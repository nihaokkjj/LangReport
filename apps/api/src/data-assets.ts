import { desc, eq } from "drizzle-orm";
import {
  dataAssetSourceType,
  dataAssets,
  dataSnapshots,
  db,
  projects
} from "@langreport/db";
import {
  DataParseError,
  parseData,
  type DataSourceType
} from "@langreport/data-engine";
import { putObject, storageObjectKey } from "@langreport/storage";

const MAX_DATA_BYTES = 50 * 1024 * 1024;

export class DataAssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataAssetError";
  }
}

export type IngestDataAssetInput = {
  projectId: string;
  createdBy: string;
  name: string;
  sourceType: DataSourceType;
  mimeType: string;
  bytes: Buffer;
};

export async function ingestDataAsset(input: IngestDataAssetInput) {
  if (input.bytes.byteLength > MAX_DATA_BYTES) {
    throw new DataAssetError("文件不能超过 50 MB");
  }

  const [project] = await db
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);

  if (!project) throw new DataAssetError("项目不存在");

  const assetId = crypto.randomUUID();
  const safeName = input.name.trim().replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, "_") || "data.csv";
  const sourceObjectKey = storageObjectKey({
    workspaceId: project.workspaceId,
    projectId: input.projectId,
    assetId,
    kind: "source",
    filename: safeName
  });
  const normalizedObjectKey = storageObjectKey({
    workspaceId: project.workspaceId,
    projectId: input.projectId,
    assetId,
    kind: "normalized",
    filename: "snapshot.json"
  });

  await db.insert(dataAssets).values({
    id: assetId,
    projectId: input.projectId,
    name: input.name.trim() || safeName,
    sourceType: input.sourceType as typeof dataAssetSourceType.enumValues[number],
    mimeType: input.mimeType || "application/octet-stream",
    sizeBytes: input.bytes.byteLength,
    objectKey: sourceObjectKey,
    status: "processing",
    createdBy: input.createdBy
  });

  try {
    const parsed = parseData({ sourceType: input.sourceType, bytes: input.bytes });

    await putObject({
      key: sourceObjectKey,
      body: input.bytes,
      contentType: input.mimeType || "application/octet-stream"
    });

    await putObject({
      key: normalizedObjectKey,
      body: JSON.stringify({ columns: parsed.columns, rows: parsed.rows }),
      contentType: "application/json"
    });

    const [latestSnapshot] = await db
      .select({ version: dataSnapshots.version })
      .from(dataSnapshots)
      .where(eq(dataSnapshots.assetId, assetId))
      .orderBy(desc(dataSnapshots.version))
      .limit(1);
    const version = (latestSnapshot?.version ?? 0) + 1;

    await db.insert(dataSnapshots).values({
      id: crypto.randomUUID(),
      assetId,
      version,
      rowCount: parsed.rows.length,
      columnCount: parsed.columns.length,
      schema: parsed.profiles,
      preview: parsed.preview,
      normalizedObjectKey
    });

    await db
      .update(dataAssets)
      .set({ status: "ready", errorMessage: null })
      .where(eq(dataAssets.id, assetId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "数据处理失败";
    await db
      .update(dataAssets)
      .set({ status: "failed", errorMessage: message })
      .where(eq(dataAssets.id, assetId));
    if (error instanceof DataParseError) throw error;
    throw new DataAssetError(message);
  }

  return getDataAsset(assetId);
}

export async function listDataAssets(projectId: string) {
  const assets = await db
    .select()
    .from(dataAssets)
    .where(eq(dataAssets.projectId, projectId))
    .orderBy(desc(dataAssets.createdAt));

  return Promise.all(assets.map((asset) => getDataAsset(asset.id)));
}

export async function getDataAsset(assetId: string) {
  const [asset] = await db
    .select()
    .from(dataAssets)
    .where(eq(dataAssets.id, assetId))
    .limit(1);
  if (!asset) throw new DataAssetError("数据资产不存在");

  const [latestSnapshot] = await db
    .select()
    .from(dataSnapshots)
    .where(eq(dataSnapshots.assetId, assetId))
    .orderBy(desc(dataSnapshots.version))
    .limit(1);

  return {
    ...asset,
    latestSnapshot: latestSnapshot ?? null
  };
}

export function inferSourceType(name: string, mimeType: string): Exclude<DataSourceType, "pasted"> {
  const extension = name.toLowerCase().split(".").pop();
  if (extension === "csv" || mimeType.includes("csv")) return "csv";
  if (extension === "xlsx" || extension === "xls" || mimeType.includes("spreadsheet")) return "xlsx";
  if (extension === "json" || mimeType.includes("json")) return "json";
  throw new DataAssetError("只支持 CSV、XLSX 和 JSON 文件");
}
