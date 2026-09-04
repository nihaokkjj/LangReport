import { and, asc, desc, eq, or } from "drizzle-orm";
import { createHash } from "node:crypto";
import { chartRevisions, conversationMessages, conversations, db, dataAssets, evidenceBlocks, generationJobs, projects, withAdvisoryLock } from "@langreport/db";
import { flintSpecSchema, memoryContextSchema, pluginContextSchema, pluginUsageSchema, validationReportSchema, type FlintSpec, type ValidationReport } from "@langreport/contracts";
import { createDerivedRevision, createInitialRevision } from "@langreport/chart";
import { renderChart, FLINT_VERSION, RENDERER_VERSION } from "@langreport/flint-adapter";
import { buildPluginSnapshot, PluginServiceError } from "@langreport/plugins";
import { storageObjectKey } from "@langreport/storage";

const workerName = "render-worker";
const pollIntervalMs = Number(process.env.RENDER_POLL_INTERVAL_MS ?? 1000);
let polling = false;

export async function processRenderJob(jobId: string): Promise<void> {
  await withAdvisoryLock(`generation-render:${jobId}`, () => processRenderJobLocked(jobId));
}

async function processRenderJobLocked(jobId: string): Promise<void> {
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
      await persistEvidenceBlock({ job: record.job, revision: existingRevision, spec, validation });
      await db.update(generationJobs).set({
        status: "succeeded",
        outputs: existingRevision.outputObjects,
        vegaLiteSpec: existingRevision.vegaLiteSpec,
        errorCode: null,
        errorMessage: null,
        updatedAt: new Date()
      }).where(and(
        eq(generationJobs.id, jobId),
        or(eq(generationJobs.status, "rendering"), eq(generationJobs.status, "validating"))
      ));
      return;
    }
    const validation = validationReportSchema.safeParse(record.job.validation);
    if (!validation.success || !validation.data.valid) {
      await failRenderJob(jobId, "VALIDATION_FAILED", "渲染前校验未通过");
      return;
    }
    const spec = flintSpecSchema.parse(record.job.flintSpec);
    const parsedPluginContext = pluginContextSchema.safeParse(record.job.pluginContext);
    if (hasPluginContext(record.job.pluginContext) && !parsedPluginContext.success) {
      await failRenderJob(jobId, "PLUGIN_CONTEXT_INVALID", "插件上下文不符合已固化的 Schema");
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
    await setStatus(jobId, "validating", { vegaLiteSpec: rendered.vegaLiteSpec });

    const outputObjects = {
      vegaLite: vegaLiteKey,
      svg: svgKey,
      png: pngKey,
      flintVersion: FLINT_VERSION,
      rendererVersion: RENDERER_VERSION
    };
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
    await persistEvidenceBlock({ job: record.job, revision, spec, validation: validation.data });
    await appendAssistantMessage(record.job.conversationId, record.job.operation === "edit"
      ? `已创建新的 Draft Chart Revision R${revision.revision}。它保留原始 Data Snapshot 和历史版本，可从结果卡片继续编辑或提交审核。`
      : `已生成一个 Draft Evidence Block（Revision R${revision.revision}）。图表、发现、指标口径、数据来源和校验记录已绑定到同一个 Data Snapshot。`);
    await setStatus(jobId, "succeeded", {
      outputs: { vegaLite: vegaLiteKey, svg: svgKey, png: pngKey },
      vegaLiteSpec: rendered.vegaLiteSpec,
      errorCode: null,
      errorMessage: null
    });
    console.log(`${workerName} completed`, { jobId, revisionId: revision.id });
  } catch (error) {
    if (error instanceof PluginServiceError) {
      await failRenderJob(jobId, error.code, error.message);
      return;
    }
    await failRenderJob(jobId, "RENDER_FAILED", error instanceof Error ? error.message : "渲染失败");
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
    const queued = await db
      .select({ id: generationJobs.id })
      .from(generationJobs)
      .where(eq(generationJobs.status, "rendering"))
      .orderBy(asc(generationJobs.createdAt))
      .limit(1);
    const candidate = queued[0];
    if (!candidate) return;
    const [claimed] = await db
      .update(generationJobs)
      .set({ updatedAt: new Date() })
      .where(and(eq(generationJobs.id, candidate.id), eq(generationJobs.status, "rendering")))
      .returning({ id: generationJobs.id });
    if (claimed) await processRenderJob(claimed.id);
  } finally {
    polling = false;
  }
}

async function setStatus(jobId: string, status: "validating" | "succeeded", values: Record<string, unknown> = {}): Promise<void> {
  await db.update(generationJobs).set({ ...values, status, updatedAt: new Date() } as never).where(and(
    eq(generationJobs.id, jobId),
    status === "validating" ? eq(generationJobs.status, "rendering") : eq(generationJobs.status, "validating")
  ));
}

async function failRenderJob(jobId: string, errorCode: string, errorMessage: string): Promise<void> {
  await db.update(generationJobs).set({ status: "failed", errorCode, errorMessage, updatedAt: new Date() } as never).where(and(
    eq(generationJobs.id, jobId),
    or(eq(generationJobs.status, "rendering"), eq(generationJobs.status, "validating"))
  ));
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
