import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "./app.js";

const developmentEnvironment = {
  ...process.env,
  NODE_ENV: "development",
  APP_ENV: "development",
  API_PUBLIC_URL: "http://localhost:4000"
};

test("serves OpenAPI JSON and a standard Swagger UI page", async () => {
  const app = await buildApp({ environment: developmentEnvironment, logger: false });
  await app.ready();

  try {
    const openApiResponse = await app.inject({
      method: "GET",
      url: "/openapi.json",
      headers: { "x-request-id": "openapi-test" }
    });
    assert.equal(openApiResponse.statusCode, 200);
    assert.equal(openApiResponse.headers["x-request-id"], "openapi-test");
    const document = openApiResponse.json() as {
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
    };
    assert.match(document.openapi, /^3\./);
    assert.ok(document.paths["/health"]?.get);
    assert.ok(document.paths["/ready"]?.get);
    assert.ok(document.paths["/api/v1/dev/bootstrap"]?.post);
    assert.ok(document.paths["/api/v1/projects/{projectId}/data-assets/paste"]?.post);
    assert.ok(document.paths["/api/v1/projects/{projectId}/metric-definitions"]?.post);
    assert.ok(document.paths["/api/v1/projects/{projectId}/generation-jobs"]?.post);
    assert.ok(document.paths["/api/v1/generation-jobs/{jobId}"]?.get);

    const docsResponse = await app.inject({ method: "GET", url: "/docs" });
    assert.equal(docsResponse.statusCode, 200);
    assert.match(docsResponse.headers["content-type"] ?? "", /^text\/html/);
    assert.match(docsResponse.body, /SwaggerUIBundle/);
    assert.match(docsResponse.body, /\/openapi\.json/);
  } finally {
    await app.close();
  }
});

test("hides internal documentation and bootstrap routes in production", async () => {
  const app = await buildApp({
    environment: { ...developmentEnvironment, NODE_ENV: "production", APP_ENV: "production" },
    logger: false
  });
  await app.ready();

  try {
    for (const [method, url] of [["GET", "/openapi.json"], ["GET", "/docs"], ["POST", "/api/v1/dev/bootstrap"]] as const) {
      const response = await app.inject({ method, url });
      assert.equal(response.statusCode, 404, url);
      assert.deepEqual(Object.keys(response.json()).sort(), ["code", "details", "error", "requestId"]);
    }
  } finally {
    await app.close();
  }
});
