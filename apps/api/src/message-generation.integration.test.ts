import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  closeDatabase,
  conversationMessages,
  conversations,
  dataAssets,
  dataSnapshots,
  db,
  generationJobs,
  members,
  metricDefinitions,
  projects,
  workspaces
} from "@langreport/db";
import { buildApp } from "./app.js";

const enabled = process.env.RUN_INTEGRATION === "1";
type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : {};
}

test("message-triggered generation is single-write, idempotent and explains missing prerequisites", { skip: !enabled }, async () => {
  const suffix = randomUUID();
  const userId = `phase1-message-${suffix}`;
  const [workspace] = await db.insert(workspaces).values({ name: `Phase 1 message ${suffix}` }).returning();
  await db.insert(members).values({ workspaceId: workspace.id, userId, role: "owner" });
  async function fixture(name: string, options: { snapshot: boolean; metricCount: number }) {
    const [project] = await db.insert(projects).values({
      workspaceId: workspace.id,
      name: `Phase 1 ${name} ${suffix}`,
      slug: `phase1-${name}-${suffix.slice(0, 8)}`
    }).returning();
    const [conversation] = await db.insert(conversations).values({
      projectId: project.id,
      title: `Phase 1 ${name}`,
      createdBy: userId
    }).returning();
    const [asset] = await db.insert(dataAssets).values({
      projectId: project.id,
      name: `${name}.csv`,
      sourceType: "pasted",
      mimeType: "text/csv",
      sizeBytes: 1,
      objectKey: `phase1/${suffix}/${name}.csv`,
      status: "ready",
      createdBy: userId
    }).returning();
    if (options.snapshot) {
      await db.insert(dataSnapshots).values({
        assetId: asset.id,
        version: 1,
        rowCount: 1,
        columnCount: 1,
        schema: [{ name: "销售额", inferredType: "number", nullCount: 0, distinctCount: 1, sampleValues: [100] }],
        preview: [{ 销售额: 100 }],
        normalizedObjectKey: `phase1/${suffix}/${name}.json`
      });
    }
    const metricIds: string[] = [];
    for (let index = 0; index < options.metricCount; index += 1) {
      const [metric] = await db.insert(metricDefinitions).values({
        projectId: project.id,
        sourceConversationId: conversation.id,
        name: index === 0 ? "销售额" : `利润${index}`,
        meaning: "测试指标",
        formula: "sum(value)",
        unit: "元",
        timeRule: "按月",
        status: "confirmed",
        version: index + 1,
        confirmedBy: userId,
        confirmedAt: new Date(),
        createdBy: userId,
        updatedAt: new Date()
      }).returning({ id: metricDefinitions.id });
      metricIds.push(metric.id);
    }
    const value = { projectId: project.id, conversationId: conversation.id, assetId: asset.id, metricIds };
    return value;
  }

  const valid = await fixture("valid", { snapshot: true, metricCount: 1 });
  const noSnapshot = await fixture("no-snapshot", { snapshot: false, metricCount: 1 });
  const noMetric = await fixture("no-metric", { snapshot: true, metricCount: 0 });
  const multipleMetrics = await fixture("multiple-metrics", { snapshot: true, metricCount: 2 });
  const app = await buildApp({ logger: false, environment: { ...process.env, NODE_ENV: "test", APP_ENV: "test" } });
  await app.ready();

  try {
    const request = async (conversationId: string, payload: Record<string, unknown>) => {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${conversationId}/messages`,
        headers: { "x-user-id": userId, "content-type": "application/json" },
        payload: JSON.stringify(payload)
      });
      return { status: response.statusCode, body: asObject(response.json()) };
    };

    const idempotencyKey = `phase1-idempotency-${suffix}`;
    const validPayload = {
      content: "按月份展示销售额",
      generate: true,
      dataAssetId: valid.assetId,
      metricDefinitionId: valid.metricIds[0],
      clientRequestId: idempotencyKey
    };
    let result = await request(valid.conversationId, validPayload);
    assert.equal(result.status, 202, JSON.stringify(result.body));
    assert.equal(asObject(result.body.message).role, "user");
    assert.equal(asObject(result.body.job).status, "queued");
    result = await request(valid.conversationId, validPayload);
    assert.equal(result.status, 200);

    const concurrentPayload = {
      ...validPayload,
      content: "并发提交销售额趋势",
      clientRequestId: `phase1-concurrent-${suffix}`
    };
    const concurrentResults = await Promise.all([
      request(valid.conversationId, concurrentPayload),
      request(valid.conversationId, concurrentPayload)
    ]);
    assert.deepEqual(concurrentResults.map((item) => item.status).sort((left, right) => left - right), [200, 202]);
    const validMessages = await db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, valid.conversationId));
    const validJobs = await db.select().from(generationJobs).where(eq(generationJobs.projectId, valid.projectId));
    assert.equal(validMessages.length, 2);
    assert.equal(validMessages.every((message) => message.role === "user"), true);
    assert.equal(validJobs.length, 2);

    result = await request(valid.conversationId, { ...validPayload, content: "换成利润" });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, "IDEMPOTENCY_CONFLICT");

    result = await request(noSnapshot.conversationId, { content: "生成销售额", generate: true, dataAssetId: noSnapshot.assetId, metricDefinitionId: noSnapshot.metricIds[0], clientRequestId: `no-snapshot-${suffix}` });
    assert.equal(result.status, 201);
    assert.equal(asObject(result.body.nextAction).code, "DATA_SNAPSHOT_REQUIRED");
    assert.equal(result.body.job, null);

    result = await request(noMetric.conversationId, { content: "生成销售额", generate: true, dataAssetId: noMetric.assetId, clientRequestId: `no-metric-${suffix}` });
    assert.equal(result.status, 201);
    assert.equal(asObject(result.body.nextAction).code, "METRIC_DEFINITION_REQUIRED");

    result = await request(multipleMetrics.conversationId, { content: "生成销售额", generate: true, dataAssetId: multipleMetrics.assetId, clientRequestId: `multiple-${suffix}` });
    assert.equal(result.status, 201);
    assert.equal(asObject(result.body.nextAction).code, "METRIC_SELECTION_REQUIRED");
  } finally {
    await app.close();
    await db.delete(workspaces).where(and(eq(workspaces.id, workspace.id)));
    await closeDatabase();
  }
});
