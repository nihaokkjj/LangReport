import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchSnapshotDetail,
  fetchSnapshotSummaries,
  initialSnapshotPreviewState,
  sortSnapshotSummaries
} from "../../features/data-snapshot/use-snapshot-preview";

const summary = (id: string, version: number) => ({
  id,
  assetId: "asset-1",
  version,
  rowCount: version * 10,
  columnCount: 3,
  sourceName: "sales.csv",
  sourceType: "csv",
  mimeType: "text/csv",
  sizeBytes: 100,
  createdAt: `2026-09-0${version}T00:00:00.000Z`
});

test("Snapshot summaries sort newest versions first without mutating the response", () => {
  const source = [summary("v1", 1), summary("v3", 3), summary("v2", 2)];
  const sorted = sortSnapshotSummaries(source);
  assert.deepEqual(sorted.map((item) => item.id), ["v3", "v2", "v1"]);
  assert.deepEqual(source.map((item) => item.id), ["v1", "v3", "v2"]);
});

test("Snapshot fetchers unwrap list/detail responses and forward AbortSignal", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const requests: Array<{ url: string; signal?: AbortSignal | null; credentials?: RequestCredentials; cache?: RequestCache }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), signal: init?.signal, credentials: init?.credentials, cache: init?.cache });
    if (String(input).endsWith("/snapshots")) {
      return new Response(JSON.stringify({ snapshots: [summary("v1", 1), summary("v2", 2)] }), { status: 200 });
    }
    return new Response(JSON.stringify({ snapshot: { ...summary("v2", 2), schema: [], preview: [] } }), { status: 200 });
  };
  try {
    const summaries = await fetchSnapshotSummaries("asset-1", { signal: controller.signal });
    const detail = await fetchSnapshotDetail("asset-1", "v2", { signal: controller.signal });
    assert.deepEqual(summaries.map((item) => item.version), [2, 1]);
    assert.equal(detail.id, "v2");
    assert.equal(requests[0]?.url, "/api/v1/data-assets/asset-1/snapshots");
    assert.equal(requests[1]?.url, "/api/v1/data-assets/asset-1/snapshots/v2");
    assert.equal(requests[0]?.signal, controller.signal);
    assert.equal(requests[1]?.signal, controller.signal);
    assert.equal(requests[0]?.credentials, "include");
    assert.equal(requests[0]?.cache, "no-store");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Snapshot preview starts closed and empty", () => {
  assert.deepEqual(initialSnapshotPreviewState, {
    isOpen: false,
    assetId: null,
    summaries: [],
    selectedSnapshotId: null,
    snapshot: null,
    status: "idle",
    error: null
  });
});
