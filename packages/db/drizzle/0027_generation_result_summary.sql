ALTER TABLE "generation_jobs" ADD COLUMN "result_summary" jsonb;
--> statement-breakpoint
ALTER TABLE "chart_revisions" ADD COLUMN "result_summary" jsonb;
--> statement-breakpoint
ALTER TABLE "evidence_blocks" ADD COLUMN "result_summary" jsonb;
