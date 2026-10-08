ALTER TABLE "chart_revisions" ADD COLUMN "integrity_status" text DEFAULT 'legacy_unverified' NOT NULL;
--> statement-breakpoint
ALTER TABLE "chart_revisions" ADD CONSTRAINT "chart_revisions_integrity_status_check" CHECK ("integrity_status" IN ('legacy_unverified', 'verified'));
--> statement-breakpoint
ALTER TABLE "evidence_blocks" ADD COLUMN "binding_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "evidence_blocks" ADD CONSTRAINT "evidence_blocks_binding_version_check" CHECK ("binding_version" IN (1, 2));
--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_blocks_verified_revision_unique" ON "evidence_blocks" ("chart_revision_id") WHERE "binding_version" = 2;
--> statement-breakpoint
CREATE TABLE "chart_lifecycle_control" (
  "id" text PRIMARY KEY DEFAULT 'singleton' CONSTRAINT "chart_lifecycle_control_id_check" CHECK ("id" = 'singleton'),
  "mode" text NOT NULL DEFAULT 'writable' CONSTRAINT "chart_lifecycle_control_mode_check" CHECK ("mode" IN ('writable', 'read_only'))
);
INSERT INTO "chart_lifecycle_control" ("id") VALUES ('singleton');
--> statement-breakpoint
CREATE FUNCTION "guard_chart_lifecycle_writer"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE lifecycle_mode text;
BEGIN
  SELECT "mode" INTO lifecycle_mode FROM "chart_lifecycle_control" WHERE "id" = 'singleton' FOR SHARE;
  IF lifecycle_mode IS DISTINCT FROM 'writable' THEN
    RAISE EXCEPTION 'EVIDENCE_LIFECYCLE_READ_ONLY' USING ERRCODE = '55000';
  END IF;
  IF current_setting('application_name') IS DISTINCT FROM 'langreport-lifecycle-v2' THEN
    RAISE EXCEPTION 'EVIDENCE_WRITER_VERSION_MISMATCH' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "generation_jobs_lifecycle_writer" BEFORE INSERT OR UPDATE OR DELETE ON "generation_jobs" FOR EACH ROW EXECUTE FUNCTION "guard_chart_lifecycle_writer"();
CREATE TRIGGER "chart_artifacts_lifecycle_writer" BEFORE INSERT OR UPDATE OR DELETE ON "chart_artifacts" FOR EACH ROW EXECUTE FUNCTION "guard_chart_lifecycle_writer"();
CREATE TRIGGER "chart_revisions_lifecycle_writer" BEFORE INSERT OR UPDATE OR DELETE ON "chart_revisions" FOR EACH ROW EXECUTE FUNCTION "guard_chart_lifecycle_writer"();
CREATE TRIGGER "evidence_blocks_lifecycle_writer" BEFORE INSERT OR UPDATE OR DELETE ON "evidence_blocks" FOR EACH ROW EXECUTE FUNCTION "guard_chart_lifecycle_writer"();
CREATE TRIGGER "chart_reviews_lifecycle_writer" BEFORE INSERT OR UPDATE OR DELETE ON "chart_reviews" FOR EACH ROW EXECUTE FUNCTION "guard_chart_lifecycle_writer"();
--> statement-breakpoint
CREATE FUNCTION "guard_verified_evidence_binding"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE target "chart_revisions"%ROWTYPE; target_project uuid; target_job "generation_jobs"%ROWTYPE;
BEGIN
  SELECT * INTO target FROM "chart_revisions" WHERE "id" = NEW."chart_revision_id" FOR UPDATE;
  IF target."integrity_status" = 'verified' OR NEW."binding_version" = 2 THEN
    SELECT "project_id" INTO target_project FROM "chart_artifacts" WHERE "id" = target."artifact_id";
    SELECT * INTO target_job FROM "generation_jobs" WHERE "id" = target."generation_job_id";
    IF target."integrity_status" IS DISTINCT FROM 'verified' OR NEW."binding_version" <> 2
      OR NEW."chart_artifact_id" IS DISTINCT FROM target."artifact_id"
      OR NEW."generation_job_id" IS DISTINCT FROM target."generation_job_id"
      OR NEW."snapshot_id" IS DISTINCT FROM target."snapshot_id"
      OR NEW."project_id" IS DISTINCT FROM target_project
      OR target_job."project_id" IS DISTINCT FROM target_project
      OR target_job."snapshot_id" IS DISTINCT FROM target."snapshot_id"
      OR NEW."conversation_id" IS DISTINCT FROM target_job."conversation_id"
      OR NEW."analysis_brief_snapshot" IS DISTINCT FROM target."analysis_brief_snapshot"
      OR NEW."metric_definition_snapshot" IS DISTINCT FROM target."metric_definition_snapshot" THEN
      RAISE EXCEPTION 'VERIFIED_EVIDENCE_BINDING_MISMATCH' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM "evidence_blocks" WHERE "chart_revision_id" = target."id" AND "id" <> NEW."id") THEN
      RAISE EXCEPTION 'VERIFIED_EVIDENCE_DUPLICATE' USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "evidence_blocks_verified_binding" BEFORE INSERT OR UPDATE ON "evidence_blocks" FOR EACH ROW EXECUTE FUNCTION "guard_verified_evidence_binding"();
--> statement-breakpoint
CREATE VIEW "evidence_integrity_audit" AS
SELECT r."id" AS "revision_id", a."project_id", r."status", r."integrity_status",
  (SELECT count(*) FROM "evidence_blocks" b WHERE b."chart_revision_id" = r."id") AS "evidence_count",
  array_remove(ARRAY[
    CASE WHEN r."integrity_status" = 'legacy_unverified' THEN 'pre_v2_not_reverified' END,
    CASE WHEN (SELECT count(*) FROM "evidence_blocks" b WHERE b."chart_revision_id" = r."id") = 0 THEN 'missing_evidence' END,
    CASE WHEN (SELECT count(*) FROM "evidence_blocks" b WHERE b."chart_revision_id" = r."id") > 1 THEN 'duplicate_evidence' END,
    CASE WHEN EXISTS (SELECT 1 FROM "evidence_blocks" b WHERE b."chart_revision_id" = r."id" AND
      (b."generation_job_id" IS DISTINCT FROM r."generation_job_id" OR b."chart_artifact_id" <> r."artifact_id" OR b."project_id" <> a."project_id" OR b."snapshot_id" <> r."snapshot_id")) THEN 'mixed_evidence_binding' END,
    CASE WHEN j."id" IS NULL OR j."status" <> 'succeeded' THEN 'missing_successful_job' END,
    CASE WHEN COALESCE(r."analysis_brief_snapshot"->>'businessQuestion', '') = '' OR COALESCE(r."metric_definition_snapshot"->>'name', '') = '' OR COALESCE(r."metric_definition_snapshot"->>'formula', '') = '' THEN 'missing_provenance' END,
    CASE WHEN EXISTS (SELECT 1 FROM unnest(ARRAY['svg','png','html','vegaLite']) kind WHERE COALESCE(r."output_objects"->>kind, '') = '') THEN 'missing_output_keys' END
  ], NULL) AS "reasons"
FROM "chart_revisions" r JOIN "chart_artifacts" a ON a."id" = r."artifact_id"
LEFT JOIN "generation_jobs" j ON j."id" = r."generation_job_id";
