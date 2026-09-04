import assert from "node:assert/strict";
import test from "node:test";
import { toPublicDataAsset } from "./data-assets.js";

test("public data asset DTO omits storage object keys", () => {
  const asset = {
    id: "asset-1",
    projectId: "project-1",
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
