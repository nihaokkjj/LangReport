import { and, asc, eq, lt, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { validateGenerationRevision } from "@langreport/generation";
import {
  GenerationJobLeaseLostError,
  assertGenerationJobLease,
  claimGenerationJobLease,
  db,
  chartRevisions,
  conversationMessages,
  conversations,
  dataAssets,
  dataSnapshots,
  generationJobs,
  memoryExtractionJobs,
  projects,
  recoverExpiredGenerationJobLeases,
  startGenerationJobLeaseHeartbeat,
  updateGenerationJobUnderLease,
  workspaceModelCredentials,
  type GenerationJobLease,
  type GenerationJobStatus,
} from "@langreport/db";
import { getObject } from "@langreport/storage";
import {
  applyRevisionPatch,
  freezeDerivedProvenance,
  freezeVisualRevisionInput,
  ChartServiceError,
} from "@langreport/chart";
import { executeTransformPlan, summarizeTransformResult } from "@langreport/data-engine";
import {
  chartEditPatchSchema,
  executionAssemblySchema,
  flintSpecSchema,
  transformPlanSchema,
  type ValidationRecord,
  type ValidationReport,
} from "@langreport/contracts";
import { ensureMemoryRevocationReady, processMemoryExtractionJob } from "@langreport/memory";
import { decryptWorkspaceModelCredential } from "@langreport/model-gateway";
import { PluginServiceError } from "@langreport/plugins";
import { EvidenceGenerationWorkflow } from "./evidence-generation-workflow.js";
import { pollTableIntake } from "./table-intake.js";
import { loadFrozenSnapshot, SnapshotAccessError, type FrozenSnapshotInput } from "./snapshot-access.js";

const workerName = "generation-worker";
const pollIntervalMs = Number(process.env.GENERATION_POLL_INTERVAL_MS ?? 1000);
const leaseDurationMs = Number(process.env.GENERATION_JOB_LEASE_MS ?? 30_000);
const workerInstanceId = process.env.GENERATION_WORKER_ID?.trim() || `${workerName}:${randomUUID()}`;
let polling = false;

type GenerationJobRecord = {
  job: typeof generationJobs.$inferSelect;
  snapshot: typeof dataSnapshots.$inferSelect;
  asset: typeof dataAssets.$inferSelect;
  workspaceId: string;
};

export async function processGenerationJob(jobId: string): Promise<void> {
  await ensureMemoryRevocationReady();
  const lease = await claimGenerationJobLease({
    jobId,
    owner: workerInstanceId,
    currentStatuses: ["queued"],
    nextStatus: "profiling",
    leaseDurationMs,
    incrementAttempt: true,
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
      workspaceId: projects.workspaceId,
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
      await processEditJob(jobId, job, lease);
      return;
    }
    await setStatus(jobId, lease, "profiling", { errorCode: null, errorMessage: null });

    let frozenSnapshot: FrozenSnapshotInput;
    try {
      frozenSnapshot = await loadFrozenSnapshot({
        job: {
          projectId: job.job.projectId,
          conversationId: job.job.conversationId,
          dataAssetId: job.job.dataAssetId,
          snapshotId: job.job.snapshotId,
        },
        asset: job.asset,
        snapshot: job.snapshot,
        workspaceId: job.workspaceId,
        readSnapshot: getObject,
      });
    } catch (error) {
      if (error instanceof SnapshotAccessError) {
        await failJob(jobId, lease, error.code, error.message);
        return;
      }
      throw error;
    }

    const workflowResult = await new EvidenceGenerationWorkflow(workspaceApiKeyForGeneration).run({
      job: job.job,
      snapshot: frozenSnapshot,
      workspaceId: job.workspaceId,
    });
    if (workflowResult.status === "failed") {
      await failJob(jobId, lease, workflowResult.failure.code, workflowResult.failure.message);
      return;
    }
    const { cycleResult, memoryContext } = workflowResult;
    await setStatus(jobId, lease, "planning", { memoryContext });
    if (cycleResult.status === "needs_clarification") {
      await assertGenerationJobLease(lease);
      await appendAssistantMessage(
        job.job.conversationId,
        `需要澄清：${cycleResult.proposal.question}（${cycleResult.proposal.reason}）`,
      );
      await setStatus(
        jobId,
        lease,
        "needs_clarification",
        {
          generationAudit: cycleResult.audit,
          ...validationFieldsFromAudit(cycleResult.audit),
          clarificationProposal: cycleResult.proposal,
          errorCode: "GENERATION_NEEDS_CLARIFICATION",
          errorMessage: cycleResult.proposal.question,
        },
        true,
      );
      return;
    }
    if (cycleResult.status === "failed") {
      await failJob(jobId, lease, cycleResult.error.code, cycleResult.error.message, undefined, cycleResult.audit);
      return;
    }
    const artifacts = cycleResult.artifacts;
    const resultSummary = summarizeTransformResult({
      sourceRowCount: frozenSnapshot.rows.length,
      transform: artifacts.transform,
      previewLimit: 500,
      qualityWarnings: artifacts.validation.issues
        .filter((issue) => issue.severity === "warning")
        .map((issue) => `${issue.code}: ${issue.message}`),
    });
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
        steps: artifacts.transform.steps,
      },
      resultSummary,
    });
    await setStatus(jobId, lease, "compiling", { flintSpec: artifacts.flintSpec });
    if (!artifacts.validation.valid) {
      await failJob(
        jobId,
        lease,
        "VALIDATION_FAILED",
        "Flint Spec 未通过必要校验",
        artifacts.validation,
        cycleResult.audit,
      );
      return;
    }
    await setStatus(jobId, lease, "rendering", {}, true);
    console.log(`${workerName} handed off to render-worker`, { jobId, repairCount: artifacts.repairCount });
    return;
  } catch (error) {
    if (error instanceof PluginServiceError) {
      await failJob(jobId, lease, error.code, error.message);
      return;
    }
    throw error;
  }
}

async function processEditJob(jobId: string, record: GenerationJobRecord, lease: GenerationJobLease): Promise<void> {
  const job = record.job;
  if (!job.baseRevisionId || !job.artifactId) {
    await failJob(jobId, lease, "EDIT_INPUT_INVALID", "编辑任务缺少基础 Revision");
    return;
  }
  await setStatus(jobId, lease, "planning", { errorCode: null, errorMessage: null });
  const [source] = await db.select().from(chartRevisions).where(eq(chartRevisions.id, job.baseRevisionId)).limit(1);
  if (!source || source.artifactId !== job.artifactId || source.snapshotId !== job.snapshotId) {
    await failJob(jobId, lease, "EDIT_SOURCE_NOT_FOUND", "基础 Revision 不属于当前图表产物");
    return;
  }
  try {
    let frozenSnapshot: FrozenSnapshotInput;
    const frozenProvenance = freezeDerivedProvenance(source);
    const patch = chartEditPatchSchema.parse(job.editPatch);
    const visual = freezeVisualRevisionInput(source, patch);
    if (visual) {
      const validation = validateGenerationRevision(visual.flintSpec);
      const planValidation = planValidationFromReport(validation);
      const renderValidation = pendingRenderValidation();
      await setStatus(jobId, lease, "transforming", {
        ...frozenProvenance,
        transformPlan: visual.transformPlan,
        fieldLineage: visual.fieldLineage,
        resultSummary: visual.resultSummary,
        previewData: {
          columns: visual.resultSummary.columns,
          rows: visual.flintSpec.data.values.slice(0, 500),
          steps: [],
        },
      });
      await setStatus(jobId, lease, "compiling", {
        flintSpec: visual.flintSpec,
        validation,
        planValidation,
        renderValidation,
      });
      if (!validation.valid) {
        await failJob(jobId, lease, "VALIDATION_FAILED", "编辑后的 Flint Spec 未通过必要校验", validation);
        return;
      }
      await setStatus(jobId, lease, "rendering", {}, true);
      return;
    }
    try {
      frozenSnapshot = await loadFrozenSnapshot({
        job: {
          projectId: job.projectId,
          conversationId: job.conversationId,
          dataAssetId: job.dataAssetId,
          snapshotId: job.snapshotId,
        },
        asset: record.asset,
        snapshot: record.snapshot,
        workspaceId: record.workspaceId,
        readSnapshot: getObject,
      });
    } catch (error) {
      if (error instanceof SnapshotAccessError) {
        await failJob(jobId, lease, error.code, error.message);
        return;
      }
      throw error;
    }
    const spec = flintSpecSchema.parse(source.flintSpec);
    const plan = transformPlanSchema.parse(patch.transformPlan ?? source.transformPlan);
    const sourceAssembly =
      source.executionAssembly === null ? null : executionAssemblySchema.parse(source.executionAssembly);
    const transform = executeTransformPlan(plan, frozenSnapshot.rows, sourceAssembly?.transformExecutorVersion ?? "v1");
    const editedSpec = applyRevisionPatch(spec, patch);
    editedSpec.data.values = transform.rows;
    editedSpec.semanticTypes = semanticTypesForEditedSpec(spec.semanticTypes, transform.columns, transform.lineage);
    const validation = validateGenerationRevision(editedSpec);
    const resultSummary = summarizeTransformResult({
      sourceRowCount: frozenSnapshot.rows.length,
      transform,
      previewLimit: 500,
      qualityWarnings: validation.issues
        .filter((issue) => issue.severity === "warning")
        .map((issue) => `${issue.code}: ${issue.message}`),
    });
    const planValidation = planValidationFromReport(validation);
    const renderValidation = pendingRenderValidation();
    await setStatus(jobId, lease, "transforming", {
      transformPlan: plan,
      fieldLineage: transform.lineage,
      ...frozenProvenance,
      validation,
      planValidation,
      renderValidation,
      previewData: {
        columns: transform.columns,
        rows: transform.rows.slice(0, 500),
        steps: transform.steps,
      },
      resultSummary,
    });
    await setStatus(jobId, lease, "compiling", { flintSpec: editedSpec, validation, planValidation, renderValidation });
    if (!validation.valid) {
      await failJob(jobId, lease, "VALIDATION_FAILED", "编辑后的 Flint Spec 未通过必要校验", validation);
      return;
    }
    await setStatus(jobId, lease, "rendering", {}, true);
  } catch (error) {
    await failJob(
      jobId,
      lease,
      error instanceof ChartServiceError ? error.code : "EDIT_INVALID",
      error instanceof Error ? error.message : "图表编辑失败",
    );
  }
}

function semanticTypesForEditedSpec(
  sourceTypes: Record<string, string>,
  columns: string[],
  lineage: Array<{ outputColumn: string; operation: string }>,
): Record<string, string> {
  return Object.fromEntries(
    columns.map((column) => {
      const existing = sourceTypes[column];
      if (existing) return [column, existing];
      const line = lineage.find((item) => item.outputColumn === column);
      return [
        column,
        line?.operation.startsWith("aggregate:") || line?.operation.startsWith("derive:") ? "Quantity" : "Category",
      ];
    }),
  );
}

async function pollOnce(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    await ensureMemoryRevocationReady();
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
      .where(
        or(
          eq(memoryExtractionJobs.status, "queued"),
          and(eq(memoryExtractionJobs.status, "failed"), lt(memoryExtractionJobs.attemptCount, 3)),
        ),
      )
      .orderBy(asc(memoryExtractionJobs.createdAt))
      .limit(1);
    if (extractionQueue[0]) await processMemoryExtractionJob(extractionQueue[0].id);
  } finally {
    polling = false;
  }
}

async function setStatus(
  jobId: string,
  lease: GenerationJobLease,
  status: GenerationJobStatus,
  values: Record<string, unknown> = {},
  release = false,
): Promise<void> {
  await assertGenerationJobLease(lease);
  const updated = await updateGenerationJobUnderLease({ lease, status, values, release });
  if (!updated) throw new GenerationJobLeaseLostError(jobId);
}

async function failJob(
  jobId: string,
  lease: GenerationJobLease,
  errorCode: string,
  errorMessage: string,
  validation?: unknown,
  generationAudit?: unknown,
): Promise<void> {
  const updated = await updateGenerationJobUnderLease({
    lease,
    status: "failed",
    release: true,
    values: {
      errorCode,
      errorMessage,
      ...(validation ? { validation } : {}),
      ...(generationAudit ? { generationAudit } : {}),
      ...validationFieldsFromAudit(generationAudit),
    },
  });
  if (!updated) throw new GenerationJobLeaseLostError(jobId);
}

async function appendAssistantMessage(conversationId: string, content: string): Promise<void> {
  await db.insert(conversationMessages).values({ conversationId, role: "assistant", content });
  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));
}

function hasRecordValues(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
}

/**
 * A Workspace credential overrides the deployment fallback for future calls.
 * The key is held only in this local variable while constructing the gateway;
 * no Job, audit, log or model-route snapshot receives it.
 */
async function workspaceApiKeyForGeneration(workspaceId: string): Promise<string | undefined> {
  const [credential] = await db
    .select({ encryptedApiKey: workspaceModelCredentials.encryptedApiKey })
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
    ...(audit.renderValidation ? { renderValidation: audit.renderValidation } : {}),
  };
}

function planValidationFromReport(validation: ValidationReport): ValidationRecord {
  return {
    status: validation.valid ? "passed" : "failed",
    errors: validation.issues.map((issue) => ({
      code: issue.code,
      ...(issue.field ? { path: issue.field } : {}),
      message: issue.message,
      severity: issue.severity,
    })),
    validatorVersion: "plan-validator-v1",
    checkedAt: new Date().toISOString(),
  };
}

function pendingRenderValidation(): ValidationRecord {
  return { status: "pending", errors: [], validatorVersion: "flint-render-v1" };
}

if (process.env.LANGREPORT_WORKER_TEST !== "1") {
  await ensureMemoryRevocationReady();
  console.log(`${workerName} ready; polling PostgreSQL-backed Generation Jobs.`);
  // Separate lane: a slow cloud import must not block the chart-generation queue.
  const pollIntake = () =>
    void pollTableIntake(workspaceApiKeyForGeneration).catch(() =>
      console.error(`${workerName} table intake poll failed`),
    );
  pollIntake();
  setInterval(pollIntake, pollIntervalMs);
  void pollOnce().catch((error) => console.error(`${workerName} initial poll failed`, error));
  setInterval(() => {
    void pollOnce().catch((error) => console.error(`${workerName} poll failed`, error));
  }, pollIntervalMs);
}
