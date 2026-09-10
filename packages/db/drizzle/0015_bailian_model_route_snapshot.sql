ALTER TABLE "generation_jobs" ADD COLUMN "model_route" jsonb DEFAULT '{}'::jsonb NOT NULL;
