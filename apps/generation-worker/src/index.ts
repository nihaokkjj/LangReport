import { and, asc, eq, lt, or, sql } from "drizzle-orm";
import { generateArtifacts, validateFlintSpec } from "@langreport/generation";
import { db, chartRevisions, dataAssets, dataSnapshots, generationJobs, memoryExtractionJobs, projects } from "@langreport/db";
import { getObject } from "@langreport/storage";
import type { ColumnProfile, DataRow } from "@langreport/data-engine";
import { applyRevisionPatch } from "@langreport/chart";
import { chartEditPatchSchema, flintSpecSchema, themePresetSchema, type TransformPlan } from "@langreport/contracts";
import { getMemoryContextForGeneration, processMemoryExtractionJob } from "@langreport/memory";
import { pluginContextSchema } from "@langreport/contracts";
import { PluginServiceError, resolvePluginContextForWorkspace } from "@langreport/plugins";

const workerName = "generation-worker";
const pollIntervalMs = Number(process.env.GENERATION_POLL_INTERVAL_MS ?? 1000);
let polling = false;

export async function processGenerationJob(jobId: string): Promise<void> {
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
  if (job.job.status === "succeeded") return;

  try {
    if (job.job.operation === "edit") {
      await processEditJob(jobId, job.job);
      return;
    }
    await setStatus(jobId, "profiling", { errorCode: null, errorMessage: null });
    const snapshotPayload = JSON.parse((await getObject(job.snapshot.normalizedObjectKey)).toString("utf8")) as { rows: DataRow[] };
    const profiles = job.snapshot.schema as unknown as ColumnProfile[];
    if (!Array.isArray(snapshotPayload.rows) || !Array.isArray(profiles)) throw new Error("Data Snapshot 内容无效");

    const memoryContext = await getMemoryContextForGeneration({
      projectId: job.job.projectId,
      conversationId: job.job.conversationId,
      userId: job.job.createdBy,
      prompt: job.job.prompt
    });
    let pluginManifests = [] as Awaited<ReturnType<typeof resolvePluginContextForWorkspace>>;
    const pluginContext = pluginContextSchema.safeParse(job.job.pluginContext);
    if (!pluginContext.success && hasPluginContext(job.job.pluginContext)) {
      await failJob(jobId, "PLUGIN_CONTEXT_INVALID", "插件上下文不符合已固化的 Schema");
      return;
    }
    if (pluginContext.success) pluginManifests = await resolvePluginContextForWorkspace(job.workspaceId, pluginContext.data);
    await setStatus(jobId, "planning", { memoryContext });
    const theme = themePresetSchema.parse(job.job.theme);
    const artifacts = generateArtifacts({
      prompt: job.job.prompt,
      profiles,
      rows: snapshotPayload.rows,
      theme,
      themeVersion: job.job.themeVersion,
      memoryContext,
      pluginManifests,
      plan: isTransformPlan(job.job.transformPlan) ? job.job.transformPlan : undefined
    });
    await setStatus(jobId, "transforming", {
      intent: artifacts.intent,
      transformPlan: artifacts.plan,
      fieldLineage: artifacts.transform.lineage,
      validation: artifacts.validation,
      repairCount: artifacts.repairCount,
      previewData: {
        columns: artifacts.transform.columns,
        rows: artifacts.transform.rows.slice(0, 500),
        steps: artifacts.transform.steps
      }
    });

    await setStatus(jobId, "compiling", { flintSpec: artifacts.flintSpec });
    if (!artifacts.validation.valid) {
      await failJob(jobId, "VALIDATION_FAILED", "Flint Spec 未通过必要校验", artifacts.validation);
      return;
    }

    await setStatus(jobId, "rendering");
    console.log(`${workerName} handed off to render-worker`, { jobId, repairCount: artifacts.repairCount });
  } catch (error) {
    if (error instanceof PluginServiceError) {
      await failJob(jobId, error.code, error.message);
      return;
    }
    const message = error instanceof Error ? error.message : "生成失败";
    console.error(`${workerName} failed`, { jobId, error: message });
    await failJob(jobId, "GENERATION_FAILED", message);
  }
}

async function processEditJob(jobId: string, job: typeof generationJobs.$inferSelect): Promise<void> {
  if (!job.baseRevisionId || !job.artifactId) {
    await failJob(jobId, "EDIT_INPUT_INVALID", "编辑任务缺少基础 Revision");
    return;
  }
  await setStatus(jobId, "planning", { errorCode: null, errorMessage: null });
  const [source] = await db.select().from(chartRevisions)
    .where(eq(chartRevisions.id, job.baseRevisionId))
    .limit(1);
  if (!source || source.artifactId !== job.artifactId) {
    await failJob(jobId, "EDIT_SOURCE_NOT_FOUND", "基础 Revision 不属于当前图表产物");
    return;
  }
  try {
    const spec = flintSpecSchema.parse(source.flintSpec);
    const patch = chartEditPatchSchema.parse(job.editPatch);
    const editedSpec = applyRevisionPatch(spec, patch);
    const validation = validateFlintSpec(editedSpec);
    const [sourceJob] = source.generationJobId
      ? await db.select({ previewData: generationJobs.previewData }).from(generationJobs).where(eq(generationJobs.id, source.generationJobId)).limit(1)
      : [];
    await setStatus(jobId, "transforming", {
      transformPlan: source.transformPlan,
      fieldLineage: source.fieldLineage,
      memoryContext: job.memoryContext ?? source.memorySnapshot ?? [],
      validation,
      previewData: sourceJob?.previewData ?? null
    });
    await setStatus(jobId, "compiling", { flintSpec: editedSpec, validation });
    if (!validation.valid) {
      await failJob(jobId, "VALIDATION_FAILED", "编辑后的 Flint Spec 未通过必要校验", validation);
      return;
    }
    await setStatus(jobId, "rendering");
  } catch (error) {
    await failJob(jobId, "EDIT_INVALID", error instanceof Error ? error.message : "图表编辑失败");
  }
}

async function pollOnce(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const queued = await db
      .select({ id: generationJobs.id })
      .from(generationJobs)
      .where(eq(generationJobs.status, "queued"))
      .orderBy(asc(generationJobs.createdAt))
      .limit(1);
    const candidate = queued[0];
    if (candidate) {
      const [claimed] = await db
        .update(generationJobs)
        .set({
          status: "profiling",
          attemptCount: sql`${generationJobs.attemptCount} + 1`,
          updatedAt: new Date()
        })
        .where(and(eq(generationJobs.id, candidate.id), eq(generationJobs.status, "queued")))
        .returning({ id: generationJobs.id });
      if (claimed) await processGenerationJob(claimed.id);
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

async function setStatus(jobId: string, status: typeof generationJobs["status"]["enumValues"][number], values: Record<string, unknown> = {}): Promise<void> {
  await db.update(generationJobs).set({ ...values, status, updatedAt: new Date() } as never).where(eq(generationJobs.id, jobId));
}

async function failJob(jobId: string, errorCode: string, errorMessage: string, validation?: unknown): Promise<void> {
  await db.update(generationJobs).set({
    status: "failed",
    errorCode,
    errorMessage,
    ...(validation ? { validation } : {}),
    updatedAt: new Date()
  } as never).where(eq(generationJobs.id, jobId));
}

function isTransformPlan(value: unknown): value is TransformPlan {
  return typeof value === "object" && value !== null && "version" in value && "steps" in value && "expectedColumns" in value;
}

function hasPluginContext(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
}

console.log(`${workerName} ready; polling PostgreSQL-backed Generation Jobs.`);
void pollOnce().catch((error) => console.error(`${workerName} initial poll failed`, error));
setInterval(() => {
  void pollOnce().catch((error) => console.error(`${workerName} poll failed`, error));
}, pollIntervalMs);
