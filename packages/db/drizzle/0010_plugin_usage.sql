ALTER TABLE "generation_jobs" ADD COLUMN "plugin_usage" jsonb DEFAULT '{}'::jsonb NOT NULL;
