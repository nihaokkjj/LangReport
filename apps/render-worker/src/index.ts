import { and, asc, desc, eq } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { GenerationJobLeaseLostError, assertGenerationJobLease, chartRevisions, claimGenerationJobLease, conversationMessages, conversations, db, dataAssets, evidenceBlocks, generationJobs, projects, recoverExpiredGenerationJobLeases, startGenerationJobLeaseHeartbeat, updateGenerationJobUnderLease, withAdvisoryLock, type GenerationJobLease } from "@langreport/db";
import { flintSpecSchema, memoryContextSchema, pluginContextSchema, pluginUsageSchema, validationRecordSchema, validationReportSchema, type FlintSpec, type ValidationRecord, type ValidationReport } from "@langreport/contracts";
import { createDerivedRevision, createInitialRevision } from "@langreport/chart";
import { renderChart, validateRenderedChart, FLINT_VERSION, RENDERER_VERSION } from "@langreport/flint-adapter";
import { buildPluginSnapshot, PluginServiceError } from "@langreport/plugins";
import { storageObjectKey } from "@langreport/storage";

const workerName = "render-worker";
const pollIntervalMs = Number(process.env.RENDER_POLL_INTERVAL_MS ?? 1000);
const leaseDurationMs = Number(process.env.GENERATION_JOB_LEASE_MS ?? 30_000);
const workerInstanceId = process.env.RENDER_WORKER_ID?.trim() || `${workerName}:${randomUUID()}`;
let polling = false;

export async function processRenderJob(jobId: string): Promise<void> {
  await withAdvisoryLock(`generation-render:${jobId}`, async () => {
    const lease = await claimGenerationJobLease({
      jobId,
      owner: workerInstanceId,
      currentStatuses: ["rendering"],
      nextStatus: "rendering",
      leaseDurationMs
    });
    if (!lease) return;
    const heartbeat = startGenerationJobLeaseHeartbeat(lease);
    try {
      await processRenderJobLocked(jobId, lease);
    } catch (error) {
      if (error instanceof GenerationJobLeaseLostError || heartbeat.hasLostLease()) {
        console.warn(`${workerName} lease lost`, { jobId, fencingToken: lease.fencingToken });
        return;
      }
      const message = error instanceof Error ? error.message : "渲染失败";
      try {
        await failRenderJob(jobId, lease, "RENDER_FAILED", message);
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
  });
}

async function processRenderJobLocked(jobId: string, lease: GenerationJobLease): Promise<void> {
  const [record] = await db
    .select({
      job: generationJobs,
      asset: dataAssets,
      workspaceId: projects.workspaceId
    })
    .from(generationJobs)
    .innerJoin(dataAssets, eq(dataAssets.id, generationJobs.dataAssetId))
    .innerJoin(projects, eq(projects.id, generationJobs.projectId))
    .where(eq(generationJobs.id, jobId))
    .limit(1);
  if (!record || record.job.status !== "rendering") return;

  try {
    const [existingRevision] = await db.select().from(chartRevisions)
      .where(eq(chartRevisions.generationJobId, record.job.id)).limit(1);
    if (existingRevision) {
      const spec = flintSpecSchema.parse(existingRevision.flintSpec);
      const validation = validationReportSchema.parse(existingRevision.validation);
      const storedPlanValidation = readPlanValidation(record.job.planValidation, validation);
      const planValidation = storedPlanValidation?.status === "passed"
        ? storedPlanValidation
        : readPlanValidation(undefined, validation);
      const storedRenderValidation = readRenderValidation(record.job.renderValidation);
      const renderValidation = storedRenderValidation?.status === "passed"
        ? storedRenderValidation
        : legacyRenderValidation();
      await assertGenerationJobLease(lease);
      await persistEvidenceBlock({ job: record.job, revision: existingRevision, spec, validation });
      await setStatus(jobId, lease, "succeeded", {
        outputs: existingRevision.outputObjects,
        vegaLiteSpec: existingRevision.vegaLiteSpec,
        ...(planValidation ? { planValidation } : {}),
        renderValidation,
        generationAudit: withValidationAudit(record.job.generationAudit, { planValidation, renderValidation }),
        errorCode: null,
        errorMessage: null
      }, true);
      return;
    }
    const validation = validationReportSchema.safeParse(record.job.validation);
    const planValidation = validation.success ? readPlanValidation(record.job.planValidation, validation.data) : undefined;
    if (!validation.success || !validation.data.valid || planValidation?.status !== "passed") {
      const failedValidation = planValidation?.status === "failed"
        ? planValidation
        : failedPlanValidation("PLAN_VALIDATION_FAILED", "渲染前计划校验未通过或缺失");
      await failRenderJob(jobId, lease, "PLAN_VALIDATION_FAILED", "渲染前计划校验未通过或缺失", {
        planValidation: failedValidation,
        generationAudit: withValidationAudit(record.job.generationAudit, { planValidation: failedValidation })
      });
      return;
    }
    const spec = flintSpecSchema.parse(record.job.flintSpec);
    const parsedPluginContext = pluginContextSchema.safeParse(record.job.pluginContext);
    if (hasPluginContext(record.job.pluginContext) && !parsedPluginContext.success) {
      const renderValidation = failedRenderValidation("PLUGIN_CONTEXT_INVALID", "插件上下文不符合已固化的 Schema");
      await failRenderJob(jobId, lease, "PLUGIN_CONTEXT_INVALID", "插件上下文不符合已固化的 Schema", {
        planValidation,
        renderValidation,
        generationAudit: withValidationAudit(record.job.generationAudit, { planValidation, renderValidation })
      });
      return;
    }
    const [sourceRevision] = record.job.operation === "edit" && record.job.baseRevisionId
      ? await db.select({ pluginSnapshot: chartRevisions.pluginSnapshot }).from(chartRevisions).where(eq(chartRevisions.id, record.job.baseRevisionId)).limit(1)
      : [];
    const pluginUsage = pluginUsageSchema.safeParse(record.job.pluginUsage);
    const pluginSnapshot = record.job.operation === "edit" && sourceRevision?.pluginSnapshot
      ? sourceRevision.pluginSnapshot
      : parsedPluginContext.success
      ? await buildPluginSnapshot({ workspaceId: record.workspaceId, context: parsedPluginContext.data, rendererVersion: RENDERER_VERSION, usedCapabilities: pluginUsage.success ? pluginUsage.data.usedCapabilities : undefined })
      : sourceRevision?.pluginSnapshot ?? {};
    const rendered = await renderChart(spec);
    const renderValidation = validateRenderedChart(rendered);
    const generationAudit = withValidationAudit(record.job.generationAudit, { planValidation, renderValidation });
    await setStatus(jobId, lease, "validating", {
      vegaLiteSpec: rendered.vegaLiteSpec,
      planValidation,
      renderValidation,
      generationAudit
    });
    if (renderValidation.status !== "passed") {
      await failRenderJob(jobId, lease, "RENDER_VALIDATION_FAILED", "渲染产物未通过必要校验", {
        planValidation,
        renderValidation,
        generationAudit
      });
      return;
    }
    const outputBase = {
      workspaceId: record.workspaceId,
      projectId: record.job.projectId,
      assetId: record.job.dataAssetId,
      kind: "output" as const
    };
    const vegaLiteKey = storageObjectKey({ ...outputBase, filename: `${jobId}.vega-lite.json` });
    const svgKey = storageObjectKey({ ...outputBase, filename: `${jobId}.svg` });
    const pngKey = storageObjectKey({ ...outputBase, filename: `${jobId}.png` });
    const { putObject } = await import("@langreport/storage");
    await putObject({ key: vegaLiteKey, body: JSON.stringify(rendered.vegaLiteSpec), contentType: "application/json" });
    await putObject({ key: svgKey, body: rendered.svg, contentType: "image/svg+xml" });
    await putObject({ key: pngKey, body: rendered.png, contentType: "image/png" });

    const outputObjects = {
      vegaLite: vegaLiteKey,
      svg: svgKey,
      png: pngKey,
      flintVersion: FLINT_VERSION,
      rendererVersion: RENDERER_VERSION
    };
    await assertGenerationJobLease(lease);
    const revision = record.job.operation === "edit" && record.job.artifactId && record.job.baseRevisionId
      ? await createDerivedRevision({
        projectId: record.job.projectId,
        artifactId: record.job.artifactId,
        sourceRevisionId: record.job.baseRevisionId,
        createdBy: record.job.createdBy,
        changeReason: "edit",
        generationJobId: jobId,
        flintSpec: spec,
        themeSnapshot: {
          id: spec.theme,
          preset: spec.theme,
          version: spec.themeVersion,
          config: spec.themeConfig,
          source: record.job.themeSource,
          themeRef: parsedPluginContext.success ? parsedPluginContext.data.themeRef : null
        },
        vegaLiteSpec: rendered.vegaLiteSpec,
        validation: validation.data,
        analysisBriefSnapshot: record.job.analysisBriefSnapshot,
        metricDefinitionSnapshot: record.job.metricDefinitionSnapshot,
        memorySnapshot: memorySnapshotForRevision(record.job.memoryContext),
        pluginSnapshot,
        outputObjects
      })
      : await createInitialRevision({
        jobId,
        projectId: record.job.projectId,
        createdBy: record.job.createdBy,
        name: readTitle(spec),
        snapshotId: record.job.snapshotId,
        transformPlan: record.job.transformPlan ?? {},
        fieldLineage: record.job.fieldLineage ?? [],
        flintSpec: spec,
        themeSnapshot: {
          id: spec.theme,
          preset: spec.theme,
          version: spec.themeVersion,
          config: spec.themeConfig,
          source: record.job.themeSource,
          themeRef: parsedPluginContext.success ? parsedPluginContext.data.themeRef : null
        },
        vegaLiteSpec: rendered.vegaLiteSpec,
        validation: validation.data,
        analysisBriefSnapshot: record.job.analysisBriefSnapshot,
        metricDefinitionSnapshot: record.job.metricDefinitionSnapshot,
        memorySnapshot: memorySnapshotForRevision(record.job.memoryContext),
        pluginSnapshot,
        outputObjects
      });
    await assertGenerationJobLease(lease);
    await persistEvidenceBlock({ job: record.job, revision, spec, validation: validation.data });
    await appendAssistantMessage(record.job.conversationId, record.job.operation === "edit"
      ? `已创建新的 Draft Chart Revision R${revision.revision}。它保留原始 Data Snapshot 和历史版本，可从结果卡片继续编辑或提交审核。`
      : `已生成一个 Draft Evidence Block（Revision R${revision.revision}）。图表、发现、指标口径、数据来源和校验记录已绑定到同一个 Data Snapshot。`);
    await setStatus(jobId, lease, "succeeded", {
      outputs: { vegaLite: vegaLiteKey, svg: svgKey, png: pngKey },
      vegaLiteSpec: rendered.vegaLiteSpec,
      planValidation,
      renderValidation,
      generationAudit,
      errorCode: null,
      errorMessage: null
    }, true);
    console.log(`${workerName} completed`, { jobId, revisionId: revision.id });
  } catch (error) {
    if (error instanceof PluginServiceError) {
      const renderValidation = failedRenderValidation(error.code, error.message);
      await failRenderJob(jobId, lease, error.code, error.message, {
        renderValidation,
        generationAudit: withValidationAudit(record.job.generationAudit, { renderValidation })
      });
      return;
    }
    const message = error instanceof Error ? error.message : "渲染失败";
    const renderValidation = failedRenderValidation("RENDER_FAILED", message);
    await failRenderJob(jobId, lease, "RENDER_FAILED", message, {
      renderValidation,
      generationAudit: withValidationAudit(record.job.generationAudit, { renderValidation })
    });
  }
}

async function persistEvidenceBlock(input: {
  job: typeof generationJobs.$inferSelect;
  revision: typeof chartRevisions.$inferSelect;
  spec: FlintSpec;
  validation: ValidationReport;
}): Promise<void> {
  const warnings = input.validation.issues.filter((issue) => issue.severity === "warning");
  const finding = buildFinding(input.spec, input.job.previewData);
  const [existingForJob] = await db.select({ id: evidenceBlocks.id }).from(evidenceBlocks)
    .where(eq(evidenceBlocks.generationJobId, input.job.id)).limit(1);
  const [existingForArtifact] = input.job.artifactId
    ? await db.select({ id: evidenceBlocks.id }).from(evidenceBlocks)
      .where(eq(evidenceBlocks.chartArtifactId, input.job.artifactId))
      .orderBy(desc(evidenceBlocks.updatedAt)).limit(1)
    : [];
  const evidenceId = existingForJob?.id ?? existingForArtifact?.id;
  const values = {
    projectId: input.job.projectId,
    conversationId: input.job.conversationId,
    generationJobId: input.job.id,
    chartArtifactId: input.revision.artifactId,
    chartRevisionId: input.revision.id,
    snapshotId: input.revision.snapshotId,
    title: input.spec.chartSpec.title,
    finding,
    analysisBriefSnapshot: input.job.analysisBriefSnapshot ?? input.revision.analysisBriefSnapshot ?? {},
    metricDefinitionSnapshot: input.job.metricDefinitionSnapshot ?? input.revision.metricDefinitionSnapshot ?? {},
    qualityWarnings: warnings,
    status: "draft" as const,
    createdBy: input.job.createdBy,
    updatedAt: new Date()
  };
  if (evidenceId) {
    await db.update(evidenceBlocks).set(values).where(eq(evidenceBlocks.id, evidenceId));
    return;
  }
  await db.insert(evidenceBlocks).values(values);
}

function buildFinding(spec: FlintSpec, previewData: unknown): string {
  const rows = previewRowsOf(previewData);
  const yField = spec.chartSpec.encodings.y?.field;
  const xField = spec.chartSpec.encodings.x?.field;
  const numericRows = yField ? rows.filter((row) => typeof row[yField] === "number") : [];
  if (!xField || !yField || numericRows.length === 0) {
    return "已完成图表生成。该发现仅描述当前快照中的可视化结果，仍需 Reviewer 结合指标口径和数据质量提示确认。";
  }
  const highest = numericRows.reduce((best, row) => Number(row[yField]) > Number(best[yField]) ? row : best, numericRows[0]);
  return `当前快照按 ${xField} 聚合得到 ${numericRows.length} 个可视化数据点，${String(highest[xField] ?? "当前分组")} 的 ${yField} 数值最高。该候选发现不解释因果，也不替代人工审核。`;
}

function previewRowsOf(value: unknown): Array<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || !("rows" in value) || !Array.isArray((value as { rows?: unknown }).rows)) return [];
  return (value as { rows: unknown[] }).rows.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null && !Array.isArray(row));
}

async function appendAssistantMessage(conversationId: string, content: string): Promise<void> {
  await db.insert(conversationMessages).values({ conversationId, role: "assistant", content });
  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));
}

async function pollOnce(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    await recoverExpiredGenerationJobLeases();
    const queued = await db
      .select({ id: generationJobs.id })
      .from(generationJobs)
      .where(eq(generationJobs.status, "rendering"))
      .orderBy(asc(generationJobs.createdAt))
      .limit(1);
    const candidate = queued[0];
    if (!candidate) return;
    await processRenderJob(candidate.id);
  } finally {
    polling = false;
  }
}

async function setStatus(jobId: string, lease: GenerationJobLease, status: "validating" | "succeeded", values: Record<string, unknown> = {}, release = false): Promise<void> {
  await assertGenerationJobLease(lease);
  const updated = await updateGenerationJobUnderLease({ lease, status, values, release });
  if (!updated) throw new GenerationJobLeaseLostError(jobId);
}

async function failRenderJob(jobId: string, lease: GenerationJobLease, errorCode: string, errorMessage: string, values: Record<string, unknown> = {}): Promise<void> {
  const updated = await updateGenerationJobUnderLease({
    lease,
    status: "failed",
    release: true,
    values: { ...values, errorCode, errorMessage }
  });
  if (!updated) throw new GenerationJobLeaseLostError(jobId);
}

function readPlanValidation(value: unknown, legacyValidation: ValidationReport): ValidationRecord | undefined {
  const parsed = validationRecordSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (!legacyValidation.valid) return undefined;
  return {
    status: "passed",
    errors: legacyValidation.issues.map((issue) => ({
      code: issue.code,
      ...(issue.field ? { path: issue.field } : {}),
      message: issue.message,
      severity: issue.severity
    })),
    validatorVersion: "legacy-plan-validator-v1",
    checkedAt: new Date().toISOString()
  };
}

function readRenderValidation(value: unknown): ValidationRecord | undefined {
  const parsed = validationRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function failedPlanValidation(code: string, message: string): ValidationRecord {
  return failedValidation(code, message, "plan-validator-v1");
}

function failedRenderValidation(code: string, message: string): ValidationRecord {
  return failedValidation(code, message, "flint-render-v1");
}

function failedValidation(code: string, message: string, validatorVersion: string): ValidationRecord {
  return {
    status: "failed",
    errors: [{ code, message, severity: "error" }],
    validatorVersion,
    checkedAt: new Date().toISOString()
  };
}

function legacyRenderValidation(): ValidationRecord {
  return {
    status: "passed",
    errors: [],
    validatorVersion: "legacy-render-revision-v1",
    checkedAt: new Date().toISOString()
  };
}

function withValidationAudit(audit: unknown, validations: Partial<{ planValidation: ValidationRecord; renderValidation: ValidationRecord }>): unknown {
  if (!isRecord(audit)) return audit;
  return { ...audit, ...validations };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTitle(spec: { chartSpec: { title: string } }): string {
  return spec.chartSpec.title;
}

function memorySnapshotForRevision(value: unknown): Array<Record<string, unknown>> {
  const parsed = memoryContextSchema.safeParse(value);
  if (parsed.success) {
    return [...parsed.data.project, ...parsed.data.workspace].map((record) => ({
      id: record.id,
      scope: record.scope,
      key: record.memoryKey,
      version: record.version,
      contentHash: createHash("sha256").update(JSON.stringify(record.value)).digest("hex")
    }));
  }
  return Array.isArray(value) ? value.filter((record): record is Record<string, unknown> => typeof record === "object" && record !== null) : [];
}

function hasPluginContext(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
}

if (process.env.LANGREPORT_WORKER_TEST !== "1") {
  console.log(`${workerName} ready; polling rendering Generation Jobs.`);
  void pollOnce().catch((error) => console.error(`${workerName} initial poll failed`, error));
  setInterval(() => {
    void pollOnce().catch((error) => console.error(`${workerName} poll failed`, error));
  }, pollIntervalMs);
}
