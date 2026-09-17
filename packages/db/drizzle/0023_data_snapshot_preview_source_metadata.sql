ALTER TABLE "data_snapshots" ADD COLUMN "source_name" text;--> statement-breakpoint
ALTER TABLE "data_snapshots" ADD COLUMN "source_type" "data_asset_source_type";--> statement-breakpoint
ALTER TABLE "data_snapshots" ADD COLUMN "mime_type" text;--> statement-breakpoint
ALTER TABLE "data_snapshots" ADD COLUMN "size_bytes" integer;
