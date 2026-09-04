import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { closeDatabase, db, auditEvents, chartArtifacts, chartRevisions, conversations, dataAssets, dataSnapshots, generationJobs, members, metricDefinitions, projectMembers, projects, workspaces } from "@langreport/db";
import { buildApp } from "./app.js";
import { buildPluginSnapshot } from "@langreport/plugins";

const enabled = process.env.RUN_INTEGRATION === "1";
type JsonObject = Record<string, unknown>;
type InjectMethod = "GET" | "POST" | "PUT";

function asObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} should be a string`);
  return value;
}

test("plugin API completes install, binding, theme, revoke, restore and audit flow", { skip: !enabled }, async () => {
  const suffix = randomUUID();
  const ownerId = `phase5-owner-${suffix}`;
  const editorId = `phase5-editor-${suffix}`;
  const reviewerId = `phase5-reviewer-${suffix}`;
  const viewerId = `phase5-viewer-${suffix}`;
  const outsiderId = `phase5-outsider-${suffix}`;
  const crossWorkspaceUserId = `phase5-cross-workspace-${suffix}`;
  const [workspace] = await db.insert(workspaces).values({ name: `Phase5 integration ${suffix}` }).returning();
  const [otherWorkspace] = await db.insert(workspaces).values({ name: `Phase5 other workspace ${suffix}` }).returning();
  await db.insert(members).values({ workspaceId: otherWorkspace.id, userId: crossWorkspaceUserId, role: "owner" });
  const [project] = await db.insert(projects).values({
    workspaceId: workspace.id,
    name: `Phase5 project ${suffix}`,
    slug: `phase5-${suffix.slice(0, 8)}`
  }).returning();
  const [otherProject] = await db.insert(projects).values({
    workspaceId: otherWorkspace.id,
    name: `Phase5 other project ${suffix}`,
    slug: `phase5-other-${suffix.slice(0, 8)}`
  }).returning();
  await db.insert(members).values([
    { workspaceId: workspace.id, userId: ownerId, role: "owner" },
    { workspaceId: workspace.id, userId: editorId, role: "member" },
    { workspaceId: workspace.id, userId: reviewerId, role: "member" },
    { workspaceId: workspace.id, userId: viewerId, role: "member" }
  ]);
  await db.insert(projectMembers).values([
    { projectId: project.id, userId: editorId, role: "editor" },
    { projectId: project.id, userId: reviewerId, role: "reviewer" },
    { projectId: project.id, userId: viewerId, role: "viewer" }
  ]);
  const [asset] = await db.insert(dataAssets).values({
    projectId: project.id,
    name: "phase5.csv",
    sourceType: "pasted",
    mimeType: "text/csv",
    sizeBytes: 1,
    objectKey: `phase5/${suffix}/asset.csv`,
    status: "ready",
    createdBy: ownerId
  }).returning();
  const [snapshot] = await db.insert(dataSnapshots).values({
    assetId: asset.id,
    version: 1,
    rowCount: 1,
    columnCount: 1,
    schema: [],
    preview: [],
    normalizedObjectKey: `phase5/${suffix}/snapshot.json`
  }).returning();
  const [conversation] = await db.insert(conversations).values({
    projectId: project.id,
    title: "Phase 5 integration",
    createdBy: ownerId
  }).returning();
  await db.insert(metricDefinitions).values({
    projectId: project.id,
    sourceConversationId: conversation.id,
    name: "销售额",
    meaning: "测试销售额",
    formula: "sum(sales)",
    unit: "元",
    timeRule: "按月",
    status: "confirmed",
    version: 1,
    confirmedBy: ownerId,
    confirmedAt: new Date(),
    createdBy: ownerId,
    updatedAt: new Date()
  });

  const app = await buildApp({
    logger: false,
    environment: { ...process.env, NODE_ENV: "test", APP_ENV: "test" }
  });
  await app.ready();
  try {
    const request = async (method: InjectMethod, url: string, userId: string, payload?: unknown) => {
      const response = await app.inject({
        method,
        url,
        headers: { "x-user-id": userId, "x-request-id": `phase5-request-${randomUUID()}`, ...(payload === undefined ? {} : { "content-type": "application/json" }) },
        payload: payload === undefined ? undefined : JSON.stringify(payload)
      });
      return { status: response.statusCode, requestId: response.headers["x-request-id"] as string, body: asObject(response.json()) };
    };

    let result = await request("GET", `/api/v1/workspaces/${workspace.id}/plugin-catalog`, ownerId);
    assert.equal(result.status, 200);
    const catalog = asObject(asArray(result.body.plugins)[0]);
    const manifest = asObject(catalog.manifest);
    assert.equal(stringValue(catalog.pluginId, "catalog pluginId"), "sales-editorial");

    result = await request("GET", `/api/v1/workspaces/${workspace.id}/plugin-catalog`, editorId);
    assert.equal(result.status, 200);
    result = await request("GET", `/api/v1/workspaces/${workspace.id}/plugin-catalog`, reviewerId);
    assert.equal(result.status, 403);
    result = await request("GET", `/api/v1/workspaces/${workspace.id}/plugin-catalog`, viewerId);
    assert.equal(result.status, 403);

    result = await request("POST", `/api/v1/workspaces/${workspace.id}/plugins/validate`, ownerId, manifest);
    assert.equal(result.status, 200);
    assert.equal(asObject(result.body.validationReport).valid, true);

    const installPayload = { manifest, source: "builtin", idempotencyKey: `install-${suffix}` };
    result = await request("POST", `/api/v1/workspaces/${workspace.id}/plugins`, editorId, installPayload);
    assert.equal(result.status, 403);
    assert.equal(result.body.code, "PLUGIN_SCOPE_FORBIDDEN");
    assert.equal((await db.select({ id: auditEvents.id }).from(auditEvents).where(and(
      eq(auditEvents.workspaceId, workspace.id),
      eq(auditEvents.action, "plugin.permission_denied"),
      eq(auditEvents.requestId, result.requestId)
    ))).length, 1);

    result = await request("POST", `/api/v1/workspaces/${workspace.id}/plugins`, ownerId, installPayload);
    assert.equal(result.status, 201);
    assert.equal(result.body.reused, false);
    const installation = asObject(result.body.installation);
    const installationId = stringValue(installation.id, "installation id");
    stringValue(installation.manifestId, "manifest id");
    const pluginId = stringValue(installation.pluginId, "plugin id");
    const version = stringValue(installation.version, "plugin version");
    const contentHash = stringValue(installation.contentHash, "content hash");
    const installAudits = await db.select({ id: auditEvents.id, requestId: auditEvents.requestId }).from(auditEvents).where(and(
      eq(auditEvents.workspaceId, workspace.id),
      eq(auditEvents.action, "plugin.installed"),
      eq(auditEvents.entityId, installationId)
    ));
    assert.equal(installAudits.length, 1);
    assert.equal(typeof installAudits[0]?.requestId, "string");
    const installAuditEventId = stringValue(result.body.auditEventId, "install audit event id");
    assert.equal(installAuditEventId, installAudits[0]?.id);

    result = await request("POST", `/api/v1/workspaces/${workspace.id}/plugins`, ownerId, installPayload);
    assert.equal(result.status, 200);
    assert.equal(result.body.reused, true);
    assert.equal(result.body.auditEventId, installAuditEventId);

    const concurrentManifest = {
      ...manifest,
      metadata: { ...asObject(manifest.metadata), id: `phase5-concurrent-${suffix}`, name: "Phase 5 Concurrent" }
    };
    const concurrentInstallPayload = {
      manifest: concurrentManifest,
      source: "uploaded",
      idempotencyKey: `concurrent-install-${suffix}`
    };
    const concurrentInstallResults = await Promise.all([
      request("POST", `/api/v1/workspaces/${workspace.id}/plugins`, ownerId, concurrentInstallPayload),
      request("POST", `/api/v1/workspaces/${workspace.id}/plugins`, ownerId, concurrentInstallPayload)
    ]);
    assert.deepEqual(concurrentInstallResults.map((item) => item.status).sort((a, b) => a - b), [200, 201]);
    assert.equal(concurrentInstallResults.filter((item) => item.body.reused === true).length, 1);

    const changedManifest = { ...manifest, metadata: { ...asObject(manifest.metadata), name: "Changed name" } };
    result = await request("POST", `/api/v1/workspaces/${workspace.id}/plugins`, ownerId, { ...installPayload, manifest: changedManifest, source: "uploaded" });
    assert.equal(result.status, 409, JSON.stringify(result.body));
    assert.equal(result.body.code, "IDEMPOTENCY_CONFLICT");
    assert.equal((await db.select({ id: auditEvents.id }).from(auditEvents).where(and(
      eq(auditEvents.workspaceId, workspace.id),
      eq(auditEvents.action, "plugin.conflict"),
      eq(auditEvents.requestId, result.requestId)
    ))).length, 1);

    result = await request("PUT", `/api/v1/projects/${project.id}/plugins/${installationId}`, reviewerId, { enabled: true, idempotencyKey: `reviewer-${suffix}` });
    assert.equal(result.status, 403);
    assert.equal((await db.select({ id: auditEvents.id }).from(auditEvents).where(and(
      eq(auditEvents.workspaceId, workspace.id),
      eq(auditEvents.action, "plugin.permission_denied"),
      eq(auditEvents.requestId, result.requestId)
    ))).length, 1);
    result = await request("PUT", `/api/v1/projects/${project.id}/plugins/${installationId}`, viewerId, { enabled: true, idempotencyKey: `viewer-${suffix}` });
    assert.equal(result.status, 403);

    result = await request("PUT", `/api/v1/projects/${project.id}/plugins/${installationId}`, editorId, { enabled: true, idempotencyKey: `enable-${suffix}` });
    assert.equal(result.status, 200);
    assert.equal(asObject(result.body.binding).status, "enabled");
    assert.equal(asObject(result.body.binding).versionNumber, 1);
    const bindingId = stringValue(asObject(result.body.binding).id, "binding id");
    const enableAuditEventId = stringValue(result.body.auditEventId, "enable audit event id");
    assert.equal((await db.select({ id: auditEvents.id }).from(auditEvents).where(and(
      eq(auditEvents.workspaceId, workspace.id),
      eq(auditEvents.action, "plugin.enabled"),
      eq(auditEvents.entityId, bindingId)
    ))).some((audit) => audit.id === enableAuditEventId), true);

    result = await request("PUT", `/api/v1/projects/${project.id}/plugins/${installationId}`, editorId, { enabled: false, expectedVersion: 2, idempotencyKey: `stale-${suffix}` });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, "PLUGIN_BINDING_CONFLICT");
    assert.equal((await db.select({ id: auditEvents.id }).from(auditEvents).where(and(
      eq(auditEvents.workspaceId, workspace.id),
      eq(auditEvents.action, "plugin.conflict"),
      eq(auditEvents.requestId, result.requestId)
    ))).length, 1);

    result = await request("PUT", `/api/v1/projects/${project.id}/plugins/${installationId}`, editorId, { enabled: false, expectedVersion: 1, idempotencyKey: `disable-${suffix}` });
    assert.equal(result.status, 200);
    assert.equal(asObject(result.body.binding).status, "disabled");
    const disableAuditEventId = stringValue(result.body.auditEventId, "disable audit event id");
    assert.equal((await db.select({ id: auditEvents.id }).from(auditEvents).where(and(
      eq(auditEvents.workspaceId, workspace.id),
      eq(auditEvents.action, "plugin.disabled"),
      eq(auditEvents.entityId, bindingId)
    ))).some((audit) => audit.id === disableAuditEventId), true);

    result = await request("PUT", `/api/v1/projects/${project.id}/plugins/${installationId}`, editorId, { enabled: true, expectedVersion: 2, idempotencyKey: `enable-again-${suffix}` });
    assert.equal(result.status, 200);
    assert.equal(asObject(result.body.binding).status, "enabled");
    assert.equal(asObject(result.body.binding).versionNumber, 3);

    result = await request("GET", `/api/v1/projects/${project.id}/capabilities`, reviewerId);
    assert.equal(result.status, 200);
    assert.equal(asArray(asObject(result.body.context).enabledPlugins).length, 1);
    assert.equal(asArray(result.body.manifests).length, 1);
    result = await request("GET", `/api/v1/projects/${project.id}/capabilities`, viewerId);
    assert.equal(result.status, 403);
    assert.equal((await db.select({ id: auditEvents.id }).from(auditEvents).where(and(
      eq(auditEvents.workspaceId, workspace.id),
      eq(auditEvents.action, "plugin.permission_denied"),
      eq(auditEvents.requestId, result.requestId)
    ))).length, 1);

    result = await request("PUT", `/api/v1/projects/${project.id}/theme`, editorId, {
      preset: "economist",
      config: {},
      themeRef: { source: "plugin", pluginId, version, capabilityId: "sales-brand", contentHash }
    });
    assert.equal(result.status, 200);
    assert.equal(asObject(asObject(result.body.theme).themeRef).contentHash, contentHash);
    result = await request("GET", `/api/v1/projects/${project.id}/theme`, ownerId);
    assert.equal(result.status, 200);
    assert.equal(asObject(asObject(result.body.theme).themeRef).source, "plugin");

    result = await request("POST", `/api/v1/projects/${project.id}/generation-jobs`, editorId, {
      dataAssetId: asset.id,
      conversationId: conversation.id,
      prompt: "按月份展示各区域销售额趋势",
      idempotencyKey: `generation-with-plugin-${suffix}`
    });
    assert.equal(result.status, 202, JSON.stringify(result.body));
    const generationJob = asObject(result.body.job);
    const generationJobId = stringValue(generationJob.id, "generation job id");
    const pluginContext = asObject(generationJob.pluginContext);
    assert.equal(asArray(pluginContext.enabledPlugins).length, 1);
    assert.equal(asObject(pluginContext.themeRef).source, "plugin");
    assert.equal(typeof generationJob.inputFingerprint, "string");
    const pluginFingerprint = stringValue(generationJob.inputFingerprint, "plugin generation fingerprint");

    result = await request("GET", `/api/v1/projects/${project.id}/theme`, ownerId);
    assert.equal(result.status, 200);
    const concurrentThemeVersion = Number(asObject(result.body.theme).version);
    const concurrentThemePayload = {
      preset: "economist",
      config: { source: "concurrent-test" },
      themeRef: { source: "plugin", pluginId, version, capabilityId: "sales-brand", contentHash },
      expectedVersion: concurrentThemeVersion
    };
    const concurrentThemeResults = await Promise.all([
      request("PUT", `/api/v1/projects/${project.id}/theme`, editorId, concurrentThemePayload),
      request("PUT", `/api/v1/projects/${project.id}/theme`, editorId, concurrentThemePayload)
    ]);
    assert.deepEqual(concurrentThemeResults.map((item) => item.status).sort((a, b) => a - b), [200, 409]);
    assert.equal(concurrentThemeResults.filter((item) => item.body.code === "THEME_CONFLICT").length, 1);

    result = await request("POST", `/api/v1/workspaces/${workspace.id}/plugins/${installationId}/revoke`, editorId, { reason: "not allowed" });
    assert.equal(result.status, 403);
    result = await request("POST", `/api/v1/workspaces/${workspace.id}/plugins/${installationId}/revoke`, ownerId, { reason: "integration test" });
    assert.equal(result.status, 200);
    assert.equal(asObject(result.body.installation).status, "revoked");
    const revokeAuditEventId = stringValue(result.body.auditEventId, "revoke audit event id");
    assert.equal((await db.select({ id: auditEvents.id }).from(auditEvents).where(and(
      eq(auditEvents.workspaceId, workspace.id),
      eq(auditEvents.action, "plugin.revoked"),
      eq(auditEvents.entityId, installationId)
    ))).some((audit) => audit.id === revokeAuditEventId), true);
    const revokeDisableAudits = await db.select({ metadata: auditEvents.metadata }).from(auditEvents).where(and(
      eq(auditEvents.workspaceId, workspace.id),
      eq(auditEvents.projectId, project.id),
      eq(auditEvents.action, "plugin.disabled"),
      eq(auditEvents.entityId, bindingId),
      eq(auditEvents.requestId, result.requestId)
    ));
    assert.equal(revokeDisableAudits.length, 1);
    assert.equal((revokeDisableAudits[0]?.metadata as { reason?: string }).reason, "插件安装已撤销");

    result = await request("GET", `/api/v1/projects/${project.id}/plugins`, reviewerId);
    assert.equal(result.status, 200);
    assert.equal(asArray(result.body.plugins).length, 1);
    assert.equal(asObject(asObject(asArray(result.body.plugins)[0]).binding).status, "disabled");
    result = await request("GET", `/api/v1/projects/${project.id}/plugins`, viewerId);
    assert.equal(result.status, 403);
    result = await request("GET", `/api/v1/projects/${project.id}/capabilities`, reviewerId);
    assert.equal(result.status, 200);
    assert.equal(asArray(result.body.manifests).length, 0);
    result = await request("GET", `/api/v1/projects/${project.id}/capabilities`, viewerId);
    assert.equal(result.status, 403);

    const historicalSnapshot = await buildPluginSnapshot({
      workspaceId: workspace.id,
      context: generationJob.pluginContext,
      rendererVersion: "vega-lite-svg-v1",
      usedCapabilities: [
        { kind: "template", id: "monthly-regional-sales" },
        { kind: "theme", id: "sales-brand" }
      ]
    });
    const historicalPlugin = asObject(asArray(historicalSnapshot.plugins)[0]);
    assert.equal(historicalPlugin.pluginId, pluginId);
    assert.equal(asArray(asObject(historicalPlugin.capabilities).templates).length, 1);
    assert.equal(asObject(historicalSnapshot.resolvedTheme).ref !== undefined, true);
    assert.equal(asObject(asObject(historicalSnapshot.resolvedTheme).payload).ink !== undefined, true);
    const [artifact] = await db.insert(chartArtifacts).values({
      projectId: project.id,
      name: "Phase 5 historical chart",
      createdBy: ownerId
    }).returning();
    const [revision] = await db.insert(chartRevisions).values({
      artifactId: artifact.id,
      generationJobId,
      snapshotId: snapshot.id,
      revision: 1,
      status: "in_review",
      createdBy: ownerId,
      transformPlan: {},
      fieldLineage: {},
      flintSpec: { theme: "economist", themeVersion: "project-v1", themeConfig: {} },
      themeSnapshot: {},
      vegaLiteSpec: {},
      validation: { valid: true },
      pluginSnapshot: historicalSnapshot,
      outputObjects: {}
    }).returning();
    const [otherArtifact] = await db.insert(chartArtifacts).values({
      projectId: otherProject.id,
      name: "Phase 5 other workspace chart",
      createdBy: crossWorkspaceUserId
    }).returning();
    const [otherRevision] = await db.insert(chartRevisions).values({
      artifactId: otherArtifact.id,
      snapshotId: snapshot.id,
      revision: 1,
      createdBy: crossWorkspaceUserId,
      transformPlan: {},
      fieldLineage: {},
      flintSpec: { theme: "economist", themeVersion: "v1", themeConfig: {} },
      themeSnapshot: {},
      vegaLiteSpec: {},
      validation: { valid: true },
      pluginSnapshot: {},
      outputObjects: {}
    }).returning();
    result = await request("GET", `/api/v1/chart-revisions/${revision.id}/plugin-context`, reviewerId);
    assert.equal(result.status, 200);
    assert.equal(asObject(asArray(asObject(result.body.pluginSnapshot).plugins)[0]).pluginId, pluginId);

    result = await request("GET", `/api/v1/workspaces/${workspace.id}/plugin-catalog`, crossWorkspaceUserId);
    assert.equal(result.status, 404);
    result = await request("GET", `/api/v1/workspaces/${workspace.id}/plugins`, crossWorkspaceUserId);
    assert.equal(result.status, 404);
    result = await request("GET", `/api/v1/workspaces/${workspace.id}/plugins/${installationId}`, crossWorkspaceUserId);
    assert.equal(result.status, 404);
    result = await request("POST", `/api/v1/workspaces/${workspace.id}/plugins/${installationId}/revoke`, crossWorkspaceUserId, { reason: "cross workspace" });
    assert.equal(result.status, 403);
    result = await request("POST", `/api/v1/workspaces/${workspace.id}/plugins`, crossWorkspaceUserId, { manifest, source: "builtin", idempotencyKey: `cross-install-${suffix}` });
    assert.equal(result.status, 403);
    result = await request("GET", `/api/v1/projects/${project.id}/plugins`, crossWorkspaceUserId);
    assert.equal(result.status, 404);
    result = await request("GET", `/api/v1/projects/${project.id}/capabilities`, crossWorkspaceUserId);
    assert.equal(result.status, 404);
    result = await request("PUT", `/api/v1/projects/${project.id}/plugins/${installationId}`, crossWorkspaceUserId, { enabled: true, idempotencyKey: `cross-binding-${suffix}` });
    assert.equal(result.status, 404);
    result = await request("GET", `/api/v1/chart-revisions/${revision.id}/plugin-context`, crossWorkspaceUserId);
    assert.equal(result.status, 404);
    result = await request("GET", `/api/v1/workspaces/${otherWorkspace.id}/plugins`, ownerId);
    assert.equal(result.status, 404);
    result = await request("GET", `/api/v1/projects/${otherProject.id}/plugins`, ownerId);
    assert.equal(result.status, 404);
    result = await request("GET", `/api/v1/projects/${otherProject.id}/capabilities`, ownerId);
    assert.equal(result.status, 404);
    result = await request("GET", `/api/v1/chart-revisions/${otherRevision.id}/plugin-context`, ownerId);
    assert.equal(result.status, 404);
    result = await request("PUT", `/api/v1/projects/${otherProject.id}/plugins/${installationId}`, ownerId, { enabled: true, idempotencyKey: `target-owner-cross-binding-${suffix}` });
    assert.equal(result.status, 404);

    result = await request("GET", `/api/v1/projects/${project.id}/theme`, ownerId);
    assert.equal(result.status, 200);
    const resetThemeVersion = Number(asObject(result.body.theme).version);
    result = await request("PUT", `/api/v1/projects/${project.id}/theme`, editorId, {
      preset: "economist",
      config: {},
      themeRef: { source: "plugin", pluginId, version, capabilityId: "sales-brand", contentHash },
      expectedVersion: resetThemeVersion
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, "PLUGIN_THEME_INVALID");
    result = await request("PUT", `/api/v1/projects/${project.id}/theme`, editorId, { preset: "economist", config: {}, themeRef: null, expectedVersion: resetThemeVersion });
    assert.equal(result.status, 200);
    result = await request("POST", `/api/v1/projects/${project.id}/generation-jobs`, editorId, {
      dataAssetId: asset.id,
      conversationId: conversation.id,
      prompt: "按月份展示各区域销售额趋势",
      idempotencyKey: `generation-without-plugin-${suffix}`
    });
    assert.equal(result.status, 202, JSON.stringify(result.body));
    const generationJobWithoutPlugin = asObject(result.body.job);
    assert.equal(asArray(asObject(generationJobWithoutPlugin.pluginContext).enabledPlugins).length, 0);
    assert.notEqual(generationJobWithoutPlugin.inputFingerprint, pluginFingerprint);

    result = await request("GET", `/api/v1/generation-jobs/${generationJobId}`, ownerId);
    assert.equal(result.status, 200);
    assert.equal(asArray(asObject(asObject(result.body.job).pluginContext).enabledPlugins).length, 1);

    await db.update(generationJobs).set({ status: "failed", attemptCount: 1, errorCode: "RENDER_FAILED", errorMessage: "temporary render failure" }).where(eq(generationJobs.id, generationJobId));
    const retryResults = await Promise.all([
      request("POST", `/api/v1/generation-jobs/${generationJobId}/retry`, editorId),
      request("POST", `/api/v1/generation-jobs/${generationJobId}/retry`, editorId)
    ]);
    assert.deepEqual(retryResults.map((item) => item.status).sort((a, b) => a - b), [200, 202]);
    assert.equal(retryResults.filter((item) => item.body.reused === false).length, 1);
    assert.equal(retryResults.every((item) => asObject(item.body.job).status === "rendering"), true);
    assert.equal(retryResults.every((item) => asObject(item.body.job).errorCode === null), true);

    const failedWithoutRetry = stringValue(generationJobWithoutPlugin.id, "failed generation job id");
    await db.update(generationJobs).set({ status: "failed", attemptCount: 1, errorCode: "RENDER_FAILED", errorMessage: "temporary render failure" }).where(eq(generationJobs.id, failedWithoutRetry));
    result = await request("POST", `/api/v1/generation-jobs/${failedWithoutRetry}/retry`, ownerId);
    assert.equal(result.status, 202);
    assert.equal(asObject(result.body.job).status, "queued");
    assert.equal(result.body.reused, false);
    await db.update(generationJobs).set({ status: "failed", errorCode: "PLUGIN_CONTEXT_INVALID", errorMessage: "invalid plugin context" }).where(eq(generationJobs.id, failedWithoutRetry));
    result = await request("POST", `/api/v1/generation-jobs/${failedWithoutRetry}/retry`, ownerId);
    assert.equal(result.status, 409);
    assert.equal(result.body.code, "GENERATION_RETRY_NOT_ALLOWED");
    await db.update(generationJobs).set({ errorCode: "RENDER_FAILED", attemptCount: 3 }).where(eq(generationJobs.id, failedWithoutRetry));
    result = await request("POST", `/api/v1/generation-jobs/${failedWithoutRetry}/retry`, ownerId);
    assert.equal(result.status, 409);
    assert.equal(result.body.code, "GENERATION_RETRY_LIMIT");

    result = await request("POST", `/api/v1/workspaces/${workspace.id}/plugins/${installationId}/restore`, ownerId, {});
    assert.equal(result.status, 200);
    assert.equal(asObject(result.body.installation).status, "installed");
    const restoreAuditEventId = stringValue(result.body.auditEventId, "restore audit event id");
    assert.equal((await db.select({ id: auditEvents.id }).from(auditEvents).where(and(
      eq(auditEvents.workspaceId, workspace.id),
      eq(auditEvents.action, "plugin.restored"),
      eq(auditEvents.entityId, installationId)
    ))).some((audit) => audit.id === restoreAuditEventId), true);

    result = await request("PUT", `/api/v1/projects/${project.id}/plugins/${installationId}`, editorId, { enabled: true, expectedVersion: 4, idempotencyKey: `re-enable-${suffix}` });
    assert.equal(result.status, 200);
    assert.equal(asObject(result.body.binding).versionNumber, 5);
    assert.equal(typeof result.body.auditEventId, "string");

    result = await request("GET", `/api/v1/projects/${project.id}/theme`, ownerId);
    assert.equal(result.status, 200);
    assert.equal(asObject(result.body.theme).themeRef, null);

    result = await request("GET", `/api/v1/workspaces/${workspace.id}/plugins`, outsiderId);
    assert.equal(result.status, 404);
    result = await request("GET", `/api/v1/projects/${project.id}/plugins`, outsiderId);
    assert.equal(result.status, 404);

    const audits = await db.select({ action: auditEvents.action }).from(auditEvents)
      .where(eq(auditEvents.workspaceId, workspace.id));
    const actions = new Set(audits.map((audit) => audit.action));
    for (const action of ["plugin.installed", "plugin.enabled", "project_theme.updated", "plugin.revoked", "plugin.restored"]) {
      assert.equal(actions.has(action), true, `missing audit action ${action}`);
    }
  } finally {
    try {
      await app.close();
      await db.delete(workspaces).where(eq(workspaces.id, otherWorkspace.id));
      await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
    } finally {
      await closeDatabase();
    }
  }
});
