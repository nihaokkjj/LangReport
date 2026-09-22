CREATE TABLE "workspace_model_credentials" (
  "workspace_id" uuid PRIMARY KEY NOT NULL,
  "provider" text DEFAULT 'bailian' NOT NULL,
  "encrypted_api_key" text NOT NULL,
  "key_suffix" text NOT NULL,
  "created_by" text NOT NULL,
  "updated_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_model_credentials_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "workspace_model_credentials_provider_idx" ON "workspace_model_credentials" USING btree ("provider");
