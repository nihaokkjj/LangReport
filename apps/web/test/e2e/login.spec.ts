import { expect, test } from "@playwright/test";

test("登录页不持久化密码，并在认证成功后返回原路径", async ({ page }) => {
  const requests: Array<{ username?: string; password?: string }> = [];
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "需要已认证的用户身份", code: "UNAUTHENTICATED" }) });
  });
  await page.route("**/api/v1/auth/login", async (route) => {
    const body = route.request().postDataJSON() as { username?: string; password?: string };
    requests.push(body);
    if (body.username !== "operator" || body.password !== "correct-password") {
      await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "账号或密码错误", code: "INVALID_CREDENTIALS" }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: true, userId: "login-user", expiresAt: "2026-09-29T00:00:00.000Z" }) });
  });

  await page.goto("/login?returnTo=%2Flogin-success");
  await expect(page.getByRole("heading", { name: "账号登录" })).toBeVisible();
  await page.getByLabel("账号").fill("operator");
  await page.getByLabel("密码").fill("wrong-password");
  await page.getByRole("button", { name: "进入工作台 ↗" }).click();
  await expect(page.getByText("账号或密码错误，请重新输入。", { exact: true })).toBeVisible();
  await expect(page.getByLabel("密码")).toHaveValue("");

  await page.getByLabel("密码").fill("correct-password");
  await page.getByRole("button", { name: "进入工作台 ↗" }).click();
  await expect(page).toHaveURL(/\/login-success$/);
  expect(requests).toEqual([
    { username: "operator", password: "wrong-password" },
    { username: "operator", password: "correct-password" }
  ]);
  const storedValues = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)]);
  expect(storedValues.join(" ")).not.toContain("correct-password");
  expect(storedValues.join(" ")).not.toContain("wrong-password");
});

test("开发工作台未登录时跳转登录且不发送 x-user-id", async ({ page }) => {
  let identityHeader: string | undefined;
  await page.route("**/api/v1/dev/bootstrap", async (route) => {
    identityHeader = route.request().headers()["x-user-id"];
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "需要已认证的用户身份", code: "UNAUTHENTICATED" })
    });
  });
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "需要已认证的用户身份", code: "UNAUTHENTICATED" })
    });
  });

  await page.goto("/");
  await expect(page).toHaveURL(/\/login\?returnTo=%2F$/);
  await expect(page.getByRole("heading", { name: "账号登录" })).toBeVisible();
  expect(identityHeader).toBeUndefined();
});

test("浏览器登出清理 Cookie、选择状态并中止 Generation watcher", async ({ page, context }) => {
  const projectId = "logout-project";
  const conversationId = "logout-conversation";
  const sessionCookie = "fixture-session";
  let authenticated = true;
  let loginCalls = 0;
  let logoutCookieHeader = "";

  await page.addInitScript(() => {
    window.addEventListener("langreport:generation-abort", () => {
      window.sessionStorage.setItem("langreport-generation-abort", "seen");
    });
  });
  await context.addCookies([{ name: "langreport_session", value: sessionCookie, url: "http://127.0.0.1:3100", httpOnly: true, sameSite: "Lax" }]);

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const workspace = { id: "logout-workspace", name: "Logout Workspace", role: "owner" };
    const project = { id: projectId, name: "登出验收项目", clientName: "测试客户", objective: "验证登出后的身份隔离。", audience: "client_presentation", visualTemplate: "consulting-neutral" };

    if (path === "/api/v1/auth/session" && request.method() === "GET") {
      return authenticated
        ? json({ authenticated: true, userId: "logout-user", expiresAt: "2026-09-29T00:00:00.000Z" })
        : json({ error: "需要已认证的用户身份", code: "UNAUTHENTICATED" }, 401);
    }
    if (path === "/api/v1/auth/login" && request.method() === "POST") {
      const body = request.postDataJSON() as { username?: string; password?: string };
      if (body.username !== "operator" || body.password !== "correct-password") return json({ error: "账号或密码错误", code: "INVALID_CREDENTIALS" }, 401);
      authenticated = true;
      loginCalls += 1;
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "set-cookie": `langreport_session=${sessionCookie}; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax` }, body: JSON.stringify({ authenticated: true, userId: "logout-user", expiresAt: "2026-09-29T00:00:00.000Z" }) });
    }
    if (path === "/api/v1/auth/logout" && request.method() === "POST") {
      logoutCookieHeader = request.headers().cookie ?? "";
      authenticated = false;
      return route.fulfill({ status: 204, headers: { "set-cookie": "langreport_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax" }, body: "" });
    }
    if (path === "/api/v1/dev/bootstrap" && request.method() === "POST") return json({ workspace, project });
    if (path === "/api/v1/projects" && request.method() === "GET") return json({ workspace, projects: [project] });
    if (path === `/api/v1/projects/${projectId}/conversations` && request.method() === "GET") return json({ conversations: [{ id: conversationId, projectId, title: "登出验收对话", createdAt: "2026-09-15T00:00:00.000Z", updatedAt: "2026-09-15T00:00:00.000Z" }] });
    if (path === `/api/v1/conversations/${conversationId}/messages` && request.method() === "GET") return json({ messages: [] });
    if (path === `/api/v1/projects/${projectId}/data-assets` && request.method() === "GET") return json({ assets: [] });
    if (path === `/api/v1/projects/${projectId}/evidence-blocks` && request.method() === "GET") return json({ evidence: [] });
    if (path === `/api/v1/projects/${projectId}/metric-definition` && request.method() === "GET") return json({ definition: null });
    if (path === `/api/v1/projects/${projectId}/analysis-brief` && request.method() === "GET") return json({ brief: null });
    if (path === `/api/v1/projects/${projectId}/memories` && request.method() === "GET") return json({ memory: { project: [], workspace: [], conflicts: [] } });
    if (path === `/api/v1/projects/${projectId}/theme` && request.method() === "GET") return json({ theme: { preset: "economist" } });
    if (path === "/api/v1/workspaces/logout-workspace/model-credential" && request.method() === "GET") return json({ credential: { workspaceId: "logout-workspace", provider: "bailian", configured: false, keySuffix: null, updatedAt: null } });
    return json({ error: `unhandled ${request.method()} ${path}` }, 404);
  });

  await page.goto("/");
  await expect(page.locator(".project-selector .selector-button")).toContainText("登出验收项目");
  await expect.poll(() => page.evaluate((id) => window.localStorage.getItem("langreport-project-id"), projectId)).toBe(projectId);
  await expect.poll(() => page.evaluate((id) => window.localStorage.getItem(`langreport-conversation-${id}`), projectId)).toBe(conversationId);

  await page.getByRole("button", { name: "退出" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "账号登录" })).toBeVisible();
  expect(logoutCookieHeader).toContain(`langreport_session=${sessionCookie}`);
  const cookiesAfterLogout = await context.cookies();
  expect(cookiesAfterLogout.find((cookie) => cookie.name === "langreport_session")?.value ?? "").toBe("");
  const clientStateAfterLogout = await page.evaluate(() => ({
    project: window.localStorage.getItem("langreport-project-id"),
    conversations: Object.keys(window.localStorage).filter((key) => key.startsWith("langreport-conversation-")),
    abort: window.sessionStorage.getItem("langreport-generation-abort")
  }));
  expect(clientStateAfterLogout).toEqual({ project: null, conversations: [], abort: "seen" });
  await expect(page.getByText("登出验收项目", { exact: true })).toHaveCount(0);

  await page.getByLabel("账号").fill("operator");
  await page.getByLabel("密码").fill("correct-password");
  await page.getByRole("button", { name: "进入工作台 ↗" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".project-selector .selector-button")).toContainText("登出验收项目");
  expect(loginCalls).toBe(1);
});
