import { expect, test } from "@playwright/test";

test("API Console 将业务 401 留在响应面板而不跳转登录", async ({ page }) => {
  await page.route("**/api-console/openapi.json", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        openapi: "3.0.3",
        info: { title: "LangReport API", version: "test" },
        paths: {
          "/api/v1/projects": {
            get: {
              operationId: "listProjects",
              tags: ["Project"],
              summary: "读取项目",
              responses: {
                "200": { description: "项目列表" },
                "401": { description: "需要登录", content: { "application/json": { example: { error: "需要登录", code: "UNAUTHENTICATED", requestId: "req-console" } } } }
              }
            }
          }
        }
      }
    });
  });
  await page.route("**/api/v1/projects", async (route) => {
    await route.fulfill({ status: 401, contentType: "application/json", headers: { "x-request-id": "req-console" }, body: JSON.stringify({ error: "需要登录", code: "UNAUTHENTICATED", requestId: "req-console" }) });
  });

  await page.goto("/api-console");
  await expect(page.getByRole("heading", { name: "Generation Job 场景" })).toBeVisible();
  await expect(page.getByRole("button", { name: /\/api\/v1\/projects/ })).toBeVisible();
  await page.getByRole("button", { name: /\/api\/v1\/projects/ }).click();
  await page.getByRole("button", { name: "发送请求 ↗" }).click();

  await expect(page).toHaveURL(/\/api-console$/);
  await expect(page.getByRole("alert").filter({ hasText: "UNAUTHENTICATED" })).toBeVisible();
  await expect(page.getByText("requestId · req-console", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "账号登录" })).toHaveCount(0);
});
