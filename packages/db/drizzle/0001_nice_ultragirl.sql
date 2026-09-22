CREATE TYPE "public"."data_asset_source_type" AS ENUM('csv', 'xlsx', 'json', 'pasted');--> statement-breakpoint
CREATE TYPE "public"."data_asset_status" AS ENUM('processing', 'ready', 'failed', 'archived', 'deleted');--> statement-breakpoint
CREATE TABLE "data_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source_type" "data_asset_source_type" NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"object_key" text NOT NULL,
	"status" "data_asset_status" DEFAULT 'processing' NOT NULL,
	"error_message" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"row_count" integer NOT NULL,
	"column_count" integer NOT NULL,
	"schema" jsonb NOT NULL,
	"preview" jsonb NOT NULL,
	"normalized_object_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_assets" ADD CONSTRAINT "data_assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_snapshots" ADD CONSTRAINT "data_snapshots_asset_id_data_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."data_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_assets_project_idx" ON "data_assets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "data_assets_status_idx" ON "data_assets" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "data_snapshots_asset_version_unique" ON "data_snapshots" USING btree ("asset_id","version");--> statement-breakpoint
CREATE INDEX "data_snapshots_asset_idx" ON "data_snapshots" USING btree ("asset_id");