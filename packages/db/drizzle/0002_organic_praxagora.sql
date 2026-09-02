CREATE TYPE "public"."chart_artifact_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."chart_review_action" AS ENUM('submitted', 'approved', 'changes_requested');--> statement-breakpoint
CREATE TYPE "public"."chart_revision_status" AS ENUM('draft', 'in_review', 'approved', 'changes_requested', 'archived');--> statement-breakpoint
CREATE TYPE "public"."conversation_message_role" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TYPE "public"."generation_job_operation" AS ENUM('generate', 'edit', 'rollback', 'copy');--> statement-breakpoint
CREATE TYPE "public"."generation_job_status" AS ENUM('queued', 'profiling', 'planning', 'transforming', 'compiling', 'rendering', 'validating', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chart_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"head_revision_id" uuid,
	"published_revision_id" uuid,
	"status" chart_artifact_status DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "chart_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"anchor" jsonb,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chart_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"action" chart_review_action NOT NULL,
	"actor_id" text NOT NULL,
	"note" text,
	"review_cycle" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chart_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"generation_job_id" uuid,
	"snapshot_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"status" chart_revision_status DEFAULT 'draft' NOT NULL,
	"parent_revision_id" uuid,
	"created_by" text NOT NULL,
	"change_reason" text,
	"transform_plan" jsonb NOT NULL,
	"field_lineage" jsonb NOT NULL,
	"flint_spec" jsonb NOT NULL,
	"theme_snapshot" jsonb NOT NULL,
	"vega_lite_spec" jsonb NOT NULL,
	"validation" jsonb NOT NULL,
	"output_objects" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chart_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "conversation_message_role" NOT NULL,
	"content" text NOT NULL,
	"intent" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"data_asset_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"input_fingerprint" text NOT NULL,
	"renderer" text DEFAULT 'vega-lite' NOT NULL,
	"renderer_version" text DEFAULT 'vega-lite-svg-v1' NOT NULL,
	"theme" text DEFAULT 'economist' NOT NULL,
	"theme_version" text DEFAULT 'v1' NOT NULL,
	"operation" "generation_job_operation" DEFAULT 'generate' NOT NULL,
	"artifact_id" uuid,
	"base_revision_id" uuid,
	"edit_patch" jsonb,
	"status" "generation_job_status" DEFAULT 'queued' NOT NULL,
	"intent" jsonb,
	"transform_plan" jsonb,
	"field_lineage" jsonb,
	"flint_spec" jsonb,
	"validation" jsonb,
	"vega_lite_spec" jsonb,
	"preview_data" jsonb,
	"outputs" jsonb,
	"repair_count" integer DEFAULT 0 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_themes" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"preset" text DEFAULT 'economist' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_artifacts" ADD CONSTRAINT "chart_artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_comments" ADD CONSTRAINT "chart_comments_revision_id_chart_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."chart_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_reviews" ADD CONSTRAINT "chart_reviews_revision_id_chart_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."chart_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_revisions" ADD CONSTRAINT "chart_revisions_artifact_id_chart_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."chart_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_revisions" ADD CONSTRAINT "chart_revisions_generation_job_id_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_revisions" ADD CONSTRAINT "chart_revisions_snapshot_id_data_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."data_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_shares" ADD CONSTRAINT "chart_shares_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_shares" ADD CONSTRAINT "chart_shares_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_shares" ADD CONSTRAINT "chart_shares_revision_id_chart_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."chart_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_data_asset_id_data_assets_id_fk" FOREIGN KEY ("data_asset_id") REFERENCES "public"."data_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_snapshot_id_data_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."data_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_themes" ADD CONSTRAINT "project_themes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_workspace_created_idx" ON "audit_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_project_created_idx" ON "audit_events" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "chart_artifacts_project_idx" ON "chart_artifacts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "chart_artifacts_status_idx" ON "chart_artifacts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "chart_comments_revision_idx" ON "chart_comments" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "chart_comments_author_idx" ON "chart_comments" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "chart_reviews_revision_idx" ON "chart_reviews" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "chart_reviews_actor_idx" ON "chart_reviews" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chart_revisions_artifact_revision_unique" ON "chart_revisions" USING btree ("artifact_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "chart_revisions_generation_job_unique" ON "chart_revisions" USING btree ("generation_job_id");--> statement-breakpoint
CREATE INDEX "chart_revisions_snapshot_idx" ON "chart_revisions" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "chart_revisions_artifact_status_idx" ON "chart_revisions" USING btree ("artifact_id","status");--> statement-breakpoint
CREATE INDEX "chart_revisions_parent_idx" ON "chart_revisions" USING btree ("parent_revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chart_shares_token_unique" ON "chart_shares" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "chart_shares_project_idx" ON "chart_shares" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "chart_shares_revision_idx" ON "chart_shares" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "conversation_messages_conversation_idx" ON "conversation_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversations_project_idx" ON "conversations" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_jobs_project_idempotency_unique" ON "generation_jobs" USING btree ("project_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "generation_jobs_status_idx" ON "generation_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "generation_jobs_project_idx" ON "generation_jobs" USING btree ("project_id");