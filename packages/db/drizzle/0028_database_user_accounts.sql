CREATE TYPE "user_account_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"username_key" text NOT NULL,
	"password_hash" text NOT NULL,
	"status" "user_account_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	"legacy_auth_subject" text,
	"legacy_auth_subject_expires_at" timestamp with time zone
);--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_key_unique" ON "users" USING btree ("username_key");--> statement-breakpoint
CREATE UNIQUE INDEX "users_legacy_auth_subject_unique" ON "users" USING btree ("legacy_auth_subject");
