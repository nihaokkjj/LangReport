import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createIsolatedIntegrationEnvironment } from "./integration-environment.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = resolve(repositoryRoot, "infra/docker-compose.test.yml");
const isWindows = process.platform === "win32";
const pnpmCommand = isWindows ? "pnpm.cmd" : "pnpm";
const runId = randomUUID().replaceAll("-", "").toLowerCase();
const userId = "phase1-live-" + runId;
const environment = createIsolatedIntegrationEnvironment(process.env, runId);
Object.assign(environment, {
  API_PORT: "4100",
  API_URL: "http://127.0.0.1:4100",
  API_PUBLIC_URL: "http://127.0.0.1:4100",
  WEB_ORIGIN: "http://127.0.0.1:3100",
  GENERATION_POLL_INTERVAL_MS: "100",
  RENDER_POLL_INTERVAL_MS: "100",
  GENERATION_STATUS_LONG_POLL: "true",
  LANGREPORT_WORKER_TEST: "0"
});

const apiOrigin = environment.API_URL;
const children = [];
const logs = new Map();
let schemaPrepared = false;
let bucketPrepared = false;
let composeStarted = false;
let cleanupFailure = false;

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function runCommand(command, args, label, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: options.env ?? environment,
    stdio: options.stdio ?? "inherit",
    shell: isWindows
  });
  if (result.error) throw new Error(label + " 启动失败");
  if (result.status !== 0) throw new Error(label + " 失败（退出码 " + String(result.status) + "）");
  return result;
}

function runPnpm(args, label, options = {}) {
  return runCommand(pnpmCommand, args, label, options);
}

function startService(label, args) {
  const child = spawn(pnpmCommand, args, {
    cwd: repositoryRoot,
    env: environment,
    shell: isWindows,
    stdio: ["ignore", "pipe", "pipe"]
  });
  logs.set(label, []);
  const append = (chunk) => {
    const lines = String(chunk).split(/\r?\n/).filter(Boolean);
    const current = logs.get(label) ?? [];
    current.push(...lines.map(redact));
    logs.set(label, current.slice(-80));
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  child.on("error", (error) => append(error.message));
  children.push({ label, child });
  return child;
}

function redact(value) {
  let result = String(value);
  for (const key of ["BAILIAN_API_KEY", "MODEL_CREDENTIAL_ENCRYPTION_KEY", "AUTH_JWT_SECRET", "S3_SECRET_KEY"]) {
    const secret = process.env[key];
    if (secret) result = result.replaceAll(secret, "[REDACTED]");
  }
  return result.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
}

async function waitFor(label, check, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  const detail = lastError instanceof Error ? ": " + lastError.message : "";
  throw new Error(label + " 超时" + detail);
}

async function request(path, init = {}) {
  const headers = {
    accept: "application/json",
    "x-user-id": userId,
    ...(init.headers ?? {})
  };
  const response = await fetch(apiOrigin + path, { ...init, headers });
  const raw = await response.text();
  let body = {};
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json") && raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = { raw: raw.slice(0, 200) };
    }
  }
  return { response, body, raw };
}

async function jsonRequest(method, path, payload) {
  return request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function expectStatus(label, method, path, status, payload) {
  const result = payload === undefined
    ? await request(path, { method })
    : await jsonRequest(method, path, payload);
  if (result.response.status !== status) {
    const body = result.body && typeof result.body === "object" ? result.body : {};
    const code = typeof body.code === "string" ? " (" + body.code + ")" : "";
    throw new Error(label + " 失败：HTTP " + String(result.response.status) + code);
  }
  return result;
}

async function waitForJob(jobId) {
  const history = [];
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const result = await request("/api/v1/generation-jobs/" + jobId, { method: "GET" });
    if (result.response.status !== 200) throw new Error("读取 Generation Job 失败");
    const job = result.body.job;
    if (!job || typeof job !== "object") throw new Error("Generation Job 响应缺少 job");
    const status = job.status;
    if (history[history.length - 1] !== status) history.push(status);
    if (["succeeded", "failed", "needs_clarification", "cancelled"].includes(status)) {
      return { ...result, history };
    }
    await sleep(250);
  }
  throw new Error("Generation Job 未在 60 秒内进入终态");
}

async function waitForTestServices() {
  await waitFor("PostgreSQL", async () => runCommand("docker", ["compose", "-f", composeFile, "exec", "-T", "postgres", "pg_isready", "-U", "langreport_test", "-d", "langreport_integration_test"], "PostgreSQL 就绪", { stdio: "ignore" })?.status === 0);
  await waitFor("MinIO", async () => {
    const response = await fetch("http://127.0.0.1:9002/minio/health/ready");
    return response.status === 200;
  });
}

async function stopServices() {
  for (const { label, child } of children.reverse()) {
    if (child.exitCode !== null) continue;
    if (isWindows && child.pid) {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", shell: false });
    } else {
      child.kill("SIGTERM");
    }
    await sleep(100);
    if (child.exitCode === null) child.kill("SIGKILL");
    void label;
  }
}

async function main() {
  runCommand("docker", ["compose", "-f", composeFile, "up", "-d"], "测试基础设施启动");
  composeStarted = true;
  await waitForTestServices();

  runPnpm(["--filter", "@langreport/db", "exec", "node", "scripts/prepare-integration-schema.mjs"], "测试数据库 schema 初始化");
  schemaPrepared = true;
  runPnpm(["--filter", "@langreport/storage", "exec", "node", "scripts/prepare-integration-bucket.mjs"], "测试对象存储 bucket 初始化");
  bucketPrepared = true;

  const api = startService("api", ["--filter", "@langreport/api", "start"]);
  startService("generation-worker", ["--filter", "@langreport/generation-worker", "start"]);
  startService("render-worker", ["--filter", "@langreport/render-worker", "start"]);

  await waitFor("API health", async () => {
    if (api.exitCode !== null) throw new Error("API 进程提前退出");
    const response = await fetch(apiOrigin + "/health");
    return response.status === 200;
  });
  await expectStatus("API ready", "GET", "/ready", 200);

  const projectResponse = await expectStatus("创建 Project", "POST", "/api/v1/projects", 201, {
    name: "Phase 1 Live Sales",
    clientName: "Live Client",
    objective: "验证咨询项目报告 Evidence Block 闭环",
    audience: "client_presentation",
    visualTemplate: "consulting-neutral"
  });
  const project = projectResponse.body.project;
  assertCondition(project && typeof project.id === "string", "Project 响应缺少 id");
  const projectId = project.id;

  const projectsResponse = await expectStatus("刷新 Project 列表", "GET", "/api/v1/projects", 200);
  assertCondition(Array.isArray(projectsResponse.body.projects) && projectsResponse.body.projects.some((item) => item.id === projectId), "刷新后找不到 Project");

  const conversationResponse = await expectStatus("创建 Conversation", "POST", "/api/v1/projects/" + projectId + "/conversations", 201, {
    title: "销售趋势分析"
  });
  const conversationId = conversationResponse.body.conversation?.id;
  assertCondition(typeof conversationId === "string", "Conversation 响应缺少 id");
  const conversationsResponse = await expectStatus("刷新 Conversation 列表", "GET", "/api/v1/projects/" + projectId + "/conversations", 200);
  assertCondition(conversationsResponse.body.conversations.some((item) => item.id === conversationId), "刷新后找不到 Conversation");

  const csv = [
    "月份,区域,销售额",
    "2026-01,华东,100",
    "2026-01,华南,80",
    "2026-02,华东,130",
    "2026-02,华南,110",
    "2026-03,华东,125",
    "2026-03,华南,118"
  ].join("\n");
  const assetResponse = await expectStatus("粘贴数据并生成 Snapshot", "POST", "/api/v1/projects/" + projectId + "/data-assets/paste", 201, {
    name: "monthly-sales.csv",
    content: csv,
    conversationId
  });
  const asset = assetResponse.body.asset;
  const assetId = asset?.id;
  assertCondition(typeof assetId === "string" && asset.latestSnapshot?.id, "Data Snapshot 响应缺少 id");
  const snapshotId = asset.latestSnapshot.id;
  const snapshotResponse = await expectStatus("读取 Snapshot 画像", "GET", "/api/v1/data-assets/" + assetId + "/snapshots/" + snapshotId, 200);
  assertCondition(Array.isArray(snapshotResponse.body.snapshot?.schema), "Snapshot 缺少字段画像");

  const metricResponse = await expectStatus("确认 Metric Definition", "POST", "/api/v1/projects/" + projectId + "/metric-definitions", 201, {
    conversationId,
    name: "销售额",
    meaning: "订单销售额合计",
    formula: "sum(销售额)",
    unit: "元",
    timeRule: "按自然月聚合",
    filterRule: ""
  });
  const metricId = metricResponse.body.definition?.id;
  assertCondition(typeof metricId === "string", "Metric Definition 响应缺少 id");

  const briefResponse = await expectStatus("确认 Analysis Brief", "POST", "/api/v1/projects/" + projectId + "/analysis-brief", 201, {
    conversationId,
    businessQuestion: "按月份展示各区域销售额趋势",
    audience: "客户汇报",
    timeRange: "2026-01 至 2026-03",
    timeGrain: "month",
    outputFormat: "evidence_block",
    status: "confirmed"
  });
  assertCondition(briefResponse.body.brief?.status === "confirmed", "Analysis Brief 未确认");

  const generationResponse = await expectStatus("创建 Generation Job", "POST", "/api/v1/projects/" + projectId + "/generation-jobs", 202, {
    conversationId,
    dataAssetId: assetId,
    metricDefinitionId: metricId,
    prompt: "按月份展示各区域销售额趋势",
    renderer: "vega-lite",
    idempotencyKey: "phase1-live-generation-" + runId
  });
  const jobId = generationResponse.body.job?.id;
  assertCondition(typeof jobId === "string", "Generation Job 响应缺少 id");
  const jobResult = await waitForJob(jobId);
  assertCondition(jobResult.body.job.status === "succeeded", "Generation Job 未成功：" + String(jobResult.body.job.errorCode ?? "unknown"));
  const firstRevision = jobResult.body.revision;
  assertCondition(firstRevision && typeof firstRevision.id === "string", "Generation Job 缺少初始 Revision");
  const evidenceResponse = await expectStatus("读取 Evidence Block", "GET", "/api/v1/projects/" + projectId + "/evidence-blocks", 200);
  assertCondition(evidenceResponse.body.evidence?.some((item) => item.block?.generationJobId === jobId), "未持久化 Evidence Block");

  const editResponse = await expectStatus("创建图表编辑 Job", "POST", "/api/v1/chart-artifacts/" + firstRevision.artifactId + "/revisions", 202, {
    operation: "edit",
    baseRevisionId: firstRevision.id,
    patch: {
      title: "修订后的销售额趋势",
      showValues: true
    },
    idempotencyKey: "phase1-live-edit-" + runId
  });
  const editJobId = editResponse.body.job?.id;
  assertCondition(typeof editJobId === "string", "编辑 Job 响应缺少 id");
  const editResult = await waitForJob(editJobId);
  assertCondition(editResult.body.job.status === "succeeded", "编辑 Job 未成功");
  const editRevisionSummary = editResult.body.revision;
  const revisionDetails = await expectStatus("读取编辑后的 Revision", "GET", "/api/v1/chart-revisions/" + editRevisionSummary.id, 200);
  const revision = revisionDetails.body.revision;
  assertCondition(revision && revision.parentRevisionId === firstRevision.id, "编辑未追加子 Revision");

  const commentResponse = await expectStatus("添加审核评论", "POST", "/api/v1/chart-revisions/" + revision.id + "/comments", 201, {
    body: "请确认客户汇报中的销售额口径。"
  });
  const commentId = commentResponse.body.comment?.id;
  assertCondition(typeof commentId === "string", "评论响应缺少 id");
  await expectStatus("提交审核", "POST", "/api/v1/chart-revisions/" + revision.id + "/submit", 200, { note: "提交 Reviewer 检查", expectedStatus: "draft" });
  await expectStatus("要求修改", "POST", "/api/v1/chart-revisions/" + revision.id + "/request-changes", 200, { note: "保留口径确认记录", expectedStatus: "in_review" });
  await expectStatus("解决审核评论", "POST", "/api/v1/comments/" + commentId + "/resolve", 200);
  await expectStatus("重新打开草稿", "POST", "/api/v1/chart-revisions/" + revision.id + "/reopen", 200, { expectedStatus: "changes_requested" });
  await expectStatus("再次提交审核", "POST", "/api/v1/chart-revisions/" + revision.id + "/submit", 200, { expectedStatus: "draft" });
  const approvedResponse = await expectStatus("批准固定 Revision", "POST", "/api/v1/chart-revisions/" + revision.id + "/approve", 200, { note: "口径、来源、变换和校验已确认", expectedStatus: "in_review" });
  assertCondition(approvedResponse.body.revision?.status === "approved", "Revision 未进入 Approved");

  const htmlResponse = await expectStatus("导出固定 Revision HTML", "GET", "/api/v1/chart-revisions/" + revision.id + "/outputs/html", 200);
  assertCondition((htmlResponse.response.headers.get("content-type") ?? "").includes("text/html"), "HTML Content-Type 不正确");
  assertCondition(/<!doctype html>/i.test(htmlResponse.raw) && /<svg[\s>]/i.test(htmlResponse.raw), "HTML 缺少静态 SVG");
  assertCondition(!/<script\b|javascript:/i.test(htmlResponse.raw), "HTML 包含不允许的脚本");
  for (const format of ["png", "svg", "vegaLite"]) {
    const output = await expectStatus("导出固定 Revision " + format, "GET", "/api/v1/chart-revisions/" + revision.id + "/outputs/" + format, 200);
    assertCondition(output.raw.length > 0, format + " 输出为空");
  }
  await expectStatus("拒绝未知导出格式", "GET", "/api/v1/chart-revisions/" + revision.id + "/outputs/unknown", 400);

  const refreshedEvidence = await expectStatus("刷新后恢复 Evidence", "GET", "/api/v1/projects/" + projectId + "/evidence-blocks", 200);
  const refreshed = refreshedEvidence.body.evidence?.find((item) => item.block?.chartRevisionId === revision.id);
  assertCondition(refreshed?.revision?.status === "approved", "刷新后未恢复 Approved Revision");

  console.log(JSON.stringify({
    status: "passed",
    gate: "phase1-live-smoke",
    runId,
    projectId,
    conversationId,
    snapshotId,
    jobId,
    jobStatusHistory: jobResult.history,
    editJobId,
    editJobStatusHistory: editResult.history,
    revisionId: revision.id,
    revisionNumber: revision.revision,
    exportedFormats: ["png", "svg", "html", "vegaLite"]
  }));
}

async function cleanup() {
  await stopServices();
  if (bucketPrepared) {
    try {
      runPnpm(["--filter", "@langreport/storage", "exec", "node", "scripts/cleanup-integration-bucket.mjs"], "测试对象存储 bucket 清理");
    } catch {
      cleanupFailure = true;
    }
  }
  if (schemaPrepared) {
    try {
      runPnpm(["--filter", "@langreport/db", "exec", "node", "scripts/cleanup-integration-schema.mjs"], "测试数据库 schema 清理");
    } catch {
      cleanupFailure = true;
    }
  }
  if (composeStarted) {
    try {
      runCommand("docker", ["compose", "-f", composeFile, "down"], "测试基础设施清理");
    } catch {
      cleanupFailure = true;
    }
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "live smoke 失败";
  console.error(JSON.stringify({ status: "failed", gate: "phase1-live-smoke", message }));
  for (const [label, entries] of logs) {
    if (entries.length > 0) console.error(label + " last logs: " + entries.slice(-8).join(" | "));
  }
  process.exitCode = 1;
} finally {
  await cleanup();
  if (cleanupFailure) process.exitCode = 1;
}
