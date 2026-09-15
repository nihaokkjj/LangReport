import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ColumnProfile, DataRow } from "@langreport/data-engine";
import { conversationUploadObjectKey } from "@langreport/storage";
import { loadFrozenSnapshot, SnapshotAccessError, type SnapshotAccessErrorCode, type SnapshotAccessInput } from "../../src/snapshot-access.js";

const workspaceId = randomUUID();
const projectId = randomUUID();
const assetId = randomUUID();
const snapshotId = randomUUID();
const sourceConversationId = randomUUID();
const jobConversationId = randomUUID();

const rows: DataRow[] = [
  { 月份: "2026-01", 销售额: 100 },
  { 月份: "2026-02", 销售额: 130 }
];
const profiles: ColumnProfile[] = [
  { name: "月份", inferredType: "date", nullCount: 0, distinctCount: 2, sampleValues: ["2026-01", "2026-02"] },
  { name: "销售额", inferredType: "number", nullCount: 0, distinctCount: 2, sampleValues: [100, 130] }
];
const normalizedObjectKey = conversationUploadObjectKey({
  workspaceId,
  projectId,
  conversationId: sourceConversationId,
  assetId,
  kind: "normalized",
  filename: `${snapshotId}.json`
});

function baseInput(overrides: Partial<SnapshotAccessInput> = {}): SnapshotAccessInput {
  return {
    job: { projectId, conversationId: jobConversationId, dataAssetId: assetId, snapshotId },
    asset: { id: assetId, projectId, sourceConversationId },
    snapshot: { id: snapshotId, assetId, rowCount: rows.length, columnCount: profiles.length, schema: profiles, normalizedObjectKey },
    workspaceId,
    readSnapshot: async () => Buffer.from(JSON.stringify({ columns: profiles.map((profile) => profile.name), rows })),
    ...overrides
  };
}

async function assertSnapshotError(
  input: SnapshotAccessInput,
  code: SnapshotAccessErrorCode
): Promise<void> {
  await assert.rejects(
    () => loadFrozenSnapshot(input),
    (error: unknown) => error instanceof SnapshotAccessError && error.code === code
  );
}

test("loads a validated structured snapshot without leaking storage details", async () => {
  let requestedKey: string | undefined;
  const result = await loadFrozenSnapshot(baseInput({
    job: { projectId, conversationId: jobConversationId, dataAssetId: assetId, snapshotId },
    readSnapshot: async (key) => {
      requestedKey = key;
      return Buffer.from(JSON.stringify({ columns: ["月份", "销售额"], rows }));
    }
  }));

  assert.deepEqual(result, { snapshotId, assetId, projectId, rows, profiles });
  assert.equal(requestedKey, normalizedObjectKey);
  assert.equal("normalizedObjectKey" in result, false);
});

test("allows a Project-owned asset to be reused by another Conversation", async () => {
  const result = await loadFrozenSnapshot(baseInput({
    job: { projectId, conversationId: jobConversationId, dataAssetId: assetId, snapshotId }
  }));
  assert.equal(result.assetId, assetId);
  assert.notEqual(jobConversationId, sourceConversationId);
});

test("rejects a mismatched snapshot and asset relation before reading", async () => {
  let readCount = 0;
  await assertSnapshotError(baseInput({
    snapshot: { id: snapshotId, assetId: randomUUID(), rowCount: rows.length, columnCount: profiles.length, schema: profiles, normalizedObjectKey },
    readSnapshot: async () => {
      readCount += 1;
      return Buffer.from("{}");
    }
  }), "SNAPSHOT_RELATION_INVALID");
  assert.equal(readCount, 0);
});

test("rejects an asset from another Project before reading", async () => {
  await assertSnapshotError(baseInput({
    asset: { id: assetId, projectId: randomUUID(), sourceConversationId }
  }), "SNAPSHOT_RELATION_INVALID");
});

test("rejects assets without a current Conversation source", async () => {
  await assertSnapshotError(baseInput({
    asset: { id: assetId, projectId, sourceConversationId: null }
  }), "SNAPSHOT_RELATION_INVALID");
});

test("rejects legacy or tampered object keys without a fallback read", async () => {
  let readCount = 0;
  await assertSnapshotError(baseInput({
    snapshot: { id: snapshotId, assetId, rowCount: rows.length, columnCount: profiles.length, schema: profiles, normalizedObjectKey: `projects/${projectId}/snapshot.json` },
    readSnapshot: async () => {
      readCount += 1;
      return Buffer.from("{}");
    }
  }), "SNAPSHOT_KEY_INVALID");
  assert.equal(readCount, 0);
});

test("maps missing objects to an auditable snapshot error", async () => {
  const missing = Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
  await assertSnapshotError(baseInput({ readSnapshot: async () => { throw missing; } }), "SNAPSHOT_OBJECT_NOT_FOUND");
});

test("maps other storage failures to a direct snapshot read failure", async () => {
  await assertSnapshotError(baseInput({ readSnapshot: async () => { throw new Error("network unavailable"); } }), "SNAPSHOT_READ_FAILED");
});

test("rejects malformed snapshot JSON and schema payloads", async () => {
  await assertSnapshotError(baseInput({ readSnapshot: async () => Buffer.from("not-json") }), "SNAPSHOT_PAYLOAD_INVALID");
  await assertSnapshotError(baseInput({ readSnapshot: async () => Buffer.from(JSON.stringify({ columns: ["月份"], rows })) }), "SNAPSHOT_PAYLOAD_INVALID");
  await assertSnapshotError(baseInput({
    snapshot: { id: snapshotId, assetId, rowCount: rows.length + 1, columnCount: profiles.length, schema: profiles, normalizedObjectKey }
  }), "SNAPSHOT_PAYLOAD_INVALID");
});
