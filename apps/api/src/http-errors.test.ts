import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { attachRequestId, sendHttpError } from "./http-errors.js";

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
