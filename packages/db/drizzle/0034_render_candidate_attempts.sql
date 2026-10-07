CREATE TABLE "render_candidate_attempts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "generation_job_id" uuid NOT NULL REFERENCES "generation_jobs"("id") ON DELETE CASCADE,
  "revision_id" uuid NOT NULL,
  "lease_fencing_token" integer NOT NULL,
  "output_keys" jsonb NOT NULL,
  "status" text DEFAULT 'writing' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "render_candidate_attempts_status_check" CHECK ("status" IN ('writing', 'validated', 'published', 'deleting', 'deleted', 'quarantined'))
);
--> statement-breakpoint
CREATE INDEX "render_candidate_attempts_job_idx" ON "render_candidate_attempts" ("generation_job_id");
--> statement-breakpoint
CREATE INDEX "render_candidate_attempts_reconcile_idx" ON "render_candidate_attempts" ("status", "created_at");
--> statement-breakpoint
CREATE INDEX "render_candidate_attempts_resweep_idx" ON "render_candidate_attempts" ("status", "updated_at");
