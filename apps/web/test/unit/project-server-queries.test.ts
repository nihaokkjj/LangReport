import assert from "node:assert/strict";
import test from "node:test";
import { conversationQueryKeys, fetchConversationList } from "../../features/conversation/conversation-queries";
import { dataAssetQueryKeys, fetchDataAssetList } from "../../features/data-snapshot/data-asset-queries";
import { evidenceQueryKeys } from "../../features/evidence/evidence-queries";
import { projectResourceQueryKeys } from "../../features/project/project-resource-queries";

test("project server query keys isolate user, project and conversation scope", () => {
  assert.notDeepEqual(conversationQueryKeys.list("user-a", "project-a"), conversationQueryKeys.list("user-b", "project-a"));
  assert.notDeepEqual(conversationQueryKeys.list("user-a", "project-a"), conversationQueryKeys.list("user-a", "project-b"));
  assert.notDeepEqual(conversationQueryKeys.messages("user-a", "conversation-a"), conversationQueryKeys.messages("user-a", "conversation-b"));
  assert.notDeepEqual(dataAssetQueryKeys.list("user-a", "project-a"), evidenceQueryKeys.list("user-a", "project-a"));
  assert.notDeepEqual(projectResourceQueryKeys.metric("user-a", "project-a"), projectResourceQueryKeys.brief("user-a", "project-a"));
});

test("server query fetchers pass AbortSignal and unwrap API collections", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const requests: Array<{ url: string; signal?: AbortSignal }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), signal: init?.signal ?? undefined });
    return new Response(JSON.stringify({ assets: [{ id: "asset-1" }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const assets = await fetchDataAssetList("project-1", { signal: controller.signal });
    assert.deepEqual(assets, [{ id: "asset-1" }]);
    assert.equal(requests[0]?.url, "/api/v1/projects/project-1/data-assets");
    assert.equal(requests[0]?.signal, controller.signal);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const conversationFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ conversations: [{ id: "conversation-1" }] }), { status: 200 });
  try {
    assert.deepEqual(await fetchConversationList("project-1"), [{ id: "conversation-1" }]);
  } finally {
    globalThis.fetch = conversationFetch;
  }
});
