import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { sendDataError } from "../../src/routes.js";
import { DataAssetError } from "../../src/data-assets.js";
import { attachRequestId, sendHttpError } from "../../src/http-errors.js";

test("sendHttpError returns the stable error shape and request id", async () => {
  const app = Fastify({ requestIdHeader: "x-request-id" });
  attachRequestId(app);
  app.get("/error", async (_request, reply) => sendHttpError(reply, 409, "冲突", "CONFLICT", { field: "name" }));

  const response = await app.inject({
    method: "GET",
    url: "/error",
    headers: { "x-request-id": "acceptance-request-1" }
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.headers["x-request-id"], "acceptance-request-1");
  assert.deepEqual(response.json(), {
    error: "冲突",
    code: "CONFLICT",
    requestId: "acceptance-request-1",
    details: { field: "name" }
  });
  await app.close();
});

test("sendDataError maps intake failures without exposing provider details", async () => {
  const app = Fastify({ requestIdHeader: "x-request-id" });
  attachRequestId(app);
  app.get("/asset", async (_request, reply) => sendDataError(
    reply,
    new DataAssetError("SOURCE_OBJECT_WRITE_FAILED", "原始数据暂时无法保存，请稍后重试", 503, {
      cause: new Error("provider failed for private/object-key")
    })
  ));

  const response = await app.inject({ method: "GET", url: "/asset" });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), {
    error: "原始数据暂时无法保存，请稍后重试",
    code: "SOURCE_OBJECT_WRITE_FAILED",
    requestId: response.headers["x-request-id"],
    details: {}
  });
  assert.doesNotMatch(response.body, /provider|private\/object-key/);
  await app.close();
});
