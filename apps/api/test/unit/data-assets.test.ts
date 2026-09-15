import assert from "node:assert/strict";
import test from "node:test";
import { toPublicDataAsset } from "../../src/data-assets.js";
import { conversationUploadObjectKey } from "@langreport/storage";

test("public data asset DTO omits storage object keys", () => {
  const asset = {
    id: "asset-1",
    projectId: "project-1",
    sourceConversationId: null,
    name: "sales.csv",
    sourceType: "csv" as const,
    mimeType: "text/csv",
    sizeBytes: 12,
    objectKey: "private/source-key",
    status: "ready" as const,
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
    normalizedObjectKey: "private/normalized-key",
    createdAt: new Date("2026-09-03T00:00:00.000Z")
  };

  const result = toPublicDataAsset(asset, snapshot);
  assert.equal("objectKey" in result, false);
  assert.equal("normalizedObjectKey" in (result.latestSnapshot ?? {}), false);
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
});
