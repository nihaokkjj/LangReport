ALTER TABLE "chart_revisions" ADD COLUMN "execution_assembly" jsonb;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "execution_assembly" jsonb;
