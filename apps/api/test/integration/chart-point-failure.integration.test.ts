import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  closeDatabase,
  conversations,
  dataAssets,
  dataSnapshots,
  db,
  generationJobs,
  members,
  projectMembers,
  projects,
  users,
  workspaces,
} from "@langreport/db";
import { chartPointBudgetMessage, MAX_CHART_POINTS } from "@langreport/contracts";
import { buildApp } from "../../src/app.js";

const { processRenderJob } = await import("../../../render-worker/src/index.js");
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

async function verifyFailureInBrowser(): Promise<void> {
  const webRoot = resolve(repositoryRoot, "apps/web");
  const cli = resolve(webRoot, "node_modules/@playwright/test/cli.js");
  const code = await new Promise<number>((resolveCode, reject) => {
    const child = spawn(
      process.execPath,
      [
        cli,
        "test",
        "-c",
        "playwright.config.ts",
        "test/e2e/consulting-report.spec.ts",
        "-g",
        "真实数据库失败链路在界面提示聚合",
        "--project",
        "chromium-desktop",
        "--project",
        "chromium-mobile",
      ],
      { cwd: webRoot, env: process.env, stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", (exitCode) => resolveCode(exitCode ?? 1));
  });
  assert.equal(code, 0, "真实数据库失败链路的浏览器验收失败");
}

test("真实数据库中的 10,001 点经 Render Worker 与 API 保留预算失败", async () => {
  const suffix = randomUUID();
  const userId = `point-budget-${suffix}`;
  let workspaceId: string | undefined;
  const app = await buildApp({
    logger: false,
    environment: { ...process.env, NODE_ENV: "test", APP_ENV: "test" },
    authProvider: () => ({ id: userId }),
  });
  try {
    await db
      .insert(users)
      .values({ id: userId, username: userId, usernameKey: userId, passwordHash: "integration-test-only" });
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: `Point budget ${suffix}` })
      .returning();
    workspaceId = workspace.id;
    const [project] = await db
      .insert(projects)
      .values({
        workspaceId,
        name: `Point budget ${suffix}`,
        slug: `point-budget-${suffix.slice(0, 8)}`,
      })
      .returning();
    await db.insert(members).values({ workspaceId, userId, role: "owner" });
    await db.insert(projectMembers).values({ projectId: project.id, userId, role: "editor" });
    const [conversation] = await db
      .insert(conversations)
      .values({ projectId: project.id, title: "Point budget", createdBy: userId })
      .returning();
    const [asset] = await db
      .insert(dataAssets)
      .values({
        projectId: project.id,
        sourceConversationId: conversation.id,
        name: "points.csv",
        sourceType: "pasted",
        mimeType: "text/csv",
        sizeBytes: 1,
        status: "ready",
        createdBy: userId,
      })
      .returning();
    const [snapshot] = await db
      .insert(dataSnapshots)
      .values({
        assetId: asset.id,
        version: 1,
        rowCount: MAX_CHART_POINTS + 1,
        columnCount: 2,
        schema: [],
        preview: [],
        sourceObjectKey: `point-budget/${suffix}/source.csv`,
        normalizedObjectKey: `point-budget/${suffix}/normalized.json`,
      })
      .returning();
    const values = Array.from({ length: MAX_CHART_POINTS + 1 }, (_, index) => ({ 月份: `M${index}`, 销售额: index }));
    const [job] = await db
      .insert(generationJobs)
      .values({
        projectId: project.id,
        conversationId: conversation.id,
        dataAssetId: asset.id,
        snapshotId: snapshot.id,
        prompt: "逐行绘制",
        idempotencyKey: `point-budget-${suffix}`,
        inputFingerprint: `point-budget-${suffix}`,
        renderer: "vega-lite",
        rendererVersion: "vega-lite-svg-v4",
        theme: "default",
        themeVersion: "v1",
        themeConfig: {},
        pluginContext: {},
        analysisBriefSnapshot: {},
        metricDefinitionSnapshot: {},
        createdBy: userId,
        status: "rendering",
        validation: {
          valid: true,
          issues: [],
          checks: { schema: true, semantics: true, dataFields: true, visual: true },
        },
        planValidation: { status: "passed", errors: [], validatorVersion: "integration-plan-v1" },
        resultSummary: {
          version: "v1",
          sourceRowCount: values.length,
          transformedRowCount: values.length,
          previewRowCount: 500,
          columns: ["月份", "销售额"],
          numericSummaries: [],
          topGroups: [],
          qualityWarnings: [],
        },
        flintSpec: {
          version: "v1",
          data: { values },
          semanticTypes: { 月份: "Month", 销售额: "Quantity" },
          chartSpec: {
            chartType: "Line Chart",
            title: "逐行销售额",
            encodings: { x: { field: "月份" }, y: { field: "销售额" } },
            baseSize: { width: 900, height: 360 },
          },
          theme: "default",
          themeVersion: "v1",
          themeConfig: {},
        },
      })
      .returning();
    await processRenderJob(job.id);
    const [failed] = await db.select().from(generationJobs).where(eq(generationJobs.id, job.id));
    assert.equal(failed.status, "failed");
    assert.equal(failed.errorCode, "CHART_POINT_BUDGET_EXCEEDED");
    assert.equal(failed.errorMessage, chartPointBudgetMessage(values.length));
    assert.equal(failed.leaseOwner, null);
    await app.ready();
    const status = await app.inject({ method: "GET", url: `/api/v1/generation-jobs/${job.id}/status?waitMs=0` });
    assert.equal(status.statusCode, 200);
    const statusBody = status.json() as {
      job: { status: string; errorCode: string; errorMessage: string; terminal: boolean };
      revision: unknown;
    };
    assert.equal(statusBody.job.status, "failed");
    assert.equal(statusBody.job.errorCode, failed.errorCode);
    assert.equal(statusBody.job.errorMessage, failed.errorMessage);
    assert.equal(statusBody.job.terminal, true);
    assert.equal(statusBody.revision, null);
    const detail = await app.inject({ method: "GET", url: `/api/v1/generation-jobs/${job.id}` });
    assert.equal(detail.statusCode, 200);
    assert.equal((detail.json() as { job: { errorCode: string } }).job.errorCode, failed.errorCode);
    const retry = await app.inject({ method: "POST", url: `/api/v1/generation-jobs/${job.id}/retry` });
    assert.equal(retry.statusCode, 409);
    if (process.env.LANGREPORT_FAILURE_FIXTURE_PATH) {
      const apiBaseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
      await writeFile(
        process.env.LANGREPORT_FAILURE_FIXTURE_PATH,
        JSON.stringify({
          job: {
            ...statusBody.job,
            id: job.id,
            conversationId: conversation.id,
            snapshotId: snapshot.id,
            prompt: job.prompt,
            repairCount: job.repairCount,
            clarificationProposal: null,
          },
          apiBaseUrl,
          source: { database: "postgres", worker: "render-worker", apiStatus: status.statusCode },
        }),
        "utf8",
      );
      await verifyFailureInBrowser();
    }
  } finally {
    await app.close();
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(eq(users.id, userId));
    await closeDatabase();
  }
});
