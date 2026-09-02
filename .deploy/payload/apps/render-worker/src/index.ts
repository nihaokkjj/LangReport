import { and, asc, eq, or, sql } from "drizzle-orm";
import { db, dataAssets, generationJobs, projects } from "@langreport/db";
import { flintSpecSchema, validationReportSchema } from "@langreport/contracts";
import { memoryContextSchema } from "@langreport/contracts";
import { createDerivedRevision, createInitialRevision } from "@langreport/chart";
import { renderChart, FLINT_VERSION, RENDERER_VERSION } from "@langreport/flint-adapter";
import { storageObjectKey } from "@langreport/storage";

const workerName = "render-worker";
const pollIntervalMs = Number(process.env.RENDER_POLL_INTERVAL_MS ?? 1000);
let polling = false;

export async function processRenderJob(jobId: string): Promise<void> {
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
    const validation = validationReportSchema.safeParse(record.job.validation);
    if (!validation.success || !validation.data.valid) {
      await failRenderJob(jobId, "VALIDATION_FAILED", "渲染前校验未通过");
      return;
    }
    const spec = flintSpecSchema.parse(record.job.flintSpec);
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
          config: record.job.themeConfig,
          source: record.job.themeSource
        },
        vegaLiteSpec: rendered.vegaLiteSpec,
        validation: validation.data,
        memorySnapshot: memorySnapshotForRevision(record.job.memoryContext),
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
          config: record.job.themeConfig,
          source: record.job.themeSource
        },
        vegaLiteSpec: rendered.vegaLiteSpec,
        validation: validation.data,
        memorySnapshot: memorySnapshotForRevision(record.job.memoryContext),
        outputObjects
      });
    await setStatus(jobId, "succeeded", {
      outputs: { vegaLite: vegaLiteKey, svg: svgKey, png: pngKey },
      vegaLiteSpec: rendered.vegaLiteSpec,
      errorCode: null,
      errorMessage: null
    });
    console.log(`${workerName} completed`, { jobId, revisionId: revision.id });
  } catch (error) {
    await failRenderJob(jobId, "RENDER_FAILED", error instanceof Error ? error.message : "渲染失败");
  }
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
      .set({ attemptCount: sql`${generationJobs.attemptCount} + 1`, updatedAt: new Date() })
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
  if (!parsed.success) return [];
  return [...parsed.data.project, ...parsed.data.workspace].map((record) => ({
    id: record.id,
    scope: record.scope,
    key: record.memoryKey,
    version: record.version,
    contentHash: JSON.stringify(record.value)
  }));
}

console.log(`${workerName} ready; polling rendering Generation Jobs.`);
void pollOnce().catch((error) => console.error(`${workerName} initial poll failed`, error));
setInterval(() => {
  void pollOnce().catch((error) => console.error(`${workerName} poll failed`, error));
}, pollIntervalMs);
