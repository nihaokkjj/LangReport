import postgres from "postgres";
import { assertIsolatedIntegrationEnvironment } from "../../../scripts/integration-environment.mjs";

const schemaName = process.env.DATABASE_SCHEMA;

assertIsolatedIntegrationEnvironment(process.env);

if (!schemaName) throw new Error("DATABASE_SCHEMA is required");

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
try {
  await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
} finally {
  await sql.end();
}
