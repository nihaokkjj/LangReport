ALTER TABLE "projects" ADD COLUMN "client_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "objective" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "audience" text DEFAULT 'client_presentation' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "visual_template" text DEFAULT 'consulting-neutral' NOT NULL;
