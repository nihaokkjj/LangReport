import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, asc, eq } from "drizzle-orm";
import { closeDatabase, conversations, dataAssets, dataSnapshots, db, members, projects, workspaces } from "@langreport/db";
import { deleteObject, getObject } from "@langreport/storage";
import { buildApp } from "../../src/app.js";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : {};
}

test("data asset snapshot update appends immutable snapshots and isolates concurrent writes", async () => {
  const suffix = randomUUID();
  const userId = `phase1-data-assets-${suffix}`;
  const [workspace] = await db.insert(workspaces).values({ name: `Phase 1 data assets ${suffix}` }).returning();
  await db.insert(members).values({ workspaceId: workspace.id, userId, role: "owner" });
  const [project] = await db.insert(projects).values({
    workspaceId: workspace.id,
    name: `Snapshot project ${suffix}`,
    slug: `snapshot-${suffix.slice(0, 8)}`
  }).returning();
  const [otherProject] = await db.insert(projects).values({
    workspaceId: workspace.id,
    name: `Other snapshot project ${suffix}`,
    slug: `other-snapshot-${suffix.slice(0, 8)}`
  }).returning();
  const [conversation] = await db.insert(conversations).values({
    projectId: project.id,
    title: "Snapshot source",
    createdBy: userId
  }).returning();
  const [otherConversation] = await db.insert(conversations).values({
    projectId: otherProject.id,
    title: "Other snapshot source",
    createdBy: userId
  }).returning();
  let createdAssetId: string | undefined;

  const app = await buildApp({ logger: false, environment: { ...process.env, NODE_ENV: "test", APP_ENV: "test" } });
  await app.ready();

  try {
    const paste = async (projectId: string, conversationId: string, name: string, content: string) => {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${projectId}/data-assets/paste`,
        headers: { "x-user-id": userId, "content-type": "application/json" },
        payload: JSON.stringify({ name, content, conversationId })
      });
      return { status: response.statusCode, body: asObject(response.json()) };
    };
    const update = async (projectId: string, assetId: string, conversationId: string, name: string, content: string) => {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${projectId}/data-assets/${assetId}/snapshots/paste`,
        headers: { "x-user-id": userId, "content-type": "application/json" },
        payload: JSON.stringify({ name, content, conversationId })
      });
      return { status: response.statusCode, body: asObject(response.json()) };
    };

    const initial = await paste(project.id, conversation.id, "sales-v1.csv", "month,amount\nJan,10\nFeb,20");
    assert.equal(initial.status, 201, JSON.stringify(initial.body));
    const initialAsset = asObject(initial.body.asset);
    const assetId = String(initialAsset.id);
    createdAssetId = assetId;
    assert.equal("objectKey" in initialAsset, false);
    assert.equal("sourceObjectKey" in asObject(initialAsset.latestSnapshot), false);
    assert.equal(asObject(initialAsset.latestSnapshot).version, 1);

    const second = await update(project.id, assetId, conversation.id, "sales-v2.csv", "month,amount\nJan,11\nFeb,21");
    assert.equal(second.status, 201, JSON.stringify(second.body));
    const secondAsset = asObject(second.body.asset);
    assert.equal(secondAsset.id, assetId);
    assert.equal(asObject(secondAsset.latestSnapshot).version, 2);

    const concurrent = await Promise.all([
      update(project.id, assetId, conversation.id, "sales-v3a.csv", "month,amount\nJan,12"),
      update(project.id, assetId, conversation.id, "sales-v3b.csv", "month,amount\nJan,13")
    ]);
    assert.deepEqual(concurrent.map((result) => result.status).sort((left, right) => left - right), [201, 201]);
    assert.deepEqual(concurrent.map((result) => asObject(asObject(result.body.asset).latestSnapshot).version).sort(), [3, 4]);

    const snapshots = await db.select().from(dataSnapshots)
      .where(eq(dataSnapshots.assetId, assetId))
      .orderBy(asc(dataSnapshots.version));
    assert.deepEqual(snapshots.map((snapshot) => snapshot.version), [1, 2, 3, 4]);
    assert.equal(new Set(snapshots.map((snapshot) => snapshot.sourceObjectKey)).size, 4);
    assert.equal(new Set(snapshots.map((snapshot) => snapshot.normalizedObjectKey)).size, 4);
    assert.equal(snapshots.every((snapshot) => snapshot.sourceObjectKey.includes(`/snapshots/${snapshot.id}/source/`)), true);
    for (const snapshot of snapshots) {
      assert.ok((await getObject(snapshot.sourceObjectKey)).byteLength > 0);
      assert.ok((await getObject(snapshot.normalizedObjectKey)).byteLength > 0);
    }
    assert.match((await getObject(snapshots[0].normalizedObjectKey)).toString("utf8"), /Jan/);

    const invalidConversation = await update(project.id, assetId, otherConversation.id, "invalid.csv", "month,amount\nJan,99");
    assert.equal(invalidConversation.status, 400, JSON.stringify(invalidConversation.body));
    assert.equal(invalidConversation.body.code, "SOURCE_CONVERSATION_INVALID");

    const wrongProject = await update(otherProject.id, assetId, otherConversation.id, "wrong-project.csv", "month,amount\nJan,100");
    assert.equal(wrongProject.status, 404, JSON.stringify(wrongProject.body));
    assert.equal(wrongProject.body.code, "DATA_ASSET_NOT_FOUND");
    assert.equal((await db.select().from(dataAssets).where(eq(dataAssets.id, assetId))).length, 1);
  } finally {
    await app.close();
    if (createdAssetId) {
      const storedSnapshots = await db.select({ sourceObjectKey: dataSnapshots.sourceObjectKey, normalizedObjectKey: dataSnapshots.normalizedObjectKey })
        .from(dataSnapshots)
        .where(eq(dataSnapshots.assetId, createdAssetId));
      await Promise.all(storedSnapshots.flatMap((snapshot) => [snapshot.sourceObjectKey, snapshot.normalizedObjectKey]).map(async (key) => {
        try {
          await deleteObject(key);
        } catch {
          // The isolated integration bucket cleanup remains the final safety net.
        }
      }));
    }
    await db.delete(workspaces).where(and(eq(workspaces.id, workspace.id)));
    await closeDatabase();
  }
});
