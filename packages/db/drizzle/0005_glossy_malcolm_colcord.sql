CREATE TYPE "public"."memory_candidate_status" AS ENUM('proposed', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."memory_extraction_job_status" AS ENUM('queued', 'processing', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."memory_record_status" AS ENUM('active', 'superseded', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."memory_scope" AS ENUM('project', 'workspace');--> statement-breakpoint
CREATE TYPE "public"."memory_type" AS ENUM('metric_definition', 'data_definition', 'business_rule', 'terminology', 'visual_preference');--> statement-breakpoint
CREATE TABLE "conversation_memory_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_through_message_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"scope" "memory_scope" NOT NULL,
	"memory_key" text NOT NULL,
	"memory_type" "memory_type" NOT NULL,
	"statement" text NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "memory_record_status" DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source_candidate_id" uuid,
	"source_conversation_id" uuid,
	"source_message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_by" text,
	"deleted_at" timestamp with time zone,
	"superseded_by" uuid,
	CONSTRAINT "memories_scope_project_check" CHECK (("scope" = 'project' AND "project_id" IS NOT NULL) OR ("scope" = 'workspace' AND "project_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "memory_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"source_message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"candidate_fingerprint" text NOT NULL,
	"memory_key" text NOT NULL,
	"memory_type" "memory_type" NOT NULL,
	"statement" text NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scope_hint" "memory_scope" NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"extractor_version" text NOT NULL,
	"status" "memory_candidate_status" DEFAULT 'proposed' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"target_memory_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_extraction_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"source_through_message_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"extractor_version" text NOT NULL,
	"status" "memory_extraction_job_status" DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chart_revisions" ADD COLUMN "memory_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "memory_context" jsonb;--> statement-breakpoint
ALTER TABLE "conversation_memory_snapshots" ADD CONSTRAINT "conversation_memory_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_memory_snapshots" ADD CONSTRAINT "conversation_memory_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_memory_snapshots" ADD CONSTRAINT "conversation_memory_snapshots_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_memory_snapshots" ADD CONSTRAINT "conversation_memory_snapshots_source_through_message_id_conversation_messages_id_fk" FOREIGN KEY ("source_through_message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_source_conversation_id_conversations_id_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_candidates" ADD CONSTRAINT "memory_candidates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_candidates" ADD CONSTRAINT "memory_candidates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_candidates" ADD CONSTRAINT "memory_candidates_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_candidates" ADD CONSTRAINT "memory_candidates_target_memory_id_memories_id_fk" FOREIGN KEY ("target_memory_id") REFERENCES "public"."memories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_extraction_jobs" ADD CONSTRAINT "memory_extraction_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_extraction_jobs" ADD CONSTRAINT "memory_extraction_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_extraction_jobs" ADD CONSTRAINT "memory_extraction_jobs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_extraction_jobs" ADD CONSTRAINT "memory_extraction_jobs_source_through_message_id_conversation_messages_id_fk" FOREIGN KEY ("source_through_message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_memory_snapshots_conversation_unique" ON "conversation_memory_snapshots" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_memory_snapshots_project_idx" ON "conversation_memory_snapshots" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "memories_workspace_status_key_idx" ON "memories" USING btree ("workspace_id","status","memory_key");--> statement-breakpoint
CREATE INDEX "memories_project_status_key_idx" ON "memories" USING btree ("project_id","status","memory_key");--> statement-breakpoint
CREATE INDEX "memories_source_candidate_idx" ON "memories" USING btree ("source_candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_candidates_conversation_fingerprint_unique" ON "memory_candidates" USING btree ("conversation_id","candidate_fingerprint");--> statement-breakpoint
CREATE INDEX "memory_candidates_project_status_idx" ON "memory_candidates" USING btree ("project_id","status","created_at");--> statement-breakpoint
CREATE INDEX "memory_candidates_workspace_status_idx" ON "memory_candidates" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_extraction_jobs_conversation_key_unique" ON "memory_extraction_jobs" USING btree ("conversation_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "memory_extraction_jobs_status_idx" ON "memory_extraction_jobs" USING btree ("status","created_at");