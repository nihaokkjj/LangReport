const apiOrigin = process.env.PHASE5_API_ORIGIN?.trim().replace(/\/+$/, "");
const jwt = process.env.PHASE5_JWT?.trim();
const sessionCookie = process.env.PHASE5_SESSION_COOKIE?.trim();
const workspaceId = process.env.PHASE5_WORKSPACE_ID?.trim();
const projectId = process.env.PHASE5_PROJECT_ID?.trim();

if (!apiOrigin || (!jwt && !sessionCookie) || !workspaceId) {
  throw new Error("需要设置 PHASE5_API_ORIGIN、PHASE5_JWT 或 PHASE5_SESSION_COOKIE，以及 PHASE5_WORKSPACE_ID；脚本不会输出认证凭据。");
}

async function request(path, init = {}) {
  const response = await fetch(`${apiOrigin}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
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

async function expectStatus(label, path, expectedStatus, init = {}) {
  const { response, body } = await request(path, init);
  if (response.status !== expectedStatus) {
    const detail = typeof body === "object" && body !== null
      ? [body.code, body.error].filter((value) => typeof value === "string").join(" · ")
      : "";
    throw new Error(`${label} 失败：HTTP ${response.status}${detail ? ` (${detail})` : ""}`);
  }
  console.log(`PASS ${label} · HTTP ${response.status}`);
  return body;
}

await expectStatus("健康检查", "/health", 200);
await expectStatus("数据库就绪检查", "/ready", 200);

const authenticatedHeaders = jwt
  ? { authorization: `Bearer ${jwt}` }
  : { cookie: sessionCookie };
const authenticatedLabel = jwt ? "JWT" : "Session Cookie";

await expectStatus(`${authenticatedLabel} 访问项目列表`, "/api/v1/projects", 200, { headers: authenticatedHeaders });
await expectStatus(
  "生产环境拒绝伪造 x-user-id",
  "/api/v1/projects",
  401,
  { headers: { "x-user-id": "phase5-smoke-spoof" } }
);
await expectStatus("无认证访问被拒绝", "/api/v1/projects", 401);

if (jwt && sessionCookie) {
  await expectStatus("Session Cookie 访问项目列表", "/api/v1/projects", 200, { headers: { cookie: sessionCookie } });
}

await expectStatus(
  `${authenticatedLabel} 访问插件目录`,
  `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/plugin-catalog`,
  200,
  { headers: authenticatedHeaders }
);
await expectStatus(
  `${authenticatedLabel} 访问 Workspace 插件安装列表`,
  `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/plugins`,
  200,
  { headers: authenticatedHeaders }
);

if (projectId) {
  await expectStatus(
    `${authenticatedLabel} 访问 Project 插件 Binding`,
    `/api/v1/projects/${encodeURIComponent(projectId)}/plugins`,
    200,
    { headers: authenticatedHeaders }
  );
  await expectStatus(
    `${authenticatedLabel} 访问 Project 能力目录`,
    `/api/v1/projects/${encodeURIComponent(projectId)}/capabilities`,
    200,
    { headers: authenticatedHeaders }
  );
}

console.log("Phase 5 production smoke passed.");
