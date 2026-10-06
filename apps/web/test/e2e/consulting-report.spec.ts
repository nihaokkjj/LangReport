import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { captureUiEvidence } from "./visual-evidence";

const projectId = "project-sales";
const conversationId = "conversation-sales";
const assetId = "asset-sales";
const jobId = "job-sales";
const revisionId = "revision-sales-r1";

const now = "2026-09-15T00:00:00.000Z";
const rows = [
  { 月份: "2026-01", 区域: "华东", 销售额: 120000 },
  { 月份: "2026-02", 区域: "华东", 销售额: 138000 },
  { 月份: "2026-03", 区域: "华东", 销售额: 145000 },
];

function createFixture(
  options: {
    intakeResult?: "succeeded" | "needs_clarification";
    chartRows?: typeof rows;
    generationFailure?: { code: string; message: string };
    generationJobId?: string;
    initialMessages?: Array<{
      id: string;
      conversationId: string;
      role: "user" | "assistant" | "system";
      content: string;
      createdAt: string;
    }>;
  } = {},
) {
  const submittedJobId = options.generationJobId ?? jobId;
  const initialMessages = options.initialMessages ?? [];
  let intakePolls = 0;
  let asset: Record<string, unknown> | null = null;
  let snapshots: Record<string, unknown>[] = [];
  let metric: Record<string, unknown> | null = null;
  let brief: Record<string, unknown> | null = null;
  let editRequest: Record<string, unknown> | null = null;
  let reviewComments: Array<Record<string, unknown>> = [];
  let revisionStatus: "draft" | "in_review" | "approved" = "draft";
  const schema = [
    { name: "月份", inferredType: "date", nullCount: 0, distinctCount: 3, sampleValues: ["2026-01"] },
    { name: "区域", inferredType: "string", nullCount: 0, distinctCount: 1, sampleValues: ["华东"] },
    { name: "销售额", inferredType: "number", nullCount: 0, distinctCount: 3, sampleValues: [120000] },
  ];
  const createSnapshot = (version: number, sourceName: string, sourceType: "csv" | "pasted") => ({
    id: `snapshot-sales-v${version}`,
    assetId,
    version,
    rowCount: rows.length,
    columnCount: 3,
    sourceName,
    sourceType,
    mimeType: "text/csv",
    sizeBytes: 42,
    createdAt: now,
    schema,
    preview: rows,
  });
  const revision = () => ({
    id: revisionId,
    artifactId: "artifact-sales",
    revision: 1,
    status: revisionStatus,
    parentRevisionId: null,
    snapshotId: "snapshot-sales-v1",
    createdAt: now,
    changeReason: null,
    vegaLiteSpec: {
      data: { values: options.chartRows ?? rows },
      mark: { type: "line", color: "#FF4F00", tooltip: true },
      encoding: {
        x: { field: "月份", type: "ordinal" },
        y: { field: "销售额", type: "quantitative", scale: { zero: true } },
        color: { field: "区域", type: "nominal", scale: { range: ["#FF4F00", "#939084", "#18794E"] } },
      },
      width: 900,
      height: 360,
      title: "各区域月度销售额",
      background: "#fffefb",
    },
    flintSpec: {
      version: "v1",
      data: { values: options.chartRows ?? rows },
      semanticTypes: { 月份: "temporal", 区域: "nominal", 销售额: "measure" },
      chartSpec: {
        chartType: "Line Chart",
        title: "各区域月度销售额",
        encodings: {
          x: { field: "月份", type: "temporal" },
          y: { field: "销售额", type: "quantitative" },
          color: { field: "区域", type: "nominal" },
        },
        baseSize: { width: 900, height: 360 },
      },
      theme: "economist",
      themeVersion: "v1",
    },
    validation: { valid: true, issues: [], checks: { structure: true, semantics: true, fields: true, visual: true } },
    transformPlan: {
      rationale: "按月份和区域聚合销售额",
      steps: [{ kind: "group", groupBy: ["月份", "区域"], measures: [{ column: "销售额", operation: "sum" }] }],
    },
    fieldLineage: [{ outputColumn: "销售额", sourceColumns: ["销售额"], operation: "sum" }],
    analysisBriefSnapshot: brief,
    metricDefinitionSnapshot: metric,
    pluginSnapshot: null,
  });
  const evidence = () => ({
    block: {
      id: "block-sales",
      projectId,
      conversationId,
      generationJobId: jobId,
      chartArtifactId: "artifact-sales",
      chartRevisionId: revisionId,
      snapshotId: "snapshot-sales-v1",
      title: "各区域月度销售额",
      finding: "华东销售额连续增长。",
      analysisBriefSnapshot: brief,
      metricDefinitionSnapshot: metric,
      qualityWarnings: [],
      status: revisionStatus,
      updatedAt: now,
    },
    artifact: {
      id: "artifact-sales",
      projectId,
      name: "各区域月度销售额",
      headRevisionId: revisionId,
      status: "active",
    },
    revision: revision(),
    job: {
      id: jobId,
      conversationId,
      status: "succeeded",
      operation: "generate",
      prompt: "按月份展示各区域销售额",
      snapshotId: "snapshot-sales-v1",
      repairCount: 0,
      errorCode: null,
      errorMessage: null,
      clarificationProposal: null,
      intent: null,
      transformPlan: revision().transformPlan,
      fieldLineage: revision().fieldLineage,
      flintSpec: revision().flintSpec,
      validation: revision().validation,
      previewData: { columns: ["月份", "区域", "销售额"], rows, steps: [] },
      revision: { id: revisionId, artifactId: "artifact-sales", revision: 1, status: revisionStatus },
    },
  });
  return {
    route: async (route: import("@playwright/test").Route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
        throw new Error(`unexpected external request: ${request.url()}`);
      if (path === "/api/v1/auth/session" && request.method() === "GET")
        return route.fulfill({
          json: { authenticated: true, userId: "e2e-user", username: "analyst", expiresAt: "2026-09-29T00:00:00.000Z" },
        });
      if (path === "/api/v1/dev/bootstrap" && request.method() === "POST")
        return route.fulfill({
          json: {
            workspace: { id: "workspace-sales", name: "E2E Workspace", role: "owner" },
            project: {
              id: projectId,
              name: "销售分析 Demo",
              clientName: "海岚消费",
              objective: "验证区域销售增长机会。",
              audience: "client_presentation",
              visualTemplate: "consulting-neutral",
            },
          },
        });
      if (path === "/api/v1/projects" && request.method() === "GET")
        return route.fulfill({
          json: {
            workspace: { id: "workspace-sales", name: "E2E Workspace", role: "owner" },
            projects: [
              {
                id: projectId,
                name: "销售分析 Demo",
                clientName: "海岚消费",
                objective: "验证区域销售增长机会。",
                audience: "client_presentation",
                visualTemplate: "consulting-neutral",
              },
            ],
          },
        });
      if (path === `/api/v1/projects/${projectId}/data-assets` && request.method() === "GET")
        return route.fulfill({ json: { assets: asset ? [asset] : [] } });
      if (path === `/api/v1/data-assets/${assetId}/snapshots` && request.method() === "GET") {
        return route.fulfill({
          json: {
            snapshots: snapshots.map((snapshot) =>
              Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== "schema" && key !== "preview")),
            ),
          },
        });
      }
      const snapshotDetailMatch = path.match(new RegExp(`^/api/v1/data-assets/${assetId}/snapshots/([^/]+)$`));
      if (snapshotDetailMatch && request.method() === "GET") {
        const snapshot = snapshots.find((candidate) => candidate.id === snapshotDetailMatch[1]);
        if (!snapshot)
          return route.fulfill({ status: 404, json: { code: "SNAPSHOT_NOT_FOUND", message: "Snapshot 不存在" } });
        return route.fulfill({ json: { snapshot } });
      }
      if (path === `/api/v1/projects/${projectId}/conversations` && request.method() === "GET")
        return route.fulfill({
          json: {
            conversations: [{ id: conversationId, projectId, title: "销售分析对话", createdAt: now, updatedAt: now }],
          },
        });
      if (path === `/api/v1/projects/${projectId}/metric-definition` && request.method() === "GET")
        return route.fulfill({ json: { definition: metric } });
      if (path === `/api/v1/projects/${projectId}/analysis-brief` && request.method() === "GET")
        return route.fulfill({ json: { brief } });
      if (path === `/api/v1/projects/${projectId}/memories` && request.method() === "GET")
        return route.fulfill({ json: { memory: { project: [], workspace: [], conflicts: [] } } });
      if (path === `/api/v1/projects/${projectId}/evidence-blocks` && request.method() === "GET")
        return route.fulfill({
          json: { evidence: asset && brief && metric && !options.generationFailure ? [evidence()] : [] },
        });
      if (path === `/api/v1/projects/${projectId}/theme` && request.method() === "GET")
        return route.fulfill({ json: { theme: { preset: "economist" } } });
      if (path === "/api/v1/workspaces/workspace-sales/model-credential" && request.method() === "GET")
        return route.fulfill({
          json: {
            credential: {
              workspaceId: "workspace-sales",
              provider: "bailian",
              configured: false,
              keySuffix: null,
              updatedAt: null,
            },
          },
        });
      if (path === `/api/v1/conversations/${conversationId}/messages` && request.method() === "GET")
        return route.fulfill({ json: { messages: initialMessages } });
      if (path === `/api/v1/projects/${projectId}/data-assets/paste` && request.method() === "POST") {
        const snapshot = createSnapshot(1, "sales-sample.csv", "pasted");
        snapshots = [snapshot];
        asset = {
          id: assetId,
          projectId,
          sourceConversationId: conversationId,
          name: "sales-sample.csv",
          sourceType: "pasted",
          sizeBytes: 42,
          status: "ready",
          errorMessage: null,
          createdAt: now,
          latestSnapshot: snapshot,
        };
        return route.fulfill({ status: 201, json: { asset } });
      }
      if (path === `/api/v1/projects/${projectId}/data-intake-jobs/intake-test`) {
        const status = ++intakePolls === 1 ? "running" : (options.intakeResult ?? "succeeded");
        return route.fulfill({
          json: {
            job: {
              id: "intake-test",
              assetId,
              status,
              snapshotId: status === "succeeded" ? "snapshot-sales-v1" : null,
              errorCode: status === "needs_clarification" ? "LARK_NEEDS_CLARIFICATION" : null,
              errorMessage: status === "needs_clarification" ? "请指定工作表和真实表头行" : null,
            },
          },
        });
      }
      if (path === `/api/v1/projects/${projectId}/data-assets/upload` && request.method() === "POST") {
        const snapshot = createSnapshot(1, "sales-v1.csv", "csv");
        snapshots = [snapshot];
        asset = {
          id: assetId,
          projectId,
          sourceConversationId: conversationId,
          name: "sales-v1.csv",
          sourceType: "csv",
          sizeBytes: 42,
          status: "ready",
          errorMessage: null,
          createdAt: now,
          latestSnapshot: snapshot,
        };
        if (options.intakeResult)
          return route.fulfill({
            status: 202,
            json: { asset: { ...asset, status: "processing", latestSnapshot: null }, intakeJobId: "intake-test" },
          });
        return route.fulfill({ status: 201, json: { asset } });
      }
      if (
        path === `/api/v1/projects/${projectId}/data-assets/${assetId}/snapshots/upload` &&
        request.method() === "POST"
      ) {
        const snapshot = createSnapshot(2, "sales-v2.csv", "csv");
        snapshots = [...snapshots.filter((candidate) => candidate.version !== 2), snapshot];
        asset = { ...(asset ?? {}), name: "sales-v2.csv", sourceType: "csv", sizeBytes: 42, latestSnapshot: snapshot };
        return route.fulfill({ status: 201, json: { asset } });
      }
      if (path === `/api/v1/projects/${projectId}/metric-definitions` && request.method() === "POST") {
        metric = {
          id: "metric-sales",
          projectId,
          sourceConversationId: conversationId,
          name: "销售额",
          meaning: "客户订单的销售金额总和。",
          formula: "sum(销售额)",
          unit: "人民币",
          timeRule: "按自然月聚合",
          filterRule: null,
          status: "confirmed",
          version: 1,
          confirmedBy: "e2e-user",
          confirmedAt: now,
        };
        return route.fulfill({ status: 201, json: { definition: metric } });
      }
      if (path === `/api/v1/conversations/${conversationId}/messages` && request.method() === "POST") {
        const body = JSON.parse(request.postData() ?? "{}");
        if (body.generate)
          return route.fulfill({
            status: 202,
            json: {
              message: { id: "message-user", conversationId, role: "user", content: body.content, createdAt: now },
              job: {
                id: submittedJobId,
                conversationId,
                status: "queued",
                operation: "generate",
                prompt: body.content,
                snapshotId: "snapshot-sales-v1",
                repairCount: 0,
                errorCode: null,
                errorMessage: null,
                clarificationProposal: null,
                intent: null,
                transformPlan: null,
                fieldLineage: null,
                flintSpec: null,
                validation: null,
                previewData: null,
                revision: null,
              },
              nextAction: { type: "poll_generation_job", jobId: submittedJobId, message: "Generation Cycle 已排队。" },
            },
          });
        return route.fulfill({
          json: {
            messages: [
              {
                id: "message-metric",
                conversationId,
                role: "assistant",
                content: body.assistantContent ?? "已确认。",
                createdAt: now,
              },
            ],
          },
        });
      }
      if (path === `/api/v1/projects/${projectId}/analysis-brief` && request.method() === "POST") {
        const body = JSON.parse(request.postData() ?? "{}");
        brief = {
          id: "brief-sales",
          conversationId,
          businessQuestion: body.businessQuestion,
          audience: body.audience,
          timeRange: body.timeRange,
          timeGrain: body.timeGrain,
          outputFormat: body.outputFormat,
          status: "confirmed",
        };
        return route.fulfill({ status: 201, json: { brief } });
      }
      if (path === `/api/v1/generation-jobs/${jobId}` && request.method() === "GET") {
        const nextRevision = revision();
        return route.fulfill({
          json: {
            job: {
              id: jobId,
              conversationId,
              status: options.generationFailure ? "failed" : "succeeded",
              operation: "generate",
              prompt: "按月份展示各区域销售额",
              snapshotId: "snapshot-sales-v1",
              repairCount: 0,
              errorCode: options.generationFailure?.code ?? null,
              errorMessage: options.generationFailure?.message ?? null,
              clarificationProposal: null,
              intent: null,
              transformPlan: nextRevision.transformPlan,
              fieldLineage: nextRevision.fieldLineage,
              flintSpec: nextRevision.flintSpec,
              validation: nextRevision.validation,
              previewData: { columns: ["月份", "区域", "销售额"], rows, steps: [] },
              revision: options.generationFailure
                ? null
                : { id: revisionId, artifactId: "artifact-sales", revision: 1, status: revisionStatus },
            },
            revision: options.generationFailure ? null : nextRevision,
          },
        });
      }
      if (path === "/api/v1/chart-artifacts/artifact-sales/revisions" && request.method() === "POST") {
        const parsedRequest = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
        editRequest = parsedRequest;
        const patch = parsedRequest.patch as Record<string, unknown>;
        return route.fulfill({
          status: 202,
          json: {
            job: {
              id: "job-sales-edit",
              conversationId,
              status: "succeeded",
              operation: "edit",
              prompt: "编辑图表版本 R1",
              snapshotId: "snapshot-sales-v1",
              repairCount: 0,
              errorCode: null,
              errorMessage: null,
              clarificationProposal: null,
              intent: null,
              transformPlan: patch.transformPlan,
              fieldLineage: null,
              flintSpec: null,
              validation: null,
              previewData: null,
              revision: null,
            },
            reused: false,
          },
        });
      }
      if (path === `/api/v1/chart-revisions/${revisionId}/submit` && request.method() === "POST") {
        revisionStatus = "in_review";
        return route.fulfill({ json: { revision: revision() } });
      }
      if (path === `/api/v1/chart-revisions/${revisionId}/approve` && request.method() === "POST") {
        revisionStatus = "approved";
        return route.fulfill({ json: { revision: revision() } });
      }
      if (path === `/api/v1/chart-revisions/${revisionId}/comments` && request.method() === "GET")
        return route.fulfill({ json: { comments: reviewComments } });
      if (path === `/api/v1/chart-revisions/${revisionId}/comments` && request.method() === "POST") {
        const body = JSON.parse(request.postData() ?? "{}") as { body?: string };
        const created = {
          id: `comment-${reviewComments.length + 1}`,
          revisionId,
          authorId: "e2e-user",
          body: body.body ?? "",
          anchor: null,
          resolvedAt: null,
          createdAt: now,
        };
        reviewComments = [...reviewComments, created];
        return route.fulfill({ status: 201, json: { comment: created } });
      }
      if (path === `/api/v1/chart-revisions/${revisionId}/plugin-context` && request.method() === "GET")
        return route.fulfill({ json: { pluginSnapshot: {} } });
      if (path === `/api/v1/chart-revisions/${revisionId}/outputs/svg` && request.method() === "GET")
        return route.fulfill({
          headers: {
            "content-type": "image/svg+xml",
            "content-disposition": 'attachment; filename="langreport-revision-sales-r1.svg"',
          },
          body: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        });
      return route.fulfill({ status: 404, json: { error: `unhandled ${request.method()} ${path}` } });
    },
    getEditRequest: () => editRequest,
  };
}

test.describe.configure({ mode: "serial" });

test("飞书异步接入等待成功才显示快照，澄清问题可见", async ({ page }) => {
  for (const intakeResult of ["succeeded", "needs_clarification"] as const) {
    const fixture = createFixture({ intakeResult });
    await page.unroute("**/api/**");
    await page.route("**/api/**", fixture.route);
    await page.goto("/");
    const tableHint = page.getByRole("textbox", { name: "表格说明（可选）" });
    await expect(tableHint).toBeEnabled();
    if (await page.locator(".app-shell.left-collapsed").count())
      await page.getByRole("button", { name: /打开对话历史|显示对话历史/ }).click();
    await expect(tableHint).toBeVisible();
    await expect(tableHint).toBeInViewport();
    await tableHint.fill("使用销售明细，第 3 行是列名");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`table-hint-${intakeResult}.png`), animations: "disabled" });
    const chooser = page.waitForEvent("filechooser");
    await page.locator(".rail-source").getByText("导入文件", { exact: true }).click();
    const uploadRequest = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().endsWith("/data-assets/upload"),
    );
    await (
      await chooser
    ).setFiles({
      name: "sales.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from("mock-workbook"),
    });
    expect((await uploadRequest).postDataBuffer()?.toString("utf8")).toContain("使用销售明细，第 3 行是列名");
    const closeDrawer = page.locator(".history-drawer-close");
    if (await closeDrawer.isVisible()) await closeDrawer.click();
    await expect(page.getByRole("status").filter({ hasText: "正在通过飞书识别" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "创建为数据快照" })).toHaveCount(0);
    if (intakeResult === "succeeded")
      await expect(page.getByRole("status").filter({ hasText: "创建为数据快照 v1" })).toBeVisible();
    else await expect(page.getByText("请指定工作表和真实表头行", { exact: false })).toBeVisible();
  }
});

test("导入文件与更新当前数据保持显式分流", async ({ page }) => {
  const fixture = createFixture();
  await page.route("**/api/**", fixture.route);
  await page.goto("/");

  await expect(page.locator(".rail-source input[type=file]")).toBeEnabled();
  await page
    .locator(".rail-source input[type=file]")
    .setInputFiles({ name: "sales-v1.csv", mimeType: "text/csv", buffer: Buffer.from("month,amount\nJan,10") });
  await expect(page.getByRole("status").filter({ hasText: "创建为数据快照 v1" })).toBeVisible();
  await page
    .getByRole("button", { name: /打开项目依据|显示依据面板/ })
    .first()
    .click();
  await expect(page.locator(".context-summary-copy")).toContainText("sales-v1.csv · v1");
  await page.getByRole("button", { name: /关闭依据面板|隐藏依据面板/ }).click();
  const updateButton = page.locator(".canvas-header-actions").getByRole("button", { name: "更新当前数据" });
  await expect(updateButton).toBeVisible();
  await updateButton.click();

  await page
    .locator('input[aria-label="选择数据文件"]')
    .setInputFiles({ name: "sales-v2.csv", mimeType: "text/csv", buffer: Buffer.from("month,amount\nJan,11") });
  await expect(page.getByRole("status").filter({ hasText: "更新为数据快照 v2" })).toBeVisible();
  await page
    .getByRole("button", { name: /打开项目依据|显示依据面板/ })
    .first()
    .click();
  await expect(page.locator(".context-summary-copy")).toContainText("sales-v2.csv · v2");
});

test("数据预览默认打开最新版本并可切换历史 Snapshot", async ({ page }) => {
  const fixture = createFixture();
  await page.route("**/api/**", fixture.route);
  await page.goto("/");

  const sourceInput = page.locator(".rail-source input[type=file]");
  await expect(sourceInput).toBeEnabled();
  await sourceInput.setInputFiles({
    name: "sales-v1.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("month,amount\nJan,10"),
  });
  await expect(page.getByRole("status").filter({ hasText: "创建为数据快照 v1" })).toBeVisible();
  await page.locator(".canvas-header-actions").getByRole("button", { name: "更新当前数据" }).click();
  await page
    .locator('input[aria-label="选择数据文件"]')
    .setInputFiles({ name: "sales-v2.csv", mimeType: "text/csv", buffer: Buffer.from("month,amount\nJan,11") });
  await expect(page.getByRole("status").filter({ hasText: "更新为数据快照 v2" })).toBeVisible();

  const openContextButton = page.getByRole("button", { name: /打开项目依据|显示依据面板/ }).first();
  await expect(openContextButton).toBeVisible();
  await openContextButton.click();
  await expect(page.locator(".app-shell.right-open .context-drawer-view")).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) > 760) {
    const resizeHandle = page.getByRole("separator", { name: "调整右侧抽屉宽度" });
    await resizeHandle.focus();
    await resizeHandle.press("ArrowLeft");
    await expect(resizeHandle).toHaveAttribute("aria-valuenow", "376");
    await resizeHandle.press("ArrowRight");
    await expect(resizeHandle).toHaveAttribute("aria-valuenow", "360");
  }
  const contextHeaderHeight = await page
    .locator(".context-header")
    .evaluate((element) => element.getBoundingClientRect().height);
  const snapshotDetails = page.locator(".context-drawer-view details").first();
  await snapshotDetails.locator("summary").click();
  await snapshotDetails.locator(".snapshot-preview-trigger").click();
  const dialog = page.getByRole("region", { name: "查看数据" });
  await expect(dialog).toBeVisible();
  const snapshotHeaderHeight = await dialog
    .locator(".snapshot-preview-head")
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(snapshotHeaderHeight).toBeCloseTo(contextHeaderHeight, 0);
  await expect(dialog.locator(".snapshot-version-item")).toHaveCount(2);
  await expect(dialog.locator(".snapshot-version-item").first()).toHaveClass(/selected/);
  await expect(dialog.getByText("sales-v2.csv", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("table")).toBeVisible();
  await expect(dialog.getByText("前 3 行 / 共 3 行 · 只读预览", { exact: true })).toBeVisible();
  await expect(dialog.getByText("只读", { exact: true })).toBeVisible();

  await dialog.locator(".snapshot-version-item").filter({ hasText: "v1" }).click();
  await expect(dialog.locator(".snapshot-version-item").filter({ hasText: "v1" })).toHaveClass(/selected/);
  await expect(dialog.getByText("sales-v1.csv", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "关闭数据预览" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".app-shell.right-open .context-drawer-view")).toBeVisible();
});

test("销售 CSV 到固定 Revision 导出的核心链路", async ({ page }) => {
  const fixture = createFixture({ chartRows: [...rows, { 月份: "2026-04", 区域: "华东", 销售额: 999999 }] });
  await page.route("**/api/**", fixture.route);
  await page.goto("/");
  const topbar = page.locator(".topbar");
  const projectButton = page.locator(".project-selector .selector-button");
  await expect(projectButton).toHaveCSS("height", "48px");
  if ((page.viewportSize()?.width ?? 0) > 760) {
    const initialTopbarHeight = await topbar.evaluate((element) => element.getBoundingClientRect().height);
    expect(initialTopbarHeight).toBe(70);
    await projectButton.click();
    const projectMenu = page.getByRole("menu");
    await expect(projectMenu).toBeVisible();
    const menuBounds = await projectMenu.boundingBox();
    const buttonBounds = await projectButton.boundingBox();
    expect(await topbar.evaluate((element) => element.getBoundingClientRect().height)).toBe(70);
    expect(menuBounds?.y).toBeGreaterThanOrEqual(buttonBounds!.y + buttonBounds!.height - 1);
    await projectMenu.getByRole("menuitem").filter({ hasText: "当前项目" }).click();
  }
  await expect(page.getByText("E2E Workspace", { exact: true })).toHaveCount(0);
  const composerWrap = page.locator(".composer-wrap");
  await expect(composerWrap).toHaveCSS("position", "fixed");
  await expect(composerWrap).toHaveCSS("bottom", "0px");
  const composerDistanceFromViewportBottom = await composerWrap.evaluate(
    (element) => window.innerHeight - element.getBoundingClientRect().bottom,
  );
  expect(Math.abs(composerDistanceFromViewportBottom)).toBeLessThanOrEqual(1);

  const sampleButton = page.getByRole("button", { name: "使用示例" });
  if ((page.viewportSize()?.width ?? 0) <= 760) {
    await page.evaluate(async () => {
      await fetch("/api/v1/projects/project-sales/data-assets/paste", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "sales-sample.csv",
          conversationId: "conversation-sales",
          content: "月份,区域,销售额\n2026-01,华东,120000\n2026-02,华东,138000",
        }),
      });
    });
    await page.reload();
  } else {
    const openHistoryButton = page.getByRole("button", { name: /打开对话历史|显示对话历史/ }).first();
    await expect(openHistoryButton).toBeVisible();
    const mainWidthBeforeHistory = await page
      .locator(".workspace-main")
      .evaluate((element) => element.getBoundingClientRect().width);
    await openHistoryButton.click();
    await expect(page.locator(".app-shell.left-open .history-rail")).toBeVisible();
    await expect
      .poll(() => page.locator(".workspace-main").evaluate((element) => element.getBoundingClientRect().width), {
        timeout: 1_000,
      })
      .toBeLessThan(mainWidthBeforeHistory - 1);
    await expect(sampleButton).toHaveCount(1);
    await expect(sampleButton).toBeEnabled();
    await sampleButton.click();
    if ((page.viewportSize()?.width ?? 0) <= 1024) {
      await page.locator(".history-drawer-close").click();
      await expect
        .poll(() => page.locator(".history-rail").evaluate((element) => element.getBoundingClientRect().width), {
          timeout: 1_000,
        })
        .toBeLessThan(1);
    }
  }
  const mainWidthBeforeContext = await page
    .locator(".workspace-main")
    .evaluate((element) => element.getBoundingClientRect().width);
  await page
    .getByRole("button", { name: /打开项目依据|显示依据面板/ })
    .first()
    .click();
  await expect(page.locator(".context-summary-copy")).toContainText("sales-sample.csv");
  if ((page.viewportSize()?.width ?? 0) > 760) {
    await expect
      .poll(() => page.locator(".workspace-main").evaluate((element) => element.getBoundingClientRect().width), {
        timeout: 1_000,
      })
      .toBeLessThan(mainWidthBeforeContext - 1);
  }
  const snapshotDetails = page.locator(".context-drawer-view details").first();
  expect(await snapshotDetails.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(false);
  await page.getByRole("button", { name: /关闭依据面板|隐藏依据面板/ }).click();

  await page.getByRole("button", { name: "确认指标" }).click();
  await page.getByRole("button", { name: "确认并保存" }).click();
  await expect(page.getByText("指标已确认")).toBeVisible();

  await page.getByRole("button", { name: "填写简报", exact: true }).click();
  await page.getByLabel("业务问题").fill("按月份展示各区域销售额");
  await page.getByLabel("受众").fill("客户管理层");
  await page.getByLabel("时间范围").fill("2026-01 至 2026-06");
  await page.getByLabel("时间粒度").fill("月");
  await page.getByLabel("交付形式").fill("证据模块");
  await page.getByRole("button", { name: "确认简报" }).click();
  await expect(page.getByText("Analysis Brief 已确认", { exact: true })).toBeVisible();

  await page.getByLabel("继续对话").fill("按月份展示各区域销售额");
  await page.getByRole("button", { name: /^生成证据/ }).click();
  const evidenceCanvas = page.getByLabel("证据画布");
  await expect(evidenceCanvas.getByRole("heading", { name: "各区域月度销售额" })).toBeVisible({ timeout: 10000 });
  await expect(evidenceCanvas.locator(".vega-host[data-rendered-points='4'] svg .role-mark")).toBeVisible();
  await evidenceCanvas.locator(".chart-visual").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(evidenceCanvas.locator(".chart-readout")).toContainText("999999");
  await captureUiEvidence(page, "workbench");
  await expect(evidenceCanvas.getByText("草稿", { exact: true })).toBeVisible();
  const chartAlignment = await evidenceCanvas.locator(".chart-stage").evaluate((stage) => {
    const visual = stage.querySelector<HTMLElement>(".chart-visual");
    if (!visual) throw new Error("图表视觉区域未渲染");
    const stageRect = stage.getBoundingClientRect();
    const visualRect = visual.getBoundingClientRect();
    return Math.abs(stageRect.left + stageRect.width / 2 - (visualRect.left + visualRect.width / 2));
  });
  expect(chartAlignment).toBeLessThanOrEqual(1);
  await expect(page.locator(".plugin-trace-banner")).toHaveCount(0);

  if ((page.viewportSize()?.width ?? 0) <= 760) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight / 2));
  }
  await evidenceCanvas.getByRole("button", { name: "提交审核" }).click();
  await expect(evidenceCanvas.getByText("审核中", { exact: true })).toBeVisible();
  await expect(evidenceCanvas.getByRole("button", { name: "批准版本" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "批准此版本", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "刷新评论", exact: true }).click();
  await expect(page.getByText("暂无评论。审核意见会保留在当前 Revision。", { exact: true })).toBeVisible();
  await page.getByLabel("审核意见").fill("请补充来源。");
  await page.getByRole("button", { name: "添加评论", exact: true }).click();
  await expect(page.getByText("审核评论已添加到当前 Revision。", { exact: true })).toBeVisible();
  await expect(page.locator(".review-comment")).toContainText("请补充来源。");
  await page.getByRole("button", { name: "批准此版本", exact: true }).click();
  await expect(evidenceCanvas.getByText("已批准", { exact: true })).toBeVisible();

  await expect(page.getByRole("link", { name: "导出 SVG" })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "导出 SVG" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("langreport-revision-r1.svg");
});

test("绘图结果超出上限时主界面提示聚合且不提供相同输入重试", async ({ page }) => {
  const fixture = createFixture({
    generationFailure: {
      code: "CHART_POINT_BUDGET_EXCEEDED",
      message:
        "图表绘制结果为 10001 个点，超过 10000 个点的上限。请先按时间或类别聚合，再重新生成图表；系统不会自动截断数据。",
    },
  });
  await page.route("**/api/**", fixture.route);
  await page.goto("/");
  await page.evaluate(async () => {
    await fetch("/api/v1/projects/project-sales/data-assets/paste", { method: "POST" });
    await fetch("/api/v1/projects/project-sales/metric-definitions", { method: "POST" });
    await fetch("/api/v1/projects/project-sales/analysis-brief", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        businessQuestion: "按月份展示销售额",
        audience: "客户",
        timeRange: "全部",
        timeGrain: "月",
        outputFormat: "evidence_block",
      }),
    });
  });
  await page.reload();
  await page.getByLabel("继续对话").fill("按月份展示销售额");
  await page.getByRole("button", { name: /^生成证据/ }).click();
  const failure = page.locator(".failure-stage");
  await expect(failure).toContainText("CHART_POINT_BUDGET_EXCEEDED");
  await expect(failure).toContainText("请先按时间或类别聚合");
  await expect(failure.getByRole("button", { name: "再次尝试" })).toHaveCount(0);
});

test("真实数据库失败链路在界面提示聚合", async ({ page }) => {
  test.skip(!process.env.LANGREPORT_FAILURE_FIXTURE_PATH, "仅在隔离数据库集成验收中运行");
  test.setTimeout(120_000);
  const payload = JSON.parse(await readFile(process.env.LANGREPORT_FAILURE_FIXTURE_PATH!, "utf8")) as {
    job: { id: string; errorCode: string; errorMessage: string; status: string };
    apiBaseUrl: string;
    source: { database: string; worker: string; apiStatus: number };
  };
  expect(payload.source).toEqual({ database: "postgres", worker: "render-worker", apiStatus: 200 });
  expect(new URL(payload.apiBaseUrl).hostname).toBe("127.0.0.1");
  const fixture = createFixture({ generationJobId: payload.job.id });
  const jobPath = `/api/v1/generation-jobs/${payload.job.id}`;
  let statusRequests = 0;
  let detailRequests = 0;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET" || (url.pathname !== jobPath && url.pathname !== `${jobPath}/status`)) {
      return fixture.route(route);
    }
    const response = await route.fetch({ url: new URL(`${url.pathname}${url.search}`, payload.apiBaseUrl).toString() });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { job: { id: string; status: string; errorCode: string } };
    expect(body.job.id).toBe(payload.job.id);
    expect(body.job.status).toBe("failed");
    expect(body.job.errorCode).toBe(payload.job.errorCode);
    if (url.pathname.endsWith("/status")) statusRequests += 1;
    else detailRequests += 1;
    await route.fulfill({ response });
  });
  await page.goto("/");
  await page.evaluate(async () => {
    await fetch("/api/v1/projects/project-sales/data-assets/paste", { method: "POST" });
    await fetch("/api/v1/projects/project-sales/metric-definitions", { method: "POST" });
    await fetch("/api/v1/projects/project-sales/analysis-brief", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        businessQuestion: "逐行绘制",
        audience: "客户",
        timeRange: "全部",
        timeGrain: "月",
        outputFormat: "evidence_block",
      }),
    });
  });
  await page.reload();
  await page.getByLabel("继续对话").fill("逐行绘制");
  await page.getByRole("button", { name: /^生成证据/ }).click();
  const failure = page.locator(".failure-stage");
  await expect(failure).toContainText(payload.job.errorCode);
  await expect(failure).toContainText(payload.job.errorMessage);
  await expect(failure.getByRole("button", { name: "再次尝试" })).toHaveCount(0);
  expect(statusRequests).toBeGreaterThan(0);
  expect(detailRequests).toBeGreaterThan(0);
});

test("浏览器 Canvas 绘制完整 10,000 点且保持键盘与事件响应", async ({ page }) => {
  test.setTimeout(90_000);
  const chartRows = Array.from({ length: 10_000 }, (_, index) => ({
    月份: `M${index}`,
    区域: "华东",
    销售额: index,
  }));
  const fixture = createFixture({ chartRows });
  await page.route("**/api/**", fixture.route);
  await page.goto("/");
  await page.evaluate(async () => {
    await fetch("/api/v1/projects/project-sales/data-assets/paste", { method: "POST" });
    await fetch("/api/v1/projects/project-sales/metric-definitions", { method: "POST" });
    await fetch("/api/v1/projects/project-sales/analysis-brief", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        businessQuestion: "按月份展示销售额",
        audience: "客户",
        timeRange: "全部",
        timeGrain: "月",
        outputFormat: "evidence_block",
      }),
    });
  });
  await page.reload();
  await page.evaluate(() => {
    const samples: number[] = [];
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      samples.push(now - last);
      last = now;
    }, 16);
    (window as typeof window & { chartPulse?: { samples: number[]; timer: number } }).chartPulse = { samples, timer };
  });
  await page.getByLabel("继续对话").fill("按月份展示销售额");
  await page.getByRole("button", { name: /^生成证据/ }).click();
  const evidenceCanvas = page.getByLabel("证据画布");
  const host = evidenceCanvas.locator(".vega-host[data-rendered-points='10000']");
  await expect(host.locator("canvas")).toBeVisible({ timeout: 30_000 });
  const metrics = await page.evaluate(() => {
    const pulse = (window as typeof window & { chartPulse: { samples: number[]; timer: number } }).chartPulse;
    window.clearInterval(pulse.timer);
    const host = document.querySelector<HTMLElement>(".vega-host[data-rendered-points='10000']");
    return {
      renderMs: Number(host?.dataset.renderMs),
      maxGapMs: Math.max(...pulse.samples),
      samples: pulse.samples.length,
    };
  });
  console.log(`10,000-point browser response: ${JSON.stringify(metrics)}`);
  expect(metrics.renderMs).toBeLessThan(3_000);
  expect(metrics.maxGapMs).toBeLessThan(500);
  await evidenceCanvas.locator(".chart-visual").focus();
  await page.keyboard.press("End");
  await expect(evidenceCanvas.locator(".chart-readout")).toContainText("M9999 · 华东 · 9999");
});

test("图表编辑器把逻辑和显示变化提交为可追溯 Patch", async ({ page }) => {
  const fixture = createFixture();
  await page.route("**/api/**", fixture.route);
  await page.goto("/");
  await page.evaluate(async () => {
    await fetch("/api/v1/projects/project-sales/data-assets/paste", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "sales-sample.csv",
        conversationId: "conversation-sales",
        content: "月份,区域,销售额\n2026-01,华东,120000\n2026-02,华东,138000",
      }),
    });
  });
  await page.reload();
  await page
    .getByRole("button", { name: /打开项目依据|显示依据面板/ })
    .first()
    .click();
  await expect(page.locator(".context-summary-copy")).toContainText("sales-sample.csv");
  await page.getByRole("button", { name: /关闭依据面板|隐藏依据面板/ }).click();
  await page.getByRole("button", { name: "确认指标" }).click();
  await page.getByRole("button", { name: "确认并保存" }).click();
  await expect(page.getByText("指标已确认")).toBeVisible();
  await page.getByRole("button", { name: "填写简报", exact: true }).click();
  await page.getByLabel("业务问题").fill("按月份展示各区域销售额");
  await page.getByLabel("受众").fill("客户管理层");
  await page.getByLabel("时间范围").fill("2026-01 至 2026-06");
  await page.getByLabel("时间粒度").fill("月");
  await page.getByLabel("交付形式").fill("证据模块");
  await page.getByRole("button", { name: "确认简报" }).click();
  await page.getByLabel("继续对话").fill("按月份展示各区域销售额");
  await page.getByRole("button", { name: /^生成证据/ }).click();
  const evidenceCanvas = page.getByLabel("证据画布");
  await expect(evidenceCanvas.getByRole("heading", { name: "各区域月度销售额" })).toBeVisible({ timeout: 10000 });
  await evidenceCanvas.getByRole("button", { name: "编辑图表" }).click();
  const editorDialog = page.getByRole("dialog", { name: "编辑图表" });
  await expect(editorDialog).toBeVisible();
  async function selectEditorOption(label: string, option: string) {
    await editorDialog.locator(".field-label").filter({ hasText: label }).getByRole("combobox").click();
    await page.getByRole("option", { name: option, exact: true }).click();
  }
  await selectEditorOption("聚合度量", "平均");
  await selectEditorOption("筛选字段", "区域");
  await selectEditorOption("条件", "等于");
  await editorDialog.getByLabel("筛选值").fill("华东");
  await selectEditorOption("排序字段", "销售额");
  await selectEditorOption("方向", "降序");
  await editorDialog.getByLabel("注释（每行一条）").fill("仅看华东\n重点区域");
  await editorDialog.getByLabel("显示数值标签").check();
  await editorDialog.getByLabel("显示图例").uncheck();
  await editorDialog.getByRole("button", { name: "保存为新版本 ↗" }).click();
  await expect(page.getByRole("status").filter({ hasText: "编辑任务已排队" })).toBeVisible();

  const patchBody = (fixture.getEditRequest()?.patch ?? {}) as {
    transformPlan?: { steps?: Array<{ kind: string; operator?: string; column?: string; direction?: string }> };
    annotations?: Array<{ text: string }>;
    showValues?: boolean;
    showLegend?: boolean;
  };
  expect(patchBody.transformPlan?.steps).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "filter", column: "区域", operator: "eq" }),
      expect.objectContaining({ kind: "aggregate" }),
      expect.objectContaining({ kind: "sort", direction: "desc" }),
    ]),
  );
  expect(patchBody.annotations).toEqual([{ text: "仅看华东" }, { text: "重点区域" }]);
  expect(patchBody.showValues).toBe(true);
  expect(patchBody.showLegend).toBe(false);
});

test("指标保存期间禁止重复提交和关闭弹窗", async ({ page }) => {
  const fixture = createFixture();
  let releaseSave: (() => void) | undefined;
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let saveRequests = 0;
  await page.route("**/api/**", fixture.route);
  await page.route("**/api/v1/projects/project-sales/metric-definitions", async (route) => {
    if (route.request().method() === "POST") {
      saveRequests += 1;
      await saveGate;
    }
    await fixture.route(route);
  });
  await page.goto("/");
  await page.evaluate(async () => {
    await fetch("/api/v1/projects/project-sales/data-assets/paste", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "sales-sample.csv",
        conversationId: "conversation-sales",
        content: "月份,区域,销售额\n2026-01,华东,120000",
      }),
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "确认指标" }).click();
  const dialog = page.getByRole("dialog", { name: "确认指标口径" });
  await dialog.getByRole("button", { name: "确认并保存" }).click();
  await expect.poll(() => saveRequests).toBe(1);
  await expect(dialog.getByRole("button", { name: "保存中" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  expect(saveRequests).toBe(1);
  releaseSave?.();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("指标已确认")).toBeVisible();
  expect(saveRequests).toBe(1);
});

test("准备度不足时提交问题不会触发前端异常", async ({ page }) => {
  const fixture = createFixture();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/**", fixture.route);
  await page.goto("/");

  await page.getByLabel("继续对话").fill("先确认分析范围");
  await page.getByRole("button", { name: /^提交问题/ }).click();

  await expect(page.getByRole("status").filter({ hasText: "问题已记录" })).toBeVisible();
  expect(pageErrors).not.toContain("Cannot read properties of undefined (reading 'id')");
});

test("长对话消息可以滚动到完整末尾", async ({ page }) => {
  const content = Array.from({ length: 36 }, (_, index) => `第 ${index + 1} 行：这是一段需要完整阅读的分析说明。`).join(
    "\n",
  );
  const fixture = createFixture({
    initialMessages: [{ id: "message-long", conversationId, role: "assistant", content, createdAt: now }],
  });
  await page.route("**/api/**", fixture.route);
  await page.goto("/");

  const conversationLog = page.locator(".conversation-log");
  await conversationLog.locator("summary").click();
  const messages = conversationLog.locator(".conversation-messages");
  const message = conversationLog.locator(".conversation-message");
  await expect(message).toContainText("第 36 行：这是一段需要完整阅读的分析说明。");

  const layout = await messages.evaluate((container) => {
    const messageElement = container.querySelector<HTMLElement>(".conversation-message");
    if (!messageElement) throw new Error("长消息未渲染");
    container.scrollTop = container.scrollHeight;
    const containerRect = container.getBoundingClientRect();
    const messageRect = messageElement.getBoundingClientRect();
    return {
      scrollable: container.scrollHeight > container.clientHeight,
      messageBottom: messageRect.bottom,
      containerBottom: containerRect.bottom,
    };
  });

  expect(layout.scrollable).toBe(true);
  expect(layout.messageBottom).toBeLessThanOrEqual(layout.containerBottom + 1);
});
