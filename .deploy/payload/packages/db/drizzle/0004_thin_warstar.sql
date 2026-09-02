ALTER TABLE "chart_artifacts" ADD COLUMN "creation_key" text;--> statement-breakpoint
ALTER TABLE "chart_revisions" ADD COLUMN "operation_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "chart_artifacts_project_creation_key_unique" ON "chart_artifacts" USING btree ("project_id","creation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "chart_revisions_artifact_operation_key_unique" ON "chart_revisions" USING btree ("artifact_id","operation_key");