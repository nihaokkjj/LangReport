CREATE TABLE "memory_revocation_replay_state" (
  "singleton_id" integer PRIMARY KEY,
  "ledger_id" text NOT NULL,
  "sequence" bigint NOT NULL,
  "digest" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "memory_revocation_replay_state_singleton_check" CHECK ("singleton_id" = 1),
  CONSTRAINT "memory_revocation_replay_state_sequence_check" CHECK ("sequence" >= 0),
  CONSTRAINT "memory_revocation_replay_state_digest_check" CHECK ("digest" ~ '^[0-9a-f]{64}$')
);
