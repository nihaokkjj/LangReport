import { and, desc, eq } from "drizzle-orm";
import {
  auditEvents,
  conversations,
  dataAssetSourceType,
  dataAssets,
  dataSnapshots,
  db,
  projects,
} from "@langreport/db";
import { DataParseError, type DataSourceType, type ParsedTable } from "@langreport/data-engine";
import { createLocalParser, LocalParseError, type LocalParseResult } from "./local-parse.js";
import { reserveLocalIntake, hasLocalIntakeReservation } from "./local-intake-admission.js";
import {
  conversationUploadObjectKey,
  deleteObject as deleteStorageObject,
  putObject as putStorageObject,
  putObjectFile as putStorageObjectFile,
  snapshotSourceObjectKey,
} from "@langreport/storage";

export const MAX_DATA_ASSET_BYTES = 50 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DataAssetErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "DATA_ASSET_NOT_FOUND"
  | "DATA_ASSET_NOT_UPDATABLE"
  | "DATA_ASSET_READ_FAILED"
  | "PROJECT_NOT_FOUND"
  | "DATA_ASSET_TOO_LARGE"
  | "SOURCE_CONVERSATION_INVALID"
  | "DATA_PARSE_FAILED"
  | "DATA_PARSE_BUSY"
  | "DATA_PARSE_TIMEOUT"
  | "DATA_PARSE_RESOURCE_LIMIT"
  | "DATA_PARSE_WORKER_FAILED"
  | "DATA_PARSE_CANCELLED"
  | "SOURCE_OBJECT_WRITE_FAILED"
  | "SNAPSHOT_OBJECT_WRITE_FAILED"
  | "SNAPSHOT_NOT_FOUND"
  | "SNAPSHOT_PREVIEW_UNAVAILABLE"
  | "SNAPSHOT_PERSIST_FAILED"
  | "DATA_ASSET_CLEANUP_FAILED"
  | "LARK_CONNECTION_FORBIDDEN"
  | "LARK_NOT_CONFIGURED";

const knownErrorCodes = new Set<DataAssetErrorCode>([
  "INVALID_INPUT",
  "NOT_FOUND",
  "DATA_ASSET_NOT_FOUND",
  "DATA_ASSET_NOT_UPDATABLE",
  "DATA_ASSET_READ_FAILED",
  "PROJECT_NOT_FOUND",
  "DATA_ASSET_TOO_LARGE",
  "SOURCE_CONVERSATION_INVALID",
  "DATA_PARSE_FAILED",
  "DATA_PARSE_BUSY",
  "DATA_PARSE_TIMEOUT",
  "DATA_PARSE_RESOURCE_LIMIT",
  "DATA_PARSE_WORKER_FAILED",
  "DATA_PARSE_CANCELLED",
  "SOURCE_OBJECT_WRITE_FAILED",
  "SNAPSHOT_OBJECT_WRITE_FAILED",
  "SNAPSHOT_NOT_FOUND",
  "SNAPSHOT_PREVIEW_UNAVAILABLE",
  "SNAPSHOT_PERSIST_FAILED",
  "DATA_ASSET_CLEANUP_FAILED",
  "LARK_CONNECTION_FORBIDDEN",
  "LARK_NOT_CONFIGURED",
]);

const defaultStatusByCode: Record<DataAssetErrorCode, number> = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  DATA_ASSET_NOT_FOUND: 404,
  DATA_ASSET_NOT_UPDATABLE: 409,
  DATA_ASSET_READ_FAILED: 500,
  PROJECT_NOT_FOUND: 404,
  DATA_ASSET_TOO_LARGE: 413,
  SOURCE_CONVERSATION_INVALID: 400,
  DATA_PARSE_FAILED: 422,
  DATA_PARSE_BUSY: 503,
  DATA_PARSE_TIMEOUT: 503,
  DATA_PARSE_RESOURCE_LIMIT: 422,
  DATA_PARSE_WORKER_FAILED: 500,
  DATA_PARSE_CANCELLED: 503,
  SOURCE_OBJECT_WRITE_FAILED: 503,
  SNAPSHOT_OBJECT_WRITE_FAILED: 503,
  SNAPSHOT_NOT_FOUND: 404,
  SNAPSHOT_PREVIEW_UNAVAILABLE: 409,
  SNAPSHOT_PERSIST_FAILED: 500,
  DATA_ASSET_CLEANUP_FAILED: 500,
  LARK_CONNECTION_FORBIDDEN: 403,
  LARK_NOT_CONFIGURED: 503,
};

/**
 * Stable, safe-to-project Data Asset boundary error. The one-argument form is
 * retained for unrelated API code that already uses this local error class;
 * intake code always supplies an explicit code and status.
 */
export class DataAssetError extends Error {
  public readonly code: DataAssetErrorCode;
  public readonly statusCode: number;

  constructor(message: string);
  constructor(message: string, code: DataAssetErrorCode, statusCode?: number, options?: ErrorOptions);
  constructor(code: DataAssetErrorCode, message: string, statusCode?: number, options?: ErrorOptions);
  constructor(first: string, second?: string, statusCode?: number, options?: ErrorOptions) {
    const firstIsCode = knownErrorCodes.has(first as DataAssetErrorCode);
    const secondIsCode = knownErrorCodes.has(second as DataAssetErrorCode);
    const code = (firstIsCode ? first : secondIsCode ? second : "INVALID_INPUT") as DataAssetErrorCode;
    const message = firstIsCode && second ? second : first;
    super(message, options);
    this.name = "DataAssetError";
    this.code = code;
    this.statusCode = statusCode ?? defaultStatusByCode[code];
  }
}

export type PublicDataAsset = typeof dataAssets.$inferSelect & {
  sourceConversationDeleted: boolean;
  latestSnapshot: PublicDataSnapshot | null;
};

export type PublicDataSnapshot = Omit<typeof dataSnapshots.$inferSelect, "sourceObjectKey" | "normalizedObjectKey">;
export type PublicSnapshotSummary = Omit<PublicDataSnapshot, "schema" | "preview">;
export type PublicSnapshotDetail = PublicDataSnapshot;

function toPublicSnapshot(snapshot: typeof dataSnapshots.$inferSelect): PublicDataSnapshot {
  const { sourceObjectKey: _sourceObjectKey, normalizedObjectKey: _normalizedObjectKey, ...publicSnapshot } = snapshot;
  void _sourceObjectKey;
  void _normalizedObjectKey;
  return publicSnapshot;
}

export function toPublicDataAsset(
  asset: typeof dataAssets.$inferSelect,
  latestSnapshot: typeof dataSnapshots.$inferSelect | null,
  sourceConversationDeleted = false,
): PublicDataAsset {
  if (!latestSnapshot) return { ...asset, sourceConversationDeleted, latestSnapshot: null };
  return { ...asset, sourceConversationDeleted, latestSnapshot: toPublicSnapshot(latestSnapshot) };
}

export type DataAssetIntakeCommand = {
  observe?: (event: {
    stage: string;
    durationMs?: number;
    inputBytes?: number;
    outputBytes?: number;
    rowCount?: number;
    code?: string;
  }) => void;
  signal?: AbortSignal;
  intakeReservation?: symbol;
  projectId: string;
  sourceConversationId: string;
  createdBy: string;
  requestId?: string;
  target?: { assetId: string };
  source: {
    name: string;
    sourceType: DataSourceType;
    mimeType: string;
  } & ({ bytes: Buffer; path?: never; sizeBytes?: never } | { bytes?: never; path: string; sizeBytes: number });
};

/** Kept as a local alias for callers that used the old function name. */
export type IngestDataAssetInput = DataAssetIntakeCommand;

type ProjectContext = { workspaceId: string };

type SnapshotPersistenceInput = {
  assetId: string;
  snapshotId: string;
  rowCount: number;
  columnCount: number;
  schema: ParsedTable["profiles"];
  preview: ParsedTable["preview"];
  sourceName: string;
  sourceType: (typeof dataAssetSourceType.enumValues)[number];
  mimeType: string;
  sizeBytes: number;
  sourceObjectKey: string;
  normalizedObjectKey: string;
  assetMetadata: {
    name: string;
    sourceType: (typeof dataAssetSourceType.enumValues)[number];
    mimeType: string;
    sizeBytes: number;
  };
};

type SnapshotPersistenceResult = {
  asset: typeof dataAssets.$inferSelect;
  snapshot: typeof dataSnapshots.$inferSelect;
};

export type IntakeRepository = {
  findProject: (projectId: string) => Promise<ProjectContext | undefined>;
  hasConversationInProject: (projectId: string, conversationId: string) => Promise<boolean>;
  findAssetForUpdate: (projectId: string, assetId: string) => Promise<typeof dataAssets.$inferSelect | undefined>;
  insertProcessingAsset: (asset: typeof dataAssets.$inferInsert) => Promise<void>;
  persistSnapshotAndReady: (input: SnapshotPersistenceInput) => Promise<SnapshotPersistenceResult>;
  markFailed: (assetId: string, code: DataAssetErrorCode, message: string) => Promise<void>;
};

type CleanupObjectKind = "source" | "normalized";

export type IntakeAuditInput = {
  workspaceId: string;
  projectId: string;
  assetId: string;
  sourceConversationId: string;
  actorId: string;
  requestId?: string;
  objectKind: CleanupObjectKind;
  failureCode: DataAssetErrorCode;
};

export type IntakeDependencies = {
  parser?: Pick<ReturnType<typeof createLocalParser>, "parse">;
  repository?: IntakeRepository;
  storage?: {
    putObject: typeof putStorageObject;
    putObjectFile: typeof putStorageObjectFile;
    deleteObject: typeof deleteStorageObject;
  };
  recordCleanupFailure?: (input: IntakeAuditInput) => Promise<void>;
  createId?: () => string;
};

export function createIntakeRepository(database: typeof db = db): IntakeRepository {
  return {
    async findProject(projectId) {
      const [project] = await database
        .select({ workspaceId: projects.workspaceId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      return project;
    },

    async hasConversationInProject(projectId, conversationId) {
      const [conversation] = await database
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.projectId, projectId)))
        .limit(1);
      return Boolean(conversation);
    },

    async findAssetForUpdate(projectId, assetId) {
      const [asset] = await database
        .select()
        .from(dataAssets)
        .where(and(eq(dataAssets.id, assetId), eq(dataAssets.projectId, projectId)))
        .limit(1);
      return asset;
    },

    async insertProcessingAsset(asset) {
      await database.insert(dataAssets).values(asset);
    },

    async persistSnapshotAndReady(input) {
      return database.transaction(async (transaction) => {
        const [lockedAsset] = await transaction
          .select()
          .from(dataAssets)
          .where(eq(dataAssets.id, input.assetId))
          .for("update")
          .limit(1);
        if (!lockedAsset) throw intakeError("DATA_ASSET_NOT_FOUND", "数据资产不存在");
        if (lockedAsset.status !== "processing" && lockedAsset.status !== "ready") {
          throw intakeError("DATA_ASSET_NOT_UPDATABLE", "当前 Data Asset 不可更新");
        }

        const [latestSnapshot] = await transaction
          .select({ version: dataSnapshots.version })
          .from(dataSnapshots)
          .where(eq(dataSnapshots.assetId, input.assetId))
          .orderBy(desc(dataSnapshots.version))
          .limit(1);
        const version = (latestSnapshot?.version ?? 0) + 1;

        const [snapshot] = await transaction
          .insert(dataSnapshots)
          .values({
            id: input.snapshotId,
            assetId: input.assetId,
            version,
            rowCount: input.rowCount,
            columnCount: input.columnCount,
            schema: input.schema,
            preview: input.preview,
            sourceName: input.assetMetadata.name,
            sourceType: input.assetMetadata.sourceType,
            mimeType: input.assetMetadata.mimeType,
            sizeBytes: input.assetMetadata.sizeBytes,
            sourceObjectKey: input.sourceObjectKey,
            normalizedObjectKey: input.normalizedObjectKey,
          })
          .returning();
        if (!snapshot) throw new Error("Snapshot 元数据保存失败");

        const [asset] = await transaction
          .update(dataAssets)
          .set({
            ...input.assetMetadata,
            status: "ready",
            errorCode: null,
            errorMessage: null,
          })
          .where(eq(dataAssets.id, input.assetId))
          .returning();
        if (!asset) throw new Error("Data Asset 状态保存失败");

        return { asset, snapshot };
      });
    },

    async markFailed(assetId, code, message) {
      await database
        .update(dataAssets)
        .set({ status: "failed", errorCode: code, errorMessage: message })
        .where(eq(dataAssets.id, assetId));
    },
  };
}

const productionRepository = createIntakeRepository();

const productionStorage = {
  putObject: putStorageObject,
  putObjectFile: putStorageObjectFile,
  deleteObject: deleteStorageObject,
};

async function recordCleanupFailure(input: IntakeAuditInput): Promise<void> {
  await db.insert(auditEvents).values({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    actorId: input.actorId,
    action: "data_asset.intake.cleanup_failed",
    entityType: "data_asset",
    entityId: input.assetId,
    metadata: {
      sourceConversationId: input.sourceConversationId,
      phase: "cleanup",
      objectKind: input.objectKind,
      failureCode: input.failureCode,
      cleanupCode: "DATA_ASSET_CLEANUP_FAILED",
    },
    requestId: input.requestId,
  });
}

function safeName(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, "_") || "data.csv";
}

function intakeError(code: DataAssetErrorCode, message: string, options?: ErrorOptions): DataAssetError {
  return new DataAssetError(code, message, undefined, options);
}

export function parseFailure(error: unknown): DataAssetError {
  if (error instanceof LocalParseError) {
    const messages = {
      DATA_PARSE_BUSY: "当前有表格正在解析，请稍后重试",
      DATA_PARSE_TIMEOUT: "表格解析超时，请稍后重试或拆分文件",
      DATA_PARSE_RESOURCE_LIMIT: "表格解析超出资源限制，请拆分文件或减少输入",
      DATA_PARSE_WORKER_FAILED: "表格解析暂时不可用，请稍后重试",
      DATA_PARSE_CANCELLED: "表格解析已取消，请重新提交",
      DATA_PARSE_FAILED: "数据无法解析，请检查文件格式、表头和内容",
    };
    return intakeError(error.code, messages[error.code]);
  }
  return error instanceof DataAssetError && error.code === "DATA_PARSE_FAILED"
    ? error
    : intakeError("DATA_PARSE_FAILED", "数据无法解析，请检查文件格式、表头和内容", { cause: error });
}

function persistenceFailure(error: unknown): DataAssetError {
  return error instanceof DataAssetError
    ? error
    : intakeError("SNAPSHOT_PERSIST_FAILED", "Data Snapshot 保存失败，请稍后重试", { cause: error });
}

function asIntakeError(error: unknown): DataAssetError {
  if (error instanceof DataAssetError) return error;
  if (error instanceof DataParseError) return parseFailure(error);
  return persistenceFailure(error);
}

const localParser = createLocalParser();
export const closeLocalParser = () => localParser.close();

export function createDataAssetIntake(dependencies: IntakeDependencies = {}) {
  const repository = dependencies.repository ?? productionRepository;
  const storage = dependencies.storage ?? productionStorage;
  const createId = dependencies.createId ?? (() => crypto.randomUUID());
  const writeCleanupAudit = dependencies.recordCleanupFailure ?? recordCleanupFailure;
  const parser = dependencies.parser ?? localParser;

  return {
    async ingest(command: DataAssetIntakeCommand): Promise<PublicDataAsset> {
      const observe: NonNullable<DataAssetIntakeCommand["observe"]> = (event) => {
        try {
          command.observe?.(event);
        } catch {
          /* Telemetry must not change publication results. */
        }
      };
      const intakeStarted = performance.now();
      const bytes = command.source.bytes;
      const sizeBytes = command.source.bytes ? command.source.bytes.byteLength : command.source.sizeBytes;
      if (sizeBytes > MAX_DATA_ASSET_BYTES) {
        throw intakeError("DATA_ASSET_TOO_LARGE", "文件不能超过 50 MB");
      }

      let project: ProjectContext | undefined;
      try {
        project = await repository.findProject(command.projectId);
      } catch (error) {
        throw persistenceFailure(error);
      }
      if (!project) throw new DataAssetError("项目不存在", "PROJECT_NOT_FOUND");

      if (!UUID_PATTERN.test(command.sourceConversationId)) {
        throw intakeError("SOURCE_CONVERSATION_INVALID", "来源 Conversation 无效或不属于当前 Project");
      }

      let belongsToProject: boolean;
      try {
        belongsToProject = await repository.hasConversationInProject(command.projectId, command.sourceConversationId);
      } catch (error) {
        throw persistenceFailure(error);
      }
      if (!belongsToProject) {
        throw intakeError("SOURCE_CONVERSATION_INVALID", "来源 Conversation 无效或不属于当前 Project");
      }

      let targetAsset: typeof dataAssets.$inferSelect | undefined;
      if (command.target) {
        if (!UUID_PATTERN.test(command.target.assetId)) {
          throw intakeError("DATA_ASSET_NOT_FOUND", "数据资产不存在");
        }
        try {
          targetAsset = await repository.findAssetForUpdate(command.projectId, command.target.assetId);
        } catch (error) {
          throw persistenceFailure(error);
        }
        if (!targetAsset) throw intakeError("DATA_ASSET_NOT_FOUND", "数据资产不存在");
        if (targetAsset.status !== "ready") {
          throw intakeError("DATA_ASSET_NOT_UPDATABLE", "当前 Data Asset 不可更新");
        }
        if (!UUID_PATTERN.test(targetAsset.sourceConversationId)) {
          throw intakeError("DATA_ASSET_NOT_UPDATABLE", "当前 Data Asset 缺少有效的来源 Conversation");
        }
      }

      let reservation: ReturnType<typeof reserveLocalIntake> | undefined;
      try {
        if (command.intakeReservation) {
          if (!hasLocalIntakeReservation(command.intakeReservation)) throw new LocalParseError("DATA_PARSE_CANCELLED");
        } else reservation = reserveLocalIntake();
      } catch (error) {
        if (error instanceof LocalParseError) observe({ stage: "admission_failed", code: error.code });
        throw parseFailure(error);
      }
      try {
        const assetId = targetAsset?.id ?? createId();
        const snapshotId = createId();
        const normalizedName = safeName(command.source.name);
        const mimeType = command.source.mimeType || "application/octet-stream";
        const keyConversationId = targetAsset?.sourceConversationId ?? command.sourceConversationId;
        const sourceObjectKey = snapshotSourceObjectKey({
          workspaceId: project.workspaceId,
          projectId: command.projectId,
          conversationId: keyConversationId,
          assetId,
          snapshotId,
          filename: normalizedName,
        });
        const normalizedObjectKey = conversationUploadObjectKey({
          workspaceId: project.workspaceId,
          projectId: command.projectId,
          conversationId: keyConversationId,
          assetId,
          kind: "normalized",
          filename: `${snapshotId}.json`,
        });

        if (!targetAsset) {
          try {
            await repository.insertProcessingAsset({
              id: assetId,
              projectId: command.projectId,
              sourceConversationId: command.sourceConversationId,
              name: command.source.name.trim() || normalizedName,
              sourceType: command.source.sourceType as (typeof dataAssetSourceType.enumValues)[number],
              mimeType,
              sizeBytes,
              status: "processing",
              errorCode: null,
              errorMessage: null,
              createdBy: command.createdBy,
            });
          } catch (error) {
            throw persistenceFailure(error);
          }
        }

        let parsedResult: LocalParseResult | undefined;
        let sourceWritten = false;
        let normalizedWritten = false;
        let persistenceAttempted = false;
        let failure: DataAssetError | undefined;
        try {
          try {
            parsedResult = await parser.parse({
              sourceType: command.source.sourceType,
              bytes,
              sourcePath: command.source.path,
              signal: command.signal,
            });
            observe({
              stage: "parsed",
              durationMs: parsedResult.metadata.parseMs,
              inputBytes: sizeBytes,
              outputBytes: parsedResult.metadata.outputBytes,
              rowCount: parsedResult.metadata.rowCount,
            });
            observe({ stage: "serialized", durationMs: parsedResult.metadata.totalMs - parsedResult.metadata.parseMs });
          } catch (error) {
            throw parseFailure(error);
          }

          try {
            const started = performance.now();
            // A successful provider-side write followed by a lost response is
            // still a possible orphan, so mark the object for compensation
            // before awaiting the adapter.
            sourceWritten = true;
            command.signal?.throwIfAborted();
            await storage.putObjectFile({
              key: sourceObjectKey,
              path: parsedResult.sourcePath,
              contentType: mimeType,
              signal: command.signal,
            });
            observe({ stage: "source_stored", durationMs: performance.now() - started });
          } catch (error) {
            throw intakeError("SOURCE_OBJECT_WRITE_FAILED", "原始数据暂时无法保存，请稍后重试", { cause: error });
          }

          try {
            const started = performance.now();
            normalizedWritten = true;
            command.signal?.throwIfAborted();
            await storage.putObjectFile({
              key: normalizedObjectKey,
              path: parsedResult.normalizedPath,
              signal: command.signal,
              contentType: "application/json",
            });
            observe({ stage: "normalized_stored", durationMs: performance.now() - started });
          } catch (error) {
            throw intakeError("SNAPSHOT_OBJECT_WRITE_FAILED", "Data Snapshot 暂时无法保存，请稍后重试", {
              cause: error,
            });
          }

          let persisted: SnapshotPersistenceResult;
          try {
            const started = performance.now();
            command.signal?.throwIfAborted();
            persistenceAttempted = true;
            persisted = await repository.persistSnapshotAndReady({
              assetId,
              snapshotId,
              rowCount: parsedResult.metadata.rowCount,
              columnCount: parsedResult.metadata.columns.length,
              schema: parsedResult.metadata.profiles,
              preview: parsedResult.metadata.preview,
              sourceName: command.source.name.trim() || normalizedName,
              sourceType: command.source.sourceType as (typeof dataAssetSourceType.enumValues)[number],
              mimeType,
              sizeBytes,
              sourceObjectKey,
              assetMetadata: {
                name: command.source.name.trim() || normalizedName,
                sourceType: command.source.sourceType as (typeof dataAssetSourceType.enumValues)[number],
                mimeType,
                sizeBytes,
              },
              normalizedObjectKey,
            });
            observe({ stage: "published", durationMs: performance.now() - started });
          } catch (error) {
            throw persistenceFailure(error);
          }

          return toPublicDataAsset(persisted.asset, persisted.snapshot, false);
        } catch (error) {
          failure = asIntakeError(error);
          if (persistenceAttempted && failure.code === "SNAPSHOT_PERSIST_FAILED") {
            failure = intakeError(
              "SNAPSHOT_PERSIST_FAILED",
              "Data Snapshot 保存结果暂无法确认，请先查询资产及快照列表，再决定是否重试",
            );
          }
          observe({ stage: persistenceAttempted ? "publication_unknown" : "failed", code: failure.code });
          // A lost COMMIT response is not proof of rollback. Keep candidate objects
          // and asset state for reconciliation once publication was attempted.
          if (!persistenceAttempted)
            await cleanupWrittenObjects({
              workspaceId: project.workspaceId,
              projectId: command.projectId,
              assetId,
              sourceConversationId: command.sourceConversationId,
              actorId: command.createdBy,
              requestId: command.requestId,
              sourceObjectKey,
              normalizedObjectKey,
              sourceWritten,
              normalizedWritten,
              failureCode: failure.code,
              storage,
              writeCleanupAudit,
            });
          if (!targetAsset && !persistenceAttempted) {
            try {
              await repository.markFailed(assetId, failure.code, failure.message);
            } catch {
              // The original stable failure remains the externally meaningful error.
              // A later cleanup/reconciliation process can inspect the processing row.
            }
          }
          throw failure;
        } finally {
          try {
            await parsedResult?.dispose();
          } catch {
            observe({ stage: "cleanup_failed", code: "LOCAL_PARSE_CLEANUP_FAILED" });
          }
          observe({ stage: "finished", durationMs: performance.now() - intakeStarted });
        }
      } finally {
        reservation?.release();
      }
    },
  };
}

async function cleanupWrittenObjects(input: {
  workspaceId: string;
  projectId: string;
  assetId: string;
  sourceConversationId: string;
  actorId: string;
  requestId?: string;
  sourceObjectKey: string;
  normalizedObjectKey: string;
  sourceWritten: boolean;
  normalizedWritten: boolean;
  failureCode: DataAssetErrorCode;
  storage: { putObject: typeof putStorageObject; deleteObject: typeof deleteStorageObject };
  writeCleanupAudit: (input: IntakeAuditInput) => Promise<void>;
}): Promise<void> {
  const objects: Array<{ kind: CleanupObjectKind; key: string; written: boolean }> = [
    { kind: "normalized", key: input.normalizedObjectKey, written: input.normalizedWritten },
    { kind: "source", key: input.sourceObjectKey, written: input.sourceWritten },
  ];

  for (const object of objects) {
    if (!object.written) continue;
    try {
      await input.storage.deleteObject(object.key);
    } catch {
      try {
        await input.writeCleanupAudit({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          assetId: input.assetId,
          sourceConversationId: input.sourceConversationId,
          actorId: input.actorId,
          requestId: input.requestId,
          objectKind: object.kind,
          failureCode: input.failureCode,
        });
      } catch {
        // Audit is best-effort here; do not replace the original intake error.
      }
    }
  }
}

export async function ingestDataAsset(command: DataAssetIntakeCommand): Promise<PublicDataAsset> {
  return createDataAssetIntake().ingest(command);
}

type AssetReadRecord = {
  asset: typeof dataAssets.$inferSelect;
  sourceConversationId: string | null;
};

async function readAsset(assetId: string): Promise<AssetReadRecord> {
  try {
    const [record] = await db
      .select({ asset: dataAssets, sourceConversationId: conversations.id })
      .from(dataAssets)
      .leftJoin(conversations, eq(conversations.id, dataAssets.sourceConversationId))
      .where(eq(dataAssets.id, assetId))
      .limit(1);
    if (!record) throw new DataAssetError("数据资产不存在", "DATA_ASSET_NOT_FOUND");
    return record;
  } catch (error) {
    if (error instanceof DataAssetError) throw error;
    throw new DataAssetError("数据资产暂时无法读取，请稍后重试", "DATA_ASSET_READ_FAILED", 500, { cause: error });
  }
}

export async function getDataAssetProjectId(assetId: string): Promise<string> {
  const record = await readAsset(assetId);
  return record.asset.projectId;
}

export async function listDataAssets(projectId: string): Promise<PublicDataAsset[]> {
  try {
    const assets = await db
      .select({ asset: dataAssets, sourceConversationId: conversations.id })
      .from(dataAssets)
      .leftJoin(conversations, eq(conversations.id, dataAssets.sourceConversationId))
      .where(eq(dataAssets.projectId, projectId))
      .orderBy(desc(dataAssets.createdAt));

    return Promise.all(
      assets.map(async ({ asset, sourceConversationId }) => {
        const [latestSnapshot] = await db
          .select()
          .from(dataSnapshots)
          .where(eq(dataSnapshots.assetId, asset.id))
          .orderBy(desc(dataSnapshots.version))
          .limit(1);
        return toPublicDataAsset(asset, latestSnapshot ?? null, sourceConversationId === null);
      }),
    );
  } catch (error) {
    if (error instanceof DataAssetError) throw error;
    throw new DataAssetError("数据资产暂时无法读取，请稍后重试", "DATA_ASSET_READ_FAILED", 500, { cause: error });
  }
}

export async function getDataAsset(assetId: string): Promise<PublicDataAsset> {
  const record = await readAsset(assetId);
  try {
    const [latestSnapshot] = await db
      .select()
      .from(dataSnapshots)
      .where(eq(dataSnapshots.assetId, assetId))
      .orderBy(desc(dataSnapshots.version))
      .limit(1);
    return toPublicDataAsset(record.asset, latestSnapshot ?? null, record.sourceConversationId === null);
  } catch (error) {
    throw new DataAssetError("数据资产暂时无法读取，请稍后重试", "DATA_ASSET_READ_FAILED", 500, { cause: error });
  }
}

export async function listDataSnapshots(assetId: string): Promise<PublicSnapshotSummary[]> {
  try {
    const [asset] = await db
      .select({ status: dataAssets.status })
      .from(dataAssets)
      .where(eq(dataAssets.id, assetId))
      .limit(1);
    if (!asset) throw new DataAssetError("数据资产不存在", "DATA_ASSET_NOT_FOUND");
    if (asset.status !== "ready") return [];

    const snapshots = await db
      .select()
      .from(dataSnapshots)
      .where(eq(dataSnapshots.assetId, assetId))
      .orderBy(desc(dataSnapshots.version));
    return snapshots.map((snapshot) => {
      const publicSnapshot = toPublicSnapshot(snapshot);
      const { schema: _schema, preview: _preview, ...summary } = publicSnapshot;
      void _schema;
      void _preview;
      return summary;
    });
  } catch (error) {
    if (error instanceof DataAssetError) throw error;
    throw new DataAssetError("数据快照暂时无法读取，请稍后重试", "DATA_ASSET_READ_FAILED", 500, { cause: error });
  }
}

export async function getDataSnapshot(assetId: string, snapshotId: string): Promise<PublicSnapshotDetail> {
  try {
    const [asset] = await db
      .select({ status: dataAssets.status })
      .from(dataAssets)
      .where(eq(dataAssets.id, assetId))
      .limit(1);
    if (!asset) throw new DataAssetError("数据资产不存在", "DATA_ASSET_NOT_FOUND");
    if (asset.status !== "ready") {
      throw new DataAssetError("当前 Data Asset 暂无可用预览", "SNAPSHOT_PREVIEW_UNAVAILABLE");
    }

    const [snapshot] = await db
      .select()
      .from(dataSnapshots)
      .where(and(eq(dataSnapshots.assetId, assetId), eq(dataSnapshots.id, snapshotId)))
      .limit(1);
    if (!snapshot) throw new DataAssetError("Data Snapshot 不存在或当前不可见", "SNAPSHOT_NOT_FOUND");
    return toPublicSnapshot(snapshot);
  } catch (error) {
    if (error instanceof DataAssetError) throw error;
    throw new DataAssetError("数据快照暂时无法读取，请稍后重试", "DATA_ASSET_READ_FAILED", 500, { cause: error });
  }
}

export function inferSourceType(name: string, mimeType: string): Exclude<DataSourceType, "pasted"> {
  const extension = name.toLowerCase().split(".").pop();
  if (extension === "csv" || mimeType.includes("csv")) return "csv";
  if (extension === "xlsx" || extension === "xls" || mimeType.includes("spreadsheet")) return "xlsx";
  if (extension === "json" || mimeType.includes("json")) return "json";
  throw new DataAssetError("只支持 CSV、XLSX 和 JSON 文件", "DATA_PARSE_FAILED");
}
