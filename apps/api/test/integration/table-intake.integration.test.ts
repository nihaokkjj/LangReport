import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  closeDatabase,
  conversations,
  dataAssets,
  dataIntakeJobs,
  dataSnapshots,
  db,
  members,
  projects,
  users,
  workspaces,
} from "@langreport/db";
import { getObject } from "@langreport/storage";
import type { CliRunner } from "@langreport/lark-data";
import { buildApp } from "../../src/app.js";
import {
  claimTableIntake,
  expireTableIntakes,
  processTableIntake,
} from "../../../generation-worker/src/table-intake.js";

test("streamed upload -> atomic claim -> CLI agent -> immutable snapshot; failures preserve the previous version", async () => {
  const userId = `lark-intake-${randomUUID()}`;
  const [workspace] = await db.insert(workspaces).values({ name: userId }).returning();
  await db
    .insert(users)
    .values({ id: userId, username: userId, usernameKey: userId, passwordHash: "integration-only" });
  await db.insert(members).values({ userId, workspaceId: workspace!.id, role: "owner" });
  const [project] = await db
    .insert(projects)
    .values({ workspaceId: workspace!.id, name: userId, slug: userId })
    .returning();
  const [conversation] = await db
    .insert(conversations)
    .values({ projectId: project!.id, title: "表格来源", createdBy: userId })
    .returning();
  const savedEnv = { ...process.env };
  Object.assign(process.env, {
    TABLE_INGESTION_PROVIDER: "lark",
    LARK_CLI_PROFILE: "langreport-test",
    LARK_OWNER_USER_ID: userId,
    LARK_WORKSPACE_ID: workspace!.id,
    LARK_EXPECTED_OPEN_ID: "ou_test",
    GENERATION_MODE: "llm",
    BAILIAN_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    BAILIAN_MODEL_ID: "qwen-plus",
    BAILIAN_STRUCTURED_OUTPUT: "json_schema",
  });
  const app = await buildApp({
    logger: false,
    environment: { ...process.env },
    authProvider: (request) =>
      typeof request.headers["x-user-id"] === "string" ? { id: request.headers["x-user-id"] } : null,
  });
  const source = "\uFEFF地区,利润\n华东,12\n华南,34\n";
  const upload = async (assetId?: string) => {
    const boundary = `boundary-${randomUUID()}`;
    const response = await app.inject({
      method: "POST",
      url: assetId
        ? `/api/v1/projects/${project!.id}/data-assets/${assetId}/snapshots/upload`
        : `/api/v1/projects/${project!.id}/data-assets/upload`,
      headers: { "x-user-id": userId, "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="conversationId"\r\n\r\n${conversation!.id}\r\n--${boundary}\r\nContent-Disposition: form-data; name="tableHint"\r\n\r\n读取利润\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="profit.csv"\r\nContent-Type: text/csv\r\n\r\n${source}\r\n--${boundary}--\r\n`,
      ),
    });
    assert.equal(response.statusCode, 202, response.body);
    return response.json() as { asset: { id: string; status: string }; intakeJobId: string };
  };
  const typed = (range: string, data: unknown[][]) => ({
    sheets: [{ name: "利润", columns: ["col1", "col2"], dtypes: { col1: "object", col2: "float64" }, range, data }],
  });
  let imports = 0;
  const cli: CliRunner = async (args, options) => {
    if (args[0] === "auth") return { identity: "user", verified: true, identities: { user: { openId: "ou_test" } } };
    if (args[1] === "+workbook-import") {
      imports++;
      assert.equal(await readFile(join(options.cwd, args[args.indexOf("--file") + 1]!), "utf8"), source);
      return { ready: true, type: "sheet", token: "testtoken" };
    }
    if (args[1] === "+revision-get") return { revision: 7 };
    if (args[1] === "+workbook-info")
      return { sheets: [{ sheet_id: "profit", sheet_name: "利润", resource_type: "sheet", is_hidden: false }] };
    if (args[1] === "+table-get") {
      const range = args.includes("--range") ? args[args.indexOf("--range") + 1] : undefined;
      return range === "A1:B1"
        ? typed(range, [["地区", "利润"]])
        : range === "A2:B3"
          ? typed(range, [
              ["华东", 12],
              ["华南", 34],
            ])
          : typed("A1:B3", [
              ["地区", "利润"],
              ["华东", "12"],
              ["华南", "34"],
            ]);
    }
    throw new Error(`unexpected command ${args[1]}`);
  };
  try {
    const created = await upload();
    assert.equal(created.asset.status, "processing");
    const claims = await Promise.all([claimTableIntake(created.intakeJobId), claimTableIntake(created.intakeJobId)]);
    assert.equal(claims.filter(Boolean).length, 1);
    const job = claims.find(Boolean)!;
    let decisions = 0;
    await processTableIntake(job, async () => "fake-worker-key", {
      cli: () => cli,
      plan: async (input) => {
        await input.recordInvocation({
          modelId: "mock",
          routeFingerprint: input.route.fingerprint,
          inputTokens: 120,
          outputTokens: 20,
          status: "received",
        });
        return decisions++ === 0
          ? { action: "inspect_sheet", sheetId: "profit", range: null }
          : { action: "select_table", sheetId: "profit", range: "A1:B3", reason: "已核对表头和末行" };
      },
    });
    const [snapshot] = await db.select().from(dataSnapshots).where(eq(dataSnapshots.assetId, created.asset.id));
    assert.ok(snapshot);
    assert.equal(snapshot.rowCount, 2);
    const normalized = JSON.parse((await getObject(snapshot.normalizedObjectKey)).toString("utf8"));
    assert.equal(normalized.rows[1].利润, 34);
    assert.equal(normalized.provenance.revision, "7");
    assert.equal((await getObject(snapshot.sourceObjectKey)).toString("utf8"), source);
    const status = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project!.id}/data-intake-jobs/${job.id}`,
      headers: { "x-user-id": userId },
    });
    assert.equal(status.statusCode, 200, status.body);
    assert.equal(status.json().job.status, "succeeded");
    assert.ok(!status.body.includes("testtoken"));
    const foreign = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project!.id}/data-intake-jobs/${job.id}`,
      headers: { "x-user-id": "another-user" },
    });
    assert.ok([403, 404].includes(foreign.statusCode));
    const updated = await upload(created.asset.id);
    const updateJob = (await claimTableIntake(updated.intakeJobId))!;
    await processTableIntake(updateJob, async () => "fake-worker-key", {
      cli: () => cli,
      plan: async () => ({ action: "clarify", question: "请选择数据区域" }),
    });
    const [failed] = await db.select().from(dataIntakeJobs).where(eq(dataIntakeJobs.id, updateJob.id));
    assert.equal(failed!.status, "needs_clarification");
    const versions = await db.select().from(dataSnapshots).where(eq(dataSnapshots.assetId, created.asset.id));
    assert.equal(versions.length, 1);
    const [asset] = await db.select().from(dataAssets).where(eq(dataAssets.id, created.asset.id));
    assert.equal(asset!.status, "ready");
    assert.equal(imports, 2);
    assert.equal(await claimTableIntake(updateJob.id), undefined);
    const pending = await upload(created.asset.id);
    const pendingJob = (await claimTableIntake(pending.intakeJobId))!;
    await processTableIntake(pendingJob, async () => "fake-worker-key", {
      cli: () => async (args, options) => {
        const result = await cli(args, options);
        return args[1] === "+workbook-import"
          ? { ready: false, type: "sheet", token: "pendingToken", ticket: "ticket123", timed_out: true }
          : result;
      },
      plan: async () => {
        throw new Error("pending import must not invoke the model");
      },
    });
    const [pendingRecord] = await db.select().from(dataIntakeJobs).where(eq(dataIntakeJobs.id, pendingJob.id));
    assert.equal(pendingRecord!.status, "failed");
    assert.equal(pendingRecord!.errorCode, "LARK_IMPORT_INCOMPLETE");
    assert.equal(pendingRecord!.remoteToken, "pendingToken");
    assert.equal((pendingRecord!.audit as { importTicket: string }).importTicket, "ticket123");
    assert.equal((await db.select().from(dataSnapshots).where(eq(dataSnapshots.assetId, created.asset.id))).length, 1);
    assert.equal((await db.select().from(dataAssets).where(eq(dataAssets.id, created.asset.id)))[0]!.status, "ready");
    const abandoned = await upload();
    await claimTableIntake(abandoned.intakeJobId);
    await db
      .update(dataIntakeJobs)
      .set({ deadlineAt: new Date(0) })
      .where(eq(dataIntakeJobs.id, abandoned.intakeJobId));
    await expireTableIntakes();
    const [expired] = await db.select().from(dataIntakeJobs).where(eq(dataIntakeJobs.id, abandoned.intakeJobId));
    assert.equal(expired!.status, "failed");
    assert.equal(imports, 3, "expired import must not replay automatically");
  } finally {
    await app.close();
    await db.delete(workspaces).where(eq(workspaces.id, workspace!.id));
    await db.delete(users).where(eq(users.id, userId));
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    await closeDatabase();
  }
});
