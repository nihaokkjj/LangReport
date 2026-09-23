import assert from "node:assert/strict";
import test from "node:test";
import { fetchPluginSnapshot, parsePluginSnapshot } from "../../features/evidence/use-plugin-trace";

const validSnapshot = {
  version: "v1",
  flintAdapterVersion: "1.0.0",
  renderer: { id: "vega-lite", version: "5.16.0" },
  themeRef: { pluginId: "builtin-consulting", version: "1.0.0" },
  plugins: [{
    pluginId: "builtin-consulting",
    version: "1.0.0",
    contentHash: `sha256:${"a".repeat(64)}`,
    capabilities: { themes: ["consulting-neutral"] }
  }]
};

test("Plugin Snapshot parser preserves empty, valid, and invalid trace states", () => {
  assert.deepEqual(parsePluginSnapshot(null), { status: "empty" });
  assert.equal(parsePluginSnapshot(validSnapshot).status, "ready");
  assert.deepEqual(parsePluginSnapshot({ ...validSnapshot, renderer: { id: "vega-lite" } }), {
    status: "invalid",
    message: "插件快照缺少可验证的版本、Renderer 或插件列表。"
  });
  assert.deepEqual(parsePluginSnapshot({ ...validSnapshot, plugins: [{ ...validSnapshot.plugins[0], contentHash: "sha256:not-a-hash" }] }), {
    status: "invalid",
    message: "插件快照中的来源哈希或能力结构无法验证。"
  });
});

test("Plugin Snapshot fetcher uses the shared request policy and forwards AbortSignal", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const requests: Array<{ url: string; signal?: AbortSignal | null; credentials?: RequestCredentials; cache?: RequestCache }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), signal: init?.signal, credentials: init?.credentials, cache: init?.cache });
    return new Response(JSON.stringify({ pluginSnapshot: validSnapshot }), { status: 200 });
  };
  try {
    const state = await fetchPluginSnapshot("revision-1", { signal: controller.signal });
    assert.equal(state.status, "ready");
    assert.equal(requests[0]?.url, "/api/v1/chart-revisions/revision-1/plugin-context");
    assert.equal(requests[0]?.signal, controller.signal);
    assert.equal(requests[0]?.credentials, "include");
    assert.equal(requests[0]?.cache, "no-store");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
