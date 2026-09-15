import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const testOwners = [
  "apps/api",
  "apps/generation-worker",
  "apps/web",
  "packages/chart",
  "packages/contracts",
  "packages/data-engine",
  "packages/domain",
  "packages/flint-adapter",
  "packages/generation",
  "packages/harness",
  "packages/memory",
  "packages/model-gateway",
  "packages/plugin-sdk",
  "packages/plugins"
];
const migrationLedgerEntries = {
  "apps/api/src/auth.test.ts": "apps/api/test/unit/auth.test.ts",
  "apps/api/src/data-assets.test.ts": "apps/api/test/unit/data-assets.test.ts",
  "apps/api/src/http-contracts.test.ts": "apps/api/test/unit/http-contracts.test.ts",
  "apps/api/src/http-errors.test.ts": "apps/api/test/unit/http-errors.test.ts",
  "apps/api/src/openapi.test.ts": "apps/api/test/unit/openapi.test.ts",
  "apps/api/src/message-generation.integration.test.ts": "apps/api/test/integration/message-generation.integration.test.ts",
  "apps/api/src/plugins.integration.test.ts": "apps/api/test/integration/plugins.integration.test.ts",
  "apps/generation-worker/src/worker.integration.test.ts": "apps/generation-worker/test/integration/worker.integration.test.ts",
  "packages/contracts/src/http.test.ts": "packages/contracts/test/unit/http.test.ts",
  "packages/contracts/src/model.test.ts": "packages/contracts/test/unit/model.test.ts",
  "packages/data-engine/src/index.test.ts": "packages/data-engine/test/unit/index.test.ts",
  "packages/domain/src/index.test.ts": "packages/domain/test/unit/index.test.ts",
  "packages/flint-adapter/src/index.test.ts": "packages/flint-adapter/test/unit/index.test.ts",
  "packages/generation/src/context-projection.test.ts": "packages/generation/test/unit/context-projection.test.ts",
  "packages/generation/src/index.test.ts": "packages/generation/test/unit/index.test.ts",
  "packages/generation/src/model-baseline.test.ts": "packages/generation/test/unit/model-baseline.test.ts",
  "packages/generation/src/evidence-generation-graph/graph.test.ts": "packages/generation/test/unit/index.test.ts",
  "packages/harness/src/structured-model.test.ts": "packages/harness/test/unit/structured-model.test.ts",
  "packages/memory/src/index.test.ts": "packages/memory/test/unit/index.test.ts",
  "packages/model-gateway/src/index.test.ts": "packages/model-gateway/test/unit/index.test.ts",
  "packages/plugin-sdk/src/index.test.ts": "packages/plugin-sdk/test/unit/index.test.ts",
  "packages/plugins/src/index.test.ts": "packages/plugins/test/unit/index.test.ts"
};
const coreBranchCoverageBaselines = {
  "packages/data-engine": 64,
  "packages/generation": 75,
  "packages/domain": 81,
  "packages/chart": 75,
  "packages/model-gateway": 73
};

function repositoryPath(path) {
  return resolve(repositoryRoot, path);
}

function readJson(path) {
  return JSON.parse(readFileSync(repositoryPath(path), "utf8"));
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if ([".deploy", ".git", ".next", ".turbo", "coverage", "dist", "node_modules"].includes(entry.name)) return [];
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function normalizedRepositoryPaths(predicate) {
  return walk(repositoryRoot)
    .map((path) => relative(repositoryRoot, path).replaceAll("\\", "/"))
    .filter(predicate);
}

function ownerOf(path) {
  return path.split("/").slice(0, 2).join("/");
}

test("the root exposes only explicit offline test commands and checks test TypeScript", () => {
  const scripts = readJson("package.json").scripts;
  assert.equal(typeof scripts.test, "string");
  assert.equal(typeof scripts["test:coverage"], "string");
  assert.match(scripts.typecheck, /test:typecheck/);
  assert.equal(scripts["test:all"], undefined);
  assert.equal(scripts.lint, undefined);
});

test("all TypeScript tests live in an agreed package-owned directory", () => {
  const testFiles = normalizedRepositoryPaths((path) => path.endsWith(".test.ts"));
  assert.ok(testFiles.length > 0);
  const allowed = /^(?:apps|packages)\/[^/]+\/test\/(?:unit|integration|e2e)\/.+\.test\.ts$/;
  assert.deepEqual(testFiles.filter((path) => !allowed.test(path)), []);
});

test("every current test owner type-checks its test sources", () => {
  for (const owner of testOwners) {
    assert.equal(existsSync(repositoryPath(`${owner}/tsconfig.test.json`)), true, `${owner} needs tsconfig.test.json`);
    const scripts = readJson(`${owner}/package.json`).scripts;
    assert.match(scripts["test:typecheck"] ?? "", /tsconfig\.test\.json/, `${owner} needs test:typecheck`);
  }
});

test("default package tests include only unit tests and contain no skips", () => {
  const unitTestFiles = normalizedRepositoryPaths((path) => /^(?:apps|packages)\/[^/]+\/test\/unit\/.+\.test\.ts$/.test(path));
  assert.ok(unitTestFiles.length > 0);
  const skippedTests = unitTestFiles.filter((path) => /(?:\btest|\bdescribe)\.skip\s*\(|\{\s*skip\s*:/.test(readFileSync(repositoryPath(path), "utf8")));
  assert.deepEqual(skippedTests, []);

  for (const owner of new Set(unitTestFiles.map(ownerOf))) {
    const script = readJson(`${owner}/package.json`).scripts.test ?? "";
    assert.match(script, /test\/unit/);
    assert.doesNotMatch(script, /test\/integration/);
  }
});

test("coverage reports use the native Node runner and enforce each core package's branch baseline", () => {
  const unitTestFiles = normalizedRepositoryPaths((path) => /^(?:apps|packages)\/[^/]+\/test\/unit\/.+\.test\.ts$/.test(path));
  for (const owner of new Set(unitTestFiles.map(ownerOf))) {
    const scripts = readJson(`${owner}/package.json`).scripts;
    const coverage = scripts["test:coverage"] ?? "";
    assert.match(coverage, /--experimental-test-coverage/);
    if (owner in coreBranchCoverageBaselines) {
      assert.match(coverage, /--test-coverage-include=src\/\*\*/);
      assert.match(coverage, new RegExp(`--test-coverage-branches=${coreBranchCoverageBaselines[owner]}`));
    } else {
      assert.doesNotMatch(coverage, /--test-coverage-branches=/);
    }
  }
});

test("the offline runner rejects configured external services before tests start", () => {
  const result = spawnSync(process.execPath, ["scripts/test-offline.mjs", "--check"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: "postgres://production.example/langreport" }
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Offline test mode refuses configured external environment: DATABASE_URL/);
});

test("the offline runner checks the integration isolation contract without starting services", () => {
  const runner = readFileSync(repositoryPath("scripts/test-offline.mjs"), "utf8");
  assert.match(runner, /integration-environment\.contract\.test\.mjs/);
});

test("the PR workflow installs a frozen lockfile and runs the three offline gates", () => {
  const workflowPath = repositoryPath(".github/workflows/pr-offline.yml");
  assert.equal(existsSync(workflowPath), true);
  const workflow = readFileSync(workflowPath, "utf8");
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /node-version:\s*22/);
  assert.match(workflow, /version:\s*11\.19\.0/);
  for (const command of ["pnpm install --frozen-lockfile", "pnpm test", "pnpm typecheck", "pnpm build", "pnpm test:coverage"]) {
    assert.match(workflow, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("the migration ledger records every pre-T2 test path", () => {
  const ledgerPath = repositoryPath("docs/testing/test-migration-ledger.md");
  assert.equal(existsSync(ledgerPath), true);
  const ledger = readFileSync(ledgerPath, "utf8");
  for (const [oldPath, newPath] of Object.entries(migrationLedgerEntries)) {
    assert.match(ledger, new RegExp(`${oldPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*${newPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
});
