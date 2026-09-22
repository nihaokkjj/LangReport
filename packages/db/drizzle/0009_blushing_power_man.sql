CREATE TYPE "public"."analysis_brief_status" AS ENUM('draft', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."evidence_block_status" AS ENUM('draft', 'in_review', 'approved', 'changes_requested');--> statement-breakpoint
CREATE TYPE "public"."metric_definition_status" AS ENUM('inferred', 'confirmed');--> statement-breakpoint
CREATE TABLE "analysis_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"business_question" text NOT NULL,
	"audience" text DEFAULT '客户汇报' NOT NULL,
	"time_range" text,
	"time_grain" text,
	"output_format" text DEFAULT 'evidence_block' NOT NULL,
	"status" "analysis_brief_status" DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"generation_job_id" uuid NOT NULL,
	"chart_artifact_id" uuid NOT NULL,
	"chart_revision_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"title" text NOT NULL,
	"finding" text NOT NULL,
	"analysis_brief_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metric_definition_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quality_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "evidence_block_status" DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"source_conversation_id" uuid,
	"name" text NOT NULL,
	"meaning" text NOT NULL,
	"formula" text NOT NULL,
	"unit" text NOT NULL,
	"time_rule" text NOT NULL,
	"filter_rule" text,
	"status" "metric_definition_status" DEFAULT 'inferred' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chart_revisions" ADD COLUMN "analysis_brief_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "chart_revisions" ADD COLUMN "metric_definition_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "analysis_brief_id" uuid;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "metric_definition_id" uuid;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "analysis_brief_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "metric_definition_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_briefs" ADD CONSTRAINT "analysis_briefs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_briefs" ADD CONSTRAINT "analysis_briefs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_blocks" ADD CONSTRAINT "evidence_blocks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_blocks" ADD CONSTRAINT "evidence_blocks_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_blocks" ADD CONSTRAINT "evidence_blocks_generation_job_id_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_blocks" ADD CONSTRAINT "evidence_blocks_chart_artifact_id_chart_artifacts_id_fk" FOREIGN KEY ("chart_artifact_id") REFERENCES "public"."chart_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_blocks" ADD CONSTRAINT "evidence_blocks_chart_revision_id_chart_revisions_id_fk" FOREIGN KEY ("chart_revision_id") REFERENCES "public"."chart_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_blocks" ADD CONSTRAINT "evidence_blocks_snapshot_id_data_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."data_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_definitions" ADD CONSTRAINT "metric_definitions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_definitions" ADD CONSTRAINT "metric_definitions_source_conversation_id_conversations_id_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_briefs_project_idx" ON "analysis_briefs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "analysis_briefs_conversation_idx" ON "analysis_briefs" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_blocks_generation_job_unique" ON "evidence_blocks" USING btree ("generation_job_id");--> statement-breakpoint
CREATE INDEX "evidence_blocks_project_idx" ON "evidence_blocks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "evidence_blocks_conversation_idx" ON "evidence_blocks" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "evidence_blocks_revision_idx" ON "evidence_blocks" USING btree ("chart_revision_id");--> statement-breakpoint
CREATE INDEX "metric_definitions_project_idx" ON "metric_definitions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "metric_definitions_project_status_idx" ON "metric_definitions" USING btree ("project_id","status");--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_analysis_brief_id_analysis_briefs_id_fk" FOREIGN KEY ("analysis_brief_id") REFERENCES "public"."analysis_briefs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_metric_definition_id_metric_definitions_id_fk" FOREIGN KEY ("metric_definition_id") REFERENCES "public"."metric_definitions"("id") ON DELETE set null ON UPDATE no action;