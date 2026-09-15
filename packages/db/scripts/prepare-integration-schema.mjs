import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { assertIsolatedIntegrationEnvironment } from "../../../scripts/integration-environment.mjs";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationDirectory = resolve(packageDirectory, "drizzle");
const schemaName = process.env.DATABASE_SCHEMA;

assertIsolatedIntegrationEnvironment(process.env);

if (!schemaName) throw new Error("DATABASE_SCHEMA is required");

function migrationNumber(name) {
  const match = /^(\d+)_.*\.sql$/.exec(name);
  if (!match) throw new Error(`Invalid migration filename: ${name}`);
  return Number(match[1]);
}

function schemaSql(statement) {
  return statement.replaceAll('"public".', `"${schemaName}".`);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
try {
  await sql.unsafe(`CREATE SCHEMA "${schemaName}"`);
  await sql.unsafe(`SET search_path TO "${schemaName}", public`);
  const migrations = (await readdir(migrationDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => migrationNumber(left) - migrationNumber(right));
  for (const migration of migrations) {
    const source = await readFile(resolve(migrationDirectory, migration), "utf8");
    for (const statement of source.split("--> statement-breakpoint")) {
      const query = schemaSql(statement.trim());
      if (query) await sql.unsafe(query);
    }
  }
} finally {
  await sql.end();
}
