import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { eq } from "drizzle-orm";
import { closeDatabase, conversations, dataAssets, db, members, projects, workspaces } from "@langreport/db";
import { buildApp } from "../../src/app.js";
import { reserveLocalIntake } from "../../src/local-intake-admission.js";

test(
  "slow multipart disconnect and service close release admission and clean temporary files",
  { timeout: 30000 },
  async () => {
    assert.equal(process.env.LANGREPORT_INTEGRATION_TEST, "1");
    const userId = `lifecycle-${randomUUID()}`;
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
    const app = await buildApp({
      logger: false,
      authProvider: (request) => (request.headers["x-user-id"] === userId ? { id: userId } : null),
    });
    const entered = new Set<string>();
    app.addHook("preHandler", async (request) => {
      entered.add(request.id);
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const originalTemp = new Set(await readdir(tmpdir()));
    const clients = new Set<http.ClientRequest>();
    async function waitFor(check: () => Promise<boolean> | boolean) {
      const until = Date.now() + 5000;
      while (!(await check())) {
        if (Date.now() > until) throw new Error("condition did not settle within 5s");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    async function slowUpload() {
      const boundary = `test-${randomUUID()}`;
      const client = http.request(
        `${address}/api/v1/projects/${project.id}/data-assets/upload`,
        {
          method: "POST",
          headers: { "x-user-id": userId, "content-type": `multipart/form-data; boundary=${boundary}` },
        },
        (response) => response.resume(),
      );
      clients.add(client);
      client.on("error", () => undefined);
      client.on("close", () => clients.delete(client));
      client.write(
        `--${boundary}\r\nContent-Disposition: form-data; name="conversationId"\r\n\r\n${conversation.id}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="slow.csv"\r\nContent-Type: text/csv\r\n\r\na,b\n1,2\n`,
      );
      await waitFor(() => {
        try {
          const slot = reserveLocalIntake();
          slot.release();
          return false;
        } catch (error) {
          return error instanceof Error && "code" in error && error.code === "DATA_PARSE_BUSY";
        }
      });
      return client;
    }
    async function waitReleased() {
      await waitFor(() => {
        try {
          const slot = reserveLocalIntake();
          slot.release();
          return true;
        } catch {
          return false;
        }
      });
      await waitFor(
        async () =>
          !(await readdir(tmpdir())).some(
            (name) => !originalTemp.has(name) && /^langreport-(upload|parse)-/.test(name),
          ),
      );
    }
    async function beforeFileHeaders(suffix: string) {
      const requestId = randomUUID();
      const boundary = randomUUID();
      const client = http.request(
        `${address}/api/v1/projects/${project.id}/data-assets${suffix}`,
        {
          method: "POST",
          headers: {
            "x-user-id": userId,
            "x-request-id": requestId,
            "content-type": `multipart/form-data; boundary=${boundary}`,
          },
        },
        (response) => response.resume(),
      );
      clients.add(client);
      client.on("error", () => undefined);
      client.on("close", () => clients.delete(client));
      client.write(
        `--${boundary}\r\nContent-Disposition: form-data; name="conversationId"\r\n\r\n${conversation.id}\r\n`,
      );
      await waitFor(() => entered.has(requestId));
      assert.equal(client.destroyed, false);
      return client;
    }
    try {
      const first = await slowUpload();
      const busy = await fetch(`${address}/api/v1/projects/${project.id}/data-assets/paste`, {
        method: "POST",
        headers: { "x-user-id": userId, "content-type": "application/json" },
        body: JSON.stringify({ conversationId: conversation.id, name: "busy.csv", content: "a\n1" }),
      });
      assert.equal(busy.status, 503);
      assert.equal(((await busy.json()) as { code: string }).code, "DATA_PARSE_BUSY");
      first.destroy();
      await waitReleased();
      assert.equal((await db.select().from(dataAssets).where(eq(dataAssets.projectId, project.id))).length, 0);
      await slowUpload();
      // Both upload routes must shut down even before request.file() resolves.
      await beforeFileHeaders("/upload");
      await beforeFileHeaders(`/${randomUUID()}/snapshots/upload`);
      await app.close();
      await waitReleased();
      assert.equal((await db.select().from(dataAssets).where(eq(dataAssets.projectId, project.id))).length, 0);
    } finally {
      for (const client of clients) client.destroy();
      await app.close();
      await closeDatabase();
    }
  },
);
