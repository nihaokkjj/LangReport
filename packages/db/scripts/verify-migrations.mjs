import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationDirectory = resolve(packageDirectory, "drizzle");
const journalPath = resolve(migrationDirectory, "meta", "_journal.json");
const databaseUrl = process.env.DATABASE_URL ?? "postgres://langreport:langreport@localhost:54329/langreport";

function migrationNumber(name) {
  const match = /^(\d+)_.*\.sql$/.exec(name);
  if (!match) throw new Error(`Invalid migration filename: ${name}`);
  return Number(match[1]);
}

async function readMigrations() {
  const [fileNames, journalText] = await Promise.all([
    readdir(migrationDirectory),
    readFile(journalPath, "utf8")
  ]);
  const files = fileNames
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => migrationNumber(left) - migrationNumber(right));
  const journal = JSON.parse(journalText);
  const journalTags = journal.entries.map((entry) => `${entry.tag}.sql`);
  assert.deepEqual(files, journalTags, "migration files and Drizzle journal must stay in sync");
  assert.equal(new Set(files.map(migrationNumber)).size, files.length, "migration numbers must be unique");
  assert.ok(files.includes("0007_lush_starbolt.sql"), "the Phase 5 migration must remain in the chain");
  assert.ok(files.includes("0010_plugin_usage.sql"), "the plugin usage migration must remain in the chain");
  return files;
}

function schemaSql(statement, schemaName) {
  return statement.replaceAll('"public".', `"${schemaName}".`);
}

async function run() {
  const migrations = await readMigrations();
  const schemaName = `migration_verify_${randomUUID().replaceAll("-", "")}`;
  const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });

  try {
    await sql.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await sql.begin(async (transaction) => {
      await transaction.unsafe(`SET LOCAL search_path TO "${schemaName}", public`);

      for (const migration of migrations) {
        const source = await readFile(resolve(migrationDirectory, migration), "utf8");
        for (const statement of source.split("--> statement-breakpoint")) {
          const query = schemaSql(statement.trim(), schemaName);
          if (query) await transaction.unsafe(query);
        }

        if (migration === "0006_cooing_sage.sql") {
          // These rows model data created before the Phase 5 plugin columns existed.
          await transaction.unsafe(`
            INSERT INTO "workspaces" ("id", "name")
            VALUES ('00000000-0000-0000-0000-000000000001', 'Historical workspace');
            INSERT INTO "projects" ("id", "workspace_id", "name", "slug")
            VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Historical project', 'historical-project');
            INSERT INTO "data_assets" ("id", "project_id", "name", "source_type", "mime_type", "size_bytes", "object_key", "status", "created_by")
            VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 'historical.csv', 'pasted', 'text/csv', 10, 'historical.csv', 'ready', 'historical-user');
            INSERT INTO "data_snapshots" ("id", "asset_id", "version", "row_count", "column_count", "schema", "preview", "normalized_object_key")
            VALUES ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', 1, 2, 1, '[{"name":"sales","type":"number"}]'::jsonb, '[{"sales":10}]'::jsonb, 'historical-snapshot.json');
            INSERT INTO "conversations" ("id", "project_id", "title", "created_by")
            VALUES ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000002', 'Historical conversation', 'historical-user');
            INSERT INTO "generation_jobs" ("id", "project_id", "conversation_id", "data_asset_id", "snapshot_id", "prompt", "idempotency_key", "input_fingerprint", "created_by")
            VALUES ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004', '历史销售额', 'historical-job', 'historical-fingerprint', 'historical-user');
            INSERT INTO "chart_artifacts" ("id", "project_id", "name", "created_by")
            VALUES ('00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000002', 'Historical chart', 'historical-user');
            INSERT INTO "chart_revisions" ("id", "artifact_id", "generation_job_id", "snapshot_id", "revision", "created_by", "transform_plan", "field_lineage", "flint_spec", "theme_snapshot", "vega_lite_spec", "validation", "output_objects")
            VALUES ('00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000004', 1, 'historical-user', '{"type":"group"}'::jsonb, '{"sales":"sales"}'::jsonb, '{"mark":"bar"}'::jsonb, '{"preset":"economist"}'::jsonb, '{"mark":"bar"}'::jsonb, '{"valid":true}'::jsonb, '{"svg":"historical.svg"}'::jsonb);
            INSERT INTO "project_themes" ("project_id", "preset", "version", "config", "updated_by")
            VALUES ('00000000-0000-0000-0000-000000000002', 'economist', 1, '{"ink":"#111111"}'::jsonb, 'historical-user');
          `);
        }
      }

      const [historical] = await transaction.unsafe(`
        SELECT
          j."prompt" AS job_prompt,
          j."plugin_context" AS plugin_context,
          j."plugin_usage" AS plugin_usage,
          r."output_objects" AS revision_outputs,
          r."plugin_snapshot" AS plugin_snapshot,
          t."config" AS theme_config,
          t."theme_ref" AS theme_ref
        FROM "generation_jobs" j
        JOIN "chart_revisions" r ON r."generation_job_id" = j."id"
        JOIN "project_themes" t ON t."project_id" = j."project_id"
        WHERE j."id" = '00000000-0000-0000-0000-000000000006'
      `);
      assert.equal(historical.job_prompt, "历史销售额");
      assert.deepEqual(historical.plugin_context, {});
      assert.deepEqual(historical.plugin_usage, {});
      assert.deepEqual(historical.plugin_snapshot, {});
      assert.deepEqual(historical.revision_outputs, { svg: "historical.svg" });
      assert.deepEqual(historical.theme_config, { ink: "#111111" });
      assert.equal(historical.theme_ref, null);

      const [columns] = await transaction.unsafe(`
        SELECT count(*)::integer AS count
        FROM information_schema.columns
        WHERE table_schema = '${schemaName}'
          AND ((table_name = 'generation_jobs' AND column_name IN ('plugin_context', 'plugin_usage'))
            OR (table_name = 'chart_revisions' AND column_name = 'plugin_snapshot')
            OR (table_name = 'project_themes' AND column_name = 'theme_ref'))
      `);
      assert.equal(columns.count, 4, "all Phase 5 compatibility columns must exist");

      const indexes = await transaction.unsafe(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = '${schemaName}'
          AND indexname IN (
            'plugin_installations_workspace_manifest_unique',
            'plugin_manifests_workspace_version_unique',
            'project_plugin_bindings_enabled_plugin_unique'
          )
      `);
      assert.equal(indexes.length, 3, "Phase 5 uniqueness indexes must be present");
    });
    console.log(`Migration compatibility verification passed (${migrations.join(", ")})`);
  } finally {
    await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await sql.end();
  }
}

run().catch((error) => {
  console.error("Migration compatibility verification failed");
  console.error(error);
  process.exitCode = 1;
});
