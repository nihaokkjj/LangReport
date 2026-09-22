import { and, asc, desc, eq } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { GenerationJobLeaseLostError, assertGenerationJobLease, chartRevisions, claimGenerationJobLease, conversationMessages, conversations, db, dataAssets, evidenceBlocks, generationJobs, projects, recoverExpiredGenerationJobLeases, startGenerationJobLeaseHeartbeat, updateGenerationJobUnderLease, withAdvisoryLock, type GenerationJobLease } from "@langreport/db";
import { flintSpecSchema, memoryContextSchema, pluginContextSchema, pluginUsageSchema, resultSummarySchema, validationRecordSchema, validationReportSchema, type FlintSpec, type ResultSummary, type ValidationRecord, type ValidationReport } from "@langreport/contracts";
import { buildEvidenceFinding, createDerivedRevision, createInitialRevision } from "@langreport/chart";
import { createStaticSvgHtml, resolveRendererAdapter, FLINT_VERSION, RENDERER_VERSION, validateStaticSvgHtml } from "@langreport/flint-adapter";
import { buildPluginSnapshot, PluginServiceError } from "@langreport/plugins";
import { getObject, putObject, renderOutputObjectKey } from "@langreport/storage";

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
      const baseRenderValidation = storedRenderValidation?.status === "passed"
        ? storedRenderValidation
        : legacyRenderValidation();
      const ensured = await ensureStaticHtmlOutput({ job: record.job, revision: existingRevision, spec, workspaceId: record.workspaceId });
      const renderValidation = mergeRenderValidation(baseRenderValidation, ensured.htmlValidation);
      if (renderValidation.status !== "passed") {
        await failRenderJob(jobId, lease, "RENDER_VALIDATION_FAILED", "固定 Revision 导出产物未通过必要校验", {
          renderValidation,
          generationAudit: withValidationAudit(record.job.generationAudit, { renderValidation })
        });
        return;
      }
      await assertGenerationJobLease(lease);
      await persistEvidenceBlock({ job: record.job, revision: ensured.revision, spec, validation });
      await setStatus(jobId, lease, "succeeded", {
        outputs: ensured.revision.outputObjects,
        vegaLiteSpec: ensured.revision.vegaLiteSpec,
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
    const parsedResultSummary = resultSummarySchema.safeParse(record.job.resultSummary);
    if (!parsedResultSummary.success) {
      const renderValidation = failedRenderValidation("RESULT_SUMMARY_INVALID", "完整变换结果摘要缺失或不符合合同");
      await failRenderJob(jobId, lease, "RESULT_SUMMARY_INVALID", "完整变换结果摘要缺失或不符合合同", {
        planValidation,
        renderValidation,
        generationAudit: withValidationAudit(record.job.generationAudit, { planValidation, renderValidation })
      });
      return;
    }
    const resultSummary = parsedResultSummary.data;
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
    const renderer = resolveRendererAdapter(record.job.renderer);
    const rendered = await renderer.render(spec);
    const baseRenderValidation = renderer.validate(rendered);
    const generationAudit = withValidationAudit(record.job.generationAudit, { planValidation, renderValidation: baseRenderValidation });
    await setStatus(jobId, lease, "validating", {
      vegaLiteSpec: rendered.vegaLiteSpec,
      planValidation,
      renderValidation: baseRenderValidation,
      generationAudit
    });
    if (baseRenderValidation.status !== "passed") {
      await failRenderJob(jobId, lease, "RENDER_VALIDATION_FAILED", "渲染产物未通过必要校验", {
        planValidation,
        renderValidation: baseRenderValidation,
        generationAudit
      });
      return;
    }
    const htmlPreflight = validateStaticHtmlCandidate({ job: record.job, spec, svg: rendered.svg, resultSummary });
    if (htmlPreflight.status !== "passed") {
      const renderValidation = mergeRenderValidation(baseRenderValidation, htmlPreflight);
      await failRenderJob(jobId, lease, "RENDER_VALIDATION_FAILED", "固定 Revision HTML 产物未通过必要校验", {
        planValidation,
        renderValidation,
        generationAudit: withValidationAudit(record.job.generationAudit, { planValidation, renderValidation })
      });
      return;
    }
    const outputBase = {
      workspaceId: record.workspaceId,
      projectId: record.job.projectId,
      assetId: record.job.dataAssetId
    };
    const vegaLiteKey = renderOutputObjectKey({ ...outputBase, filename: `${jobId}.vega-lite.json` });
    const svgKey = renderOutputObjectKey({ ...outputBase, filename: `${jobId}.svg` });
    const pngKey = renderOutputObjectKey({ ...outputBase, filename: `${jobId}.png` });
    const htmlKey = renderOutputObjectKey({ ...outputBase, filename: `${jobId}.html` });
    await putObject({ key: vegaLiteKey, body: JSON.stringify(rendered.vegaLiteSpec), contentType: "application/json" });
    await putObject({ key: svgKey, body: rendered.svg, contentType: "image/svg+xml" });
    await putObject({ key: pngKey, body: rendered.png, contentType: "image/png" });

    const outputObjects = {
      vegaLite: vegaLiteKey,
      svg: svgKey,
      png: pngKey,
      html: htmlKey,
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
        transformPlan: record.job.transformPlan ?? undefined,
        fieldLineage: record.job.fieldLineage ?? undefined,
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
        executionAssembly: record.job.executionAssembly,
        resultSummary,
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
        executionAssembly: record.job.executionAssembly,
        resultSummary,
        outputObjects
      });
    const ensured = await ensureStaticHtmlOutput({ job: record.job, revision, spec, svg: rendered.svg, htmlKey, workspaceId: record.workspaceId });
    const renderValidation = mergeRenderValidation(baseRenderValidation, ensured.htmlValidation);
    if (renderValidation.status !== "passed") {
      await failRenderJob(jobId, lease, "RENDER_VALIDATION_FAILED", "固定 Revision 导出产物未通过必要校验", {
        planValidation,
        renderValidation,
        generationAudit: withValidationAudit(record.job.generationAudit, { planValidation, renderValidation })
      });
      return;
    }
    await assertGenerationJobLease(lease);
    await persistEvidenceBlock({ job: record.job, revision: ensured.revision, spec, validation: validation.data });
    await appendAssistantMessage(record.job.conversationId, record.job.operation === "edit"
      ? `已创建新的 Draft Chart Revision R${revision.revision}。它保留原始 Data Snapshot 和历史版本，可从结果卡片继续编辑或提交审核。`
      : `已生成一个 Draft Evidence Block（Revision R${revision.revision}）。图表、发现、指标口径、数据来源和校验记录已绑定到同一个 Data Snapshot。`);
    const finalGenerationAudit = withValidationAudit(record.job.generationAudit, { planValidation, renderValidation });
    await setStatus(jobId, lease, "succeeded", {
      outputs: ensured.revision.outputObjects,
      vegaLiteSpec: rendered.vegaLiteSpec,
      planValidation,
      renderValidation,
      generationAudit: finalGenerationAudit,
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

async function ensureStaticHtmlOutput(input: {
  job: typeof generationJobs.$inferSelect;
  revision: typeof chartRevisions.$inferSelect;
  spec: FlintSpec;
  workspaceId: string;
  svg?: string;
  htmlKey?: string;
}): Promise<{ revision: typeof chartRevisions.$inferSelect; htmlValidation: ValidationRecord }> {
  const outputObjects = isRecord(input.revision.outputObjects) ? { ...input.revision.outputObjects } : {};
  const svgKey = typeof outputObjects.svg === "string" ? outputObjects.svg : undefined;
  const svg = input.svg ?? (svgKey ? (await getObject(svgKey)).toString("utf8") : "");
  const htmlKey = typeof outputObjects.html === "string"
    ? outputObjects.html
    : input.htmlKey ?? renderOutputObjectKey({
      workspaceId: input.workspaceId,
      projectId: input.job.projectId,
      assetId: input.job.dataAssetId,
      filename: `${input.job.id}.html`
    });
  let html: string;
  try {
    html = createStaticSvgHtml({
      svg,
      revisionId: input.revision.id,
      revision: input.revision.revision,
      title: input.spec.chartSpec.title,
      finding: buildEvidenceFinding(input.spec, readResultSummary(input.revision.resultSummary ?? input.job.resultSummary)),
      snapshotId: input.revision.snapshotId,
      metricDefinition: input.job.metricDefinitionSnapshot ?? input.revision.metricDefinitionSnapshot,
      theme: input.spec.theme,
      themeVersion: input.spec.themeVersion
    });
  } catch (error) {
    return {
      revision: input.revision,
      htmlValidation: failedRenderValidation("RENDER_HTML_INVALID", error instanceof Error ? error.message : "静态 HTML 生成失败")
    };
  }
  const htmlValidation = validateStaticSvgHtml(html);
  if (htmlValidation.status !== "passed") return { revision: input.revision, htmlValidation };
  await putObject({ key: htmlKey, body: html, contentType: "text/html; charset=utf-8" });
  const nextOutputObjects = { ...outputObjects, html: htmlKey };
  const [revision] = await db.update(chartRevisions)
    .set({ outputObjects: nextOutputObjects })
    .where(eq(chartRevisions.id, input.revision.id))
    .returning();
  if (!revision) throw new Error("固定 Revision 不存在，无法保存 HTML 输出");
  return { revision, htmlValidation };
}

function mergeRenderValidation(base: ValidationRecord, html: ValidationRecord): ValidationRecord {
  const errors = [...base.errors, ...html.errors];
  return {
    status: errors.some((error) => error.severity === "error") ? "failed" : "passed",
    errors,
    validatorVersion: `${base.validatorVersion}+${html.validatorVersion}`,
    checkedAt: new Date().toISOString()
  };
}

function validateStaticHtmlCandidate(input: {
  job: typeof generationJobs.$inferSelect;
  spec: FlintSpec;
  svg: string;
  resultSummary: ResultSummary;
}): ValidationRecord {
  try {
    const html = createStaticSvgHtml({
      svg: input.svg,
      revisionId: "pending-revision",
      revision: 0,
      title: input.spec.chartSpec.title,
      finding: buildEvidenceFinding(input.spec, input.resultSummary),
      snapshotId: input.job.snapshotId,
      metricDefinition: input.job.metricDefinitionSnapshot,
      theme: input.spec.theme,
      themeVersion: input.spec.themeVersion
    });
    return validateStaticSvgHtml(html);
  } catch (error) {
    return failedRenderValidation("RENDER_HTML_INVALID", error instanceof Error ? error.message : "静态 HTML 生成失败");
  }
}

async function persistEvidenceBlock(input: {
  job: typeof generationJobs.$inferSelect;
  revision: typeof chartRevisions.$inferSelect;
  spec: FlintSpec;
  validation: ValidationReport;
}): Promise<void> {
  const warnings = input.validation.issues.filter((issue) => issue.severity === "warning");
  const resultSummary = readResultSummary(input.revision.resultSummary ?? input.job.resultSummary);
  const finding = buildEvidenceFinding(input.spec, resultSummary);
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
    resultSummary,
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

function readResultSummary(value: unknown): ResultSummary | null {
  const parsed = resultSummarySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
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
