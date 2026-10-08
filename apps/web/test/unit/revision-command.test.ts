import assert from "node:assert/strict";
import test from "node:test";
import { createRevisionCommand, pendingRevisionJobKey } from "../../features/evidence/revision-command";

test("revision command compatibility preserves pending Jobs and fixed legacy identities", async () => {
  const original = globalThis.fetch;
  const job = { id: "job-1", conversationId: "derived-conversation", status: "queued" };
  const revision = { id: "r-2", artifactId: "artifact-copy", revision: 1, status: "draft" };
  try {
    for (const [status, payload, expected] of [
      [202, { job }, { kind: "job", job }],
      [200, { job, reused: true }, { kind: "job", job }],
      [201, { revision }, { kind: "revision", revision }],
      [200, { revision }, { kind: "revision", revision }],
    ] as const) {
      globalThis.fetch = async (_url, init) => {
        assert.equal(init?.method, "POST");
        assert.equal(JSON.parse(String(init?.body)).sourceRevisionId, "approved-r1");
        return Response.json(payload, { status });
      };
      assert.deepEqual(
        await createRevisionCommand("artifact-1", { operation: "copy", sourceRevisionId: "approved-r1" }),
        expected,
      );
    }
    for (const [status, payload] of [
      [202, { revision }],
      [201, { job }],
      [200, {}],
    ] as const) {
      globalThis.fetch = async () => Response.json(payload, { status });
      await assert.rejects(createRevisionCommand("a", {}), /缺少 Job 或固定 Revision/);
    }
    globalThis.fetch = async () =>
      Response.json({ code: "REVISION_PROVENANCE_INCOMPLETE", error: "来源缺失" }, { status: 409 });
    await assert.rejects(createRevisionCommand("a", {}), /REVISION_PROVENANCE_INCOMPLETE/);
    const controller = new AbortController();
    globalThis.fetch = async (_url, init) => {
      assert.equal(init?.signal, controller.signal);
      throw new DOMException("Aborted", "AbortError");
    };
    await assert.rejects(createRevisionCommand("a", {}, controller.signal), { name: "AbortError" });
  } finally {
    globalThis.fetch = original;
  }
});

test("pending revision Jobs are isolated by authenticated user, project and conversation", () => {
  const key = pendingRevisionJobKey("user", "project", "conversation");
  for (const context of [
    ["other", "project", "conversation"],
    ["user", "other", "conversation"],
    ["user", "project", "other"],
  ]) {
    assert.notEqual(pendingRevisionJobKey(context[0], context[1], context[2]), key);
  }
  assert.notEqual(pendingRevisionJobKey("a:b", "c", "d"), pendingRevisionJobKey("a", "b:c", "d"));
});
