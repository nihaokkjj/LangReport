import { expect, test } from "@playwright/test";
import { captureUiEvidence } from "./visual-evidence";

test("账号页显示当前用户名、验证当前密码并能在桌面和窄屏完成改密", async ({ page }) => {
  const requests: Array<{ currentPassword?: string; newPassword?: string }> = [];
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({
      json: { authenticated: true, userId: "account-user", username: "analyst", expiresAt: "2026-09-29T00:00:00.000Z" },
    });
  });
  await page.route("**/api/v1/auth/password", async (route) => {
    const body = route.request().postDataJSON() as { currentPassword?: string; newPassword?: string };
    requests.push(body);
    if (body.currentPassword !== "correct-current") {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "当前密码不正确",
          code: "INVALID_CURRENT_PASSWORD",
          requestId: "account-test",
          details: {},
        }),
      });
      return;
    }
    await route.fulfill({ contentType: "application/json", json: { updated: true } });
  });

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "账号设置" })).toBeVisible();
  await captureUiEvidence(page, "account");
  await expect(page.getByText("analyst", { exact: true })).toBeVisible();
  await page.getByLabel("当前密码").fill("wrong-current");
  await page.getByLabel("新密码", { exact: true }).fill("newpass");
  await page.getByLabel("确认新密码", { exact: true }).fill("newpass");
  await page.getByRole("button", { name: "更新密码" }).click();
  await expect(page.getByRole("region", { name: "账号设置" }).getByRole("alert")).toContainText("当前密码不正确");

  await page.getByLabel("当前密码").fill("correct-current");
  await page.getByRole("button", { name: "更新密码" }).click();
  await expect(page.getByRole("status")).toContainText("会话会保留到各自原定过期时间");
  expect(requests).toEqual([
    { currentPassword: "wrong-current", newPassword: "newpass" },
    { currentPassword: "correct-current", newPassword: "newpass" },
  ]);

  await page.setViewportSize({ width: 1024, height: 900 });
  await captureUiEvidence(page, "account");
  await page.setViewportSize({ width: 760, height: 900 });
  await captureUiEvidence(page, "account");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "账号设置" })).toBeVisible();
  await captureUiEvidence(page, "account");
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  await expect(page.getByLabel("当前密码")).toBeVisible();
  await expect(page.getByRole("button", { name: "更新密码" })).toBeVisible();
});
