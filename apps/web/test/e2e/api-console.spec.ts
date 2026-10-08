import { expect, test } from "@playwright/test";
import { captureUiEvidence } from "./visual-evidence";

test("API Console 说明固定历史证据与两个审核入口的就绪核验", async ({ page }) => {
  await page.route("**/api-console/openapi.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        openapi: "3.0.3",
        info: { title: "LangReport", version: "test" },
        paths: {
          "/api/v1/chart-revisions/{revisionId}/submit": {
            post: {
              operationId: "submitChartRevision",
              tags: ["Reviews"],
              summary: "提交审核",
              responses: {
                "200": { description: "成功" },
                "409": { description: "不完整" },
                "503": { description: "不可核验" },
              },
            },
          },
          "/api/v1/chart-revisions/{revisionId}/approve": {
            post: {
              operationId: "approveChartRevision",
              tags: ["Reviews"],
              summary: "批准版本",
              responses: {
                "200": { description: "成功" },
                "409": { description: "不完整" },
                "503": { description: "不可核验" },
              },
            },
          },
          "/api/v1/projects/{projectId}/evidence-blocks": {
            get: {
              operationId: "listEvidenceBlocks",
              tags: ["Evidence"],
              summary: "查询证据",
              responses: { "200": { description: "成功" } },
            },
          },
        },
      },
    }),
  );
  await page.goto("/api-console");
  for (const path of ["submit", "approve"]) {
    await page.getByRole("button", { name: new RegExp(`/chart-revisions/.*${path}`) }).click();
    await expect(page.getByText(/审核固定 Revision 前核验来源/)).toBeVisible();
    await expect(page.getByText(/503 REVISION_OUTPUT_VERIFICATION_UNAVAILABLE/)).toBeVisible();
    await expect(page.getByText(/批准旧版本保留较新 head/)).toBeVisible();
  }
  await page.getByRole("button", { name: /\/evidence-blocks/ }).click();
  await expect(page.getByText(/默认查询 head\/published 对应 Evidence/)).toBeVisible();
  await expect(page.getByText(/使用 revisionId 查询固定历史版本/)).toBeVisible();
  await expect(page.getByText(/409 REVISION_LEGACY_UNVERIFIED/)).toBeVisible();
  await expect(page.getByText(/EVIDENCE_LIFECYCLE_READ_ONLY/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("API Console 说明编辑、复制和回滚的异步 Job 合同", async ({ page }) => {
  await page.route("**/api-console/openapi.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        openapi: "3.0.3",
        info: { title: "LangReport", version: "test" },
        paths: {
          "/api/v1/chart-artifacts/{artifactId}/revisions": {
            post: {
              operationId: "createChartRevisionCommand",
              tags: ["Chart Revisions"],
              summary: "编辑版本",
              responses: { "200": { description: "幂等复用" }, "202": { description: "已排队" } },
            },
          },
        },
      },
    }),
  );
  await page.goto("/api-console");
  await page.getByRole("button", { name: /\/revisions/ }).click();
  await expect(page.getByText(/编辑、复制与回滚统一返回 Generation Job/)).toBeVisible();
  await expect(page.getByText(/新任务 202，幂等复用 200/)).toBeVisible();
  await expect(page.getByText(/复制创建新 Artifact/)).toBeVisible();
  await expect(page.getByText(/REVISION_PROVENANCE_INCOMPLETE/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("API Console 说明本地解析繁忙及提交结果不明的处理", async ({ page }) => {
  await page.route("**/api-console/openapi.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        openapi: "3.0.3",
        info: { title: "LangReport", version: "test" },
        paths: {
          "/api/v1/projects/{projectId}/data-assets/paste": {
            post: {
              operationId: "pasteDataAsset",
              tags: ["Data Assets"],
              summary: "粘贴表格",
              responses: { "201": { description: "创建成功" }, "503": { description: "解析繁忙" } },
            },
          },
        },
      },
    }),
  );
  await page.goto("/api-console");
  await page.getByRole("button", { name: /\/data-assets\/paste/ }).click();
  await expect(page.getByText(/本地表格解析完成后同步返回 201/)).toBeVisible();
  await expect(page.getByText(/请先查询资产及快照列表/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

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
                "401": {
                  description: "需要登录",
                  content: {
                    "application/json": {
                      example: { error: "需要登录", code: "UNAUTHENTICATED", requestId: "req-console" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  });
  await page.route("**/api/v1/projects", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      headers: { "x-request-id": "req-console" },
      body: JSON.stringify({ error: "需要登录", code: "UNAUTHENTICATED", requestId: "req-console" }),
    });
  });

  await page.goto("/api-console");
  await expect(page.getByRole("heading", { name: "Generation Job 场景" })).toBeVisible();
  await captureUiEvidence(page, "api-console");
  await expect(page.getByRole("button", { name: /\/api\/v1\/projects/ })).toBeVisible();
  await page.getByRole("button", { name: /\/api\/v1\/projects/ }).click();
  await page.getByRole("button", { name: "发送请求 ↗" }).click();

  await expect(page).toHaveURL(/\/api-console$/);
  await expect(page.getByRole("alert").filter({ hasText: "UNAUTHENTICATED" })).toBeVisible();
  await expect(page.getByText("requestId · req-console", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "账号登录" })).toHaveCount(0);
});

test("API Console 发送改密请求时保留实时请求体，并从预览、cURL 与本地历史脱敏", async ({ page }) => {
  const currentPassword = "Current-secret-742";
  const newPassword = "New-secret-951";
  const legacyPassword = "Legacy-secret-382";
  const apiKey = "Live-api-key-275";
  const queryToken = "Live-query-token-486";
  let receivedBody: unknown;
  let receivedHeaders: Record<string, string> = {};
  let receivedUrl = "";

  await page.addInitScript(
    ({ legacyPassword }) => {
      localStorage.setItem(
        "langreport-api-console-history-v1",
        JSON.stringify([
          {
            id: "legacy-history",
            key: "POST /api/v1/auth/password",
            method: "POST",
            path: "/api/v1/auth/password",
            operationId: "changeAuthPassword",
            summary: "修改当前用户密码",
            at: new Date().toISOString(),
            status: 200,
            duration: 1,
            requestId: null,
            state: {
              parameterValues: {
                "header:X-API-Key": legacyPassword,
                "header:Authorization": legacyPassword,
                "query:token": legacyPassword,
              },
              contentType: "application/json",
              bodyText: JSON.stringify({ currentPassword: legacyPassword, newPassword: legacyPassword }),
              bodyFields: { currentPassword: legacyPassword, newPassword: legacyPassword },
            },
          },
        ]),
      );
    },
    { legacyPassword },
  );

  await page.route("**/api-console/openapi.json", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        openapi: "3.0.3",
        info: { title: "LangReport API", version: "test" },
        paths: {
          "/api/v1/auth/password": {
            post: {
              operationId: "changeAuthPassword",
              tags: ["Auth"],
              summary: "修改当前用户密码",
              parameters: [
                {
                  name: "X-API-Key",
                  in: "header",
                  schema: { type: "string", default: "OpenAPI-header-secret" },
                },
                {
                  name: "token",
                  in: "query",
                  schema: { type: "string", default: "OpenAPI-query-secret" },
                },
              ],
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["currentPassword", "newPassword"],
                      properties: {
                        currentPassword: { type: "string", format: "password" },
                        newPassword: { type: "string", format: "password" },
                      },
                    },
                  },
                },
              },
              responses: { "200": { description: "密码已修改" } },
            },
          },
        },
      },
    });
  });
  await page.route("**/api/v1/auth/password**", async (route) => {
    receivedBody = route.request().postDataJSON();
    receivedHeaders = route.request().headers();
    receivedUrl = route.request().url();
    await route.fulfill({ contentType: "application/json", json: { updated: true } });
  });

  await page.goto("/api-console");
  await page
    .getByRole("complementary", { name: "接口目录" })
    .getByRole("button", { name: /\/api\/v1\/auth\/password/ })
    .click();
  await expect(page.getByLabel("X-API-Key 参数")).toHaveValue("");
  await expect(page.getByLabel("token 参数")).toHaveValue("");
  await page.getByLabel("X-API-Key 参数").fill(apiKey);
  await page.getByLabel("token 参数").fill(queryToken);
  await page.getByLabel("JSON 请求体").fill(JSON.stringify({ currentPassword, newPassword }));
  await page.getByRole("button", { name: "发送请求 ↗" }).click();

  await expect.poll(() => receivedBody).toEqual({ currentPassword, newPassword });
  expect(receivedHeaders["x-api-key"]).toBe(apiKey);
  expect(new URL(receivedUrl).searchParams.get("token")).toBe(queryToken);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "复制 cURL" }).click();
  const curl = await page.evaluate(() => navigator.clipboard.readText());
  expect(curl).toContain("[REDACTED]");
  expect(curl).not.toContain(currentPassword);
  expect(curl).not.toContain(newPassword);
  expect(curl).not.toContain(apiKey);
  expect(curl).not.toContain(queryToken);
  await page.getByText("查看原始响应与请求").click();
  const requestPreview = page.locator("details pre").last();
  await expect(requestPreview).toContainText("[REDACTED]");
  await expect(requestPreview).not.toContainText(currentPassword);
  await expect(requestPreview).not.toContainText(newPassword);
  await expect(requestPreview).not.toContainText(apiKey);
  await expect(requestPreview).not.toContainText(queryToken);

  const storedHistory = await page.evaluate(() => localStorage.getItem("langreport-api-console-history-v1"));
  expect(storedHistory).not.toContain(currentPassword);
  expect(storedHistory).not.toContain(newPassword);
  expect(storedHistory).not.toContain(legacyPassword);
  expect(storedHistory).not.toContain(apiKey);
  expect(storedHistory).not.toContain(queryToken);
  const storedItems = JSON.parse(storedHistory ?? "[]") as Array<{
    state: { bodyText: string; bodyFields: Record<string, string>; parameterValues: Record<string, string> };
  }>;
  expect(storedItems.length).toBeGreaterThan(0);
  for (const item of storedItems) {
    expect(JSON.parse(item.state.bodyText)).toMatchObject({ currentPassword: "", newPassword: "" });
    expect(item.state.bodyFields).toMatchObject({ currentPassword: "", newPassword: "" });
    expect(item.state.parameterValues).not.toHaveProperty("header:X-API-Key");
    expect(item.state.parameterValues).not.toHaveProperty("header:Authorization");
    expect(item.state.parameterValues).not.toHaveProperty("query:token");
  }
});
