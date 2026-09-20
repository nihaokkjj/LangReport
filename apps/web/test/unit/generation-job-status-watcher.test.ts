import assert from "node:assert/strict";
import test from "node:test";
import { watchGenerationJob } from "../../app/generation-job-status-watcher";

function response(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? undefined : { "content-type": "application/json" }
  });
}

function active(version: number) {
  return { job: { id: "job-1", status: "profiling", operation: "generate", attemptCount: 1, repairCount: 0, errorCode: null, errorMessage: null, clarificationProposal: null, statusVersion: version, statusChangedAt: "2026-09-20T00:00:00.000Z", terminal: false }, revision: null };
}

test("watcher keeps one in-flight request and aborts a transport that resolves late", async () => {
  const controller = new AbortController();
  let calls = 0;
  let resolveRequest!: (value: Response) => void;
  const pending = new Promise<Response>((resolve) => { resolveRequest = resolve; });
  const watcher = watchGenerationJob({
    jobId: "job-1",
    signal: controller.signal,
    request: async () => {
      calls += 1;
      return pending;
    },
    onStatus: () => { throw new Error("late response must not be delivered"); }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  controller.abort();
  resolveRequest(response(200, active(1)));
  assert.equal(await watcher, null);
  assert.equal(calls, 1);
});

test("watcher falls back to serialized full reads when the status route is unavailable", async () => {
  const controller = new AbortController();
  const paths: string[] = [];
  const result = await watchGenerationJob({
    jobId: "job-1",
    signal: controller.signal,
    request: async (path) => {
      paths.push(path);
      if (paths.length === 1) return response(404, { error: "资源不存在" });
      return response(200, { job: { ...active(2).job, status: "succeeded", terminal: true }, revision: null });
    },
    onStatus: () => undefined
  });
  assert.equal(result?.job.status, "succeeded");
  assert.match(paths[0] ?? "", /\/status\?/);
  assert.equal(paths[1], "/api/v1/generation-jobs/job-1");
});

test("watcher stops after a terminal status", async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = await watchGenerationJob({
    jobId: "job-1",
    signal: controller.signal,
    request: async () => {
      calls += 1;
      return response(200, { job: { ...active(4).job, status: "failed", terminal: true }, revision: null });
    },
    onStatus: () => undefined
  });
  assert.equal(result?.job.status, "failed");
  assert.equal(calls, 1);
});
