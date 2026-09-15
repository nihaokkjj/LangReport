import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const externalEnvironmentKeys = [
  "DATABASE_URL",
  "S3_ENDPOINT",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "S3_BUCKET",
  "BAILIAN_BASE_URL",
  "BAILIAN_MODEL_ID",
  "BAILIAN_STRUCTURED_OUTPUT",
  "BAILIAN_TEMPERATURE",
  "BAILIAN_API_KEY",
  "MODEL_CREDENTIAL_ENCRYPTION_KEY",
  "AUTH_JWT_SECRET",
  "RUN_INTEGRATION",
  "RUN_WORKER_INTEGRATION",
  "LANGREPORT_WORKER_TEST"
];

const configuredExternalEnvironment = externalEnvironmentKeys.filter((key) => process.env[key]?.trim());
if (configuredExternalEnvironment.length > 0) {
  console.error(`Offline test mode refuses configured external environment: ${configuredExternalEnvironment.join(", ")}`);
  process.exit(1);
}

if (process.argv.includes("--check")) process.exit(0);

const coverage = process.argv.includes("--coverage");
const environment = { ...process.env };
for (const key of externalEnvironmentKeys) delete environment[key];
Object.assign(environment, {
  APP_ENV: "test",
  NODE_ENV: "test",
  LANGREPORT_OFFLINE_TEST: "1",
  GENERATION_MODE: "deterministic",
  DATABASE_URL: "postgres://langreport:langreport@127.0.0.1:1/langreport_offline_test",
  S3_ENDPOINT: "http://127.0.0.1:1",
  S3_ACCESS_KEY: "offline-test-access-key",
  S3_SECRET_KEY: "offline-test-secret-key",
  S3_BUCKET: "langreport-offline-test"
});
function run(command, args) {
  const result = spawnSync(command, args, { cwd: repositoryRoot, env: environment, stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

const nodeTestArgs = coverage
  ? ["--experimental-test-coverage", "--test", "tests/support/test-system.contract.test.mjs", "tests/support/integration-environment.contract.test.mjs"]
  : ["--test", "tests/support/test-system.contract.test.mjs", "tests/support/integration-environment.contract.test.mjs"];
const contractStatus = run(process.execPath, nodeTestArgs);
if (contractStatus !== 0) process.exit(contractStatus);

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
process.exit(run(pnpmCommand, ["-r", "--if-present", "run", coverage ? "test:coverage" : "test"]));
