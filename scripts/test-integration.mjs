import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createIsolatedIntegrationEnvironment } from "./integration-environment.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const runId = randomUUID().replaceAll("-", "");
const environment = createIsolatedIntegrationEnvironment(process.env, runId);
const failureFixturePath = resolve(tmpdir(), `langreport-chart-failure-${runId}.json`);
environment.LANGREPORT_FAILURE_FIXTURE_PATH = failureFixturePath;
const ledgerDirectory = resolve(environment.MEMORY_REVOCATION_LEDGER_DIR);
await mkdir(ledgerDirectory, { recursive: false });

function run(args) {
  const result = spawnSync(pnpmCommand, args, {
    cwd: repositoryRoot,
    env: environment,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

let schemaAttempted = false;
let bucketPrepared = false;
let status;
try {
  schemaAttempted = true;
  status = run(["--filter", "@langreport/db", "exec", "node", "scripts/prepare-integration-schema.mjs"]);
  if (status === 0) {
    status = run(["--filter", "@langreport/storage", "exec", "node", "scripts/prepare-integration-bucket.mjs"]);
    bucketPrepared = status === 0;
  }
  if (status === 0)
    status = run(["--filter", "@langreport/memory", "exec", "tsx", "scripts/init-revocation-ledger.ts"]);
  if (status === 0)
    status = run([
      "--filter",
      "@langreport/api",
      "exec",
      "tsx",
      "--test",
      "--test-concurrency=1",
      "test/integration/database-user-accounts.integration.test.ts",
      "test/integration/memory-management.integration.test.ts",
      "test/integration/memory-revocation-recovery.integration.test.ts",
      "test/integration/memory-revocation-startup.integration.test.ts",
      "test/integration/message-generation.integration.test.ts",
      "test/integration/plugins.integration.test.ts",
      "test/integration/data-assets.integration.test.ts",
      "test/integration/table-intake.integration.test.ts",
      "test/integration/generation-job-status.integration.test.ts",
      "test/integration/chart-point-failure.integration.test.ts",
    ]);
  if (status === 0)
    status = run([
      "--filter",
      "@langreport/web",
      "exec",
      "playwright",
      "test",
      "-c",
      "playwright.config.ts",
      "test/e2e/consulting-report.spec.ts",
      "-g",
      "真实 API 失败状态契约投影到界面",
      "--project",
      "chromium-desktop",
      "--project",
      "chromium-mobile",
    ]);
  if (status === 0)
    status = run([
      "--filter",
      "@langreport/generation-worker",
      "exec",
      "tsx",
      "--test",
      "test/integration/worker.integration.test.ts",
      "test/integration/memory-revocation.integration.test.ts",
    ]);
} finally {
  if (
    bucketPrepared &&
    run(["--filter", "@langreport/storage", "exec", "node", "scripts/cleanup-integration-bucket.mjs"]) !== 0
  )
    status = 1;
  if (
    schemaAttempted &&
    run(["--filter", "@langreport/db", "exec", "node", "scripts/cleanup-integration-schema.mjs"]) !== 0
  )
    status = 1;
  await rm(ledgerDirectory, { recursive: true, force: true });
  await rm(failureFixturePath, { force: true });
}

process.exitCode = status;
