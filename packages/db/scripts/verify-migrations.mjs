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
  const [fileNames, journalText] = await Promise.all([readdir(migrationDirectory), readFile(journalPath, "utf8")]);
  const files = fileNames
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => migrationNumber(left) - migrationNumber(right));
  const journal = JSON.parse(journalText);
  const journalTags = journal.entries.map((entry) => `${entry.tag}.sql`);
  assert.deepEqual(files, journalTags, "migration files and Drizzle journal must stay in sync");
  assert.equal(new Set(files.map(migrationNumber)).size, files.length, "migration numbers must be unique");
  assert.ok(files.includes("0007_lush_starbolt.sql"), "the Phase 5 migration must remain in the chain");
  assert.ok(files.includes("0010_plugin_usage.sql"), "the plugin usage migration must remain in the chain");
  assert.ok(
    files.includes("0016_workspace_model_credentials.sql"),
    "the Workspace model credential migration must remain in the chain",
  );
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
        if (migration === "0029_memory_identity_private_scope.sql") {
          const preflight = source.split("--> statement-breakpoint", 1)[0];
          let blockedDuplicateHead = false;
          try {
            await transaction.savepoint("memory_ambiguity_preflight", async (savepoint) => {
              await savepoint.unsafe(`
                INSERT INTO "memories" (
                  "id", "workspace_id", "project_id", "scope", "memory_key", "memory_type", "statement",
                  "value", "status", "version", "source_message_ids", "confidence", "created_by", "updated_by"
                ) VALUES (
                  '00000000-0000-0000-0000-00000000000f',
                  '00000000-0000-0000-0000-000000000001',
                  '00000000-0000-0000-0000-000000000002', 'project', 'metric.revenue.calculation',
                  'metric_definition', 'Synthetic ambiguous duplicate', '{}'::jsonb, 'active', 3,
                  '[]'::jsonb, 1, 'historical-user', 'historical-user'
                )
              `);
              await savepoint.unsafe(preflight);
            });
          } catch (error) {
            blockedDuplicateHead = error instanceof Error && error.message.includes("duplicate active heads");
          }
          const [rolledBackFixture] = await transaction.unsafe(
            `SELECT count(*)::integer AS count FROM "memories" WHERE "id" = '00000000-0000-0000-0000-00000000000f'`,
          );
          assert.equal(rolledBackFixture.count, 0, "preflight rollback must remove the synthetic duplicate head");
          assert.equal(
            blockedDuplicateHead,
            true,
            "ambiguous active heads must stop migration before choosing a winner",
          );
        }

        for (const [statementIndex, statement] of source.split("--> statement-breakpoint").entries()) {
          const query = schemaSql(statement.trim(), schemaName);
          if (query) {
            try {
              await transaction.unsafe(query);
            } catch (error) {
              throw new Error(`Failed ${migration} statement ${statementIndex + 1}: ${query.slice(0, 100)}`, {
                cause: error,
              });
            }
          }
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

        if (migration === "0021_data_asset_intake_lifecycle.sql") {
          await transaction.unsafe(`
            INSERT INTO "data_assets" ("id", "project_id", "source_conversation_id", "name", "source_type", "mime_type", "size_bytes", "object_key", "status", "created_by")
            VALUES ('00000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000005', 'historical-v1.csv', 'pasted', 'text/csv', 10, 'workspaces/00000000-0000-0000-0000-000000000001/projects/00000000-0000-0000-0000-000000000002/conversations/00000000-0000-0000-0000-000000000005/user-data/uploads/00000000-0000-0000-0000-000000000009/source/historical-v1.csv', 'ready', 'historical-user');
            INSERT INTO "data_snapshots" ("id", "asset_id", "version", "row_count", "column_count", "schema", "preview", "normalized_object_key")
            VALUES ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000009', 1, 2, 1, '[{"name":"sales","type":"number"}]'::jsonb, '[{"sales":10}]'::jsonb, 'historical-snapshot-v1.json');
          `);
        }

        if (migration === "0028_database_user_accounts.sql") {
          await transaction.unsafe(`
            INSERT INTO "users" ("id", "username", "username_key", "password_hash")
            VALUES ('historical-user', 'memory-fixture', 'memory-fixture', 'synthetic-only');
            INSERT INTO "memory_candidates" (
              "id", "workspace_id", "project_id", "conversation_id", "candidate_fingerprint",
              "memory_key", "memory_type", "statement", "scope_hint", "confidence",
              "extractor_version", "status", "reviewed_by", "reviewed_at"
            ) VALUES (
              '00000000-0000-0000-0000-00000000000b',
              '00000000-0000-0000-0000-000000000001',
              '00000000-0000-0000-0000-000000000002',
              '00000000-0000-0000-0000-000000000005',
              'synthetic-memory-fingerprint', 'metric.revenue.calculation', 'metric_definition',
              '合成历史口径', 'project', 1, 'migration-fixture', 'accepted', 'historical-user',
              '2026-01-02T03:04:05.000Z'
            );
            INSERT INTO "memories" (
              "id", "workspace_id", "project_id", "scope", "memory_key", "memory_type", "statement",
              "value", "status", "version", "source_candidate_id", "source_conversation_id",
              "source_message_ids", "confidence", "created_by", "updated_by", "created_at", "updated_at", "superseded_by"
            ) VALUES
            (
              '00000000-0000-0000-0000-00000000000c',
              '00000000-0000-0000-0000-000000000001',
              '00000000-0000-0000-0000-000000000002', 'project', 'metric.revenue.calculation',
              'metric_definition', '合成旧版本', '{"taxIncluded":false}'::jsonb, 'superseded', 1,
              NULL, '00000000-0000-0000-0000-000000000005', '[]'::jsonb, 1, 'historical-user',
              'historical-user', '2026-01-01T00:00:00.000Z', '2026-01-02T03:04:05.000Z',
              '00000000-0000-0000-0000-00000000000d'
            ),
            (
              '00000000-0000-0000-0000-00000000000d',
              '00000000-0000-0000-0000-000000000001',
              '00000000-0000-0000-0000-000000000002', 'project', 'metric.revenue.calculation',
              'metric_definition', '合成当前版本', '{"taxIncluded":true}'::jsonb, 'active', 2,
              '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000005',
              '[]'::jsonb, 1, 'historical-user', 'historical-user',
              '2026-01-02T03:04:05.000Z', '2026-01-02T03:04:05.000Z', NULL
            ),
            (
              '00000000-0000-0000-0000-00000000000e',
              '00000000-0000-0000-0000-000000000001', NULL, 'workspace', 'legacy.workspace.keep',
              'business_rule', '合成 Workspace 历史行', '{}'::jsonb, 'active', 1, NULL, NULL,
              '[]'::jsonb, 1, 'historical-user', 'historical-user',
              '2026-01-02T03:04:05.000Z', '2026-01-02T03:04:05.000Z', NULL
            );
          `);
        }
        if (migration === "0031_lark_table_intake.sql") {
          await transaction.unsafe(`
            INSERT INTO "chart_artifacts" ("id", "project_id", "name", "created_by")
            VALUES ('00000000-0000-0000-0000-000000000011',
              '00000000-0000-0000-0000-000000000002', 'Historical chart with gap', 'historical-user');
            INSERT INTO "chart_revisions" (
              "id", "artifact_id", "snapshot_id", "revision", "created_by", "transform_plan",
              "field_lineage", "flint_spec", "theme_snapshot", "vega_lite_spec", "validation", "output_objects"
            ) VALUES (
              '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000011',
              '00000000-0000-0000-0000-00000000000a', 4, 'historical-user', '{}'::jsonb,
              '[]'::jsonb, '{"mark":"bar"}'::jsonb, '{}'::jsonb, '{"mark":"bar"}'::jsonb,
              '{"valid":true}'::jsonb, '{"svg":"historical-r4.svg"}'::jsonb
            );
            INSERT INTO "chart_artifacts" ("id", "project_id", "name", "created_by")
            VALUES ('00000000-0000-0000-0000-000000000013',
              '00000000-0000-0000-0000-000000000002', 'Historical empty chart', 'historical-user');
          `);
        }
        if (migration === "0032_revision_identity_reservation.sql") {
          const counters = await transaction.unsafe(`
            SELECT "id", "next_revision_number" FROM "chart_artifacts"
            WHERE "id" IN ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000013')
            ORDER BY "id"
          `);
          assert.deepEqual(
            counters.map((row) => [row.id, row.next_revision_number]),
            [
              ["00000000-0000-0000-0000-000000000011", 5],
              ["00000000-0000-0000-0000-000000000013", 1],
            ],
            "legacy Artifact counters must use MAX(revision)+1, leaving empty Artifacts at 1",
          );
        }
      }

      const memoryVersions = Array.from(
        await transaction.unsafe(`
          SELECT id, logical_memory_id, version, status, confirmed_at, effective_from
          FROM "memories"
          WHERE "project_id" = '00000000-0000-0000-0000-000000000002'
            AND "memory_key" = 'metric.revenue.calculation'
          ORDER BY version
        `),
      );
      assert.equal(memoryVersions.length, 2, "legacy memory versions must both survive identity backfill");
      assert.equal(
        memoryVersions[0].logical_memory_id,
        memoryVersions[1].logical_memory_id,
        "legacy key versions must share one logical memory ID",
      );
      assert.equal(memoryVersions[0].confirmed_at, null, "unknown legacy confirmation time must remain unknown");
      assert.equal(memoryVersions[0].effective_from, null, "unknown legacy effective time must remain unknown");
      assert.equal(
        memoryVersions[1].confirmed_at.toISOString(),
        "2026-01-02T03:04:05.000Z",
        "accepted candidate review time supplies confirmedAt",
      );
      assert.equal(
        memoryVersions[1].effective_from.toISOString(),
        "2026-01-02T03:04:05.000Z",
        "accepted candidate review time supplies effectiveFrom",
      );

      const [retainedWorkspaceRows] = await transaction.unsafe(`
        SELECT count(*)::integer AS count
        FROM "memories"
        WHERE "scope" = 'workspace' AND "memory_key" = 'legacy.workspace.keep'
      `);
      assert.equal(retainedWorkspaceRows.count, 1, "legacy Workspace Memory rows must be retained");

      const privatePreferenceOwnerColumn = Array.from(
        await transaction.unsafe(`
          SELECT data_type
          FROM information_schema.columns
          WHERE table_schema = '${schemaName}'
            AND table_name = 'user_preference_memories'
            AND column_name = 'owner_id'
        `),
      );
      assert.deepEqual(
        privatePreferenceOwnerColumn,
        [{ data_type: "text" }],
        "private preference owner must match users.id text type",
      );

      await transaction.unsafe(`
        INSERT INTO "user_preference_memories" (
          "logical_memory_id", "owner_id", "category", "memory_key", "statement", "value",
          "source_message_ids", "version", "confirmed_at", "effective_from"
        ) VALUES (
          '00000000-0000-0000-0000-000000000010', 'historical-user', 'language',
          'user.preference.language', '合成偏好', '{"language":"en"}'::jsonb,
          '[]'::jsonb, 1, '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'
        )
      `);
      const [privatePreference] = await transaction.unsafe(`
        SELECT "owner_id", "statement"
        FROM "user_preference_memories"
        WHERE "logical_memory_id" = '00000000-0000-0000-0000-000000000010'
      `);
      assert.deepEqual(
        privatePreference,
        { owner_id: "historical-user", statement: "合成偏好" },
        "preference body must live in the owner-scoped table",
      );

      const [sharedPreferenceColumns] = await transaction.unsafe(`
        SELECT count(*)::integer AS count
        FROM information_schema.columns
        WHERE table_schema = '${schemaName}'
          AND table_name IN ('generation_jobs', 'chart_revisions')
          AND column_name ILIKE '%preference%'
      `);
      assert.equal(sharedPreferenceColumns.count, 0, "shared Job and Revision tables must have no preference columns");

      const revocationColumns = Array.from(
        await transaction.unsafe(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = '${schemaName}'
            AND table_name = 'user_preference_memory_revocations'
          ORDER BY ordinal_position
        `),
      );
      assert.deepEqual(
        revocationColumns.map((column) => column.column_name),
        ["owner_id", "logical_memory_id", "revoked_at"],
        "private revocation tombstones must retain no preference body or digest",
      );

      const [historical] = await transaction.unsafe(`
        SELECT
          j."prompt" AS job_prompt,
          j."plugin_context" AS plugin_context,
          j."plugin_usage" AS plugin_usage,
          j."model_route" AS model_route,
          j."execution_assembly" AS job_execution_assembly,
          r."output_objects" AS revision_outputs,
          r."plugin_snapshot" AS plugin_snapshot,
          r."execution_assembly" AS revision_execution_assembly,
          t."config" AS theme_config,
          t."theme_ref" AS theme_ref
        FROM "generation_jobs" j
        JOIN "chart_revisions" r ON r."generation_job_id" = j."id"
        JOIN "project_themes" t ON t."project_id" = j."project_id"
        WHERE j."id" = '00000000-0000-0000-0000-000000000006'
      `);
      assert.equal(
        historical,
        undefined,
        "legacy project-scoped Data Asset records must be cleaned before source becomes required",
      );

      const [legacyAssets] = await transaction.unsafe(`
        SELECT count(*)::integer AS count
        FROM "data_assets"
        WHERE "id" = '00000000-0000-0000-0000-000000000003'
      `);
      assert.equal(legacyAssets.count, 0, "legacy Data Asset metadata must not survive the provenance migration");

      const [sourceKey] = await transaction.unsafe(`
        SELECT s."source_object_key"
        FROM "data_snapshots" s
        WHERE s."id" = '00000000-0000-0000-0000-00000000000a'
      `);
      assert.equal(
        sourceKey.source_object_key,
        "workspaces/00000000-0000-0000-0000-000000000001/projects/00000000-0000-0000-0000-000000000002/conversations/00000000-0000-0000-0000-000000000005/user-data/uploads/00000000-0000-0000-0000-000000000009/source/historical-v1.csv",
        "historical source object keys must be moved to their Data Snapshot",
      );

      const [legacyObjectColumn] = await transaction.unsafe(`
        SELECT count(*)::integer AS count
        FROM information_schema.columns
        WHERE table_schema = '${schemaName}'
          AND table_name = 'data_assets'
          AND column_name = 'object_key'
      `);
      assert.equal(legacyObjectColumn.count, 0, "Data Asset must not retain a project-level source object key");

      const [snapshotSourceColumn] = await transaction.unsafe(`
        SELECT is_nullable
        FROM information_schema.columns
        WHERE table_schema = '${schemaName}'
          AND table_name = 'data_snapshots'
          AND column_name = 'source_object_key'
      `);
      assert.equal(snapshotSourceColumn.is_nullable, "NO", "Data Snapshot source object keys must be non-null");

      const [sourceColumn] = await transaction.unsafe(`
        SELECT is_nullable
        FROM information_schema.columns
        WHERE table_schema = '${schemaName}'
          AND table_name = 'data_assets'
          AND column_name = 'source_conversation_id'
      `);
      assert.equal(sourceColumn.is_nullable, "NO", "Data Asset provenance must be non-null");

      const snapshotSourceColumns = Array.from(
        await transaction.unsafe(`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = '${schemaName}'
          AND table_name = 'data_snapshots'
          AND column_name IN ('source_name', 'source_type', 'mime_type', 'size_bytes')
        ORDER BY column_name
      `),
      );
      assert.deepEqual(
        snapshotSourceColumns,
        [
          { column_name: "mime_type", is_nullable: "YES" },
          { column_name: "size_bytes", is_nullable: "YES" },
          { column_name: "source_name", is_nullable: "YES" },
          { column_name: "source_type", is_nullable: "YES" },
        ],
        "Data Snapshot source metadata must be nullable for historical records",
      );

      const [legacySnapshotMetadata] = await transaction.unsafe(`
        SELECT "source_name", "source_type", "mime_type", "size_bytes"
        FROM "data_snapshots"
        WHERE "id" = '00000000-0000-0000-0000-00000000000a'
      `);
      assert.deepEqual(
        legacySnapshotMetadata,
        { source_name: null, source_type: null, mime_type: null, size_bytes: null },
        "historical Snapshot source metadata must not be backfilled",
      );

      const [errorCodeColumn] = await transaction.unsafe(`
        SELECT count(*)::integer AS count
        FROM information_schema.columns
        WHERE table_schema = '${schemaName}'
          AND table_name = 'data_assets'
          AND column_name = 'error_code'
      `);
      assert.equal(errorCodeColumn.count, 1, "Data Asset failure codes must be persisted");

      const sourceForeignKeys = await transaction.unsafe(`
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class r ON r.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
        WHERE n.nspname = '${schemaName}'
          AND r.relname = 'data_assets'
          AND c.conname = 'data_assets_source_conversation_id_conversations_id_fk'
      `);
      assert.equal(sourceForeignKeys.length, 0, "Data Asset provenance must not use a live Conversation FK");

      const [columns] = await transaction.unsafe(`
        SELECT count(*)::integer AS count
        FROM information_schema.columns
        WHERE table_schema = '${schemaName}'
          AND ((table_name = 'generation_jobs' AND column_name IN ('plugin_context', 'plugin_usage', 'model_route', 'execution_assembly'))
            OR (table_name = 'chart_revisions' AND column_name IN ('plugin_snapshot', 'execution_assembly'))
            OR (table_name = 'project_themes' AND column_name = 'theme_ref'))
      `);
      assert.equal(columns.count, 7, "all compatibility columns must exist");

      const [credentialsTable] = await transaction.unsafe(`
        SELECT count(*)::integer AS count
        FROM information_schema.tables
        WHERE table_schema = '${schemaName}'
          AND table_name = 'workspace_model_credentials'
      `);
      assert.equal(credentialsTable.count, 1, "Workspace model credential table must exist");

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

      const [usersTable] = await transaction.unsafe(`
        SELECT count(*)::integer AS count
        FROM information_schema.tables
        WHERE table_schema = '${schemaName}' AND table_name = 'users'
      `);
      assert.equal(usersTable.count, 1, "database-backed account table must exist");

      const userColumns = Array.from(
        await transaction.unsafe(`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = '${schemaName}' AND table_name = 'users'
        ORDER BY ordinal_position
      `),
      );
      assert.deepEqual(
        userColumns,
        [
          { column_name: "id", is_nullable: "NO" },
          { column_name: "username", is_nullable: "NO" },
          { column_name: "username_key", is_nullable: "NO" },
          { column_name: "password_hash", is_nullable: "NO" },
          { column_name: "status", is_nullable: "NO" },
          { column_name: "created_at", is_nullable: "NO" },
          { column_name: "updated_at", is_nullable: "NO" },
          { column_name: "password_changed_at", is_nullable: "NO" },
          { column_name: "disabled_at", is_nullable: "YES" },
          { column_name: "legacy_auth_subject", is_nullable: "YES" },
          { column_name: "legacy_auth_subject_expires_at", is_nullable: "YES" },
        ],
        "account table columns must match the intended lifecycle and migration fields",
      );

      const userIndexes = await transaction.unsafe(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = '${schemaName}'
          AND indexname IN ('users_username_key_unique', 'users_legacy_auth_subject_unique')
      `);
      assert.equal(userIndexes.length, 2, "username keys and nullable legacy subjects must be unique");

      const accountStatuses = Array.from(
        await transaction.unsafe(`
        SELECT e.enumlabel
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = '${schemaName}' AND t.typname = 'user_account_status'
        ORDER BY e.enumsortorder
      `),
      );
      assert.deepEqual(
        accountStatuses,
        [{ enumlabel: "active" }, { enumlabel: "disabled" }],
        "account status enum must preserve enabled and disabled states",
      );

      const memberIdentityColumns = Array.from(
        await transaction.unsafe(`
        SELECT table_name, data_type
        FROM information_schema.columns
        WHERE table_schema = '${schemaName}'
          AND ((table_name = 'members' AND column_name = 'user_id')
            OR (table_name = 'project_members' AND column_name = 'user_id'))
        ORDER BY table_name
      `),
      );
      assert.deepEqual(
        memberIdentityColumns,
        [
          { table_name: "members", data_type: "text" },
          { table_name: "project_members", data_type: "text" },
        ],
        "legacy member identity references must remain migratable text IDs",
      );
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
