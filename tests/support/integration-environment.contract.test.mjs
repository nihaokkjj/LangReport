import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  assertIsolatedIntegrationEnvironment,
  createIsolatedIntegrationEnvironment
} from "../../scripts/integration-environment.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");

const validEnvironment = {
  APP_ENV: "test",
  LANGREPORT_INTEGRATION_TEST: "1",
  DATABASE_URL: "postgres://langreport_test:langreport_test@127.0.0.1:54330/langreport_integration_test",
  DATABASE_SCHEMA: "langreport_test_0123456789abcdef",
  S3_ENDPOINT: "http://127.0.0.1:9002",
  S3_ACCESS_KEY: "langreport_test",
  S3_SECRET_KEY: "langreport-test-secret",
  S3_BUCKET: "langreport-test-0123456789abcdef"
};

test("integration resources require the dedicated test database, schema and bucket", () => {
  assert.doesNotThrow(() => assertIsolatedIntegrationEnvironment(validEnvironment));

  assert.throws(
    () => assertIsolatedIntegrationEnvironment({ ...validEnvironment, DATABASE_URL: "postgres://postgres.example/langreport" }),
    /DATABASE_URL database must end with _test/
  );
  assert.throws(
    () => assertIsolatedIntegrationEnvironment({ ...validEnvironment, DATABASE_SCHEMA: "public" }),
    /DATABASE_SCHEMA must not be public/
  );
  assert.throws(
    () => assertIsolatedIntegrationEnvironment({ ...validEnvironment, S3_BUCKET: "customer-reports" }),
    /S3_BUCKET must start with langreport-test-/
  );
});

test("integration runner replaces parent database and storage settings with one isolated run", () => {
  const environment = createIsolatedIntegrationEnvironment({
    ...validEnvironment,
    DATABASE_URL: "postgres://production.example/langreport",
    DATABASE_SCHEMA: "public",
    S3_BUCKET: "customer-reports",
    S3_ACCESS_KEY: "production-access-key",
    S3_SECRET_KEY: "production-secret"
  }, "0123456789abcdef");

  assert.equal(environment.APP_ENV, "test");
  assert.equal(environment.LANGREPORT_INTEGRATION_TEST, "1");
  assert.match(environment.DATABASE_URL, /langreport_integration_test$/);
  assert.equal(environment.DATABASE_SCHEMA, "langreport_test_0123456789abcdef");
  assert.equal(environment.S3_BUCKET, "langreport-test-0123456789abcdef");
  assert.equal(environment.S3_ACCESS_KEY, "langreport_test");
  assert.notEqual(environment.S3_SECRET_KEY, "production-secret");
  assert.doesNotMatch(environment.DATABASE_URL, /production\.example/);
  assertIsolatedIntegrationEnvironment(environment);
});

test("the integration command owns a dedicated Compose lifecycle instead of development resources", () => {
  const scripts = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8")).scripts;
  assert.equal(scripts["test:integration"], "node scripts/test-integration.mjs");

  const composePath = resolve(repositoryRoot, "infra/docker-compose.test.yml");
  assert.equal(existsSync(composePath), true);
  const compose = readFileSync(composePath, "utf8");
  assert.match(compose, /^name: langreport-test$/m);
  assert.match(compose, /langreport_integration_test/);
  assert.match(compose, /langreport-test-postgres/);
  assert.match(compose, /langreport-test-minio/);

  const runnerPath = resolve(repositoryRoot, "scripts/test-integration.mjs");
  assert.equal(existsSync(runnerPath), true);
  const runner = readFileSync(runnerPath, "utf8");
  assert.match(runner, /prepare-integration-schema/);
  assert.match(runner, /prepare-integration-bucket/);
  assert.match(runner, /cleanup-integration-schema/);
  assert.match(runner, /cleanup-integration-bucket/);
});

test("nightly integration runs separately from PRs and records its green streak in one Issue", () => {
  const workflowPath = resolve(repositoryRoot, ".github/workflows/integration-nightly.yml");
  assert.equal(existsSync(workflowPath), true);
  const workflow = readFileSync(workflowPath, "utf8");
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.match(workflow, /issues:\s*write/);
  assert.match(workflow, /docker compose -f infra\/docker-compose\.test\.yml up -d --wait/);
  assert.match(workflow, /pnpm test:integration/);
  assert.match(workflow, /docker compose -f infra\/docker-compose\.test\.yml down -v/);
  assert.match(workflow, /Current consecutive green runs/);
  assert.match(workflow, /manually close/);
});
