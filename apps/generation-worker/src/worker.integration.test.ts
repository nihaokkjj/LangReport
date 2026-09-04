import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  chartRevisions,
  closeDatabase,
  conversations,
  dataAssets,
  dataSnapshots,
  db,
  evidenceBlocks,
  generationJobs,
  members,
  projectMembers,
  projects,
  workspaces
} from "@langreport/db";
import { flintSpecSchema, pluginSnapshotSchema, pluginUsageSchema } from "@langreport/contracts";
import {
  installPlugin,
  listBuiltinPluginCatalog,
  resolveProjectPluginContext,
  revokePluginInstallation,
  setProjectPluginBinding
} from "@langreport/plugins";
import { deleteObject, getObject, putObject } from "@langreport/storage";
import type { ColumnProfile, DataRow } from "@langreport/data-engine";

const enabled = process.env.RUN_WORKER_INTEGRATION === "1";
process.env.LANGREPORT_WORKER_TEST = "1";
const { processGenerationJob } = await import("./index.js");
const { processRenderJob } = await import("../../render-worker/src/index.js");

test("real generation and render workers persist plugin usage and historical snapshot", { skip: !enabled }, async () => {
  const suffix = randomUUID();
  const userId = `phase5-worker-${suffix}`;
  let workspaceId: string | undefined;
  const objectKeys: string[] = [];

  try {
    const [workspace] = await db.insert(workspaces).values({ name: `Phase 5 Worker ${suffix}` }).returning();
    workspaceId = workspace.id;
    const [project] = await db.insert(projects).values({
      workspaceId: workspace.id,
      name: `Phase 5 Worker Project ${suffix}`,
      slug: `phase5-worker-${suffix.slice(0, 8)}`
    }).returning();
    await db.insert(members).values({ workspaceId: workspace.id, userId, role: "owner" });
    await db.insert(projectMembers).values({ projectId: project.id, userId, role: "editor" });

    const catalogEntry = listBuiltinPluginCatalog().find((candidate) => candidate.pluginId === "sales-editorial");
    if (!catalogEntry) throw new Error("sales-editorial fixture is unavailable");
    const installationResult = await installPlugin({
      workspaceId: workspace.id,
      userId,
      manifest: catalogEntry.manifest,
      source: "uploaded",
      idempotencyKey: `worker-install-${suffix}`
    });
    const installation = installationResult.installation;
    const themeRef = {
      source: "plugin" as const,
      pluginId: installation.pluginId,
      version: installation.version,
      capabilityId: "sales-brand",
      contentHash: installation.contentHash
    };
    await setProjectPluginBinding({
      projectId: project.id,
      installationId: installation.id,
      userId,
      enabled: true,
      idempotencyKey: `worker-enable-${suffix}`
    });
    const pluginResolution = await resolveProjectPluginContext({ projectId: project.id, userId, themeRef });

    const rows: DataRow[] = [
      { 月份: "2026-01", 区域: "华东", 销售额: 100 },
      { 月份: "2026-02", 区域: "华东", 销售额: 130 },
      { 月份: "2026-01", 区域: "华南", 销售额: 80 },
      { 月份: "2026-02", 区域: "华南", 销售额: 110 }
    ];
    const profiles: ColumnProfile[] = [
      { name: "月份", inferredType: "date", nullCount: 0, distinctCount: 2, sampleValues: ["2026-01", "2026-02"] },
      { name: "区域", inferredType: "string", nullCount: 0, distinctCount: 2, sampleValues: ["华东", "华南"] },
      { name: "销售额", inferredType: "number", nullCount: 0, distinctCount: 4, sampleValues: [100, 130, 80, 110] }
    ];
    const [asset] = await db.insert(dataAssets).values({
      projectId: project.id,
      name: "phase5-worker.csv",
      sourceType: "pasted",
      mimeType: "text/csv",
      sizeBytes: 1,
      objectKey: `phase5-worker/${suffix}/source.csv`,
      status: "ready",
      createdBy: userId
    }).returning();
    const normalizedObjectKey = `phase5-worker/${suffix}/snapshot.json`;
    objectKeys.push(normalizedObjectKey);
    await putObject({ key: normalizedObjectKey, body: JSON.stringify({ columns: profiles.map((profile) => profile.name), rows }), contentType: "application/json" });
    const [snapshot] = await db.insert(dataSnapshots).values({
      assetId: asset.id,
      version: 1,
      rowCount: rows.length,
      columnCount: profiles.length,
      schema: profiles,
      preview: rows,
      normalizedObjectKey
    }).returning();
    const [conversation] = await db.insert(conversations).values({ projectId: project.id, title: "Phase 5 Worker", createdBy: userId }).returning();
    const [job] = await db.insert(generationJobs).values({
      projectId: project.id,
      conversationId: conversation.id,
      dataAssetId: asset.id,
      snapshotId: snapshot.id,
      prompt: "按月份展示各区域销售额趋势",
      idempotencyKey: `worker-job-${suffix}`,
      inputFingerprint: `worker-fingerprint-${suffix}`,
      renderer: "vega-lite",
      rendererVersion: "vega-lite-svg-v1",
      theme: "economist",
      themeVersion: "project-v1",
      themeSource: "project",
      themeConfig: {},
      pluginContext: pluginResolution.context,
      analysisBriefSnapshot: {},
      metricDefinitionSnapshot: {},
      createdBy: userId
    }).returning();

    await processGenerationJob(job.id);
    const [generatedJob] = await db.select().from(generationJobs).where(eq(generationJobs.id, job.id)).limit(1);
    assert.equal(generatedJob.status, "rendering");
    const generatedSpec = flintSpecSchema.parse(generatedJob.flintSpec);
    assert.equal(generatedSpec.themeConfig.ink && typeof generatedSpec.themeConfig.ink === "object", true);
    assert.equal((generatedSpec.themeConfig.ink as { series?: { single?: string } }).series?.single, "#2563EB");
    const usage = pluginUsageSchema.parse(generatedJob.pluginUsage);
    assert.equal(usage.selectedTemplate?.id, "monthly-regional-sales");
    assert.equal(usage.selectedTheme?.source, "plugin");
    assert.ok(usage.usedCapabilities.some((capability) => capability.kind === "validator" && capability.id === "time-required-for-trend"));
    assert.ok(usage.usedCapabilities.some((capability) => capability.kind === "semantic-type" && capability.id === "Region"));

    await Promise.all([processRenderJob(job.id), processRenderJob(job.id)]);
    const [renderedJob] = await db.select().from(generationJobs).where(eq(generationJobs.id, job.id)).limit(1);
    assert.equal(renderedJob.status, "succeeded");
    const outputs = renderedJob.outputs as { svg?: string; png?: string; vegaLite?: string };
    for (const key of [outputs.svg, outputs.png, outputs.vegaLite]) {
      if (typeof key !== "string") throw new Error("render output key is missing");
      objectKeys.push(key);
    }
    const svg = await getObject(outputs.svg as string);
    assert.match(svg.toString("utf8"), /#2563EB/);
    assert.ok((await getObject(outputs.png as string)).byteLength > 100);
    const vegaLite = JSON.parse((await getObject(outputs.vegaLite as string)).toString("utf8")) as { _theme?: unknown };
    assert.equal(typeof vegaLite._theme, "object");

    const [revision] = await db.select().from(chartRevisions).where(eq(chartRevisions.generationJobId, job.id)).limit(1);
    assert.ok(revision);
    const pluginSnapshot = pluginSnapshotSchema.parse(revision.pluginSnapshot);
    assert.equal(pluginSnapshot.plugins[0]?.pluginId, installation.pluginId);
    assert.equal(pluginSnapshot.plugins[0]?.contentHash, installation.contentHash);
    assert.equal(pluginSnapshot.resolvedTheme?.ref.source, "plugin");
    if (pluginSnapshot.resolvedTheme?.ref.source === "plugin") assert.equal(pluginSnapshot.resolvedTheme.ref.capabilityId, "sales-brand");
    assert.ok(pluginSnapshot.plugins[0]?.capabilities.templates?.some((template) => (template as { id?: string }).id === "monthly-regional-sales"));
    const [evidence] = await db.select({ id: evidenceBlocks.id }).from(evidenceBlocks).where(eq(evidenceBlocks.generationJobId, job.id)).limit(1);
    assert.ok(evidence);

    await db.update(generationJobs).set({ status: "failed", errorCode: "RENDER_FAILED", errorMessage: "simulated post-revision failure" }).where(eq(generationJobs.id, job.id));
    await db.update(generationJobs).set({ status: "rendering" }).where(eq(generationJobs.id, job.id));
    await processRenderJob(job.id);
    const [recoveredJob] = await db.select().from(generationJobs).where(eq(generationJobs.id, job.id)).limit(1);
    assert.equal(recoveredJob.status, "succeeded");
    assert.equal((await db.select({ id: chartRevisions.id }).from(chartRevisions).where(eq(chartRevisions.generationJobId, job.id))).length, 1);

    const [invalidJob] = await db.insert(generationJobs).values({
      projectId: project.id,
      conversationId: conversation.id,
      dataAssetId: asset.id,
      snapshotId: snapshot.id,
      prompt: "无效插件上下文测试",
      idempotencyKey: `worker-invalid-${suffix}`,
      inputFingerprint: `worker-invalid-fingerprint-${suffix}`,
      renderer: "vega-lite",
      rendererVersion: "vega-lite-svg-v1",
      theme: "economist",
      themeVersion: "v1",
      themeSource: "request",
      themeConfig: {},
      pluginContext: { invalid: true },
      analysisBriefSnapshot: {},
      metricDefinitionSnapshot: {},
      createdBy: userId
    }).returning();
    await processGenerationJob(invalidJob.id);
    const [failedJob] = await db.select().from(generationJobs).where(eq(generationJobs.id, invalidJob.id)).limit(1);
    assert.equal(failedJob.status, "failed");
    assert.equal(failedJob.errorCode, "PLUGIN_CONTEXT_INVALID");
    const [failedRevision] = await db.select({ id: chartRevisions.id }).from(chartRevisions).where(eq(chartRevisions.generationJobId, invalidJob.id)).limit(1);
    assert.equal(failedRevision, undefined);

    await revokePluginInstallation({ workspaceId: workspace.id, installationId: installation.id, userId, reason: "worker integration" });
    const [historicalRevision] = await db.select({ pluginSnapshot: chartRevisions.pluginSnapshot }).from(chartRevisions).where(eq(chartRevisions.id, revision.id)).limit(1);
    assert.equal(pluginSnapshotSchema.parse(historicalRevision.pluginSnapshot).plugins[0]?.contentHash, installation.contentHash);
    assert.match((await getObject(outputs.svg as string)).toString("utf8"), /#2563EB/);
  } finally {
    for (const key of objectKeys) await deleteObject(key).catch(() => undefined);
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await closeDatabase();
  }
});
