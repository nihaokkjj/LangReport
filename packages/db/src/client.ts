import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { resolve } from "node:path";
import * as schema from "./schema.js";

config({ path: resolve(process.cwd(), "../../.env") });

const configuredDatabaseUrl = process.env.DATABASE_URL;

if (!configuredDatabaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const databaseUrl: string = configuredDatabaseUrl;

const client = postgres(databaseUrl, {
  max: 5,
  prepare: false
});

export const db = drizzle({ client, schema });

export async function withAdvisoryLock<T>(key: string, callback: () => Promise<T>): Promise<T | undefined> {
  const lockClient = postgres(databaseUrl, {
    max: 1,
    prepare: false
  });
  try {
    const [lock] = await lockClient`select pg_try_advisory_lock(hashtextextended(${key}, 0)) as locked`;
    if (!lock?.locked) return undefined;
    try {
      return await callback();
    } finally {
      await lockClient`select pg_advisory_unlock(hashtextextended(${key}, 0))`;
    }
  } finally {
    await lockClient.end();
  }
}

export async function closeDatabase(): Promise<void> {
  await client.end();
}
