import { and, asc, eq, lt, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { GenerationCycle, validateCanonicalTextContextProjection, validateGenerationRevision } from "@langreport/generation";
import { GenerationJobLeaseLostError, assertGenerationJobLease, claimGenerationJobLease, db, chartRevisions, conversationMessages, conversations, dataAssets, dataSnapshots, generationJobs, memoryExtractionJobs, projects, recoverExpiredGenerationJobLeases, startGenerationJobLeaseHeartbeat, updateGenerationJobUnderLease, workspaceModelCredentials, type GenerationJobLease, type GenerationJobStatus } from "@langreport/db";
import { getObject } from "@langreport/storage";
import type { ColumnProfile, DataRow } from "@langreport/data-engine";
import { applyRevisionPatch } from "@langreport/chart";
import { chartEditPatchSchema, flintSpecSchema, memoryContextSchema, modelRouteSnapshotSchema, pluginUsageSchema, themePresetSchema, type ModelRouteSnapshot, type TransformPlan, type ValidationRecord, type ValidationReport } from "@langreport/contracts";
import { getMemoryContextForGeneration, processMemoryExtractionJob } from "@langreport/memory";
import { createBailianQwenGateway, decryptWorkspaceModelCredential, ModelCredentialEncryptionError, ModelGatewayConfigurationError, resolveModelRouteSnapshot } from "@langreport/model-gateway";
import { pluginContextSchema } from "@langreport/contracts";
import { PluginServiceError, resolvePluginContextForWorkspace } from "@langreport/plugins";
import { resolveThemePayload } from "@langreport/plugin-sdk";

const workerName = "generation-worker";
const pollIntervalMs = Number(process.env.GENERATION_POLL_INTERVAL_MS ?? 1000);
const leaseDurationMs = Number(process.env.GENERATION_JOB_LEASE_MS ?? 30_000);
const workerInstanceId = process.env.GENERATION_WORKER_ID?.trim() || `${workerName}:${randomUUID()}`;
let polling = false;

export async function processGenerationJob(jobId: string): Promise<void> {
  const lease = await claimGenerationJobLease({
    jobId,
    owner: workerInstanceId,
    currentStatuses: ["queued"],
    nextStatus: "profiling",
    leaseDurationMs,
    incrementAttempt: true
  });
  if (!lease) return;
  const heartbeat = startGenerationJobLeaseHeartbeat(lease);
  try {
    await processClaimedGenerationJob(jobId, lease);
  } catch (error) {
    if (error instanceof GenerationJobLeaseLostError || heartbeat.hasLostLease()) {
      console.warn(`${workerName} lease lost`, { jobId, fencingToken: lease.fencingToken });
      return;
    }
    const message = error instanceof Error ? error.message : "生成失败";
    console.error(`${workerName} failed`, { jobId, error: message });
    try {
      await failJob(jobId, lease, "GENERATION_FAILED", message);
    } catch (failureError) {
      if (failureError instanceof GenerationJobLeaseLostError) {
        console.warn(`${workerName} lease lost before failure commit`, { jobId, fencingToken: lease.fencingToken });
        return;
      }
      throw failureError;
    }
  } finally {
    heartbeat.stop();
  }
}

async function processClaimedGenerationJob(jobId: string, lease: GenerationJobLease): Promise<void> {
  const [job] = await db
    .select({
      job: generationJobs,
      snapshot: dataSnapshots,
      asset: dataAssets,
      workspaceId: projects.workspaceId
    })
    .from(generationJobs)
    .innerJoin(dataSnapshots, eq(dataSnapshots.id, generationJobs.snapshotId))
    .innerJoin(dataAssets, eq(dataAssets.id, generationJobs.dataAssetId))
    .innerJoin(projects, eq(projects.id, generationJobs.projectId))
    .where(eq(generationJobs.id, jobId))
    .limit(1);
  if (!job) return;

  try {
    if (job.job.operation === "edit") {
      await processEditJob(jobId, job.job, lease);
      return;
    }
    await setStatus(jobId, lease, "profiling", { errorCode: null, errorMessage: null });
    const snapshotPayload = JSON.parse((await getObject(job.snapshot.normalizedObjectKey)).toString("utf8")) as { rows: DataRow[] };
    const profiles = job.snapshot.schema as unknown as ColumnProfile[];
    if (!Array.isArray(snapshotPayload.rows) || !Array.isArray(profiles)) throw new Error("Data Snapshot 内容无效");

    const storedMemoryContext = memoryContextSchema.safeParse(job.job.memoryContext);
    const memoryContext = storedMemoryContext.success
      ? storedMemoryContext.data
      : await getMemoryContextForGeneration({
        projectId: job.job.projectId,
        conversationId: job.job.conversationId,
        userId: job.job.createdBy,
        prompt: job.job.prompt
      });
    let storedConversationProjection;
    try {
      storedConversationProjection = readStoredConversationProjection(job.job.conversationProjection);
    } catch (error) {
      await failJob(
        jobId,
        lease,
        "CONVERSATION_PROJECTION_INVALID",
        error instanceof Error ? error.message : "已固化的 Conversation 上下文投影不符合版本化合同"
      );
      return;
    }
    let pluginManifests = [] as Awaited<ReturnType<typeof resolvePluginContextForWorkspace>>;
    const pluginContext = pluginContextSchema.safeParse(job.job.pluginContext);
    if (!pluginContext.success && hasPluginContext(job.job.pluginContext)) {
      await failJob(jobId, lease, "PLUGIN_CONTEXT_INVALID", "插件上下文不符合已固化的 Schema");
      return;
    }
    if (pluginContext.success) pluginManifests = await resolvePluginContextForWorkspace(job.workspaceId, pluginContext.data);
    const pluginThemeRef = pluginContext.success && pluginContext.data.themeRef?.source === "plugin" ? pluginContext.data.themeRef : null;
    const pluginThemeManifest = pluginThemeRef
      ? pluginManifests.find((manifest) => manifest.pluginId === pluginThemeRef.pluginId && manifest.version === pluginThemeRef.version && manifest.contentHash === pluginThemeRef.contentHash)
      : undefined;
    const themeConfig = pluginThemeRef && pluginThemeManifest
      ? resolveThemePayload(pluginThemeManifest, pluginThemeRef.capabilityId)
      : asRecord(job.job.themeConfig);
    let modelRoute: ModelRouteSnapshot;
    let generationCycle: GenerationCycle;
    try {
      modelRoute = readStoredModelRoute(job.job.modelRoute);
      const workspaceApiKey = modelRoute.generationMode === "llm"
        ? await workspaceApiKeyForGeneration(job.workspaceId)
        : undefined;
      generationCycle = modelRoute.generationMode === "llm"
        ? new GenerationCycle(createBailianQwenGateway(modelRoute, workspaceApiKey ? { BAILIAN_API_KEY: workspaceApiKey } : process.env))
        : new GenerationCycle();
    } catch (error) {
      const message = error instanceof Error ? error.message : "模型路由配置无效";
      await failJob(jobId, lease, error instanceof ModelCredentialEncryptionError ? "MODEL_CREDENTIAL_UNAVAILABLE" : error instanceof ModelGatewayConfigurationError ? "MODEL_ROUTE_CONFIGURATION_INVALID" : "MODEL_ROUTE_INVALID", message);
      return;
    }
    await setStatus(jobId, lease, "planning", { memoryContext });
    const theme = themePresetSchema.parse(job.job.theme);
    const budget = { deadlineAt: Date.now() + 30_000, maxOutputTokens: 2_000 };
    const cycleResult = await generationCycle.run({
      cycle: {
        workspaceId: job.workspaceId,
        projectId: job.job.projectId,
        generationJobId: job.job.id,
        invocationId: `${job.job.id}:${job.job.attemptCount + 1}`,
        routeSnapshotId: modelRoute.routeSnapshotId,
        budget
      },
      prompt: job.job.prompt,
      profiles,
      rows: snapshotPayload.rows,
      analysisBriefSnapshot: asRecord(job.job.analysisBriefSnapshot),
      metricDefinitionSnapshot: asRecord(job.job.metricDefinitionSnapshot),
      conversationProjection: storedConversationProjection,
      theme,
      themeVersion: job.job.themeVersion,
      themeConfig,
      pluginThemeRef,
      memoryContext,
      pluginManifests,
      plan: isTransformPlan(job.job.transformPlan) ? job.job.transformPlan : undefined,
      requestedProfile: modelRoute.profileId,
      effectiveProfile: modelRoute.profileId,
      requestedOptions: { ...modelRoute.requestedOptions, maxOutputTokens: budget.maxOutputTokens },
      effectiveOptions: { ...modelRoute.effectiveOptions, maxOutputTokens: budget.maxOutputTokens }
    });
    if (cycleResult.status === "needs_clarification") {
      await assertGenerationJobLease(lease);
      await appendAssistantMessage(
        job.job.conversationId,
        cycleResult.questions.map((question) => `需要澄清：${question.question}${question.reason ? `（${question.reason}）` : ""}`).join("\n")
      );
      await setStatus(jobId, lease, "needs_clarification", {
        generationAudit: cycleResult.audit,
        ...validationFieldsFromAudit(cycleResult.audit),
        clarificationQuestions: cycleResult.questions,
        errorCode: "GENERATION_NEEDS_CLARIFICATION",
        errorMessage: cycleResult.questions.map((question) => question.question).join("；")
      }, true);
      return;
    }
    if (cycleResult.status === "failed") {
      await failJob(jobId, lease, cycleResult.error.code, cycleResult.error.message, undefined, cycleResult.audit);
      return;
    }
    const artifacts = cycleResult.artifacts;
    await setStatus(jobId, lease, "transforming", {
      generationAudit: cycleResult.audit,
      ...validationFieldsFromAudit(cycleResult.audit),
      intent: artifacts.intent,
      transformPlan: artifacts.plan,
      fieldLineage: artifacts.transform.lineage,
      validation: artifacts.validation,
      pluginUsage: artifacts.pluginUsage,
      repairCount: artifacts.repairCount,
      previewData: {
        columns: artifacts.transform.columns,
        rows: artifacts.transform.rows.slice(0, 500),
        steps: artifacts.transform.steps
      }
    });

    await setStatus(jobId, lease, "compiling", { flintSpec: artifacts.flintSpec });
    if (!artifacts.validation.valid) {
      await failJob(jobId, lease, "VALIDATION_FAILED", "Flint Spec 未通过必要校验", artifacts.validation, cycleResult.audit);
      return;
    }

    await setStatus(jobId, lease, "rendering", {}, true);
    console.log(`${workerName} handed off to render-worker`, { jobId, repairCount: artifacts.repairCount });
  } catch (error) {
    if (error instanceof PluginServiceError) {
      await failJob(jobId, lease, error.code, error.message);
      return;
    }
    throw error;
  }
}

async function processEditJob(jobId: string, job: typeof generationJobs.$inferSelect, lease: GenerationJobLease): Promise<void> {
  if (!job.baseRevisionId || !job.artifactId) {
    await failJob(jobId, lease, "EDIT_INPUT_INVALID", "编辑任务缺少基础 Revision");
    return;
  }
  await setStatus(jobId, lease, "planning", { errorCode: null, errorMessage: null });
  const [source] = await db.select().from(chartRevisions)
    .where(eq(chartRevisions.id, job.baseRevisionId))
    .limit(1);
  if (!source || source.artifactId !== job.artifactId) {
    await failJob(jobId, lease, "EDIT_SOURCE_NOT_FOUND", "基础 Revision 不属于当前图表产物");
    return;
  }
  try {
    const spec = flintSpecSchema.parse(source.flintSpec);
    const patch = chartEditPatchSchema.parse(job.editPatch);
    const editedSpec = applyRevisionPatch(spec, patch);
    const validation = validateGenerationRevision(editedSpec);
    const planValidation = planValidationFromReport(validation);
    const renderValidation = pendingRenderValidation();
    const [sourceJob] = source.generationJobId
      ? await db.select({ previewData: generationJobs.previewData }).from(generationJobs).where(eq(generationJobs.id, source.generationJobId)).limit(1)
      : [];
    await setStatus(jobId, lease, "transforming", {
      transformPlan: source.transformPlan,
      fieldLineage: source.fieldLineage,
      memoryContext: job.memoryContext ?? source.memorySnapshot ?? [],
      validation,
      planValidation,
      renderValidation,
      previewData: sourceJob?.previewData ?? null
    });
    await setStatus(jobId, lease, "compiling", { flintSpec: editedSpec, validation, planValidation, renderValidation });
    if (!validation.valid) {
      await failJob(jobId, lease, "VALIDATION_FAILED", "编辑后的 Flint Spec 未通过必要校验", validation);
      return;
    }
    await setStatus(jobId, lease, "rendering", {}, true);
  } catch (error) {
    await failJob(jobId, lease, "EDIT_INVALID", error instanceof Error ? error.message : "图表编辑失败");
  }
}

async function pollOnce(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    await recoverExpiredGenerationJobLeases();
    const queued = await db
      .select({ id: generationJobs.id })
      .from(generationJobs)
      .where(eq(generationJobs.status, "queued"))
      .orderBy(asc(generationJobs.createdAt))
      .limit(1);
    const candidate = queued[0];
    if (candidate) {
      await processGenerationJob(candidate.id);
      return;
    }
    const extractionQueue = await db
      .select({ id: memoryExtractionJobs.id })
      .from(memoryExtractionJobs)
      .where(or(
        eq(memoryExtractionJobs.status, "queued"),
        and(eq(memoryExtractionJobs.status, "failed"), lt(memoryExtractionJobs.attemptCount, 3))
      ))
      .orderBy(asc(memoryExtractionJobs.createdAt))
      .limit(1);
    if (extractionQueue[0]) await processMemoryExtractionJob(extractionQueue[0].id);
  } finally {
    polling = false;
  }
}

async function setStatus(jobId: string, lease: GenerationJobLease, status: GenerationJobStatus, values: Record<string, unknown> = {}, release = false): Promise<void> {
  await assertGenerationJobLease(lease);
  const updated = await updateGenerationJobUnderLease({ lease, status, values, release });
  if (!updated) throw new GenerationJobLeaseLostError(jobId);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function failJob(jobId: string, lease: GenerationJobLease, errorCode: string, errorMessage: string, validation?: unknown, generationAudit?: unknown): Promise<void> {
  const updated = await updateGenerationJobUnderLease({
    lease,
    status: "failed",
    release: true,
    values: {
    errorCode,
    errorMessage,
    ...(validation ? { validation } : {}),
    ...(generationAudit ? { generationAudit } : {}),
    ...validationFieldsFromAudit(generationAudit)
    }
  });
  if (!updated) throw new GenerationJobLeaseLostError(jobId);
}

async function appendAssistantMessage(conversationId: string, content: string): Promise<void> {
  await db.insert(conversationMessages).values({ conversationId, role: "assistant", content });
  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));
}

function isTransformPlan(value: unknown): value is TransformPlan {
  return typeof value === "object" && value !== null && "version" in value && "steps" in value && "expectedColumns" in value;
}

function hasPluginContext(value: unknown): boolean {
  return hasRecordValues(value);
}

function hasRecordValues(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
}

function readStoredConversationProjection(value: unknown) {
  if (!hasRecordValues(value)) return undefined;
  return validateCanonicalTextContextProjection(value);
}

function readStoredModelRoute(value: unknown): ModelRouteSnapshot {
  if (!hasRecordValues(value)) {
    // Only pre-M1 Jobs have an empty default. They are deliberately kept on
    // the offline path rather than inheriting whatever llm route is live now.
    return resolveModelRouteSnapshot({ GENERATION_MODE: "deterministic" });
  }
  const parsed = modelRouteSnapshotSchema.safeParse(value);
  if (!parsed.success) throw new Error("已冻结的模型路由不符合版本化合同");
  return parsed.data;
}

/**
 * A Workspace credential overrides the deployment fallback for future calls.
 * The key is held only in this local variable while constructing the gateway;
 * no Job, audit, log or model-route snapshot receives it.
 */
async function workspaceApiKeyForGeneration(workspaceId: string): Promise<string | undefined> {
  const [credential] = await db.select({ encryptedApiKey: workspaceModelCredentials.encryptedApiKey })
    .from(workspaceModelCredentials)
    .where(eq(workspaceModelCredentials.workspaceId, workspaceId))
    .limit(1);
  if (!credential) return undefined;
  return decryptWorkspaceModelCredential(credential.encryptedApiKey, process.env.MODEL_CREDENTIAL_ENCRYPTION_KEY);
}

function validationFieldsFromAudit(generationAudit: unknown): Record<string, unknown> {
  if (!hasRecordValues(generationAudit)) return {};
  const audit = generationAudit as Record<string, unknown>;
  return {
    ...(audit.planValidation ? { planValidation: audit.planValidation } : {}),
    ...(audit.renderValidation ? { renderValidation: audit.renderValidation } : {})
  };
}

function planValidationFromReport(validation: ValidationReport): ValidationRecord {
  return {
    status: validation.valid ? "passed" : "failed",
    errors: validation.issues.map((issue) => ({
      code: issue.code,
      ...(issue.field ? { path: issue.field } : {}),
      message: issue.message,
      severity: issue.severity
    })),
    validatorVersion: "plan-validator-v1",
    checkedAt: new Date().toISOString()
  };
}

function pendingRenderValidation(): ValidationRecord {
  return { status: "pending", errors: [], validatorVersion: "flint-render-v1" };
}

if (process.env.LANGREPORT_WORKER_TEST !== "1") {
  console.log(`${workerName} ready; polling PostgreSQL-backed Generation Jobs.`);
  void pollOnce().catch((error) => console.error(`${workerName} initial poll failed`, error));
  setInterval(() => {
    void pollOnce().catch((error) => console.error(`${workerName} poll failed`, error));
  }, pollIntervalMs);
}
