import { expect, test, type Route } from "@playwright/test";
import { captureUiEvidence } from "./visual-evidence";

const projectId = "10000000-0000-4000-8000-000000000001";
const preferenceId = "20000000-0000-4000-8000-000000000001";
const memoryId = "30000000-0000-4000-8000-000000000001";
const logicalMemoryId = "40000000-0000-4000-8000-000000000001";
const confirmedAt = "2026-09-27T00:00:00.000Z";

test("个人偏好与 Project Memory 分域管理并支持版本、冲突、历史和响应式布局", async ({ page }) => {
  type Preference = {
    id: string;
    logicalMemoryId: string;
    category: "language";
    memoryKey: string;
    statement: string;
    value: Record<string, unknown>;
    version: number;
    status: "active" | "superseded";
    confirmedAt: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    createdAt: string;
  };
  type ProjectMemory = {
    id: string;
    logicalMemoryId: string;
    memoryKey: string;
    memoryType: "business_rule";
    statement: string;
    value: Record<string, unknown>;
    version: number;
    status: "active" | "superseded" | "deleted";
    conflictStatus: "clear" | "disputed";
    confirmedAt: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  };

  let preferences: Preference[] = [];
  let projectMemories: ProjectMemory[] = [];
  let memoryHistory: ProjectMemory[] = [];
  let preferenceCreateBody: unknown;
  let preferenceEditBody: unknown;
  let preferenceDeleteBody: unknown;
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path === "/api/v1/auth/session")
      return json(route, {
        authenticated: true,
        userId: "synthetic-owner",
        username: "synthetic-owner",
        expiresAt: "2026-10-04T00:00:00.000Z",
      });
    if (path === "/api/v1/projects" && method === "GET")
      return json(route, { projects: [{ id: projectId, name: "合成验收项目" }] });
    if (path === "/api/v1/me/preferences" && method === "GET") return json(route, { preferences });
    if (path === "/api/v1/me/preferences" && method === "POST") {
      preferenceCreateBody = request.postDataJSON();
      const body = preferenceCreateBody as { category: "language"; statement: string; value: Record<string, unknown> };
      preferences = [
        {
          id: preferenceId,
          logicalMemoryId,
          category: body.category,
          memoryKey: body.category,
          statement: body.statement,
          value: body.value,
          version: 1,
          status: "active",
          confirmedAt,
          effectiveFrom: confirmedAt,
          effectiveTo: null,
          createdAt: confirmedAt,
        },
      ];
      return json(route, { preference: preferences[0] }, 201);
    }
    if (path === `/api/v1/me/preferences/${preferenceId}` && method === "PATCH") {
      preferenceEditBody = request.postDataJSON();
      const body = preferenceEditBody as { statement: string; value: Record<string, unknown> };
      preferences = [{ ...preferences[0]!, statement: body.statement, value: body.value, version: 2 }];
      return json(route, { preference: preferences[0] });
    }
    if (path === `/api/v1/me/preferences/${preferenceId}` && method === "DELETE") {
      preferenceDeleteBody = request.postDataJSON();
      preferences = [];
      return json(route, { result: { deleted: true } });
    }
    if (path === "/api/v1/me/memory-usage" && method === "GET") return json(route, { usage: [] });

    const projectMemoryCollection = `/api/v1/projects/${projectId}/memories`;
    if (path === projectMemoryCollection && method === "GET")
      return json(route, { memory: { project: projectMemories, workspace: [], conflicts: [] } });
    if (path === projectMemoryCollection && method === "POST") {
      const body = request.postDataJSON() as { memoryKey: string; memoryType: "business_rule"; statement: string };
      const created: ProjectMemory = {
        id: memoryId,
        logicalMemoryId,
        memoryKey: body.memoryKey,
        memoryType: body.memoryType,
        statement: body.statement,
        value: {},
        version: 1,
        status: "active",
        conflictStatus: "clear",
        confirmedAt,
        effectiveFrom: confirmedAt,
        effectiveTo: null,
      };
      projectMemories = [created];
      memoryHistory = [created];
      return json(route, { memory: created }, 201);
    }
    if (path === `/api/v1/projects/${projectId}/memory-usage` && method === "GET") return json(route, { usage: [] });
    if (path === `/api/v1/projects/${projectId}/memories/${logicalMemoryId}/history` && method === "GET")
      return json(route, { versions: memoryHistory });
    if (path.startsWith(`/api/v1/projects/${projectId}/memories/${logicalMemoryId}/as-of`) && method === "GET")
      return json(route, { memory: projectMemories[0] ?? null });
    if (path === `/api/v1/projects/${projectId}/memories/${memoryId}/conflict` && method === "PATCH") {
      const body = request.postDataJSON() as { conflictStatus: "clear" | "disputed" };
      projectMemories = [{ ...projectMemories[0]!, conflictStatus: body.conflictStatus }];
      return json(route, { memory: projectMemories[0] });
    }
    if (path === `/api/v1/projects/${projectId}/memories/${memoryId}` && method === "PATCH") {
      const body = request.postDataJSON() as { statement: string };
      const current = projectMemories[0]!;
      const prior = {
        ...current,
        id: "50000000-0000-4000-8000-000000000001",
        status: "superseded" as const,
        effectiveTo: confirmedAt,
      };
      const next = { ...current, statement: body.statement, version: current.version + 1 };
      memoryHistory = [next, prior];
      projectMemories = [next];
      return json(route, { memory: next });
    }
    return json(route, { error: `unhandled ${method} ${path}`, code: "NOT_FOUND" }, 404);
  });

  await page.goto("/account/memory");
  await expect(page.getByRole("heading", { name: "记忆设置" })).toBeVisible();
  await captureUiEvidence(page, "memory");
  await expect(
    page.getByText("只对当前账号可见，不会出现在 Project、Generation Job 或 Revision 的共享记录中。"),
  ).toBeVisible();

  const preferencePanel = page.locator('section[aria-labelledby="preference-title"]');
  await preferencePanel.getByLabel("偏好内容").fill("回答优先使用简体中文");
  await preferencePanel.getByRole("button", { name: "确认添加" }).click();
  await expect(page.getByText("回答优先使用简体中文", { exact: true })).toBeVisible();
  await preferencePanel.getByRole("button", { name: "编辑" }).click();
  await preferencePanel.getByLabel("编辑个人偏好").fill("回答使用简体中文，表达简洁");
  await preferencePanel.getByRole("button", { name: "保存新版本" }).click();
  await expect(page.getByText("回答使用简体中文，表达简洁", { exact: true })).toBeVisible();
  await preferencePanel.getByRole("button", { name: "删除" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "删除个人偏好" });
  await expect(deleteDialog).toContainText("全部历史正文和派生引用");
  await deleteDialog.getByRole("button", { name: "取消" }).click();
  await expect(deleteDialog).toBeHidden();
  await expect(preferencePanel.getByText("回答使用简体中文，表达简洁", { exact: true })).toBeVisible();
  expect(preferenceDeleteBody).toBeUndefined();
  await preferencePanel.getByRole("button", { name: "删除" }).click();
  await expect(deleteDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(deleteDialog).toBeHidden();
  expect(preferenceDeleteBody).toBeUndefined();
  await preferencePanel.getByRole("button", { name: "删除" }).click();
  await deleteDialog.getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByText("个人偏好及其历史正文已清除。", { exact: true })).toBeVisible();
  await expect(page.getByText("回答使用简体中文，表达简洁", { exact: true })).toHaveCount(0);
  expect(preferenceCreateBody).toEqual({ category: "language", statement: "回答优先使用简体中文", value: {} });
  expect(preferenceEditBody).toMatchObject({ expectedVersion: 1, statement: "回答使用简体中文，表达简洁" });
  expect(preferenceDeleteBody).toEqual({ expectedVersion: 2 });

  const projectPanel = page.locator('section[aria-labelledby="project-memory-title"]');
  await projectPanel.getByLabel("记忆键").fill("rule.revenue.tax");
  await projectPanel.getByLabel("已确认规则或事实").fill("项目收入按不含税金额统计");
  await projectPanel.getByRole("button", { name: "确认添加" }).click();
  await expect(projectPanel.getByText("项目收入按不含税金额统计", { exact: true })).toBeVisible();
  await projectPanel.getByRole("button", { name: "编辑" }).click();
  await projectPanel.getByLabel("编辑 Project Memory").fill("项目收入统一按不含税金额统计");
  await projectPanel.getByRole("button", { name: "保存新版本" }).click();
  await expect(projectPanel.getByText("项目收入统一按不含税金额统计", { exact: true })).toBeVisible();
  await projectPanel.getByRole("button", { name: "标记冲突" }).click();
  await expect(projectPanel.getByText("待处理冲突", { exact: true })).toBeVisible();
  await projectPanel.getByRole("button", { name: "版本历史" }).click();
  await expect(projectPanel.getByText("版本历史", { exact: true })).toBeVisible();
  await expect(projectPanel.getByText("v1 · 已替代", { exact: true })).toBeVisible();
  await projectPanel.getByLabel("按业务有效时间查询").fill("2026-09-27T12:00");
  await projectPanel.getByRole("button", { name: "查询" }).click();
  await expect(projectPanel.getByText(/当时版本 v2/)).toBeVisible();

  const viewportWidth = await page.evaluate(() => window.innerWidth);
  const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(documentWidth).toBeLessThanOrEqual(viewportWidth);
});
