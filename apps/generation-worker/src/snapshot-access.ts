import { MAX_DATA_COLUMNS, MAX_DATA_ROWS, type ColumnProfile, type DataCell, type DataRow } from "@langreport/data-engine";
import { conversationUploadObjectKey } from "@langreport/storage";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SnapshotAccessErrorCode =
  | "SNAPSHOT_RELATION_INVALID"
  | "SNAPSHOT_KEY_INVALID"
  | "SNAPSHOT_OBJECT_NOT_FOUND"
  | "SNAPSHOT_PAYLOAD_INVALID"
  | "SNAPSHOT_READ_FAILED";

export class SnapshotAccessError extends Error {
  constructor(
    public readonly code: SnapshotAccessErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "SnapshotAccessError";
  }
}

export type SnapshotAccessInput = {
  job: {
    projectId: string;
    conversationId: string;
    dataAssetId: string;
    snapshotId: string;
  };
  asset: {
    id: string;
    projectId: string;
    sourceConversationId: string | null;
  };
  snapshot: {
    id: string;
    assetId: string;
    rowCount: number;
    columnCount: number;
    schema: unknown;
    normalizedObjectKey: string;
  };
  workspaceId: string;
  readSnapshot: (key: string) => Promise<Buffer>;
};

/**
 * The only data shape that crosses from object storage into the generation
 * workflow. Storage keys, raw bytes and JSON parsing remain inside this
 * module.
 */
export type FrozenSnapshotInput = {
  snapshotId: string;
  assetId: string;
  projectId: string;
  rows: DataRow[];
  profiles: ColumnProfile[];
};

export async function loadFrozenSnapshot(input: SnapshotAccessInput): Promise<FrozenSnapshotInput> {
  assertRelations(input);

  const expectedObjectKey = conversationUploadObjectKey({
    workspaceId: input.workspaceId,
    projectId: input.job.projectId,
    conversationId: input.asset.sourceConversationId as string,
    assetId: input.asset.id,
    kind: "normalized",
    filename: `${input.snapshot.id}.json`
  });

  if (input.snapshot.normalizedObjectKey !== expectedObjectKey) {
    throw new SnapshotAccessError("SNAPSHOT_KEY_INVALID", "Data Snapshot 使用了非当前 Conversation-scoped 路径");
  }

  let body: Buffer;
  try {
    body = await input.readSnapshot(expectedObjectKey);
  } catch (error) {
    if (isMissingObjectError(error)) {
      throw new SnapshotAccessError("SNAPSHOT_OBJECT_NOT_FOUND", "Data Snapshot 对象不存在", { cause: error });
    }
    throw new SnapshotAccessError("SNAPSHOT_READ_FAILED", "Data Snapshot 读取失败", { cause: error });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch (error) {
    throw new SnapshotAccessError("SNAPSHOT_PAYLOAD_INVALID", "Data Snapshot 内容不是有效 JSON", { cause: error });
  }

  const parsed = parseSnapshotPayload(payload, input.snapshot.schema, input.snapshot.rowCount, input.snapshot.columnCount);
  if (!parsed) {
    throw new SnapshotAccessError("SNAPSHOT_PAYLOAD_INVALID", "Data Snapshot 内容不符合已固化的结构");
  }

  return {
    snapshotId: input.snapshot.id,
    assetId: input.asset.id,
    projectId: input.job.projectId,
    rows: parsed.rows,
    profiles: parsed.profiles
  };
}

function assertRelations(input: SnapshotAccessInput): void {
  if (
    input.job.dataAssetId !== input.asset.id
    || input.job.snapshotId !== input.snapshot.id
    || input.snapshot.assetId !== input.asset.id
    || input.asset.projectId !== input.job.projectId
  ) {
    throw new SnapshotAccessError("SNAPSHOT_RELATION_INVALID", "Generation Job、Data Asset 与 Data Snapshot 关系不一致");
  }

  if (!input.asset.sourceConversationId || !UUID_PATTERN.test(input.asset.sourceConversationId)) {
    throw new SnapshotAccessError("SNAPSHOT_RELATION_INVALID", "Data Asset 缺少有效的来源 Conversation");
  }
}

function parseSnapshotPayload(payload: unknown, schema: unknown, expectedRowCount: number, expectedColumnCount: number): { rows: DataRow[]; profiles: ColumnProfile[] } | null {
  if (!isRecord(payload) || !Array.isArray(payload.columns) || !Array.isArray(payload.rows)) return null;
  if (
    payload.columns.length === 0
    || payload.columns.length > MAX_DATA_COLUMNS
    || !payload.columns.every((column): column is string => typeof column === "string" && column.trim().length > 0)
    || new Set(payload.columns).size !== payload.columns.length
    || payload.rows.length > MAX_DATA_ROWS
    || payload.rows.length !== expectedRowCount
    || payload.columns.length !== expectedColumnCount
  ) return null;

  const columns = payload.columns;
  const rows: DataRow[] = [];
  for (const value of payload.rows) {
    if (!isRecord(value) || Object.keys(value).length !== columns.length) return null;
    if (!columns.every((column) => Object.prototype.hasOwnProperty.call(value, column))) return null;
    const row: DataRow = {};
    for (const column of columns) {
      const cell = value[column];
      if (!isDataCell(cell)) return null;
      row[column] = cell;
    }
    rows.push(row);
  }

  const profiles = parseProfiles(schema);
  if (!profiles || profiles.length !== columns.length || profiles.some((profile, index) => profile.name !== columns[index])) return null;
  return { rows, profiles };
}

function parseProfiles(value: unknown): ColumnProfile[] | null {
  if (!Array.isArray(value) || value.length > MAX_DATA_COLUMNS) return null;
  const profiles: ColumnProfile[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const inferredType = item.inferredType;
    if (
      typeof item.name !== "string"
      || item.name.trim().length === 0
      || (inferredType !== "string" && inferredType !== "number" && inferredType !== "boolean" && inferredType !== "date" && inferredType !== "null")
      || !isNonnegativeInteger(item.nullCount)
      || !isNonnegativeInteger(item.distinctCount)
      || !Array.isArray(item.sampleValues)
      || !item.sampleValues.every(isDataCell)
    ) return null;
    profiles.push({
      name: item.name,
      inferredType,
      nullCount: item.nullCount,
      distinctCount: item.distinctCount,
      sampleValues: item.sampleValues
    });
  }
  return profiles;
}

function isDataCell(value: unknown): value is DataCell {
  return value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingObjectError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const name = typeof error.name === "string" ? error.name : "";
  const code = typeof error.code === "string" ? error.code : "";
  const metadata = isRecord(error.$metadata) ? error.$metadata : undefined;
  return name === "NoSuchKey"
    || name === "NotFound"
    || code === "NoSuchKey"
    || code === "NotFound"
    || metadata?.httpStatusCode === 404
    || (error instanceof Error && error.message.includes("对象不存在"));
}
