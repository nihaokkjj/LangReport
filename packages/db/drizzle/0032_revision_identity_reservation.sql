ALTER TABLE "chart_artifacts" ADD COLUMN "next_revision_number" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
UPDATE "chart_artifacts" AS artifact SET "next_revision_number" = GREATEST(1, COALESCE((
  SELECT MAX(revision."revision") + 1 FROM "chart_revisions" AS revision WHERE revision."artifact_id" = artifact."id"
), 1));
--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "candidate_artifact_id" uuid;
--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "candidate_revision_id" uuid;
--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "candidate_revision_number" integer;
--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_candidate_identity_complete" CHECK (
  ("candidate_artifact_id" IS NULL AND "candidate_revision_id" IS NULL AND "candidate_revision_number" IS NULL)
  OR ("candidate_artifact_id" IS NOT NULL AND "candidate_revision_id" IS NOT NULL AND "candidate_revision_number" > 0)
);
