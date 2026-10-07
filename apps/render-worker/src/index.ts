import { asc, eq } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import {
  GenerationJobLeaseLostError,
  assertGenerationJobLease,
  chartRevisions,
  claimGenerationJobLease,
  db,
  dataAssets,
  generationJobs,
  projects,
  recoverExpiredGenerationJobLeases,
  reserveGenerationRevisionIdentity,
  startGenerationJobLeaseHeartbeat,
  updateGenerationJobUnderLease,
  withAdvisoryLock,
  type GenerationJobLease,
  type ReservedRevisionIdentity,
} from "@langreport/db";
import {
  flintSpecSchema,
  memoryContextSchema,
  pluginContextSchema,
  pluginUsageSchema,
  resultSummarySchema,
  validationRecordSchema,
  validationReportSchema,
  type FlintSpec,
  type ResultSummary,
  type ValidationRecord,
  type ValidationReport,
} from "@langreport/contracts";
import { findingForGenerationJob, publicProjectMemoryReferences } from "@langreport/chart";
import {
  ChartPointBudgetError,
  createStaticSvgHtml,
  resolveRendererAdapter,
  FLINT_VERSION,
  RENDERER_VERSION,
  validateStaticSvgHtml,
} from "@langreport/flint-adapter";
import { buildPluginSnapshot, PluginServiceError } from "@langreport/plugins";
import { getObject, putObject, renderOutputObjectKey } from "@langreport/storage";
import { ensureMemoryRevocationReady } from "@langreport/memory";
import { commitCompletedRevision, readCommittedRevision } from "./publication.js";

const workerName = "render-worker";
const pollIntervalMs = Number(process.env.RENDER_POLL_INTERVAL_MS ?? 1000);
const leaseDurationMs = Number(process.env.GENERATION_JOB_LEASE_MS ?? 30_000);
const workerInstanceId = process.env.RENDER_WORKER_ID?.trim() || `${workerName}:${randomUUID()}`;
let polling = false;

class CandidateOutputMismatchError extends Error {
  constructor(format: string) {
    super(`候选输出 ${format} 读回内容与待发布字节不一致`);
    this.name = "CandidateOutputMismatchError";
  }
}

export async function processRenderJob(
  jobId: string,
  writeOutput: typeof putObject = putObject,
  publish: typeof commitCompletedRevision = commitCompletedRevision,
): Promise<void> {
  await ensureMemoryRevocationReady();
  await withAdvisoryLock(`generation-render:${jobId}`, async () => {
    const lease = await claimGenerationJobLease({
      jobId,
      owner: workerInstanceId,
      currentStatuses: ["rendering"],
      nextStatus: "rendering",
      leaseDurationMs,
    });
    if (!lease) return;
    const heartbeat = startGenerationJobLeaseHeartbeat(lease);
    try {
      await processRenderJobLocked(jobId, lease, writeOutput, publish);
    } catch (error) {
      if (error instanceof GenerationJobLeaseLostError || heartbeat.hasLostLease()) {
        console.warn(`${workerName} lease lost`, { jobId, fencingToken: lease.fencingToken });
        return;
      }
      if (await readCommittedRevision(jobId)) return;
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

async function processRenderJobLocked(
  jobId: string,
  lease: GenerationJobLease,
  writeOutput: typeof putObject,
  publish: typeof commitCompletedRevision,
): Promise<void> {
  const [record] = await db
    .select({
      job: generationJobs,
      asset: dataAssets,
      workspaceId: projects.workspaceId,
    })
    .from(generationJobs)
    .innerJoin(dataAssets, eq(dataAssets.id, generationJobs.dataAssetId))
    .innerJoin(projects, eq(projects.id, generationJobs.projectId))
    .where(eq(generationJobs.id, jobId))
    .limit(1);
  if (!record || record.job.status !== "rendering") return;

  try {
    const [existingRevision] = await db
      .select()
      .from(chartRevisions)
      .where(eq(chartRevisions.generationJobId, record.job.id))
      .limit(1);
    if (existingRevision) {
      throw new Error("Generation Job 已有 Chart Revision 但尚未成功，拒绝修改既有版本");
    }
    const clearedCandidateManifest = await updateGenerationJobUnderLease({
      lease,
      values: { candidateOutputManifest: null },
    });
    if (!clearedCandidateManifest) throw new GenerationJobLeaseLostError(jobId);
    const validation = validationReportSchema.safeParse(record.job.validation);
    const planValidation = validation.success
      ? readPlanValidation(record.job.planValidation, validation.data)
      : undefined;
    if (!validation.success || !validation.data.valid || planValidation?.status !== "passed") {
      const failedValidation =
        planValidation?.status === "failed"
          ? planValidation
          : failedPlanValidation("PLAN_VALIDATION_FAILED", "渲染前计划校验未通过或缺失");
      await failRenderJob(jobId, lease, "PLAN_VALIDATION_FAILED", "渲染前计划校验未通过或缺失", {
        planValidation: failedValidation,
        generationAudit: withValidationAudit(record.job.generationAudit, { planValidation: failedValidation }),
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
        generationAudit: withValidationAudit(record.job.generationAudit, { planValidation, renderValidation }),
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
        generationAudit: withValidationAudit(record.job.generationAudit, { planValidation, renderValidation }),
      });
      return;
    }
    const [sourceRevision] =
      record.job.operation === "edit" && record.job.baseRevisionId
        ? await db
            .select({ pluginSnapshot: chartRevisions.pluginSnapshot })
            .from(chartRevisions)
            .where(eq(chartRevisions.id, record.job.baseRevisionId))
            .limit(1)
        : [];
    const pluginUsage = pluginUsageSchema.safeParse(record.job.pluginUsage);
    const pluginSnapshot =
      record.job.operation === "edit" && sourceRevision?.pluginSnapshot
        ? sourceRevision.pluginSnapshot
        : parsedPluginContext.success
          ? await buildPluginSnapshot({
              workspaceId: record.workspaceId,
              context: parsedPluginContext.data,
              rendererVersion: RENDERER_VERSION,
              usedCapabilities: pluginUsage.success ? pluginUsage.data.usedCapabilities : undefined,
            })
          : (sourceRevision?.pluginSnapshot ?? {});
    const renderer = resolveRendererAdapter(record.job.renderer);
    const rendered = await renderer.render(spec);
    const baseRenderValidation = await renderer.validate(rendered);
    const generationAudit = withValidationAudit(record.job.generationAudit, {
      planValidation,
      renderValidation: baseRenderValidation,
    });
    await setStatus(jobId, lease, "validating", {
      vegaLiteSpec: rendered.vegaLiteSpec,
      planValidation,
      renderValidation: baseRenderValidation,
      generationAudit,
    });
    if (baseRenderValidation.status !== "passed") {
      await failRenderJob(jobId, lease, "RENDER_VALIDATION_FAILED", "渲染产物未通过必要校验", {
        planValidation,
        renderValidation: baseRenderValidation,
        generationAudit,
      });
      return;
    }
    const reservedRevision = await reserveGenerationRevisionIdentity(lease);
    const htmlCandidate = buildStaticHtmlCandidate({
      job: record.job,
      spec,
      svg: rendered.svg,
      resultSummary,
      reservedRevision,
    });
    const htmlPreflight = htmlCandidate.validation;
    if (htmlPreflight.status !== "passed") {
      const renderValidation = mergeRenderValidation(baseRenderValidation, htmlPreflight);
      await failRenderJob(jobId, lease, "RENDER_VALIDATION_FAILED", "固定 Revision HTML 产物未通过必要校验", {
        planValidation,
        renderValidation,
        generationAudit: withValidationAudit(record.job.generationAudit, { planValidation, renderValidation }),
      });
      return;
    }
    const renderValidation = mergeRenderValidation(baseRenderValidation, htmlPreflight);
    const outputBase = {
      workspaceId: record.workspaceId,
      projectId: record.job.projectId,
      assetId: record.job.dataAssetId,
    };
    // Each lease attempt writes private candidate keys. A late worker cannot overwrite
    // another attempt's validated outputs for the same Job.
    const attemptId = randomUUID();
    const candidateName = `${reservedRevision.revisionId}.${attemptId}`;
    const candidatePayloads = [
      {
        format: "vegaLite",
        extension: "vega-lite.json",
        body: Buffer.from(JSON.stringify(rendered.vegaLiteSpec)),
        contentType: "application/json",
      },
      { format: "svg", extension: "svg", body: Buffer.from(rendered.svg), contentType: "image/svg+xml" },
      { format: "png", extension: "png", body: rendered.png, contentType: "image/png" },
      {
        format: "html",
        extension: "html",
        body: Buffer.from(htmlCandidate.html),
        contentType: "text/html; charset=utf-8",
      },
    ] as const;
    const candidateOutputs = candidatePayloads.map((output) => ({
      ...output,
      key: renderOutputObjectKey({
        ...outputBase,
        filename: `${candidateName}.${createHash("sha256").update(output.body).digest("hex").slice(0, 16)}.${output.extension}`,
      }),
    }));
    for (const output of candidateOutputs) {
      await writeOutput({ key: output.key, body: output.body, contentType: output.contentType });
    }
    const manifestEntries = [];
    for (const output of candidateOutputs) {
      const stored = await getObject(output.key);
      if (!stored.equals(output.body)) throw new CandidateOutputMismatchError(output.format);
      manifestEntries.push({
        format: output.format,
        key: output.key,
        sha256: `sha256:${createHash("sha256").update(stored).digest("hex")}`,
        byteLength: stored.length,
        contentType: output.contentType,
        rendererVersion: RENDERER_VERSION,
        validation: "passed" as const,
      });
    }
    const candidateOutputManifest = {
      revisionId: reservedRevision.revisionId,
      attemptId,
      validation: renderValidation,
      outputs: manifestEntries,
    };
    const savedManifest = await updateGenerationJobUnderLease({
      lease,
      values: { candidateOutputManifest },
    });
    if (!savedManifest) throw new GenerationJobLeaseLostError(jobId);
    const [vegaLiteOutput, svgOutput, pngOutput, htmlOutput] = candidateOutputs;
    const vegaLiteKey = vegaLiteOutput.key;
    const svgKey = svgOutput.key;
    const pngKey = pngOutput.key;
    const htmlKey = htmlOutput.key;

    const outputObjects = {
      vegaLite: vegaLiteKey,
      svg: svgKey,
      png: pngKey,
      html: htmlKey,
      flintVersion: FLINT_VERSION,
      rendererVersion: RENDERER_VERSION,
    };
    const finalGenerationAudit = withValidationAudit(record.job.generationAudit, { planValidation, renderValidation });
    const revision = await publish(lease, {
      identity: reservedRevision,
      inputFingerprint: record.job.inputFingerprint,
      spec,
      validation: validation.data,
      planValidation,
      renderValidation,
      resultSummary,
      vegaLiteSpec: rendered.vegaLiteSpec,
      pluginSnapshot,
      memorySnapshot: memorySnapshotForRevision(record.job.memoryContext),
      themeSnapshot: {
        id: spec.theme,
        preset: spec.theme,
        version: spec.themeVersion,
        config: spec.themeConfig,
        source: record.job.themeSource,
        themeRef: parsedPluginContext.success ? parsedPluginContext.data.themeRef : null,
      },
      outputObjects,
      outputManifest: candidateOutputManifest,
      generationAudit: finalGenerationAudit,
    });
    console.log(`${workerName} completed`, { jobId, revisionId: revision.id });
  } catch (error) {
    // A lost COMMIT response is not evidence of rollback. Query the authoritative Job first.
    if (await readCommittedRevision(jobId)) return;
    if (error instanceof ChartPointBudgetError) {
      const renderValidation = failedRenderValidation(error.code, error.message);
      await failRenderJob(jobId, lease, error.code, error.message, {
        renderValidation,
        generationAudit: withValidationAudit(record.job.generationAudit, { renderValidation }),
      });
      return;
    }
    if (error instanceof PluginServiceError) {
      const renderValidation = failedRenderValidation(error.code, error.message);
      await failRenderJob(jobId, lease, error.code, error.message, {
        renderValidation,
        generationAudit: withValidationAudit(record.job.generationAudit, { renderValidation }),
      });
      return;
    }
    if (error instanceof CandidateOutputMismatchError) {
      const renderValidation = failedRenderValidation("RENDER_OUTPUT_MISMATCH", error.message);
      await failRenderJob(jobId, lease, "RENDER_FAILED", error.message, {
        renderValidation,
        generationAudit: withValidationAudit(record.job.generationAudit, { renderValidation }),
      });
      return;
    }
    const message = error instanceof Error ? error.message : "渲染失败";
    const renderValidation = failedRenderValidation("RENDER_FAILED", message);
    await failRenderJob(jobId, lease, "RENDER_FAILED", message, {
      renderValidation,
      generationAudit: withValidationAudit(record.job.generationAudit, { renderValidation }),
    });
  }
}

function mergeRenderValidation(base: ValidationRecord, html: ValidationRecord): ValidationRecord {
  const errors = [...base.errors, ...html.errors];
  return {
    status: errors.some((error) => error.severity === "error") ? "failed" : "passed",
    errors,
    validatorVersion: `${base.validatorVersion}+${html.validatorVersion}`,
    checkedAt: new Date().toISOString(),
  };
}

function buildStaticHtmlCandidate(input: {
  job: typeof generationJobs.$inferSelect;
  spec: FlintSpec;
  svg: string;
  resultSummary: ResultSummary;
  reservedRevision: ReservedRevisionIdentity;
}): { html: string; validation: ValidationRecord } {
  try {
    const html = createStaticSvgHtml({
      svg: input.svg,
      revisionId: input.reservedRevision.revisionId,
      revision: input.reservedRevision.revisionNumber,
      title: input.spec.chartSpec.title,
      finding: findingForGenerationJob(input.job, input.spec, input.resultSummary),
      snapshotId: input.job.snapshotId,
      metricDefinition: input.job.metricDefinitionSnapshot,
      theme: input.spec.theme,
      themeVersion: input.spec.themeVersion,
    });
    return { html, validation: validateStaticSvgHtml(html) };
  } catch (error) {
    return {
      html: "",
      validation: failedRenderValidation(
        "RENDER_HTML_INVALID",
        error instanceof Error ? error.message : "静态 HTML 生成失败",
      ),
    };
  }
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

async function setStatus(
  jobId: string,
  lease: GenerationJobLease,
  status: "validating" | "succeeded",
  values: Record<string, unknown> = {},
  release = false,
): Promise<void> {
  await assertGenerationJobLease(lease);
  const updated = await updateGenerationJobUnderLease({ lease, status, values, release });
  if (!updated) throw new GenerationJobLeaseLostError(jobId);
}

async function failRenderJob(
  jobId: string,
  lease: GenerationJobLease,
  errorCode: string,
  errorMessage: string,
  values: Record<string, unknown> = {},
): Promise<void> {
  const updated = await updateGenerationJobUnderLease({
    lease,
    status: "failed",
    release: true,
    values: { ...values, errorCode, errorMessage },
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
      severity: issue.severity,
    })),
    validatorVersion: "legacy-plan-validator-v1",
    checkedAt: new Date().toISOString(),
  };
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
    checkedAt: new Date().toISOString(),
  };
}

function withValidationAudit(
  audit: unknown,
  validations: Partial<{ planValidation: ValidationRecord; renderValidation: ValidationRecord }>,
): unknown {
  if (!isRecord(audit)) return audit;
  return { ...audit, ...validations };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function memorySnapshotForRevision(value: unknown): Array<Record<string, unknown>> {
  const parsed = memoryContextSchema.safeParse(value);
  if (parsed.success) {
    return [...parsed.data.project, ...parsed.data.workspace].map((record) => ({
      id: record.id,
      scope: record.scope,
      key: record.memoryKey,
      version: record.version,
      contentHash: createHash("sha256").update(JSON.stringify(record.value)).digest("hex"),
    }));
  }
  return publicProjectMemoryReferences(value);
}

function hasPluginContext(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
}

if (process.env.LANGREPORT_WORKER_TEST !== "1") {
  await ensureMemoryRevocationReady();
  console.log(`${workerName} ready; polling rendering Generation Jobs.`);
  void pollOnce().catch((error) => console.error(`${workerName} initial poll failed`, error));
  setInterval(() => {
    void pollOnce().catch((error) => console.error(`${workerName} poll failed`, error));
  }, pollIntervalMs);
}
