import assert from "node:assert/strict";
import test from "node:test";
import { createReviewComment, fetchReviewComments } from "../../features/review/use-review-comments";

const comment = { id: "comment-1", revisionId: "revision-1", authorId: "reviewer-1", body: "请补充来源。", anchor: null, resolvedAt: null, createdAt: "2026-09-23T00:00:00.000Z" };

test("Review comments fetchers unwrap responses and share the HTTP request policy", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const requests: Array<{ url: string; method?: string; signal?: AbortSignal | null; credentials?: RequestCredentials; cache?: RequestCache; body?: BodyInit | null }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), method: init?.method, signal: init?.signal, credentials: init?.credentials, cache: init?.cache, body: init?.body });
    if (init?.method === "POST") return new Response(JSON.stringify({ comment }), { status: 201 });
    return new Response(JSON.stringify({ comments: [comment] }), { status: 200 });
  };
  try {
    assert.deepEqual(await fetchReviewComments("revision-1", { signal: controller.signal }), [comment]);
    assert.deepEqual(await createReviewComment("revision-1", comment.body, { signal: controller.signal }), comment);
    assert.equal(requests[0]?.url, "/api/v1/chart-revisions/revision-1/comments");
    assert.equal(requests[1]?.url, "/api/v1/chart-revisions/revision-1/comments");
    assert.equal(requests[1]?.method, "POST");
    assert.equal(requests[0]?.signal, controller.signal);
    assert.equal(requests[1]?.signal, controller.signal);
    assert.equal(requests[0]?.credentials, "include");
    assert.equal(requests[0]?.cache, "no-store");
    assert.equal(requests[1]?.body, JSON.stringify({ body: comment.body }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
