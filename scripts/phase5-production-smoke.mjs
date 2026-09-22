const apiOrigin = process.env.PHASE5_API_ORIGIN?.trim().replace(/\/+$/, "");
const jwt = process.env.PHASE5_JWT?.trim();
let sessionCookie = process.env.PHASE5_SESSION_COOKIE?.trim();
const loginUsername = process.env.PHASE5_LOGIN_USERNAME?.trim();
const loginPassword = process.env.PHASE5_LOGIN_PASSWORD;
const workspaceId = process.env.PHASE5_WORKSPACE_ID?.trim();
const projectId = process.env.PHASE5_PROJECT_ID?.trim();

if (!apiOrigin || (!jwt && !sessionCookie && !(loginUsername && loginPassword)) || !workspaceId) {
  throw new Error("需要设置 PHASE5_API_ORIGIN、一种认证方式（登录账号密码、JWT 或 Session Cookie）以及 PHASE5_WORKSPACE_ID；脚本不会输出认证凭据。");
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

if (loginUsername && loginPassword) {
  const { response, body } = await request("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: loginUsername, password: loginPassword })
  });
  if (response.status !== 200) {
    const detail = typeof body === "object" && body !== null ? [body.code, body.error].filter((value) => typeof value === "string").join(" · ") : "";
    throw new Error(`登录网关失败：HTTP ${response.status}${detail ? ` (${detail})` : ""}`);
  }
  const setCookie = response.headers.get("set-cookie") ?? "";
  for (const expected of ["langreport_session=", "HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=604800"]) {
    if (!setCookie.includes(expected)) throw new Error(`登录 Cookie 缺少安全属性：${expected}`);
  }
  sessionCookie = setCookie.split(";", 1)[0];
  console.log("PASS 登录网关签发安全 Session Cookie · HTTP 200");
}

const authenticatedHeaders = jwt
  ? { authorization: `Bearer ${jwt}` }
  : { cookie: sessionCookie };
const authenticatedLabel = jwt ? "JWT" : loginUsername ? "登录网关 Session Cookie" : "Session Cookie";

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

if (loginUsername && sessionCookie) {
  await expectStatus("登录 Cookie 查询当前会话", "/api/v1/auth/session", 200, { headers: { cookie: sessionCookie } });
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

if (loginUsername && sessionCookie) {
  const { response } = await request("/api/v1/auth/logout", { method: "POST", headers: { cookie: sessionCookie } });
  if (response.status !== 204 || !(response.headers.get("set-cookie") ?? "").includes("Max-Age=0")) {
    throw new Error(`登出清理 Cookie 失败：HTTP ${response.status}`);
  }
  console.log("PASS 登出清理 Session Cookie · HTTP 204");
}

console.log("Phase 5 production smoke passed.");
