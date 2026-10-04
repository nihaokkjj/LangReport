import { randomUUID } from "node:crypto";
import { mkdtemp, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import { dataAssets, dataIntakeJobs, dataSnapshots, db, projects } from "@langreport/db";
import {
  conversationUploadObjectKey,
  getObjectFile,
  putObject,
  deleteObject,
  snapshotSourceObjectKey,
} from "@langreport/storage";
import {
  assertLarkOwner,
  createCliRunner,
  larkConnection,
  LarkDataError,
  runLarkTableAgent,
  type LarkConnection,
  type TableAgentTrace,
} from "@langreport/lark-data";
import { planTableAction, type TableAgentRoute, type TableModelAudit } from "@langreport/model-gateway";

type Job = typeof dataIntakeJobs.$inferSelect;
const MAX_EXECUTION_MS = 8 * 60_000;
let polling = false;

/** A lost process is terminal: never replay a non-idempotent remote import automatically. */
export async function expireTableIntakes(): Promise<void> {
  await db.transaction(async (transaction) => {
    const expired = await transaction
      .update(dataIntakeJobs)
      .set({
        status: "failed",
        finishedAt: new Date(),
        errorCode: "LARK_EXECUTION_EXPIRED",
        errorMessage: "表格接入超时或 Worker 已中断；请检查飞书云空间后重新提交",
      })
      .where(and(eq(dataIntakeJobs.status, "running"), lt(dataIntakeJobs.deadlineAt, new Date())))
      .returning();
    for (const job of expired)
      if (job.isNewAsset)
        await transaction
          .update(dataAssets)
          .set({ status: "failed", errorCode: job.errorCode, errorMessage: job.errorMessage })
          .where(and(eq(dataAssets.id, job.assetId), eq(dataAssets.status, "processing")));
  });
}

export async function pollTableIntake(apiKeyForWorkspace: (id: string) => Promise<string | undefined>): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    await expireTableIntakes();
    if (process.env.TABLE_INGESTION_PROVIDER !== "lark") return;
    const [candidate] = await db
      .select({ id: dataIntakeJobs.id })
      .from(dataIntakeJobs)
      .where(eq(dataIntakeJobs.status, "queued"))
      .orderBy(asc(dataIntakeJobs.createdAt))
      .limit(1);
    if (!candidate) return;
    const job = await claimTableIntake(candidate.id);
    if (job) await processTableIntake(job, apiKeyForWorkspace);
  } finally {
    polling = false;
  }
}

export async function claimTableIntake(jobId: string): Promise<Job | undefined> {
  const [job] = await db
    .update(dataIntakeJobs)
    .set({ status: "running", executionToken: randomUUID(), deadlineAt: new Date(Date.now() + MAX_EXECUTION_MS) })
    .where(and(eq(dataIntakeJobs.id, jobId), eq(dataIntakeJobs.status, "queued")))
    .returning();
  return job;
}

function running(job: Job) {
  return and(
    eq(dataIntakeJobs.id, job.id),
    eq(dataIntakeJobs.status, "running"),
    eq(dataIntakeJobs.executionToken, job.executionToken!),
    gt(dataIntakeJobs.deadlineAt, new Date()),
  );
}

export async function processTableIntake(
  job: Job,
  apiKeyForWorkspace: (id: string) => Promise<string | undefined>,
  adapters: { cli?: typeof createCliRunner; plan?: typeof planTableAction } = {},
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, job.deadlineAt!.getTime() - Date.now()));
  let directory: string | undefined;
  let path: string | undefined;
  let normalizedWritten = false;
  let committed = false;
  const audit: {
    trace: TableAgentTrace[];
    modelInvocations: TableModelAudit[];
    importTicket?: string;
    provenance?: unknown;
  } = {
    trace: [],
    modelInvocations: [],
  };
  const update = async (values: Partial<typeof dataIntakeJobs.$inferInsert>) => {
    const saved = await db.update(dataIntakeJobs).set(values).where(running(job)).returning({ id: dataIntakeJobs.id });
    if (!saved.length) throw new LarkDataError("LARK_LEASE_LOST", "接入任务已过期或不再归此 Worker 执行");
  };
  try {
    const connection = job.connection as LarkConnection;
    const current = larkConnection();
    assertLarkOwner(current, job.createdBy, job.workspaceId);
    if (
      (["profile", "ownerUserId", "workspaceId", "openId", "folderToken"] as const).some(
        (key) => connection[key] !== current[key],
      )
    )
      throw new LarkDataError("LARK_CONNECTION_CHANGED", "飞书连接配置已改变，请重新提交任务");
    const [source] = await db
      .select({ asset: dataAssets, workspaceId: projects.workspaceId })
      .from(dataAssets)
      .innerJoin(projects, eq(dataAssets.projectId, projects.id))
      .where(and(eq(dataAssets.id, job.assetId), eq(dataAssets.projectId, job.projectId)))
      .limit(1);
    if (!source || source.workspaceId !== job.workspaceId)
      throw new LarkDataError("LARK_SOURCE_INVALID", "接入数据不属于任务的 Project/Workspace");
    const expectedSource = snapshotSourceObjectKey({
      workspaceId: job.workspaceId,
      projectId: job.projectId,
      conversationId: source.asset.sourceConversationId,
      assetId: job.assetId,
      snapshotId: job.snapshotId,
      filename: job.sourceName,
    });
    const expectedNormalized = conversationUploadObjectKey({
      workspaceId: job.workspaceId,
      projectId: job.projectId,
      conversationId: source.asset.sourceConversationId,
      assetId: job.assetId,
      kind: "normalized",
      filename: `${job.snapshotId}.json`,
    });
    if (job.sourceObjectKey !== expectedSource || job.normalizedObjectKey !== expectedNormalized)
      throw new LarkDataError("LARK_SOURCE_INVALID", "接入对象路径不属于冻结的数据源");
    const apiKey = (await apiKeyForWorkspace(job.workspaceId)) ?? process.env.BAILIAN_API_KEY ?? "";
    if (!apiKey) throw new LarkDataError("LARK_MODEL_UNAVAILABLE", "请先配置工作区模型凭据");
    directory = await mkdtemp(join(tmpdir(), "langreport-lark-"));
    const extension = extname(job.sourceName).toLowerCase();
    if (![".csv", ".xlsx", ".xls"].includes(extension))
      throw new LarkDataError("LARK_SOURCE_INVALID", "不支持的表格文件类型");
    const file = `source${extension}`;
    path = join(directory, file);
    await getObjectFile(job.sourceObjectKey, path, 50 * 1024 * 1024, controller.signal);
    const result = await runLarkTableAgent({
      connection,
      cli: (adapters.cli ?? createCliRunner)(connection),
      cwd: directory,
      file,
      filename: job.sourceName,
      hint: job.tableHint,
      signal: controller.signal,
      onImported: async (remoteToken, importTicket) => {
        audit.importTicket = importTicket;
        await update({ remoteToken, audit });
      },
      onTrace: async (trace) => {
        audit.trace = trace;
        await update({ audit });
      },
      decide: async (context, signal) => {
        try {
          return await (adapters.plan ?? planTableAction)({
            route: job.modelRoute as TableAgentRoute,
            context,
            apiKey,
            signal,
            deadlineAt: job.deadlineAt!.getTime(),
            recordInvocation: async (invocation) => {
              audit.modelInvocations.push(invocation);
              await update({ audit });
            },
          });
        } catch {
          throw new LarkDataError("LARK_MODEL_FAILED", "表格 Agent 未能返回有效决策，请检查模型配置或补充表格说明");
        }
      },
    });
    audit.provenance = result.provenance;
    normalizedWritten = true;
    await putObject({
      key: job.normalizedObjectKey,
      body: JSON.stringify({ columns: result.table.columns, rows: result.table.rows, provenance: result.provenance }),
      contentType: "application/json",
      signal: controller.signal,
    });
    await db.transaction(async (transaction) => {
      const [lockedJob] = await transaction.select().from(dataIntakeJobs).where(running(job)).for("update").limit(1);
      if (!lockedJob) throw new LarkDataError("LARK_LEASE_LOST", "接入任务已过期，结果没有发布");
      const [asset] = await transaction
        .select()
        .from(dataAssets)
        .where(eq(dataAssets.id, job.assetId))
        .for("update")
        .limit(1);
      if (!asset || !["processing", "ready"].includes(asset.status))
        throw new LarkDataError("LARK_ASSET_CHANGED", "目标数据资产不再接受更新");
      const [latest] = await transaction
        .select({ version: dataSnapshots.version })
        .from(dataSnapshots)
        .where(eq(dataSnapshots.assetId, job.assetId))
        .orderBy(desc(dataSnapshots.version))
        .limit(1);
      await transaction.insert(dataSnapshots).values({
        id: job.snapshotId,
        assetId: job.assetId,
        version: (latest?.version ?? 0) + 1,
        rowCount: result.table.rows.length,
        columnCount: result.table.columns.length,
        schema: result.table.profiles,
        preview: result.table.preview,
        sourceName: job.sourceName,
        sourceType: job.sourceType as "csv" | "xlsx",
        mimeType: job.mimeType,
        sizeBytes: job.sizeBytes,
        sourceObjectKey: job.sourceObjectKey,
        normalizedObjectKey: job.normalizedObjectKey,
      });
      await transaction
        .update(dataAssets)
        .set({
          status: "ready",
          name: job.sourceName,
          sourceType: job.sourceType as "csv" | "xlsx",
          mimeType: job.mimeType,
          sizeBytes: job.sizeBytes,
          errorCode: null,
          errorMessage: null,
        })
        .where(eq(dataAssets.id, job.assetId));
      const completed = await transaction
        .update(dataIntakeJobs)
        .set({ status: "succeeded", audit, finishedAt: new Date() })
        .where(running(job))
        .returning({ id: dataIntakeJobs.id });
      if (!completed.length) throw new LarkDataError("LARK_LEASE_LOST", "任务提交时已过期，快照事务已回滚");
    });
    committed = true;
  } catch (error) {
    const code = error instanceof LarkDataError ? error.code : "LARK_INTAKE_FAILED";
    const message = error instanceof LarkDataError ? error.message : "表格接入失败，请检查存储、飞书连接和 Worker 配置";
    await db.transaction(async (transaction) => {
      const [failed] = await transaction
        .update(dataIntakeJobs)
        .set({
          status: code === "LARK_NEEDS_CLARIFICATION" ? "needs_clarification" : "failed",
          errorCode: code,
          errorMessage: message,
          audit,
          finishedAt: new Date(),
        })
        .where(
          and(
            eq(dataIntakeJobs.id, job.id),
            eq(dataIntakeJobs.status, "running"),
            eq(dataIntakeJobs.executionToken, job.executionToken!),
          ),
        )
        .returning();
      if (failed?.isNewAsset)
        await transaction
          .update(dataAssets)
          .set({ status: "failed", errorCode: code, errorMessage: message })
          .where(and(eq(dataAssets.id, job.assetId), eq(dataAssets.status, "processing")));
    });
  } finally {
    clearTimeout(timeout);
    if (normalizedWritten && !committed) {
      // A lost COMMIT response may still mean a published snapshot. Never delete its object blindly.
      try {
        const published = await db
          .select({ id: dataSnapshots.id })
          .from(dataSnapshots)
          .where(eq(dataSnapshots.id, job.snapshotId))
          .limit(1);
        if (!published.length) await deleteObject(job.normalizedObjectKey);
      } catch {
        /* Leave an orphan for reconciliation when commit state cannot be verified. */
      }
    }
    if (path) await unlink(path).catch(() => undefined);
    if (directory) await rmdir(directory).catch(() => undefined);
  }
}
