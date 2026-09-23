import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, apiDownload, apiFetch, apiRequest, formatApiError, safeReturnTo } from "../../lib/http-client";

test("http client sends same-origin credentials and normalizes error code", async () => {
  const originalFetch = globalThis.fetch;
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    requestInit = init;
    return new Response(JSON.stringify({ error: "未授权", code: "AUTH_REQUIRED", requestId: "req-1" }), {
      status: 401,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    await assert.rejects(() => apiFetch("/api/v1/projects"), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 401);
      assert.equal(error.code, "AUTH_REQUIRED");
      assert.match(error.message, /AUTH_REQUIRED/);
      return true;
    });
    assert.equal(requestInit?.credentials, "include");
    assert.equal(requestInit?.cache, "no-store");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("safe return targets reject external and login self-redirects", () => {
  assert.equal(safeReturnTo("/projects/p-1?conversation=c-1"), "/projects/p-1?conversation=c-1");
  assert.equal(safeReturnTo("https://example.com"), "/");
  assert.equal(safeReturnTo("//example.com"), "/");
  assert.equal(safeReturnTo("/login?returnTo=/"), "/");
});

test("diagnostic requests keep 401 in the response seam without redirecting", async () => {
  const originalFetch = globalThis.fetch;
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    requestInit = init;
    return new Response(JSON.stringify({ error: "需要登录", code: "UNAUTHENTICATED", requestId: "req-console" }), {
      status: 401,
      headers: { "content-type": "application/json", "x-request-id": "req-console" }
    });
  };
  try {
    const result = await apiRequest<Record<string, unknown>>("/api/v1/projects", {}, { unauthorized: "none", throwOnError: false });
    assert.equal(result.response.status, 401);
    assert.equal(result.payload.code, "UNAUTHENTICATED");
    assert.equal(result.requestId, "req-console");
    assert.equal(requestInit?.credentials, "include");
    assert.equal(requestInit?.cache, "no-store");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("binary downloads share credentials and normalize failed response errors", async () => {
  const originalFetch = globalThis.fetch;
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    requestInit = init;
    return new Response(new Blob(["svg"]), { status: 200, headers: { "content-type": "image/svg+xml" } });
  };
  try {
    const blob = await apiDownload("/api/v1/chart-revisions/revision-1/outputs/svg");
    assert.equal(await blob.text(), "svg");
    assert.equal(requestInit?.credentials, "include");
    assert.equal(requestInit?.cache, "no-store");
  } finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = async () => new Response(JSON.stringify({ error: "版本已归档", code: "REVISION_NOT_EXPORTABLE", requestId: "req-export" }), {
    status: 409,
    headers: { "content-type": "application/json" }
  });
  try {
    await assert.rejects(() => apiDownload("/api/v1/chart-revisions/revision-1/outputs/svg"), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "REVISION_NOT_EXPORTABLE");
      assert.match(formatApiError(error, "导出失败"), /req-export/);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
