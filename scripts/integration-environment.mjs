import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

const integrationServiceKeys = [
  "DATABASE_URL",
  "DATABASE_SCHEMA",
  "MEMORY_REVOCATION_LEDGER_DIR",
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
  "AUTH_BOOTSTRAP_USERNAME",
  "AUTH_SHARED_DEFAULT_PASSWORD",
  "AUTH_LEGACY_USER_ID",
  "AUTH_LOGIN_USERNAME",
  "AUTH_LOGIN_USER_ID",
  "AUTH_LOGIN_PASSWORD_HASH",
  "AUTH_SESSION_TTL_SECONDS",
  "RUN_INTEGRATION",
  "RUN_WORKER_INTEGRATION",
];

function parseDatabaseUrl(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    return parsed;
  } catch (error) {
    if (error instanceof TypeError) throw new Error("DATABASE_URL must be a valid URL");
    throw error;
  }
}

function requireString(environment, key) {
  const value = environment[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${key} is required for integration tests`);
  return value;
}

export function assertIsolatedIntegrationEnvironment(environment) {
  if (environment.APP_ENV !== "test") throw new Error("APP_ENV must be test for integration tests");
  if (environment.LANGREPORT_INTEGRATION_TEST !== "1") throw new Error("LANGREPORT_INTEGRATION_TEST must be 1");

  const databaseUrl = parseDatabaseUrl(requireString(environment, "DATABASE_URL"));
  const name = decodeURIComponent(databaseUrl.pathname).replace(/^\//, "");
  if (!name.endsWith("_test")) throw new Error("DATABASE_URL database must end with _test");
  if (databaseUrl.hostname !== "127.0.0.1" || databaseUrl.port !== "54330") {
    throw new Error("DATABASE_URL must target the test Compose PostgreSQL endpoint");
  }

  const schema = requireString(environment, "DATABASE_SCHEMA");
  if (schema === "public") throw new Error("DATABASE_SCHEMA must not be public");
  if (!/^langreport_test_[a-z0-9]+$/.test(schema))
    throw new Error("DATABASE_SCHEMA must identify one generated test run");

  const ledgerDirectory = resolve(requireString(environment, "MEMORY_REVOCATION_LEDGER_DIR"));
  const ledgerRelativePath = relative(tmpdir(), ledgerDirectory);
  if (
    !isAbsolute(ledgerDirectory) ||
    !/^langreport-memory-revocation-[a-z0-9]+$/iu.test(ledgerRelativePath.replaceAll("\\", "/"))
  )
    throw new Error("MEMORY_REVOCATION_LEDGER_DIR must stay under the isolated temporary directory");

  const endpoint = requireString(environment, "S3_ENDPOINT");
  if (endpoint !== "http://127.0.0.1:9002") throw new Error("S3_ENDPOINT must target the test Compose MinIO endpoint");
  const bucket = requireString(environment, "S3_BUCKET");
  if (!bucket.startsWith("langreport-test-")) throw new Error("S3_BUCKET must start with langreport-test-");
  requireString(environment, "S3_ACCESS_KEY");
  requireString(environment, "S3_SECRET_KEY");
}

export function createIsolatedIntegrationEnvironment(parentEnvironment, runId) {
  if (!/^[a-z0-9]+$/.test(runId)) throw new Error("integration run id must contain only lowercase letters and digits");

  const environment = { ...parentEnvironment };
  for (const key of integrationServiceKeys) delete environment[key];
  Object.assign(environment, {
    APP_ENV: "test",
    NODE_ENV: "test",
    LANGREPORT_INTEGRATION_TEST: "1",
    LANGREPORT_WORKER_TEST: "1",
    GENERATION_MODE: "deterministic",
    DATABASE_URL: "postgres://langreport_test:langreport_test@127.0.0.1:54330/langreport_integration_test",
    DATABASE_SCHEMA: `langreport_test_${runId}`,
    MEMORY_REVOCATION_LEDGER_DIR: join(tmpdir(), `langreport-memory-revocation-${runId}`),
    S3_ENDPOINT: "http://127.0.0.1:9002",
    S3_ACCESS_KEY: "langreport_test",
    S3_SECRET_KEY: "langreport-test-secret",
    S3_BUCKET: `langreport-test-${runId}`,
  });
  assertIsolatedIntegrationEnvironment(environment);
  return environment;
}
