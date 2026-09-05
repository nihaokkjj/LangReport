import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const apiOrigin = process.env.PHASE5_API_ORIGIN?.trim().replace(/\/+$/, "");
const jwt = process.env.PHASE5_JWT?.trim();
const sessionCookie = process.env.PHASE5_SESSION_COOKIE?.trim();
const workspaceId = process.env.PHASE5_WORKSPACE_ID?.trim();
const requestedProjectId = process.env.PHASE5_PROJECT_ID?.trim();
const shouldExerciseRevocation = process.env.PHASE5_E2E_REVOCATION !== "false";

if (!apiOrigin || (!jwt && !sessionCookie) || !workspaceId) {
  throw new Error("需要设置 PHASE5_API_ORIGIN、PHASE5_JWT 或 PHASE5_SESSION_COOKIE，以及 PHASE5_WORKSPACE_ID；脚本不会输出认证凭据。");
}

const authHeaders = jwt
  ? { authorization: `Bearer ${jwt}` }
  : { cookie: sessionCookie };
const runId = randomUUID();

function asObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function stringValue(value, label) {
  assert.equal(typeof value, "string", `${label} 应为字符串`);
  return value;
}

function errorDetail(body) {
  const details = asObject(body);
  return [details.code, details.error, details.message]
    .filter((value) => typeof value === "string")
    .join(" · ");
}

async function request(path, init = {}) {
  const response = await fetch(`${apiOrigin}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      ...authHeaders,
      ...(init.headers ?? {})
    }
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 160) };
  }
  return { response, body };
}

async function expectJson(label, method, path, expectedStatus, payload) {
  const { response, body } = await request(path, {
    method,
    ...(payload === undefined ? {} : {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    })
  });
  const acceptedStatuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  if (!acceptedStatuses.includes(response.status)) {
    throw new Error(`${label} 失败：HTTP ${response.status}${errorDetail(body) ? ` (${errorDetail(body)})` : ""}`);
  }
  console.log(`PASS ${label} · HTTP ${response.status}`);
  return body;
}

async function expectStatus(label, method, path, expectedStatus) {
  const { response, body } = await request(path, { method });
  if (response.status !== expectedStatus) {
    throw new Error(`${label} 失败：HTTP ${response.status}${errorDetail(body) ? ` (${errorDetail(body)})` : ""}`);
  }
  console.log(`PASS ${label} · HTTP ${response.status}`);
}

const projectsPayload = await expectJson("认证项目列表", "GET", "/api/v1/projects", 200);
const projectItems = asArray(projectsPayload.projects).map(asObject);
const inWorkspace = (item) => item.workspaceId === undefined || item.workspaceId === workspaceId;
const project = projectItems.find((item) => item.id === requestedProjectId && inWorkspace(item))
  ?? (requestedProjectId ? null : projectItems.find(inWorkspace));
if (!project) throw new Error("PHASE5_PROJECT_ID 不属于当前用户，或当前用户没有可用 Project");
const projectId = stringValue(project.id, "projectId");

const catalogPayload = await expectJson("插件目录", "GET", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/plugin-catalog`, 200);
const catalogPlugin = asArray(catalogPayload.plugins).map(asObject).find((item) => item.pluginId === "sales-editorial");
if (!catalogPlugin) throw new Error("插件目录缺少 sales-editorial fixture");
const manifest = asObject(catalogPlugin.manifest);
const validationPayload = await expectJson("Manifest 校验", "POST", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/plugins/validate`, 200, manifest);
assert.equal(asObject(validationPayload.validationReport).valid, true, "内置 Manifest 必须校验通过");

const installationPayload = await expectJson("插件安装", "POST", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/plugins`, [200, 201], {
  manifest,
  source: "builtin",
  idempotencyKey: "phase5-production-sales-editorial"
});
const installation = asObject(installationPayload.installation);
const installationId = stringValue(installation.id, "installationId");
const contentHash = stringValue(installation.contentHash, "contentHash");
const pluginId = stringValue(installation.pluginId, "pluginId");
const version = stringValue(installation.version, "version");

const bindingPayload = await expectJson("读取 Project 插件 Binding", "GET", `/api/v1/projects/${encodeURIComponent(projectId)}/plugins`, 200);
const existingBinding = asArray(bindingPayload.plugins).map(asObject).find((item) => asObject(item.installation).id === installationId);
const wasEnabled = asObject(existingBinding?.binding).status === "enabled";
const expectedVersion = typeof asObject(existingBinding?.binding).versionNumber === "number"
  ? asObject(existingBinding.binding).versionNumber
  : undefined;
await expectJson("启用 Project 插件", "PUT", `/api/v1/projects/${encodeURIComponent(projectId)}/plugins/${encodeURIComponent(installationId)}`, 200, {
  enabled: true,
  ...(expectedVersion === undefined ? {} : { expectedVersion }),
  idempotencyKey: `phase5-production-enable-${runId}`
});

const theme = asArray(manifest.themes).map(asObject).find((item) => item.id === "sales-brand");
if (!theme) throw new Error("sales-editorial fixture 缺少 sales-brand Theme");
const themePayload = await expectJson("读取 Project Theme", "GET", `/api/v1/projects/${encodeURIComponent(projectId)}/theme`, 200);
const currentTheme = asObject(themePayload.theme);
await expectJson("选择插件 Theme", "PUT", `/api/v1/projects/${encodeURIComponent(projectId)}/theme`, 200, {
  preset: typeof currentTheme.preset === "string" ? currentTheme.preset : "economist",
  config: asObject(currentTheme.config),
  themeRef: { source: "plugin", pluginId, version, capabilityId: "sales-brand", contentHash },
  ...(typeof currentTheme.version === "number" ? { expectedVersion: currentTheme.version } : {})
});

const capabilitiesPayload = await expectJson("Project 能力目录", "GET", `/api/v1/projects/${encodeURIComponent(projectId)}/capabilities`, 200);
assert.ok(asArray(capabilitiesPayload.manifests).some((item) => asObject(item).pluginId === pluginId), "能力目录必须包含已启用插件");

const csv = [
  "月份,区域,销售额",
  "2025-01,华东,120",
  "2025-02,华东,135",
  "2025-01,华南,95",
  "2025-02,华南,110"
].join("\n");
const assetPayload = await expectJson("创建数据快照", "POST", `/api/v1/projects/${encodeURIComponent(projectId)}/data-assets/paste`, 201, {
  name: `phase5-production-${runId}.csv`,
  content: csv
});
const assetId = stringValue(asObject(assetPayload.asset).id, "dataAssetId");
const conversationPayload = await expectJson("创建分析对话", "POST", `/api/v1/projects/${encodeURIComponent(projectId)}/conversations`, 201, {
  title: `Phase 5 production ${runId}`
});
const conversationId = stringValue(asObject(conversationPayload.conversation).id, "conversationId");
await expectJson("确认指标口径", "POST", `/api/v1/projects/${encodeURIComponent(projectId)}/metric-definitions`, 201, {
  conversationId,
  name: "销售额",
  meaning: "按区域和月份统计销售额",
  formula: "sum(销售额)",
  unit: "元",
  timeRule: "按月"
});

const jobPayload = await expectJson("创建带插件上下文的 Generation Job", "POST", `/api/v1/projects/${encodeURIComponent(projectId)}/generation-jobs`, 202, {
  conversationId,
  dataAssetId: assetId,
  prompt: "按月份展示各区域销售额，并验证插件 Theme 和字段要求",
  renderer: "vega-lite",
  idempotencyKey: `phase5-production-generation-${runId}`
});
const jobId = stringValue(asObject(jobPayload.job).id, "jobId");
assert.equal(asArray(asObject(asObject(jobPayload.job).pluginContext).enabledPlugins).length, 1, "Job 必须固化插件上下文");

let finalJob = {};
let finalRevision = {};
for (let attempt = 0; attempt < 120; attempt += 1) {
  const statusResult = await request(`/api/v1/generation-jobs/${encodeURIComponent(jobId)}`, { method: "GET" });
  if (statusResult.response.status !== 200) {
    throw new Error(`轮询生成任务失败：HTTP ${statusResult.response.status}${errorDetail(statusResult.body) ? ` (${errorDetail(statusResult.body)})` : ""}`);
  }
  finalJob = asObject(statusResult.body.job);
  finalRevision = asObject(statusResult.body.revision);
  if (finalJob.status === "succeeded" || finalJob.status === "failed") break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
if (finalJob.status !== "succeeded") throw new Error(`生成未成功：${finalJob.errorCode ?? finalJob.status ?? "未知状态"}`);
const revisionId = stringValue(finalRevision.id, "revisionId");

const snapshotPayload = await expectJson("Revision 插件快照", "GET", `/api/v1/chart-revisions/${encodeURIComponent(revisionId)}/plugin-context`, 200);
const pluginSnapshot = asObject(snapshotPayload.pluginSnapshot);
const snapshotPlugin = asArray(pluginSnapshot.plugins).map(asObject).find((item) => item.pluginId === pluginId);
assert.equal(asObject(snapshotPlugin).contentHash, contentHash, "Revision 必须保存精确插件哈希");
assert.equal(asObject(asObject(pluginSnapshot.resolvedTheme).ref).capabilityId, "sales-brand", "Revision 必须保存解析后的插件 Theme");
await expectStatus("SVG 导出", "GET", `/api/v1/generation-jobs/${encodeURIComponent(jobId)}/outputs/svg`, 200);

if (shouldExerciseRevocation) {
  await expectJson("撤销插件", "POST", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/plugins/${encodeURIComponent(installationId)}/revoke`, 200, { reason: "Phase 5 acceptance" });
  await expectJson("撤销后读取历史插件快照", "GET", `/api/v1/chart-revisions/${encodeURIComponent(revisionId)}/plugin-context`, 200);
  await expectStatus("撤销后导出历史 SVG", "GET", `/api/v1/generation-jobs/${encodeURIComponent(jobId)}/outputs/svg`, 200);
  await expectJson("恢复插件", "POST", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/plugins/${encodeURIComponent(installationId)}/restore`, 200);
  if (wasEnabled) {
    const refreshedBindings = await expectJson("读取恢复后的 Binding", "GET", `/api/v1/projects/${encodeURIComponent(projectId)}/plugins`, 200);
    const refreshedBinding = asArray(refreshedBindings.plugins).map(asObject).find((item) => asObject(item.installation).id === installationId);
    const refreshedVersion = asObject(refreshedBinding?.binding).versionNumber;
    await expectJson("恢复原有 Project 启用状态", "PUT", `/api/v1/projects/${encodeURIComponent(projectId)}/plugins/${encodeURIComponent(installationId)}`, 200, {
      enabled: true,
      ...(typeof refreshedVersion === "number" ? { expectedVersion: refreshedVersion } : {}),
      idempotencyKey: `phase5-production-restore-enable-${runId}`
    });
  }
}

console.log("Phase 5 production vertical acceptance passed.");
