ALTER TABLE "data_assets" ADD COLUMN "error_code" text;--> statement-breakpoint
DO $$
BEGIN
  CREATE TEMP TABLE "data_asset_intake_cleanup_assets" ON COMMIT DROP AS
  SELECT a."id"
  FROM "data_assets" a
  JOIN "projects" p ON p."id" = a."project_id"
  WHERE a."source_conversation_id" IS NULL
     OR a."object_key" NOT LIKE 'workspaces/' || p."workspace_id"::text || '/projects/' || a."project_id"::text || '/conversations/' || a."source_conversation_id"::text || '/user-data/uploads/' || a."id"::text || '/source/%';

  CREATE TEMP TABLE "data_asset_intake_cleanup_snapshots" ON COMMIT DROP AS
  SELECT s."id"
  FROM "data_snapshots" s
  JOIN "data_assets" a ON a."id" = s."asset_id"
  JOIN "projects" p ON p."id" = a."project_id"
  WHERE a."id" IN (SELECT "id" FROM "data_asset_intake_cleanup_assets")
     OR s."normalized_object_key" <> 'workspaces/' || p."workspace_id"::text || '/projects/' || a."project_id"::text || '/conversations/' || a."source_conversation_id"::text || '/user-data/uploads/' || a."id"::text || '/snapshots/' || s."id"::text || '.json';

  CREATE TEMP TABLE "data_asset_intake_cleanup_jobs" ON COMMIT DROP AS
  SELECT j."id"
  FROM "generation_jobs" j
  WHERE j."data_asset_id" IN (SELECT "id" FROM "data_asset_intake_cleanup_assets")
     OR j."snapshot_id" IN (SELECT "id" FROM "data_asset_intake_cleanup_snapshots");

  CREATE TEMP TABLE "data_asset_intake_cleanup_revisions" ON COMMIT DROP AS
  SELECT r."id"
  FROM "chart_revisions" r
  WHERE r."generation_job_id" IN (SELECT "id" FROM "data_asset_intake_cleanup_jobs")
     OR r."snapshot_id" IN (SELECT "id" FROM "data_asset_intake_cleanup_snapshots");

  CREATE TEMP TABLE "data_asset_intake_cleanup_artifacts" ON COMMIT DROP AS
  SELECT DISTINCT r."artifact_id" AS "id"
  FROM "chart_revisions" r
  WHERE r."id" IN (SELECT "id" FROM "data_asset_intake_cleanup_revisions");

  DELETE FROM "evidence_blocks"
  WHERE "generation_job_id" IN (SELECT "id" FROM "data_asset_intake_cleanup_jobs")
     OR "snapshot_id" IN (SELECT "id" FROM "data_asset_intake_cleanup_snapshots")
     OR "chart_revision_id" IN (SELECT "id" FROM "data_asset_intake_cleanup_revisions");

  DELETE FROM "chart_revisions"
  WHERE "id" IN (SELECT "id" FROM "data_asset_intake_cleanup_revisions");

  DELETE FROM "generation_jobs"
  WHERE "id" IN (SELECT "id" FROM "data_asset_intake_cleanup_jobs");

  DELETE FROM "data_snapshots"
  WHERE "id" IN (SELECT "id" FROM "data_asset_intake_cleanup_snapshots");

  DELETE FROM "data_assets"
  WHERE "id" IN (SELECT "id" FROM "data_asset_intake_cleanup_assets");

  DELETE FROM "chart_artifacts" a
  WHERE a."id" IN (SELECT "id" FROM "data_asset_intake_cleanup_artifacts")
    AND NOT EXISTS (SELECT 1 FROM "chart_revisions" r WHERE r."artifact_id" = a."id");

  UPDATE "data_assets" a
  SET "status" = 'failed',
      "error_code" = 'SNAPSHOT_PERSIST_FAILED',
      "error_message" = '历史 Data Snapshot 无法重建，需重新导入数据'
  WHERE a."status" = 'ready'
    AND NOT EXISTS (SELECT 1 FROM "data_snapshots" s WHERE s."asset_id" = a."id");
END $$;--> statement-breakpoint
ALTER TABLE "data_assets" DROP CONSTRAINT IF EXISTS "data_assets_source_conversation_id_conversations_id_fk";--> statement-breakpoint
ALTER TABLE "data_assets" ALTER COLUMN "source_conversation_id" SET NOT NULL;
