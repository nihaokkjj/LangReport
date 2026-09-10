ALTER TABLE "generation_jobs" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "lease_token" text;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "lease_fencing_token" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "lease_heartbeat_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "generation_jobs_status_lease_expiry_idx" ON "generation_jobs" USING btree ("status","lease_expires_at");
