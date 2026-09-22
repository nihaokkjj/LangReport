CREATE TYPE "public"."plugin_installation_status" AS ENUM('installed', 'revoked', 'incompatible');--> statement-breakpoint
CREATE TYPE "public"."plugin_manifest_source" AS ENUM('builtin', 'uploaded');--> statement-breakpoint
CREATE TYPE "public"."plugin_validation_status" AS ENUM('valid', 'rejected', 'incompatible');--> statement-breakpoint
CREATE TYPE "public"."project_plugin_binding_status" AS ENUM('enabled', 'disabled');--> statement-breakpoint
CREATE TABLE "plugin_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"manifest_id" uuid NOT NULL,
	"plugin_id" text NOT NULL,
	"version" text NOT NULL,
	"content_hash" text NOT NULL,
	"status" "plugin_installation_status" DEFAULT 'installed' NOT NULL,
	"installed_by" text NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_by" text,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"idempotency_key" text NOT NULL,
	"last_compatibility_check" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_manifests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"source" "plugin_manifest_source" NOT NULL,
	"plugin_id" text NOT NULL,
	"version" text NOT NULL,
	"api_version" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"manifest" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"validation_status" "plugin_validation_status" DEFAULT 'valid' NOT NULL,
	"validation_report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_object_key" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_manifests_source_scope_check" CHECK (("source" = 'builtin' AND "workspace_id" IS NULL) OR ("source" = 'uploaded' AND "workspace_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "project_plugin_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"plugin_id" text NOT NULL,
	"version" text NOT NULL,
	"content_hash" text NOT NULL,
	"status" "project_plugin_binding_status" DEFAULT 'disabled' NOT NULL,
	"enabled_by" text,
	"enabled_at" timestamp with time zone,
	"disabled_by" text,
	"disabled_at" timestamp with time zone,
	"disabled_reason" text,
	"idempotency_key" text NOT NULL,
	"version_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chart_revisions" ADD COLUMN "plugin_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "plugin_context" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "project_themes" ADD COLUMN "theme_ref" jsonb;--> statement-breakpoint
ALTER TABLE "plugin_installations" ADD CONSTRAINT "plugin_installations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_installations" ADD CONSTRAINT "plugin_installations_manifest_id_plugin_manifests_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "public"."plugin_manifests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_manifests" ADD CONSTRAINT "plugin_manifests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_plugin_bindings" ADD CONSTRAINT "project_plugin_bindings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_plugin_bindings" ADD CONSTRAINT "project_plugin_bindings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_plugin_bindings" ADD CONSTRAINT "project_plugin_bindings_installation_id_plugin_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."plugin_installations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_installations_workspace_manifest_unique" ON "plugin_installations" USING btree ("workspace_id","manifest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_installations_workspace_idempotency_unique" ON "plugin_installations" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "plugin_installations_workspace_status_idx" ON "plugin_installations" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "plugin_installations_workspace_plugin_idx" ON "plugin_installations" USING btree ("workspace_id","plugin_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_manifests_builtin_identity_unique" ON "plugin_manifests" USING btree ("plugin_id","version","content_hash") WHERE "source" = 'builtin';--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_manifests_workspace_version_unique" ON "plugin_manifests" USING btree ("workspace_id","plugin_id","version") WHERE "source" = 'uploaded';--> statement-breakpoint
CREATE INDEX "plugin_manifests_workspace_plugin_idx" ON "plugin_manifests" USING btree ("workspace_id","plugin_id","version");--> statement-breakpoint
CREATE INDEX "plugin_manifests_hash_idx" ON "plugin_manifests" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "plugin_manifests_validation_idx" ON "plugin_manifests" USING btree ("validation_status");--> statement-breakpoint
CREATE UNIQUE INDEX "project_plugin_bindings_project_installation_unique" ON "project_plugin_bindings" USING btree ("project_id","installation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_plugin_bindings_project_idempotency_unique" ON "project_plugin_bindings" USING btree ("project_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "project_plugin_bindings_enabled_plugin_unique" ON "project_plugin_bindings" USING btree ("project_id","plugin_id") WHERE "status" = 'enabled';--> statement-breakpoint
CREATE INDEX "project_plugin_bindings_project_status_idx" ON "project_plugin_bindings" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "project_plugin_bindings_installation_status_idx" ON "project_plugin_bindings" USING btree ("installation_id","status");