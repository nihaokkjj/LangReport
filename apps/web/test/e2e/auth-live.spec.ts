import { expect, test } from "@playwright/test";

const liveBaseURL = process.env.LANGREPORT_E2E_BASE_URL?.trim();
const liveUsername = process.env.LANGREPORT_E2E_USERNAME?.trim();
const livePassword = process.env.LANGREPORT_E2E_PASSWORD;
const liveAuthEnabled = Boolean(liveBaseURL?.startsWith("https://") && liveUsername && livePassword);

test.describe("真实同源 Cookie logout/cache", () => {
  test.skip(!liveAuthEnabled, "设置 HTTPS 的 LANGREPORT_E2E_BASE_URL、LANGREPORT_E2E_USERNAME 和 LANGREPORT_E2E_PASSWORD 后运行真实浏览器验收。");

  test("登出后 Cookie、选择状态和旧工作台 DOM 均清理", async ({ page, context }) => {
    await page.addInitScript(() => {
      window.addEventListener("langreport:generation-abort", () => {
        window.sessionStorage.setItem("langreport-generation-abort", "seen");
      });
    });

    await page.goto("/login?returnTo=%2F");
    await expect(page.getByRole("heading", { name: "账号登录" })).toBeVisible();
    await page.getByLabel("账号").fill(liveUsername as string);
    await page.getByLabel("密码").fill(livePassword as string);
    await page.getByRole("button", { name: "进入工作台 ↗" }).click();
    await page.waitForURL((url) => url.pathname === "/");
    await expect(page.locator(".project-selector .selector-button")).toBeVisible();

    const projectLabel = await page.locator(".project-selector .selector-button").innerText();
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("langreport-project-id"))).not.toBeNull();

    await page.getByRole("button", { name: "退出" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "账号登录" })).toBeVisible();

    const cookiesAfterLogout = await context.cookies();
    expect(cookiesAfterLogout.find((cookie) => cookie.name === "langreport_session")?.value ?? "").toBe("");
    const clientStateAfterLogout = await page.evaluate(() => ({
      project: window.localStorage.getItem("langreport-project-id"),
      conversations: Object.keys(window.localStorage).filter((key) => key.startsWith("langreport-conversation-")),
      abort: window.sessionStorage.getItem("langreport-generation-abort")
    }));
    expect(clientStateAfterLogout.project).toBeNull();
    expect(clientStateAfterLogout.conversations).toEqual([]);
    expect(clientStateAfterLogout.abort).toBe("seen");
    await expect(page.getByText(projectLabel, { exact: true })).toHaveCount(0);

    await page.goto("/");
    await expect(page).toHaveURL(/\/login\?returnTo=%2F$/);
    await expect(page.getByRole("heading", { name: "账号登录" })).toBeVisible();
  });
});
