ALTER TYPE "public"."generation_job_status" ADD VALUE IF NOT EXISTS 'needs_clarification';--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "generation_audit" jsonb;
