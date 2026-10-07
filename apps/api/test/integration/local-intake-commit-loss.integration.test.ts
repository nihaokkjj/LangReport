import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { once } from "node:events";
import test from "node:test";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import {
  closeDatabase,
  conversations,
  dataAssets,
  dataSnapshots,
  db,
  members,
  projects,
  workspaces,
} from "@langreport/db";
import * as schema from "../../../../packages/db/src/schema.js";
import { getObject } from "@langreport/storage";
import { createDataAssetIntake, createIntakeRepository } from "../../src/data-assets.js";

test(
  "lost PostgreSQL COMMIT confirmation preserves the already committed snapshot and S3 objects",
  { timeout: 30000 },
  async () => {
    assert.equal(process.env.LANGREPORT_INTEGRATION_TEST, "1");
    const target = new URL(process.env.DATABASE_URL!);
    assert.equal(target.hostname, "127.0.0.1");
    assert.equal(target.port, "54330");
    assert.ok(target.pathname.endsWith("_test"));
    assert.match(process.env.DATABASE_SCHEMA!, /^langreport_test_[a-z0-9]+$/);
    const userId = `commit-loss-${randomUUID()}`;
    const [workspace] = await db.insert(workspaces).values({ name: userId }).returning();
    await db.insert(members).values({ workspaceId: workspace.id, userId, role: "owner" });
    const [project] = await db
      .insert(projects)
      .values({ workspaceId: workspace.id, name: userId, slug: userId })
      .returning();
    const [conversation] = await db
      .insert(conversations)
      .values({ projectId: project.id, title: userId, createdBy: userId })
      .returning();
    let dropped = false;
    const sockets = new Set<net.Socket>();
    const proxy = net.createServer((client) => {
      const upstream = net.connect({ host: "127.0.0.1", port: 54330 });
      for (const socket of [client, upstream]) {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        socket.on("error", () => {
          client.destroy();
          upstream.destroy();
        });
      }
      client.pipe(upstream);
      let buffered = Buffer.alloc(0);
      upstream.on("data", (chunk) => {
        buffered = Buffer.concat([buffered, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
        while (buffered.length >= 5) {
          const length = buffered.readUInt32BE(1) + 1;
          if (length < 5 || length > 16 * 1024 * 1024) {
            client.destroy();
            upstream.destroy();
            return;
          }
          if (buffered.length < length) return;
          const frame = buffered.subarray(0, length);
          buffered = buffered.subarray(length);
          // Backend CommandComplete("COMMIT") is emitted only after the real
          // transaction committed. Drop it before the application receives it.
          if (!dropped && frame[0] === 67 && frame.subarray(5).toString() === "COMMIT\0") {
            dropped = true;
            client.destroy();
            upstream.destroy();
            return;
          }
          client.write(frame);
        }
      });
      client.on("close", () => upstream.destroy());
      upstream.on("close", () => client.destroy());
    });
    proxy.listen(0, "127.0.0.1");
    await once(proxy, "listening");
    const address = proxy.address();
    assert.ok(address && typeof address !== "string");
    const proxyUrl = new URL(target);
    proxyUrl.port = String(address.port);
    const sql = postgres(proxyUrl.toString(), {
      max: 1,
      prepare: false,
      ssl: false,
      connect_timeout: 3,
      connection: { search_path: process.env.DATABASE_SCHEMA },
    });
    try {
      const repository = createIntakeRepository(drizzle({ client: sql, schema }));
      const intake = createDataAssetIntake({ repository });
      await assert.rejects(
        intake.ingest({
          projectId: project.id,
          sourceConversationId: conversation.id,
          createdBy: userId,
          source: {
            name: "committed.csv",
            sourceType: "csv",
            mimeType: "text/csv",
            bytes: Buffer.from("month,sales\nJan,12"),
          },
        }),
        {
          code: "SNAPSHOT_PERSIST_FAILED",
          message: "Data Snapshot 保存结果暂无法确认，请先查询资产及快照列表，再决定是否重试",
        },
      );
      assert.equal(dropped, true);
      // Verify from a separate direct connection, not through the fault proxy.
      const [asset] = await db.select().from(dataAssets).where(eq(dataAssets.projectId, project.id));
      assert.equal(asset.status, "ready");
      const snapshots = await db.select().from(dataSnapshots).where(eq(dataSnapshots.assetId, asset.id));
      assert.equal(snapshots.length, 1);
      assert.equal(snapshots[0].version, 1);
      assert.equal((await getObject(snapshots[0].sourceObjectKey)).toString(), "month,sales\nJan,12");
      assert.deepEqual(JSON.parse((await getObject(snapshots[0].normalizedObjectKey)).toString()).rows, [
        { month: "Jan", sales: 12 },
      ]);
    } finally {
      await sql.end({ timeout: 1 });
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
      await closeDatabase();
    }
  },
);
