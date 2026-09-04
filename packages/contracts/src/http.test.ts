
import assert from "node:assert/strict";
import test from "node:test";
import {
  errorResponseSchema,
  createOpenApiDocument,
  getRouteContract,
  routeContracts,
  routeSchema
} from "./http.js";

const expectedRoutes = [
  "GET /health",
  "GET /ready",
  "POST /api/v1/dev/bootstrap",
  "GET /openapi.json",
  "GET /docs",
  "GET /api/v1/projects",
  "POST /api/v1/projects",
  "GET /api/v1/workspaces/:workspaceId/plugin-catalog",
  "POST /api/v1/workspaces/:workspaceId/plugins/validate",
  "POST /api/v1/workspaces/:workspaceId/plugins",
  "GET /api/v1/workspaces/:workspaceId/plugins",
  "GET /api/v1/workspaces/:workspaceId/plugins/:installationId",
  "POST /api/v1/workspaces/:workspaceId/plugins/:installationId/revoke",
  "POST /api/v1/workspaces/:workspaceId/plugins/:installationId/restore",
  "GET /api/v1/projects/:projectId/plugins",
  "PUT /api/v1/projects/:projectId/plugins/:installationId",
  "GET /api/v1/projects/:projectId/capabilities",
  "GET /api/v1/chart-revisions/:revisionId/plugin-context",
  "GET /api/v1/projects/:projectId/data-assets",
  "POST /api/v1/projects/:projectId/data-assets/upload",
  "POST /api/v1/projects/:projectId/data-assets/paste",
  "GET /api/v1/data-assets/:assetId",
  "POST /api/v1/projects/:projectId/conversations",
  "GET /api/v1/projects/:projectId/conversations",
  "GET /api/v1/conversations/:conversationId/messages",
  "POST /api/v1/conversations/:conversationId/messages",
  "GET /api/v1/projects/:projectId/metric-definition",
  "POST /api/v1/projects/:projectId/metric-definitions",
  "GET /api/v1/projects/:projectId/analysis-brief",
  "GET /api/v1/projects/:projectId/evidence-blocks",
  "POST /api/v1/projects/:projectId/generation-jobs",
  "POST /api/v1/projects/:projectId/generate",
  "GET /api/v1/conversations/:conversationId/memory",
  "GET /api/v1/projects/:projectId/memory-candidates",
  "POST /api/v1/memory-candidates/:candidateId/accept",
  "POST /api/v1/memory-candidates/:candidateId/reject",
  "GET /api/v1/projects/:projectId/memories",
  "GET /api/v1/workspaces/:workspaceId/memories",
  "DELETE /api/v1/memories/:memoryId",
  "GET /api/v1/chart-revisions/:revisionId/memory-context",
  "GET /api/v1/generation-jobs/:jobId",
  "GET /api/v1/generation-jobs/:jobId/outputs/:format",
  "GET /api/v1/projects/:projectId/chart-artifacts",
  "GET /api/v1/projects/:projectId/chart-artifacts/:artifactId",
  "POST /api/v1/projects/:projectId/chart-artifacts/:artifactId/archive",
  "GET /api/v1/chart-revisions/:revisionId",
  "GET /api/v1/chart-revisions/:revisionId/compare/:otherRevisionId",
  "POST /api/v1/chart-artifacts/:artifactId/revisions",
  "POST /api/v1/chart-revisions/:revisionId/submit",
  "POST /api/v1/chart-revisions/:revisionId/approve",
  "POST /api/v1/chart-revisions/:revisionId/request-changes",
  "POST /api/v1/chart-revisions/:revisionId/reopen",
  "POST /api/v1/chart-revisions/:revisionId/archive",
  "GET /api/v1/chart-revisions/:revisionId/comments",
  "POST /api/v1/chart-revisions/:revisionId/comments",
  "POST /api/v1/comments/:commentId/resolve",
  "GET /api/v1/projects/:projectId/theme",
  "PUT /api/v1/projects/:projectId/theme",
  "POST /api/v1/chart-revisions/:revisionId/shares",
  "GET /api/v1/chart-shares/:shareId",
  "POST /api/v1/chart-shares/:shareId/revoke",
  "GET /api/v1/chart-revisions/:revisionId/outputs/:format"
];

function key(method: string, path: string): string {
  return method.toUpperCase() + " " + path;
}

test("route contract registry covers every current route exactly once", () => {
  assert.equal(routeContracts.length, expectedRoutes.length);
  assert.deepEqual(
    routeContracts.map((contract) => key(contract.method, contract.path)).sort(),
    [...expectedRoutes].sort()
  );
  assert.equal(
    new Set(routeContracts.map((contract) => contract.operationId)).size,
    routeContracts.length
  );
});

test("every route contract has metadata, response schemas, and complete path parameters", () => {
  for (const contract of routeContracts) {
    assert.ok(contract.operationId);
    assert.ok(contract.summary);
    assert.ok(contract.description);
    assert.ok(contract.permission);
    assert.ok(contract.idempotency);
    assert.ok(contract.successDescription);
    assert.ok(contract.failureDescription);
    assert.ok(contract.tags.length > 0);
    assert.ok(Object.keys(contract.responses).length > 0);

    const pathParams = [...contract.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]);
    const params = contract.request?.params as { properties?: Record<string, unknown>; required?: string[] } | undefined;
    assert.deepEqual(Object.keys(params?.properties ?? {}).sort(), [...pathParams].sort());
    assert.deepEqual([...(params?.required ?? [])].sort(), [...pathParams].sort());

    for (const [section, value] of Object.entries(contract.request ?? {})) {
      if (!value || typeof value !== "object" || !("properties" in value)) continue;
      const properties = (value as { properties?: Record<string, { description?: unknown }> }).properties ?? {};
      for (const [name, property] of Object.entries(properties)) {
        assert.equal(typeof property.description, "string", `${contract.operationId}.${section}.${name}`);
      }
    }

    const schema = routeSchema(contract) as {
      response?: Record<string, unknown>;
      headers?: { properties?: Record<string, unknown> };
    };
    assert.ok(schema.response);
    assert.ok(schema.headers?.properties?.["x-user-id"]);
    for (const status of ["400", "403", "404", "409", "413", "422", "500", "503"]) {
      const errorSchema = schema.response?.[status] as { properties?: Record<string, unknown>; required?: string[] } | undefined;
      assert.deepEqual(errorSchema?.properties, errorResponseSchema.properties);
      assert.deepEqual(errorSchema?.required, errorResponseSchema.required);
    }
  }
});

test("route lookup is stable and marks bootstrap as internal", () => {
  assert.equal(getRouteContract("GET", "/api/v1/projects"), routeContracts.find((item) => item.operationId === "listProjects"));
  assert.equal(getRouteContract("POST", "/api/v1/dev/bootstrap")?.internal, true);
  assert.equal(getRouteContract("GET", "/missing"), undefined);
});

test("OpenAPI document is generated from the route contracts", () => {
  const document = createOpenApiDocument({ serverUrl: "http://localhost:4000" });

  const assertSchemaIsOpenApiSafe = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) assertSchemaIsOpenApiSafe(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    assert.equal(record["$schema"], undefined);
    assert.equal(record["$ref"], undefined);
    assert.notEqual(record.type, "null");
    assert.ok(!Array.isArray(record.type) || !record.type.includes("null"));
    for (const item of Object.values(record)) assertSchemaIsOpenApiSafe(item);
  };

  assert.equal(document.openapi, "3.0.3");
  assert.equal(document.servers[0]?.url, "http://localhost:4000");
  assert.ok(document.paths["/health"]?.get);
  assert.ok(document.paths["/api/v1/projects/{projectId}/data-assets/paste"]?.post);
  assert.ok(document.paths["/api/v1/projects/{projectId}/data-assets/upload"]?.post);
  assert.ok(document.paths["/api/v1/dev/bootstrap"]?.post);
  assert.equal(document.paths["/docs"], undefined);
  assert.equal(document.paths["/openapi.json"], undefined);
  assertSchemaIsOpenApiSafe(document);
  assert.doesNotMatch(JSON.stringify(document), /DATABASE_URL|POSTGRES_PASSWORD|S3_SECRET_KEY|API_KEY|Authorization/i);

  const pasteOperation = document.paths["/api/v1/projects/{projectId}/data-assets/paste"]?.post as Record<string, any>;
  assert.equal(pasteOperation.requestBody.content["application/json"].schema.type, "object");
  assert.ok(pasteOperation.parameters.some((parameter: any) => parameter.name === "projectId" && parameter.in === "path" && parameter.required === true));
  assert.ok(pasteOperation.responses["400"].content["application/json"].schema.properties.error);

  const uploadOperation = document.paths["/api/v1/projects/{projectId}/data-assets/upload"]?.post as Record<string, any>;
  assert.ok(uploadOperation.requestBody.content["multipart/form-data"]);
  assert.equal(uploadOperation.requestBody.content["multipart/form-data"].schema.properties.file.format, "binary");

  for (const pathItem of Object.values(document.paths)) {
    for (const operation of Object.values(pathItem)) {
      const responses = (operation as Record<string, any>).responses as Record<string, any>;
      for (const status of ["400", "403", "404", "409"]) assert.ok(responses[status]);
      for (const response of Object.values(responses)) {
        assert.ok(response.description);
        assert.ok(response.content);
        assert.ok(Object.values(response.content).every((content: any) => content.schema));
      }
    }
  }
});
