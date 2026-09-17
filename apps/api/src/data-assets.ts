import { and, desc, eq } from "drizzle-orm";
import {
  auditEvents,
  conversations,
  dataAssetSourceType,
  dataAssets,
  dataSnapshots,
  db,
  projects
} from "@langreport/db";
import {
  DataParseError,
  parseData,
  type DataSourceType,
  type ParsedTable
} from "@langreport/data-engine";
import {
  conversationUploadObjectKey,
  deleteObject as deleteStorageObject,
  putObject as putStorageObject,
  snapshotSourceObjectKey
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
  | "SOURCE_OBJECT_WRITE_FAILED"
  | "SNAPSHOT_OBJECT_WRITE_FAILED"
  | "SNAPSHOT_PERSIST_FAILED"
  | "DATA_ASSET_CLEANUP_FAILED";

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
  "SOURCE_OBJECT_WRITE_FAILED",
  "SNAPSHOT_OBJECT_WRITE_FAILED",
  "SNAPSHOT_PERSIST_FAILED",
  "DATA_ASSET_CLEANUP_FAILED"
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
  SOURCE_OBJECT_WRITE_FAILED: 503,
  SNAPSHOT_OBJECT_WRITE_FAILED: 503,
  SNAPSHOT_PERSIST_FAILED: 500,
  DATA_ASSET_CLEANUP_FAILED: 500
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
  latestSnapshot: Omit<typeof dataSnapshots.$inferSelect, "sourceObjectKey" | "normalizedObjectKey"> | null;
};

export function toPublicDataAsset(
  asset: typeof dataAssets.$inferSelect,
  latestSnapshot: typeof dataSnapshots.$inferSelect | null,
  sourceConversationDeleted = false
): PublicDataAsset {
  if (!latestSnapshot) return { ...asset, sourceConversationDeleted, latestSnapshot: null };
  const { sourceObjectKey: _sourceObjectKey, normalizedObjectKey: _normalizedObjectKey, ...publicSnapshot } = latestSnapshot;
  return { ...asset, sourceConversationDeleted, latestSnapshot: publicSnapshot };
}

export type DataAssetIntakeCommand = {
  projectId: string;
  sourceConversationId: string;
  createdBy: string;
  requestId?: string;
  target?: { assetId: string };
  source: {
    name: string;
    sourceType: DataSourceType;
    mimeType: string;
    bytes: Buffer;
  };
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
  sourceObjectKey: string;
  normalizedObjectKey: string;
  assetMetadata: {
    name: string;
    sourceType: typeof dataAssetSourceType.enumValues[number];
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
  repository?: IntakeRepository;
  storage?: {
    putObject: typeof putStorageObject;
    deleteObject: typeof deleteStorageObject;
  };
  recordCleanupFailure?: (input: IntakeAuditInput) => Promise<void>;
  createId?: () => string;
};

const productionRepository: IntakeRepository = {
  async findProject(projectId) {
    const [project] = await db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return project;
  },

  async hasConversationInProject(projectId, conversationId) {
    const [conversation] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(
        eq(conversations.id, conversationId),
        eq(conversations.projectId, projectId)
      ))
      .limit(1);
    return Boolean(conversation);
  },

  async findAssetForUpdate(projectId, assetId) {
    const [asset] = await db
      .select()
      .from(dataAssets)
      .where(and(eq(dataAssets.id, assetId), eq(dataAssets.projectId, projectId)))
      .limit(1);
    return asset;
  },

  async insertProcessingAsset(asset) {
    await db.insert(dataAssets).values(asset);
  },

  async persistSnapshotAndReady(input) {
    return db.transaction(async (transaction) => {
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

      const [snapshot] = await transaction.insert(dataSnapshots).values({
        id: input.snapshotId,
        assetId: input.assetId,
        version,
        rowCount: input.rowCount,
        columnCount: input.columnCount,
        schema: input.schema,
        preview: input.preview,
        sourceObjectKey: input.sourceObjectKey,
        normalizedObjectKey: input.normalizedObjectKey
      }).returning();
      if (!snapshot) throw new Error("Snapshot 元数据保存失败");

      const [asset] = await transaction
        .update(dataAssets)
        .set({
          ...input.assetMetadata,
          status: "ready",
          errorCode: null,
          errorMessage: null
        })
        .where(eq(dataAssets.id, input.assetId))
        .returning();
      if (!asset) throw new Error("Data Asset 状态保存失败");

      return { asset, snapshot };
    });
  },

  async markFailed(assetId, code, message) {
    await db
      .update(dataAssets)
      .set({ status: "failed", errorCode: code, errorMessage: message })
      .where(eq(dataAssets.id, assetId));
  }
};

const productionStorage = {
  putObject: putStorageObject,
  deleteObject: deleteStorageObject
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
      cleanupCode: "DATA_ASSET_CLEANUP_FAILED"
    },
    requestId: input.requestId
  });
}

function safeName(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, "_") || "data.csv";
}

function intakeError(code: DataAssetErrorCode, message: string, options?: ErrorOptions): DataAssetError {
  return new DataAssetError(code, message, undefined, options);
}

function parseFailure(error: unknown): DataAssetError {
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

export function createDataAssetIntake(dependencies: IntakeDependencies = {}) {
  const repository = dependencies.repository ?? productionRepository;
  const storage = dependencies.storage ?? productionStorage;
  const createId = dependencies.createId ?? (() => crypto.randomUUID());
  const writeCleanupAudit = dependencies.recordCleanupFailure ?? recordCleanupFailure;

  return {
    async ingest(command: DataAssetIntakeCommand): Promise<PublicDataAsset> {
      const bytes = command.source.bytes;
      if (bytes.byteLength > MAX_DATA_ASSET_BYTES) {
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
        filename: normalizedName
      });
      const normalizedObjectKey = conversationUploadObjectKey({
        workspaceId: project.workspaceId,
        projectId: command.projectId,
        conversationId: keyConversationId,
        assetId,
        kind: "normalized",
        filename: `${snapshotId}.json`
      });

      if (!targetAsset) {
        try {
          await repository.insertProcessingAsset({
            id: assetId,
            projectId: command.projectId,
            sourceConversationId: command.sourceConversationId,
            name: command.source.name.trim() || normalizedName,
            sourceType: command.source.sourceType as typeof dataAssetSourceType.enumValues[number],
            mimeType,
            sizeBytes: bytes.byteLength,
            status: "processing",
            errorCode: null,
            errorMessage: null,
            createdBy: command.createdBy
          });
        } catch (error) {
          throw persistenceFailure(error);
        }
      }

      let parsed: ParsedTable;
      let sourceWritten = false;
      let normalizedWritten = false;
      let failure: DataAssetError | undefined;
      try {
        try {
          parsed = parseData({ sourceType: command.source.sourceType, bytes });
        } catch (error) {
          throw parseFailure(error);
        }

        try {
          // A successful provider-side write followed by a lost response is
          // still a possible orphan, so mark the object for compensation
          // before awaiting the adapter.
          sourceWritten = true;
          await storage.putObject({ key: sourceObjectKey, body: bytes, contentType: mimeType });
        } catch (error) {
          throw intakeError("SOURCE_OBJECT_WRITE_FAILED", "原始数据暂时无法保存，请稍后重试", { cause: error });
        }

        try {
          normalizedWritten = true;
          await storage.putObject({
            key: normalizedObjectKey,
            body: JSON.stringify({ columns: parsed.columns, rows: parsed.rows }),
            contentType: "application/json"
          });
        } catch (error) {
          throw intakeError("SNAPSHOT_OBJECT_WRITE_FAILED", "Data Snapshot 暂时无法保存，请稍后重试", { cause: error });
        }

        let persisted: SnapshotPersistenceResult;
        try {
          persisted = await repository.persistSnapshotAndReady({
            assetId,
            snapshotId,
            rowCount: parsed.rows.length,
            columnCount: parsed.columns.length,
            schema: parsed.profiles,
            preview: parsed.preview,
            sourceObjectKey,
            assetMetadata: {
              name: command.source.name.trim() || normalizedName,
              sourceType: command.source.sourceType as typeof dataAssetSourceType.enumValues[number],
              mimeType,
              sizeBytes: bytes.byteLength
            },
            normalizedObjectKey
          });
        } catch (error) {
          throw persistenceFailure(error);
        }

        return toPublicDataAsset(persisted.asset, persisted.snapshot, false);
      } catch (error) {
        failure = asIntakeError(error);
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
          writeCleanupAudit
        });
        if (!targetAsset) {
          try {
            await repository.markFailed(assetId, failure.code, failure.message);
          } catch {
            // The original stable failure remains the externally meaningful error.
            // A later cleanup/reconciliation process can inspect the processing row.
          }
        }
        throw failure;
      }
    }
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
    { kind: "source", key: input.sourceObjectKey, written: input.sourceWritten }
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
          failureCode: input.failureCode
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

export async function listDataAssets(projectId: string): Promise<PublicDataAsset[]> {
  try {
    const assets = await db
      .select({ asset: dataAssets, sourceConversationId: conversations.id })
      .from(dataAssets)
      .leftJoin(conversations, eq(conversations.id, dataAssets.sourceConversationId))
      .where(eq(dataAssets.projectId, projectId))
      .orderBy(desc(dataAssets.createdAt));

    return Promise.all(assets.map(async ({ asset, sourceConversationId }) => {
      const [latestSnapshot] = await db
        .select()
        .from(dataSnapshots)
        .where(eq(dataSnapshots.assetId, asset.id))
        .orderBy(desc(dataSnapshots.version))
        .limit(1);
      return toPublicDataAsset(asset, latestSnapshot ?? null, sourceConversationId === null);
    }));
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

export function inferSourceType(name: string, mimeType: string): Exclude<DataSourceType, "pasted"> {
  const extension = name.toLowerCase().split(".").pop();
  if (extension === "csv" || mimeType.includes("csv")) return "csv";
  if (extension === "xlsx" || extension === "xls" || mimeType.includes("spreadsheet")) return "xlsx";
  if (extension === "json" || mimeType.includes("json")) return "json";
  throw new DataAssetError("只支持 CSV、XLSX 和 JSON 文件", "DATA_PARSE_FAILED");
}
