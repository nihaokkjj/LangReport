import assert from "node:assert/strict";
import test from "node:test";
import { routeContracts } from "@langreport/contracts/http";
import { buildApp } from "./app.js";
import { isDevBootstrapAllowed } from "./http-contracts.js";

test("development bootstrap is disabled in production", () => {
  assert.equal(isDevBootstrapAllowed({ NODE_ENV: "production" }), false);
  assert.equal(isDevBootstrapAllowed({ APP_ENV: "production" }), false);
  assert.equal(isDevBootstrapAllowed({ NODE_ENV: "development" }), true);
});

test("Fastify registers every route with its HTTP contract", async () => {
  const app = await buildApp({ logger: false });
  await app.ready();
  try {
    for (const contract of routeContracts) {
      assert.equal(app.hasRoute({ method: contract.method, url: contract.path }), true, `${contract.method} ${contract.path}`);
    }
  } finally {
    await app.close();
  }
});
