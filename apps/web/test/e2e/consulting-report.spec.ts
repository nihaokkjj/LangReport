import { expect, test } from "@playwright/test";

const projectId = "project-sales";
const conversationId = "conversation-sales";
const assetId = "asset-sales";
const jobId = "job-sales";
const revisionId = "revision-sales-r1";

const now = "2026-09-15T00:00:00.000Z";
const rows = [
  { 月份: "2026-01", 区域: "华东", 销售额: 120000 },
  { 月份: "2026-02", 区域: "华东", 销售额: 138000 },
  { 月份: "2026-03", 区域: "华东", 销售额: 145000 }
];

function createFixture() {
  let asset: Record<string, unknown> | null = null;
  let metric: Record<string, unknown> | null = null;
  let brief: Record<string, unknown> | null = null;
  let revisionStatus: "draft" | "in_review" | "approved" = "draft";
  const revision = () => ({
    id: revisionId,
    artifactId: "artifact-sales",
    revision: 1,
    status: revisionStatus,
    parentRevisionId: null,
    snapshotId: "snapshot-sales-v1",
    createdAt: now,
    changeReason: null,
    flintSpec: {
      version: "v1",
      data: { values: rows },
      semanticTypes: { 月份: "temporal", 区域: "nominal", 销售额: "measure" },
      chartSpec: {
        chartType: "Line Chart",
        title: "各区域月度销售额",
        encodings: { x: { field: "月份", type: "temporal" }, y: { field: "销售额", type: "quantitative" }, color: { field: "区域", type: "nominal" } },
        baseSize: { width: 900, height: 360 }
      },
      theme: "economist",
      themeVersion: "v1"
    },
    validation: { valid: true, issues: [], checks: { structure: true, semantics: true, fields: true, visual: true } },
    transformPlan: { rationale: "按月份和区域聚合销售额", steps: [{ kind: "group", groupBy: ["月份", "区域"], measures: [{ column: "销售额", operation: "sum" }] }] },
    fieldLineage: [{ outputColumn: "销售额", sourceColumns: ["销售额"], operation: "sum" }],
    analysisBriefSnapshot: brief,
    metricDefinitionSnapshot: metric,
    pluginSnapshot: null
  });
  const evidence = () => ({
    block: { id: "block-sales", projectId, conversationId, generationJobId: jobId, chartArtifactId: "artifact-sales", chartRevisionId: revisionId, snapshotId: "snapshot-sales-v1", title: "各区域月度销售额", finding: "华东销售额连续增长。", analysisBriefSnapshot: brief, metricDefinitionSnapshot: metric, qualityWarnings: [], status: revisionStatus, updatedAt: now },
    artifact: { id: "artifact-sales", projectId, name: "各区域月度销售额", headRevisionId: revisionId, status: "active" },
    revision: revision(),
    job: { id: jobId, conversationId, status: "succeeded", operation: "generate", prompt: "按月份展示各区域销售额", snapshotId: "snapshot-sales-v1", repairCount: 0, errorCode: null, errorMessage: null, clarificationQuestions: null, intent: null, transformPlan: revision().transformPlan, fieldLineage: revision().fieldLineage, flintSpec: revision().flintSpec, validation: revision().validation, previewData: { columns: ["月份", "区域", "销售额"], rows, steps: [] }, revision: { id: revisionId, artifactId: "artifact-sales", revision: 1, status: revisionStatus } }
  });
  return {
    route: async (route: import("@playwright/test").Route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") throw new Error(`unexpected external request: ${request.url()}`);
      if (path === "/api/v1/dev/bootstrap" && request.method() === "POST") return route.fulfill({ json: { workspace: { id: "workspace-sales", name: "E2E Workspace", role: "owner" }, project: { id: projectId, name: "销售分析 Demo" } } });
      if (path === "/api/v1/projects" && request.method() === "GET") return route.fulfill({ json: { workspace: { id: "workspace-sales", name: "E2E Workspace", role: "owner" }, projects: [{ id: projectId, name: "销售分析 Demo" }] } });
      if (path === `/api/v1/projects/${projectId}/data-assets` && request.method() === "GET") return route.fulfill({ json: { assets: asset ? [asset] : [] } });
      if (path === `/api/v1/projects/${projectId}/conversations` && request.method() === "GET") return route.fulfill({ json: { conversations: [{ id: conversationId, projectId, title: "销售分析对话", createdAt: now, updatedAt: now }] } });
      if (path === `/api/v1/projects/${projectId}/metric-definition` && request.method() === "GET") return route.fulfill({ json: { definition: metric } });
      if (path === `/api/v1/projects/${projectId}/analysis-brief` && request.method() === "GET") return route.fulfill({ json: { brief } });
      if (path === `/api/v1/projects/${projectId}/memories` && request.method() === "GET") return route.fulfill({ json: { memory: { project: [], workspace: [], conflicts: [] } } });
      if (path === `/api/v1/projects/${projectId}/evidence-blocks` && request.method() === "GET") return route.fulfill({ json: { evidence: asset && brief && metric ? [evidence()] : [] } });
      if (path === `/api/v1/projects/${projectId}/theme` && request.method() === "GET") return route.fulfill({ json: { theme: { preset: "economist" } } });
      if (path === "/api/v1/workspaces/workspace-sales/model-credential" && request.method() === "GET") return route.fulfill({ json: { credential: { workspaceId: "workspace-sales", provider: "bailian", configured: false, keySuffix: null, updatedAt: null } } });
      if (path === `/api/v1/conversations/${conversationId}/messages` && request.method() === "GET") return route.fulfill({ json: { messages: [] } });
      if (path === `/api/v1/projects/${projectId}/data-assets/paste` && request.method() === "POST") {
        asset = { id: assetId, projectId, sourceConversationId: conversationId, name: "sales-sample.csv", sourceType: "paste", sizeBytes: 42, status: "ready", errorMessage: null, createdAt: now, latestSnapshot: { id: "snapshot-sales-v1", version: 1, rowCount: rows.length, columnCount: 3, schema: [{ name: "月份", inferredType: "date", nullCount: 0, distinctCount: 3, sampleValues: ["2026-01"] }, { name: "区域", inferredType: "string", nullCount: 0, distinctCount: 1, sampleValues: ["华东"] }, { name: "销售额", inferredType: "number", nullCount: 0, distinctCount: 3, sampleValues: [120000] }], preview: rows } };
        return route.fulfill({ status: 201, json: { asset } });
      }
      if (path === `/api/v1/projects/${projectId}/metric-definitions` && request.method() === "POST") {
        metric = { id: "metric-sales", projectId, sourceConversationId: conversationId, name: "销售额", meaning: "客户订单的销售金额总和。", formula: "sum(销售额)", unit: "人民币", timeRule: "按自然月聚合", filterRule: null, status: "confirmed", version: 1, confirmedBy: "e2e-user", confirmedAt: now };
        return route.fulfill({ status: 201, json: { definition: metric } });
      }
      if (path === `/api/v1/conversations/${conversationId}/messages` && request.method() === "POST") {
        const body = JSON.parse(request.postData() ?? "{}");
        if (body.generate) return route.fulfill({ status: 202, json: { message: { id: "message-user", conversationId, role: "user", content: body.content, createdAt: now }, job: { id: jobId, conversationId, status: "queued", operation: "generate", prompt: body.content, snapshotId: "snapshot-sales-v1", repairCount: 0, errorCode: null, errorMessage: null, clarificationQuestions: null, intent: null, transformPlan: null, fieldLineage: null, flintSpec: null, validation: null, previewData: null, revision: null }, nextAction: { type: "poll_generation_job", jobId, message: "Generation Cycle 已排队。" } } });
        return route.fulfill({ json: { messages: [{ id: "message-metric", conversationId, role: "assistant", content: body.assistantContent ?? "已确认。", createdAt: now }] } });
      }
      if (path === `/api/v1/projects/${projectId}/analysis-brief` && request.method() === "POST") {
        const body = JSON.parse(request.postData() ?? "{}");
        brief = { id: "brief-sales", conversationId, businessQuestion: body.businessQuestion, audience: body.audience, timeRange: body.timeRange, timeGrain: body.timeGrain, outputFormat: body.outputFormat, status: "confirmed" };
        return route.fulfill({ status: 201, json: { brief } });
      }
      if (path === `/api/v1/generation-jobs/${jobId}` && request.method() === "GET") {
        const nextRevision = revision();
        return route.fulfill({ json: { job: { id: jobId, conversationId, status: "succeeded", operation: "generate", prompt: "按月份展示各区域销售额", snapshotId: "snapshot-sales-v1", repairCount: 0, errorCode: null, errorMessage: null, clarificationQuestions: null, intent: null, transformPlan: nextRevision.transformPlan, fieldLineage: nextRevision.fieldLineage, flintSpec: nextRevision.flintSpec, validation: nextRevision.validation, previewData: { columns: ["月份", "区域", "销售额"], rows, steps: [] }, revision: { id: revisionId, artifactId: "artifact-sales", revision: 1, status: revisionStatus } }, revision: nextRevision } });
      }
      if (path === `/api/v1/chart-revisions/${revisionId}/submit` && request.method() === "POST") { revisionStatus = "in_review"; return route.fulfill({ json: { revision: revision() } }); }
      if (path === `/api/v1/chart-revisions/${revisionId}/approve` && request.method() === "POST") { revisionStatus = "approved"; return route.fulfill({ json: { revision: revision() } }); }
      if (path === `/api/v1/chart-revisions/${revisionId}/plugin-context` && request.method() === "GET") return route.fulfill({ json: { pluginSnapshot: {} } });
      if (path === `/api/v1/chart-revisions/${revisionId}/outputs/svg` && request.method() === "GET") return route.fulfill({ headers: { "content-type": "image/svg+xml", "content-disposition": 'attachment; filename="langreport-revision-sales-r1.svg"' }, body: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>" });
      return route.fulfill({ status: 404, json: { error: `unhandled ${request.method()} ${path}` } });
    }
  };
}

test.describe.configure({ mode: "serial" });

test("销售 CSV 到固定 Revision 导出的核心链路", async ({ page }) => {
  const fixture = createFixture();
  await page.route("**/api/**", fixture.route);
  await page.goto("/");
  await expect(page.getByText("E2E Workspace", { exact: true })).toHaveCount(0);

  const sampleButton = page.getByRole("button", { name: "使用示例" });
  if (page.viewportSize()?.width === 390) {
    await page.evaluate(async () => {
      await fetch("/api/v1/projects/project-sales/data-assets/paste", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "sales-sample.csv", conversationId: "conversation-sales", content: "月份,区域,销售额\n2026-01,华东,120000\n2026-02,华东,138000" }) });
    });
    await page.reload();
  } else {
    await expect(sampleButton).toHaveCount(1);
    await expect(sampleButton).toBeEnabled();
    await sampleButton.click({ force: true });
  }
  await expect(page.getByText("sales-sample.csv", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "确认指标" }).click();
  await page.getByRole("button", { name: "确认并保存" }).click();
  await expect(page.getByText("指标已确认")).toBeVisible();

  await page.getByRole("button", { name: "填写简报" }).click();
  await page.getByLabel("业务问题").fill("按月份展示各区域销售额");
  await page.getByLabel("受众").fill("客户管理层");
  await page.getByLabel("时间范围").fill("2026-01 至 2026-06");
  await page.getByLabel("时间粒度").fill("月");
  await page.getByLabel("交付形式").fill("证据模块");
  await page.getByRole("button", { name: "确认简报" }).click();
  await expect(page.getByText("Analysis Brief 已确认", { exact: true })).toBeVisible();

  await page.getByLabel("继续对话").fill("按月份展示各区域销售额");
  await page.getByRole("button", { name: "发送" }).click();
  const evidenceCanvas = page.getByLabel("证据画布");
  await expect(evidenceCanvas.getByRole("heading", { name: "各区域月度销售额" })).toBeVisible({ timeout: 10000 });
  await expect(evidenceCanvas.getByText("草稿", { exact: true })).toBeVisible();

  await evidenceCanvas.getByRole("button", { name: "提交审核" }).click();
  await expect(evidenceCanvas.getByText("审核中", { exact: true })).toBeVisible();
  await evidenceCanvas.getByRole("button", { name: "批准版本" }).click();
  await expect(evidenceCanvas.getByText("已批准", { exact: true })).toBeVisible();

  await expect(page.getByRole("link", { name: "导出 SVG" })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "导出 SVG" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("langreport-revision-r1.svg");
});
