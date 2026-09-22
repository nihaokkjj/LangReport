ALTER TABLE "conversation_messages" ADD COLUMN "client_request_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_conversation_client_request_unique" ON "conversation_messages" USING btree ("conversation_id","client_request_id");
--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "clarification_questions" jsonb;
