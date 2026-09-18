ALTER TYPE "generation_job_status" ADD VALUE IF NOT EXISTS 'cancelled';--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "parent_generation_job_id" uuid;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "generation_decision" jsonb;
