DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM memories
    WHERE status = 'active'
    GROUP BY workspace_id, scope, project_id, memory_key
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Memory migration blocked: duplicate active heads require a review report before applying';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM memories
    GROUP BY workspace_id, scope, project_id, memory_key, version
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Memory migration blocked: duplicate legacy versions require a review report before applying';
  END IF;
END $$;--> statement-breakpoint

CREATE TYPE "memory_conflict_status" AS ENUM('clear', 'disputed');--> statement-breakpoint
CREATE TYPE "user_preference_category" AS ENUM('language', 'tone', 'detail', 'interaction', 'output_format');--> statement-breakpoint

ALTER TABLE "memories" ADD COLUMN "logical_memory_id" uuid;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "conflict_status" "memory_conflict_status" DEFAULT 'clear' NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "effective_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "effective_to" timestamp with time zone;--> statement-breakpoint

WITH logical_ids AS (
  SELECT workspace_id, scope, project_id, memory_key, gen_random_uuid() AS logical_memory_id
  FROM memories
  GROUP BY workspace_id, scope, project_id, memory_key
)
UPDATE memories AS memory
SET logical_memory_id = logical_ids.logical_memory_id
FROM logical_ids
WHERE memory.workspace_id = logical_ids.workspace_id
  AND memory.scope = logical_ids.scope
  AND memory.project_id IS NOT DISTINCT FROM logical_ids.project_id
  AND memory.memory_key = logical_ids.memory_key;--> statement-breakpoint

UPDATE memories AS memory
SET confirmed_at = candidate.reviewed_at,
    effective_from = candidate.reviewed_at
FROM memory_candidates AS candidate
WHERE memory.source_candidate_id = candidate.id
  AND candidate.status = 'accepted'
  AND candidate.reviewed_at IS NOT NULL;--> statement-breakpoint

ALTER TABLE "memories" ALTER COLUMN "logical_memory_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "memories_logical_version_unique" ON "memories" USING btree ("logical_memory_id", "version");--> statement-breakpoint
CREATE UNIQUE INDEX "memories_project_active_key_unique" ON "memories" USING btree ("project_id", "memory_key") WHERE "scope" = 'project' AND "status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "memories_workspace_active_key_unique" ON "memories" USING btree ("workspace_id", "memory_key") WHERE "scope" = 'workspace' AND "status" = 'active';--> statement-breakpoint
CREATE INDEX "memories_logical_status_idx" ON "memories" USING btree ("logical_memory_id", "status");--> statement-breakpoint

CREATE TABLE "user_preference_memories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "logical_memory_id" uuid NOT NULL,
  "owner_id" text NOT NULL,
  "category" "user_preference_category" NOT NULL,
  "memory_key" text NOT NULL,
  "statement" text NOT NULL,
  "value" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "source_conversation_id" uuid,
  "source_message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "version" integer NOT NULL,
  "status" "memory_record_status" DEFAULT 'active' NOT NULL,
  "confirmed_at" timestamp with time zone NOT NULL,
  "effective_from" timestamp with time zone NOT NULL,
  "effective_to" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "user_preference_memories" ADD CONSTRAINT "user_preference_memories_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preference_memories" ADD CONSTRAINT "user_preference_memories_source_conversation_id_conversations_id_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_preference_memory_logical_version_unique" ON "user_preference_memories" USING btree ("logical_memory_id", "version");--> statement-breakpoint
CREATE UNIQUE INDEX "user_preference_memory_active_key_unique" ON "user_preference_memories" USING btree ("owner_id", "memory_key") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "user_preference_memory_owner_idx" ON "user_preference_memories" USING btree ("owner_id", "status", "memory_key");--> statement-breakpoint
CREATE INDEX "user_preference_memory_logical_idx" ON "user_preference_memories" USING btree ("owner_id", "logical_memory_id", "version");--> statement-breakpoint

CREATE TABLE "user_preference_memory_revocations" (
  "owner_id" text NOT NULL,
  "logical_memory_id" uuid NOT NULL,
  "revoked_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_preference_memory_revocations_pk" PRIMARY KEY ("owner_id", "logical_memory_id")
);--> statement-breakpoint
ALTER TABLE "user_preference_memory_revocations" ADD CONSTRAINT "user_preference_memory_revocations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE "project_memory_revocations" (
  "project_id" uuid NOT NULL,
  "logical_memory_id" uuid NOT NULL,
  "revoked_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_memory_revocations_pk" PRIMARY KEY ("project_id", "logical_memory_id")
);--> statement-breakpoint
ALTER TABLE "project_memory_revocations" ADD CONSTRAINT "project_memory_revocations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE "project_memory_source_suppressions" (
  "project_id" uuid NOT NULL,
  "source_message_id" uuid NOT NULL,
  "logical_memory_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_memory_source_suppressions_pk" PRIMARY KEY ("project_id", "source_message_id")
);--> statement-breakpoint
ALTER TABLE "project_memory_source_suppressions" ADD CONSTRAINT "project_memory_source_suppressions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memory_source_suppressions" ADD CONSTRAINT "project_memory_source_suppressions_source_message_id_conversation_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_memory_source_suppressions_memory_idx" ON "project_memory_source_suppressions" USING btree ("project_id", "logical_memory_id");--> statement-breakpoint

CREATE TABLE "user_preference_source_suppressions" (
  "owner_id" text NOT NULL,
  "source_message_id" uuid NOT NULL,
  "revoked_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_preference_source_suppressions_pk" PRIMARY KEY ("owner_id", "source_message_id")
);--> statement-breakpoint
ALTER TABLE "user_preference_source_suppressions" ADD CONSTRAINT "user_preference_source_suppressions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preference_source_suppressions" ADD CONSTRAINT "user_preference_source_suppressions_source_message_id_conversation_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE "private_generation_memory_contexts" (
  "generation_job_id" uuid PRIMARY KEY NOT NULL,
  "owner_id" text NOT NULL,
  "preference_version_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "private_generation_memory_contexts" ADD CONSTRAINT "private_generation_memory_contexts_generation_job_id_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_generation_memory_contexts" ADD CONSTRAINT "private_generation_memory_contexts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "private_generation_memory_contexts_owner_idx" ON "private_generation_memory_contexts" USING btree ("owner_id", "created_at");--> statement-breakpoint

CREATE TABLE "private_memory_invocation_usage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_id" text NOT NULL,
  "generation_job_id" uuid NOT NULL,
  "invocation_id" text NOT NULL,
  "preference_version_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'admitted' NOT NULL,
  "admitted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "private_memory_invocation_usage_status_check" CHECK ("status" IN ('admitted', 'succeeded', 'failed'))
);--> statement-breakpoint
ALTER TABLE "private_memory_invocation_usage" ADD CONSTRAINT "private_memory_invocation_usage_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_memory_invocation_usage" ADD CONSTRAINT "private_memory_invocation_usage_generation_job_id_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "private_memory_invocation_usage_owner_job_invocation_unique" ON "private_memory_invocation_usage" USING btree ("owner_id", "generation_job_id", "invocation_id");--> statement-breakpoint
CREATE INDEX "private_memory_invocation_usage_owner_admitted_idx" ON "private_memory_invocation_usage" USING btree ("owner_id", "admitted_at");
--> statement-breakpoint

CREATE TABLE "generation_memory_invocation_usage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "owner_id" text NOT NULL,
  "generation_job_id" uuid NOT NULL,
  "invocation_id" text NOT NULL,
  "memory_version_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'admitted' NOT NULL,
  "admitted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "generation_memory_invocation_usage" ADD CONSTRAINT "generation_memory_invocation_usage_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_memory_invocation_usage" ADD CONSTRAINT "generation_memory_invocation_usage_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_memory_invocation_usage" ADD CONSTRAINT "generation_memory_invocation_usage_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_memory_invocation_usage" ADD CONSTRAINT "generation_memory_invocation_usage_generation_job_id_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "generation_memory_invocation_usage_owner_job_invocation_unique" ON "generation_memory_invocation_usage" USING btree ("owner_id", "generation_job_id", "invocation_id");--> statement-breakpoint
CREATE INDEX "generation_memory_invocation_usage_project_admitted_idx" ON "generation_memory_invocation_usage" USING btree ("project_id", "admitted_at");
--> statement-breakpoint

CREATE TABLE "generation_job_context_sources" (
  "generation_job_id" uuid PRIMARY KEY NOT NULL,
  "project_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "source_message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "generation_job_context_sources" ADD CONSTRAINT "generation_job_context_sources_generation_job_id_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_job_context_sources" ADD CONSTRAINT "generation_job_context_sources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_job_context_sources" ADD CONSTRAINT "generation_job_context_sources_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_job_context_sources_project_conversation_idx" ON "generation_job_context_sources" USING btree ("project_id", "conversation_id");
