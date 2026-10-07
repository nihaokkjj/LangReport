import { createWriteStream } from "node:fs";
import { mkdtemp, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import type { MultipartFile } from "@fastify/multipart";
import { and, eq } from "drizzle-orm";
import { conversations, dataAssets, dataIntakeJobs, db, projects } from "@langreport/db";
import { conversationUploadObjectKey, deleteObject, putObjectFile, snapshotSourceObjectKey } from "@langreport/storage";
import { assertLarkOwner, larkConnection, LarkDataError } from "@langreport/lark-data";
import { freezeTableAgentRoute, resolveModelRouteSnapshot } from "@langreport/model-gateway";
import { tableIntakeJobDtoSchema } from "@langreport/contracts";
import {
  DataAssetError,
  ingestDataAsset,
  MAX_DATA_ASSET_BYTES,
  toPublicDataAsset,
  type DataAssetIntakeCommand,
  parseFailure,
} from "./data-assets.js";
import { reserveLocalIntake } from "./local-intake-admission.js";

type UploadContext = Pick<
  DataAssetIntakeCommand,
  "projectId" | "createdBy" | "requestId" | "target" | "signal" | "observe"
>;
function field(part: MultipartFile, key: string): string {
  const value = part.fields[key];
  return value && !Array.isArray(value) && value.type === "field" ? String(value.value) : "";
}

/** Testable bounded stream sink. Cleanup is owned by the enclosing request. */
export async function spoolUpload(
  part: Pick<MultipartFile, "file">,
  path: string,
  signal?: AbortSignal,
): Promise<number> {
  let size = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      callback(
        size > MAX_DATA_ASSET_BYTES ? new DataAssetError("DATA_ASSET_TOO_LARGE", "文件不能超过 50 MB") : null,
        chunk,
      );
    },
  });
  await pipeline(part.file, limit, createWriteStream(path, { flags: "wx" }), { signal });
  if (part.file.truncated) throw new DataAssetError("DATA_ASSET_TOO_LARGE", "文件不能超过 50 MB");
  if (!size) throw new DataAssetError("DATA_PARSE_FAILED", "上传文件为空");
  return size;
}

export async function ingestUploadedDataAsset(part: MultipartFile, context: UploadContext) {
  const extension = extname(part.filename).toLowerCase();
  if (![".csv", ".xlsx", ".xls", ".json"].includes(extension))
    throw new DataAssetError("INVALID_INPUT", "仅支持 CSV、Excel 或 JSON 文件");
  const isLocal = process.env.TABLE_INGESTION_PROVIDER !== "lark" || extension === ".json";
  let reservation: ReturnType<typeof reserveLocalIntake> | undefined;
  try {
    if (isLocal) reservation = reserveLocalIntake();
  } catch (error) {
    throw parseFailure(error);
  }
  let directory: string;
  try {
    directory = await mkdtemp(join(tmpdir(), "langreport-upload-"));
  } catch (error) {
    reservation?.release();
    throw error;
  }
  const path = join(directory, `source${extension}`);
  try {
    const sizeBytes = await spoolUpload(part, path, context.signal);
    const sourceConversationId = field(part, "conversationId");
    const tableHint = field(part, "tableHint");
    if (tableHint.length > 2000) throw new DataAssetError("INVALID_INPUT", "表格说明不能超过 2000 字");
    const sourceType = extension === ".csv" ? "csv" : extension === ".json" ? "json" : "xlsx";
    if (process.env.TABLE_INGESTION_PROVIDER === "lark" && sourceType !== "json") {
      return await enqueueTableIntake({
        ...context,
        sourceConversationId,
        tableHint,
        path,
        sizeBytes,
        sourceName: part.filename,
        sourceType,
        mimeType: part.mimetype,
      });
    }
    const asset = await ingestDataAsset({
      ...context,
      sourceConversationId,
      intakeReservation: reservation?.token,
      source: { name: part.filename, sourceType, mimeType: part.mimetype, path, sizeBytes },
    });
    return { asset };
  } finally {
    await unlink(path).catch(() => undefined);
    await rmdir(directory).catch(() => undefined);
    reservation?.release();
  }
}

export async function enqueueTableIntake(
  input: UploadContext & {
    sourceConversationId: string;
    tableHint: string;
    path: string;
    sizeBytes: number;
    sourceName: string;
    sourceType: "csv" | "xlsx";
    mimeType: string;
  },
) {
  const [project] = await db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
  if (!project) throw new DataAssetError("PROJECT_NOT_FOUND", "项目不存在");
  let connection;
  let modelRoute;
  try {
    connection = larkConnection();
    assertLarkOwner(connection, input.createdBy, project.workspaceId);
    modelRoute = freezeTableAgentRoute(resolveModelRouteSnapshot());
  } catch (error) {
    if (error instanceof LarkDataError && error.code === "LARK_CONNECTION_FORBIDDEN")
      throw new DataAssetError("LARK_CONNECTION_FORBIDDEN", error.message);
    throw new DataAssetError("LARK_NOT_CONFIGURED", "飞书表格接入尚未配置完成，请检查账号绑定和模型配置");
  }
  if (!/^[0-9a-f-]{36}$/i.test(input.sourceConversationId))
    throw new DataAssetError("SOURCE_CONVERSATION_INVALID", "上传数据必须指定 Conversation");
  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, input.sourceConversationId), eq(conversations.projectId, input.projectId)))
    .limit(1);
  if (!conversation) throw new DataAssetError("SOURCE_CONVERSATION_INVALID", "来源 Conversation 不属于当前项目");
  const [existing] = input.target
    ? await db
        .select()
        .from(dataAssets)
        .where(and(eq(dataAssets.id, input.target.assetId), eq(dataAssets.projectId, input.projectId)))
        .limit(1)
    : [];
  if (input.target && !existing) throw new DataAssetError("DATA_ASSET_NOT_FOUND", "数据资产不存在");
  if (existing && existing.status !== "ready") throw new DataAssetError("DATA_ASSET_NOT_UPDATABLE", "当前数据尚未就绪");
  const assetId = existing?.id ?? randomUUID();
  const snapshotId = randomUUID();
  const jobId = randomUUID();
  const keyConversationId = existing?.sourceConversationId ?? input.sourceConversationId;
  const sourceObjectKey = snapshotSourceObjectKey({
    workspaceId: project.workspaceId,
    projectId: input.projectId,
    conversationId: keyConversationId,
    assetId,
    snapshotId,
    filename: input.sourceName,
  });
  const normalizedObjectKey = conversationUploadObjectKey({
    workspaceId: project.workspaceId,
    projectId: input.projectId,
    conversationId: keyConversationId,
    assetId,
    kind: "normalized",
    filename: `${snapshotId}.json`,
  });
  try {
    await putObjectFile({ key: sourceObjectKey, path: input.path, contentType: input.mimeType });
    const asset = await db.transaction(async (transaction) => {
      const asset =
        existing ??
        (
          await transaction
            .insert(dataAssets)
            .values({
              id: assetId,
              projectId: input.projectId,
              sourceConversationId: input.sourceConversationId,
              name: input.sourceName,
              sourceType: input.sourceType,
              mimeType: input.mimeType,
              sizeBytes: input.sizeBytes,
              createdBy: input.createdBy,
              status: "processing",
            })
            .returning()
        )[0]!;
      await transaction.insert(dataIntakeJobs).values({
        id: jobId,
        assetId,
        projectId: input.projectId,
        workspaceId: project.workspaceId,
        sourceConversationId: input.sourceConversationId,
        createdBy: input.createdBy,
        snapshotId,
        sourceName: input.sourceName,
        sourceType: input.sourceType,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sourceObjectKey,
        normalizedObjectKey,
        tableHint: input.tableHint,
        isNewAsset: !existing,
        modelRoute,
        connection,
      });
      return asset;
    });
    return { asset: toPublicDataAsset(asset, null), intakeJobId: jobId };
  } catch (error) {
    await deleteObject(sourceObjectKey).catch(() => undefined);
    if (error instanceof DataAssetError) throw error;
    throw new DataAssetError("SNAPSHOT_PERSIST_FAILED", "表格接入任务暂时无法保存，请稍后重试");
  }
}

export async function getTableIntakeJob(projectId: string, jobId: string, actorId: string) {
  const [job] = await db
    .select()
    .from(dataIntakeJobs)
    .where(
      and(eq(dataIntakeJobs.id, jobId), eq(dataIntakeJobs.projectId, projectId), eq(dataIntakeJobs.createdBy, actorId)),
    )
    .limit(1);
  if (!job) throw new DataAssetError("NOT_FOUND", "表格接入任务不存在");
  return tableIntakeJobDtoSchema.parse({
    id: job.id,
    assetId: job.assetId,
    status: job.status,
    snapshotId: job.status === "succeeded" ? job.snapshotId : null,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
  });
}
