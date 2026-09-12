import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sendStructuredModelRequest, type FetchLike } from "./structured-model.js";

test("normalizes JSON responses and malformed bodies without provider semantics", async () => {
  const result = await sendStructuredModelRequest(request(), async () => new Response("not-json", { status: 502 }));

  assert.deepEqual(result, { kind: "response", status: 502, ok: false, payload: {} });
});

test("cancels the fetch when its deadline expires", async () => {
  let observedAbort = false;
  const fetcher: FetchLike = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      observedAbort = true;
      reject(new Error("aborted"));
    }, { once: true });
  });

  const result = await sendStructuredModelRequest({ ...request(), deadlineAt: Date.now() + 5 }, fetcher);

  assert.deepEqual(result, { kind: "timeout" });
  assert.equal(observedAbort, true);
});

test("propagates caller cancellation without treating it as a transport failure", async () => {
  const controller = new AbortController();
  const fetcher: FetchLike = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  const pending = sendStructuredModelRequest({ ...request(), signal: controller.signal }, fetcher);
  controller.abort(new Error("worker stopped"));

  assert.deepEqual(await pending, { kind: "cancelled" });
});

test("does not depend on LangReport application packages", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { dependencies?: Record<string, string> };
  const source = await readFile(new URL("./structured-model.ts", import.meta.url), "utf8");

  assert.deepEqual(packageJson.dependencies ?? {}, {});
  assert.equal(source.includes("@langreport/"), false);
});

function request() {
  return {
    url: "https://provider.example.test/v1/structured",
    headers: { "Content-Type": "application/json" },
    body: { model: "test" },
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 1_000
  };
}
