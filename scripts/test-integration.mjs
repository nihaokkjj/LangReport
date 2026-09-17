import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createIsolatedIntegrationEnvironment } from "./integration-environment.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const runId = randomUUID().replaceAll("-", "");
const environment = createIsolatedIntegrationEnvironment(process.env, runId);

function run(args) {
  const result = spawnSync(pnpmCommand, args, {
    cwd: repositoryRoot,
    env: environment,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

let schemaAttempted = false;
let bucketPrepared = false;
let status = 0;
try {
  schemaAttempted = true;
  status = run(["--filter", "@langreport/db", "exec", "node", "scripts/prepare-integration-schema.mjs"]);
  if (status === 0) {
    status = run(["--filter", "@langreport/storage", "exec", "node", "scripts/prepare-integration-bucket.mjs"]);
    bucketPrepared = status === 0;
  }
  if (status === 0) status = run(["--filter", "@langreport/api", "exec", "tsx", "--test", "--test-concurrency=1", "test/integration/message-generation.integration.test.ts", "test/integration/plugins.integration.test.ts", "test/integration/data-assets.integration.test.ts"]);
  if (status === 0) status = run(["--filter", "@langreport/generation-worker", "exec", "tsx", "--test", "test/integration/worker.integration.test.ts"]);
} finally {
  if (bucketPrepared && run(["--filter", "@langreport/storage", "exec", "node", "scripts/cleanup-integration-bucket.mjs"]) !== 0) status = 1;
  if (schemaAttempted && run(["--filter", "@langreport/db", "exec", "node", "scripts/cleanup-integration-schema.mjs"]) !== 0) status = 1;
}

process.exitCode = status;
