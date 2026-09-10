ALTER TABLE "generation_jobs" ADD COLUMN "conversation_projection" jsonb DEFAULT '{}'::jsonb NOT NULL;
