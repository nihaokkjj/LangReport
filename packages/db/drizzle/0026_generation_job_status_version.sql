ALTER TABLE "generation_jobs" ADD COLUMN "status_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "status_changed_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "generation_jobs_status_notify"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_notify('langreport_generation_job_status', NEW."id"::text || ':' || NEW."status_version"::text);
  ELSIF NEW."status_version" IS DISTINCT FROM OLD."status_version" THEN
    PERFORM pg_notify('langreport_generation_job_status', NEW."id"::text || ':' || NEW."status_version"::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "generation_jobs_status_notify_trigger"
AFTER INSERT OR UPDATE OF "status_version" ON "generation_jobs"
FOR EACH ROW EXECUTE FUNCTION "generation_jobs_status_notify"();
