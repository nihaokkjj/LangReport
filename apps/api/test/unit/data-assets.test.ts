import assert from "node:assert/strict";
import test from "node:test";
import { dataAssets, dataSnapshots } from "@langreport/db";
import {
  createDataAssetIntake,
  DataAssetError,
  MAX_DATA_ASSET_BYTES,
  toPublicDataAsset,
  type DataAssetIntakeCommand,
  type IntakeDependencies,
  type IntakeRepository
} from "../../src/data-assets.js";
import { conversationUploadObjectKey, snapshotSourceObjectKey } from "@langreport/storage";

test("public data asset DTO omits storage object keys and reports source status", () => {
  const asset = {
    id: "asset-1",
    projectId: "project-1",
    sourceConversationId: "00000000-0000-4000-8000-000000000001",
    name: "sales.csv",
    sourceType: "csv" as const,
    mimeType: "text/csv",
    sizeBytes: 12,
    status: "ready" as const,
    errorCode: null,
    errorMessage: null,
    createdBy: "user-1",
    createdAt: new Date("2026-09-03T00:00:00.000Z")
  };
  const snapshot = {
    id: "snapshot-1",
    assetId: "asset-1",
    version: 1,
    rowCount: 1,
    columnCount: 1,
    schema: [],
    preview: [],
    sourceObjectKey: "private/source-key",
    normalizedObjectKey: "private/normalized-key",
    createdAt: new Date("2026-09-03T00:00:00.000Z")
  };

  const result = toPublicDataAsset(asset, snapshot, true);
  assert.equal("objectKey" in result, false);
  assert.equal("sourceObjectKey" in (result.latestSnapshot ?? {}), false);
  assert.equal("normalizedObjectKey" in (result.latestSnapshot ?? {}), false);
  assert.equal(result.sourceConversationId, "00000000-0000-4000-8000-000000000001");
  assert.equal(result.sourceConversationDeleted, true);
  assert.equal(result.latestSnapshot?.id, "snapshot-1");
});

test("conversation uploads use an isolated, snapshot-addressable object path", () => {
  assert.equal(
    conversationUploadObjectKey({
      workspaceId: "workspace-1",
      projectId: "project-1",
      conversationId: "conversation-1",
      assetId: "asset-1",
      kind: "normalized",
      filename: "snapshot-1.json"
    }),
    "workspaces/workspace-1/projects/project-1/conversations/conversation-1/user-data/uploads/asset-1/snapshots/snapshot-1.json"
  );
  assert.equal(
    snapshotSourceObjectKey({
      workspaceId: "workspace-1",
      projectId: "project-1",
      conversationId: "conversation-1",
      assetId: "asset-1",
      snapshotId: "snapshot-1",
      filename: "sales v2.csv"
    }),
    "workspaces/workspace-1/projects/project-1/conversations/conversation-1/user-data/uploads/asset-1/snapshots/snapshot-1/source/sales_v2.csv"
  );
});

type Asset = typeof dataAssets.$inferSelect;
type Snapshot = typeof dataSnapshots.$inferSelect;

function createRepository(options: { persistError?: Error } = {}): {
  repository: IntakeRepository;
  assets: Map<string, Asset>;
  snapshots: Map<string, Snapshot>;
} {
  const assets = new Map<string, Asset>();
  const snapshots = new Map<string, Snapshot>();
  const repository: IntakeRepository = {
    findProject: async () => ({ workspaceId: "workspace-1" }),
    hasConversationInProject: async () => true,
    findAssetForUpdate: async (_projectId, assetId) => assets.get(assetId),
    insertProcessingAsset: async (input) => {
      if (!input.id) throw new Error("asset id missing");
      assets.set(input.id, {
        id: input.id,
        projectId: input.projectId as string,
        sourceConversationId: input.sourceConversationId as string,
        name: input.name as string,
        sourceType: input.sourceType as Asset["sourceType"],
        mimeType: input.mimeType as string,
        sizeBytes: input.sizeBytes as number,
        status: "processing",
        errorCode: null,
        errorMessage: null,
        createdBy: input.createdBy as string,
        createdAt: new Date("2026-09-16T00:00:00.000Z")
      });
    },
    persistSnapshotAndReady: async (input) => {
      if (options.persistError) throw options.persistError;
      const asset = assets.get(input.assetId);
      if (!asset) throw new Error("asset missing");
      const latestVersion = Math.max(0, ...[...snapshots.values()]
        .filter((snapshot) => snapshot.assetId === input.assetId)
        .map((snapshot) => snapshot.version));
      const snapshot: Snapshot = {
        id: input.snapshotId,
        assetId: input.assetId,
        version: latestVersion + 1,
        rowCount: input.rowCount,
        columnCount: input.columnCount,
        schema: input.schema,
        preview: input.preview,
        sourceObjectKey: input.sourceObjectKey,
        normalizedObjectKey: input.normalizedObjectKey,
        createdAt: new Date("2026-09-16T00:00:00.000Z")
      };
      snapshots.set(snapshot.id, snapshot);
      asset.status = "ready";
      asset.name = input.assetMetadata.name;
      asset.sourceType = input.assetMetadata.sourceType;
      asset.mimeType = input.assetMetadata.mimeType;
      asset.sizeBytes = input.assetMetadata.sizeBytes;
      asset.errorCode = null;
      asset.errorMessage = null;
      return { asset, snapshot };
    },
    markFailed: async (assetId, code, message) => {
      const asset = assets.get(assetId);
      if (!asset) throw new Error("asset missing");
      asset.status = "failed";
      asset.errorCode = code;
      asset.errorMessage = message;
    }
  };
  return { repository, assets, snapshots };
}

function createStorage(options: { failPutAt?: number; failDeletes?: boolean } = {}) {
  const objects = new Map<string, Buffer | string>();
  const deletedKeys: string[] = [];
  let putCount = 0;
  const storage: NonNullable<IntakeDependencies["storage"]> = {
    putObject: async (input) => {
      putCount += 1;
      if (putCount === options.failPutAt) throw new Error(`provider failed for ${input.key}`);
      objects.set(input.key, typeof input.body === "string" ? input.body : Buffer.from(input.body));
    },
    deleteObject: async (key) => {
      deletedKeys.push(key);
      if (options.failDeletes) throw new Error(`delete failed for ${key}`);
      objects.delete(key);
    }
  };
  return { storage, objects, deletedKeys };
}

function command(overrides: Partial<DataAssetIntakeCommand["source"]> = {}): DataAssetIntakeCommand {
  return {
    projectId: "project-1",
    sourceConversationId: "00000000-0000-4000-8000-000000000001",
    createdBy: "user-1",
    requestId: "request-1",
    source: {
      name: "sales.csv",
      sourceType: "csv",
      mimeType: "text/csv",
      bytes: Buffer.from("month,sales\n2026-01,100\n", "utf8"),
      ...overrides
    }
  };
}

function fixedIds(values = [
    "00000000-0000-4000-8000-000000000010",
    "00000000-0000-4000-8000-000000000011"
  ]): () => string {
  const ids = [...values];
  return () => {
    const id = ids.shift();
    if (!id) throw new Error("unexpected id request");
    return id;
  };
}

test("intake validates the source relation before creating processing state", async () => {
  const fixture = createRepository();
  fixture.repository.hasConversationInProject = async () => false;
  const storage = createStorage();
  const intake = createDataAssetIntake({ repository: fixture.repository, storage: storage.storage, createId: fixedIds() });

  await assert.rejects(() => intake.ingest(command()), (error: unknown) => {
    assert.ok(error instanceof DataAssetError);
    assert.equal(error.code, "SOURCE_CONVERSATION_INVALID");
    assert.equal(error.statusCode, 400);
    return true;
  });
  assert.equal(fixture.assets.size, 0);
  assert.equal(storage.objects.size, 0);
});

test("intake writes both objects and commits one ready snapshot", async () => {
  const fixture = createRepository();
  const storage = createStorage();
  const asset = await createDataAssetIntake({ repository: fixture.repository, storage: storage.storage, createId: fixedIds() }).ingest(command());

  assert.equal(asset.status, "ready");
  assert.equal(asset.sourceConversationDeleted, false);
  assert.equal(asset.latestSnapshot?.version, 1);
  assert.equal(fixture.assets.get(asset.id)?.status, "ready");
  assert.equal(fixture.snapshots.size, 1);
  assert.equal(storage.objects.size, 2);
  assert.equal("objectKey" in asset, false);
  assert.equal("normalizedObjectKey" in (asset.latestSnapshot ?? {}), false);
});

test("intake updates one asset by appending a new snapshot and preserving v1", async () => {
  const fixture = createRepository();
  const storage = createStorage();
  const intake = createDataAssetIntake({ repository: fixture.repository, storage: storage.storage, createId: fixedIds() });
  const first = await intake.ingest(command());
  const firstSnapshot = fixture.snapshots.get(first.latestSnapshot?.id ?? "");

  const second = await createDataAssetIntake({
    repository: fixture.repository,
    storage: storage.storage,
    createId: fixedIds(["00000000-0000-4000-8000-000000000012"])
  }).ingest({
    ...command({
      name: "sales-v2.csv",
      bytes: Buffer.from("month,sales\n2026-01,120\n2026-02,150\n", "utf8")
    }),
    target: { assetId: first.id }
  });

  assert.equal(second.id, first.id);
  assert.equal(second.latestSnapshot?.version, 2);
  assert.equal(fixture.snapshots.size, 2);
  assert.equal(firstSnapshot?.version, 1);
  const secondSnapshot = fixture.snapshots.get(second.latestSnapshot?.id ?? "");
  assert.equal(secondSnapshot?.version, 2);
  assert.notEqual(firstSnapshot?.sourceObjectKey, secondSnapshot?.sourceObjectKey);
  assert.match(secondSnapshot?.sourceObjectKey ?? "", new RegExp(`/snapshots/${secondSnapshot?.id}/source/`));
  assert.equal(storage.objects.size, 4);
});

test("failed updates clean up only new objects and preserve the ready asset", async () => {
  const fixture = createRepository();
  const storage = createStorage();
  const intake = createDataAssetIntake({ repository: fixture.repository, storage: storage.storage, createId: fixedIds() });
  const first = await intake.ingest(command());
  const firstSnapshotId = first.latestSnapshot?.id;

  const updateIntake = createDataAssetIntake({
    repository: fixture.repository,
    storage: storage.storage,
    createId: fixedIds(["00000000-0000-4000-8000-000000000012"])
  });
  storage.storage.putObject = async (input) => {
    if (input.key.includes("/snapshots/00000000-0000-4000-8000-000000000012/source/")) throw new Error("source provider failed");
    throw new Error("unexpected object write");
  };

  await assert.rejects(() => updateIntake.ingest({
    ...command({ name: "sales-v2.csv" }),
    target: { assetId: first.id }
  }), (error: unknown) => error instanceof DataAssetError && error.code === "SOURCE_OBJECT_WRITE_FAILED");

  assert.equal(fixture.assets.get(first.id)?.status, "ready");
  assert.equal(fixture.assets.get(first.id)?.errorCode, null);
  assert.equal(fixture.snapshots.size, 1);
  assert.equal(fixture.snapshots.has(firstSnapshotId ?? ""), true);
  assert.equal(storage.objects.size, 2);
});

test("source object failure persists a typed failure without creating a snapshot", async () => {
  const fixture = createRepository();
  const storage = createStorage({ failPutAt: 1 });
  const intake = createDataAssetIntake({ repository: fixture.repository, storage: storage.storage, createId: fixedIds() });

  await assert.rejects(() => intake.ingest(command()), (error: unknown) => {
    assert.ok(error instanceof DataAssetError);
    assert.equal(error.code, "SOURCE_OBJECT_WRITE_FAILED");
    assert.equal(error.statusCode, 503);
    return true;
  });
  const failed = [...fixture.assets.values()][0];
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.errorCode, "SOURCE_OBJECT_WRITE_FAILED");
  assert.equal(fixture.snapshots.size, 0);
  assert.equal(storage.deletedKeys.length, 1);
  assert.equal(storage.objects.size, 0);
});

test("normalized object failure compensates the source object and persists a typed failure", async () => {
  const fixture = createRepository();
  const storage = createStorage({ failPutAt: 2 });
  const intake = createDataAssetIntake({ repository: fixture.repository, storage: storage.storage, createId: fixedIds() });

  await assert.rejects(() => intake.ingest(command()), (error: unknown) => {
    assert.ok(error instanceof DataAssetError);
    assert.equal(error.code, "SNAPSHOT_OBJECT_WRITE_FAILED");
    assert.equal(error.statusCode, 503);
    assert.doesNotMatch(error.message, /provider|00000000/);
    return true;
  });
  const failed = [...fixture.assets.values()][0];
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.errorCode, "SNAPSHOT_OBJECT_WRITE_FAILED");
  assert.equal(storage.deletedKeys.length, 2);
  assert.equal(storage.objects.size, 0);
});

test("snapshot persistence failure compensates both objects and never reaches ready", async () => {
  const fixture = createRepository({ persistError: new Error("database failed with provider key") });
  const storage = createStorage();
  const intake = createDataAssetIntake({ repository: fixture.repository, storage: storage.storage, createId: fixedIds() });

  await assert.rejects(() => intake.ingest(command()), (error: unknown) => {
    assert.ok(error instanceof DataAssetError);
    assert.equal(error.code, "SNAPSHOT_PERSIST_FAILED");
    assert.equal(error.statusCode, 500);
    assert.doesNotMatch(error.message, /database|provider|key/);
    return true;
  });
  const failed = [...fixture.assets.values()][0];
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.errorCode, "SNAPSHOT_PERSIST_FAILED");
  assert.equal(fixture.snapshots.size, 0);
  assert.equal(storage.deletedKeys.length, 2);
  assert.equal(storage.objects.size, 0);
});

test("cleanup failures are audited without replacing the original storage error", async () => {
  const fixture = createRepository();
  const storage = createStorage({ failPutAt: 2, failDeletes: true });
  const cleanupFailures: unknown[] = [];
  const intake = createDataAssetIntake({
    repository: fixture.repository,
    storage: storage.storage,
    createId: fixedIds(),
    recordCleanupFailure: async (event) => {
      cleanupFailures.push(event);
    }
  });

  await assert.rejects(() => intake.ingest(command()), (error: unknown) => error instanceof DataAssetError && error.code === "SNAPSHOT_OBJECT_WRITE_FAILED");
  assert.equal(cleanupFailures.length, 2);
  assert.deepEqual(
    cleanupFailures.map((failure) => (failure as { objectKind: string }).objectKind),
    ["normalized", "source"]
  );
});

test("parse failures become safe 422 errors and leave no objects", async () => {
  const fixture = createRepository();
  const storage = createStorage();
  const intake = createDataAssetIntake({ repository: fixture.repository, storage: storage.storage, createId: fixedIds() });

  await assert.rejects(() => intake.ingest(command({ sourceType: "json", name: "sales.json", mimeType: "application/json", bytes: Buffer.from("not-json") })), (error: unknown) => {
    assert.ok(error instanceof DataAssetError);
    assert.equal(error.code, "DATA_PARSE_FAILED");
    assert.equal(error.statusCode, 422);
    return true;
  });
  const failed = [...fixture.assets.values()][0];
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.errorCode, "DATA_PARSE_FAILED");
  assert.equal(storage.objects.size, 0);
});

test("the module enforces the 50 MB boundary independently of HTTP multipart limits", async () => {
  const fixture = createRepository();
  const storage = createStorage();
  const intake = createDataAssetIntake({ repository: fixture.repository, storage: storage.storage, createId: fixedIds() });

  await assert.rejects(() => intake.ingest(command({ bytes: Buffer.alloc(MAX_DATA_ASSET_BYTES + 1) })), (error: unknown) => {
    assert.ok(error instanceof DataAssetError);
    assert.equal(error.code, "DATA_ASSET_TOO_LARGE");
    assert.equal(error.statusCode, 413);
    return true;
  });
  assert.equal(fixture.assets.size, 0);
});
