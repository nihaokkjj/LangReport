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
