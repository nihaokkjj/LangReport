import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { resolve } from "node:path";
import * as schema from "./schema.js";

const integrationSchema = process.env.LANGREPORT_INTEGRATION_TEST === "1" ? process.env.DATABASE_SCHEMA : undefined;

function assertIsolatedIntegrationDatabase(): void {
  if (process.env.LANGREPORT_INTEGRATION_TEST !== "1") return;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests");
  const parsed = new URL(databaseUrl);
  const databaseName = decodeURIComponent(parsed.pathname).replace(/^\//, "");
  if (parsed.hostname !== "127.0.0.1" || parsed.port !== "54330" || !databaseName.endsWith("_test")) {
    throw new Error("Integration database must be the dedicated test Compose target");
  }
  if (!integrationSchema || integrationSchema === "public" || !/^langreport_test_[a-z0-9]+$/.test(integrationSchema)) {
    throw new Error("Integration database schema must identify one generated test run");
  }
}

if (process.env.LANGREPORT_OFFLINE_TEST !== "1" && process.env.LANGREPORT_INTEGRATION_TEST !== "1") {
  config({ path: resolve(process.cwd(), "../../.env") });
}

assertIsolatedIntegrationDatabase();

const configuredDatabaseUrl = process.env.DATABASE_URL;

if (!configuredDatabaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const databaseUrl: string = configuredDatabaseUrl;

const client = postgres(databaseUrl, {
  max: 5,
  prepare: false,
  ...(integrationSchema ? { connection: { search_path: integrationSchema } } : {})
});

export async function createDatabaseChannelListener(channel: string, onNotify: (payload: string) => void): Promise<() => Promise<void>> {
  const listenerClient = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    ...(integrationSchema ? { connection: { search_path: integrationSchema } } : {})
  });
  try {
    const subscription = await listenerClient.listen(channel, onNotify);
    return async () => {
      try {
        await subscription.unlisten();
      } finally {
        const listenSql = (listenerClient.listen as typeof listenerClient.listen & { sql?: { end(): Promise<void> } }).sql;
        if (listenSql) await listenSql.end().catch(() => undefined);
        await listenerClient.end().catch(() => undefined);
      }
    };
  } catch (error) {
    await listenerClient.end().catch(() => undefined);
    throw error;
  }
}

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
