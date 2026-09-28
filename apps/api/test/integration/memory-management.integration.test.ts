import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  auditEvents,
  analysisBriefs,
  closeDatabase,
  conversations,
  conversationMessages,
  dataAssets,
  dataSnapshots,
  db,
  generationJobs,
  members,
  metricDefinitions,
  memoryCandidates,
  projectMembers,
  privateGenerationMemoryContexts,
  projects,
  userPreferenceMemoryRevocations,
  userPreferenceMemories,
  users,
  workspaces,
} from "@langreport/db";
import { getMemoryContextForGeneration, getProjectMemoryAsOf } from "@langreport/memory";
import { buildApp } from "../../src/app.js";

type JsonObject = Record<string, unknown>;
type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

function asObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("memory APIs isolate personal preferences and expose Project versions, history, as-of, conflicts and deletion", async () => {
  const suffix = randomUUID();
  const ownerId = `memory-api-owner-${suffix}`;
  const otherUserId = `memory-api-other-${suffix}`;
  let workspaceId: string | undefined;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  try {
    await db.insert(users).values(
      [ownerId, otherUserId].map((id) => ({
        id,
        username: id,
        usernameKey: id,
        passwordHash: "integration-test-only",
      })),
    );
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: `Memory API ${suffix}` })
      .returning();
    workspaceId = workspace.id;
    const [project] = await db
      .insert(projects)
      .values({ workspaceId, name: `Memory API project ${suffix}`, slug: `memory-api-${suffix.slice(0, 8)}` })
      .returning();
    await db.insert(members).values({ workspaceId, userId: ownerId, role: "owner" });
    await db.insert(projectMembers).values({ projectId: project.id, userId: ownerId, role: "editor" });
    const [conversation] = await db
      .insert(conversations)
      .values({ projectId: project.id, title: "Synthetic memory privacy", createdBy: ownerId })
      .returning();
    const [asset] = await db
      .insert(dataAssets)
      .values({
        projectId: project.id,
        sourceConversationId: conversation.id,
        name: "synthetic-memory.csv",
        sourceType: "pasted",
        mimeType: "text/csv",
        sizeBytes: 16,
        status: "ready",
        createdBy: ownerId,
      })
      .returning();
    const [snapshot] = await db
      .insert(dataSnapshots)
      .values({
        assetId: asset.id,
        version: 1,
        rowCount: 1,
        columnCount: 1,
        schema: [{ name: "revenue", inferredType: "number", nullCount: 0, distinctCount: 1, sampleValues: [100] }],
        preview: [{ revenue: 100 }],
        sourceObjectKey: `synthetic/${suffix}/source.csv`,
        normalizedObjectKey: `synthetic/${suffix}/normalized.json`,
      })
      .returning();
    await db.insert(metricDefinitions).values({
      projectId: project.id,
      sourceConversationId: conversation.id,
      name: "收入",
      meaning: "合成收入",
      formula: "sum(revenue)",
      unit: "元",
      timeRule: "按月",
      status: "confirmed",
      confirmedBy: ownerId,
      confirmedAt: new Date(),
      createdBy: ownerId,
    });
    await db.insert(analysisBriefs).values({
      projectId: project.id,
      conversationId: conversation.id,
      businessQuestion: "按月份展示收入趋势",
      audience: "合成测试",
      timeRange: "2026-01 至 2026-02",
      timeGrain: "月",
      outputFormat: "evidence_block",
      status: "confirmed",
      createdBy: ownerId,
    });

    app = await buildApp({
      logger: false,
      environment: { ...process.env, NODE_ENV: "test", APP_ENV: "test" },
      authProvider: (request) =>
        typeof request.headers["x-user-id"] === "string" ? { id: request.headers["x-user-id"] } : null,
    });
    await app.ready();

    const request = async (method: HttpMethod, url: string, userId: string, payload?: unknown) => {
      const response = await app!.inject({
        method,
        url,
        headers: {
          "x-user-id": userId,
          ...(payload === undefined ? {} : { "content-type": "application/json" }),
        },
        payload: payload === undefined ? undefined : JSON.stringify(payload),
      });
      return { status: response.statusCode, body: asObject(response.json()) };
    };

    const privateStatement = "合成私有偏好：回答保持简洁";
    let result = await request("POST", "/api/v1/me/preferences", ownerId, {
      category: "tone",
      statement: privateStatement,
      value: {},
      ownerId: otherUserId,
    });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    const preference = asObject(result.body.preference);
    assert.equal(preference.ownerId, undefined);
    assert.equal(preference.statement, privateStatement);
    const preferenceId = String(preference.id);
    const preferenceLogicalId = String(preference.logicalMemoryId);
    const [storedPreference] = await db
      .select()
      .from(userPreferenceMemories)
      .where(eq(userPreferenceMemories.id, preferenceId));
    assert.equal(storedPreference?.ownerId, ownerId, "the authenticated account determines the owner");

    result = await request("POST", `/api/v1/projects/${project.id}/generation-jobs`, ownerId, {
      dataAssetId: asset.id,
      conversationId: conversation.id,
      prompt: "按月份展示收入趋势",
      idempotencyKey: `memory-privacy-${suffix}`,
    });
    assert.equal(result.status, 202, JSON.stringify(result.body));
    const generationJob = asObject(result.body.job);
    const generationJobId = String(generationJob.id);
    assert.equal(generationJob.snapshotId, snapshot.id);
    const sharedPayload = JSON.stringify(result.body);
    assert.equal(sharedPayload.includes(privateStatement), false);
    assert.equal(sharedPayload.includes(preferenceId), false);
    assert.equal(sharedPayload.includes(preferenceLogicalId), false);
    const [storedJob] = await db.select().from(generationJobs).where(eq(generationJobs.id, generationJobId));
    assert.ok(storedJob);
    const sharedJobRow = JSON.stringify(storedJob);
    assert.equal(sharedJobRow.includes(privateStatement), false);
    assert.equal(sharedJobRow.includes(preferenceId), false);
    assert.equal(sharedJobRow.includes(preferenceLogicalId), false);
    const [privateJobContext] = await db
      .select()
      .from(privateGenerationMemoryContexts)
      .where(eq(privateGenerationMemoryContexts.generationJobId, generationJobId));
    assert.deepEqual(privateJobContext?.preferenceVersionIds, [preferenceId]);
    result = await request("GET", `/api/v1/generation-jobs/${generationJobId}`, ownerId);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const jobDetailPayload = JSON.stringify(result.body);
    assert.equal(jobDetailPayload.includes(privateStatement), false);
    assert.equal(jobDetailPayload.includes(preferenceId), false);
    assert.equal(jobDetailPayload.includes(preferenceLogicalId), false);

    result = await request("GET", "/api/v1/me/preferences", otherUserId);
    assert.deepEqual(result.body.preferences, []);
    result = await request("DELETE", `/api/v1/me/preferences/${preferenceId}`, otherUserId, { expectedVersion: 1 });
    assert.equal(result.status, 404);
    assert.equal(
      (await request("GET", "/api/v1/me/preferences", ownerId)).status,
      200,
      "a different account cannot delete the owner's preference",
    );
    assert.equal(asArray((await request("GET", "/api/v1/me/preferences", ownerId)).body.preferences).length, 1);

    result = await request("PATCH", `/api/v1/me/preferences/${preferenceId}`, ownerId, {
      expectedVersion: 1,
      statement: `${privateStatement}，修订版本`,
      value: {},
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const currentPreference = asObject(result.body.preference);
    assert.equal(currentPreference.version, 2);
    const currentPreferenceId = String(currentPreference.id);
    result = await request("DELETE", `/api/v1/me/preferences/${preferenceId}`, ownerId, { expectedVersion: 1 });
    assert.equal(result.status, 409, JSON.stringify(result.body));
    assert.equal(result.body.code, "MEMORY_VERSION_CONFLICT");
    const preferenceAfterStaleDelete = asArray(
      (await request("GET", "/api/v1/me/preferences", ownerId)).body.preferences,
    );
    assert.equal(preferenceAfterStaleDelete.length, 1);
    assert.equal(asObject(preferenceAfterStaleDelete[0]).id, currentPreferenceId);

    const memoryKey = "rule.revenue.tax";
    result = await request("POST", `/api/v1/projects/${project.id}/memories`, ownerId, {
      memoryKey,
      memoryType: "business_rule",
      statement: "项目收入按不含税金额统计",
      value: {},
      sourceMessageIds: [],
      idempotencyKey: `memory-api-${suffix}`,
    });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    const firstMemory = asObject(result.body.memory);
    const memoryId = String(firstMemory.id);
    const logicalMemoryId = String(firstMemory.logicalMemoryId);
    assert.equal(firstMemory.version, 1);

    const concurrentMemoryEdits = await Promise.all([
      request("PATCH", `/api/v1/projects/${project.id}/memories/${memoryId}`, ownerId, {
        expectedVersion: 1,
        statement: "项目收入统一按不含税金额统计",
        value: {},
      }),
      request("PATCH", `/api/v1/projects/${project.id}/memories/${memoryId}`, ownerId, {
        expectedVersion: 1,
        statement: "项目收入统一按净收入统计",
        value: {},
      }),
    ]);
    assert.deepEqual(
      concurrentMemoryEdits.map((edit) => edit.status).sort((left, right) => left - right),
      [200, 409],
    );
    const winningEdit = concurrentMemoryEdits.find((edit) => edit.status === 200);
    assert.ok(winningEdit);
    const losingEdit = concurrentMemoryEdits.find((edit) => edit.status === 409);
    assert.equal(losingEdit?.body.code, "MEMORY_VERSION_CONFLICT");
    result = winningEdit;
    const currentMemory = asObject(result.body.memory);
    assert.equal(currentMemory.version, 2);

    result = await request("GET", `/api/v1/projects/${project.id}/memories`, ownerId);
    const projectMemoryResponse = JSON.stringify(result.body);
    assert.equal(projectMemoryResponse.includes(privateStatement), false);
    assert.equal(asArray(asObject(result.body.memory).project).length, 1);

    result = await request("GET", `/api/v1/projects/${project.id}/memories/${logicalMemoryId}/history`, ownerId);
    assert.equal(result.status, 200);
    assert.deepEqual(
      asArray(result.body.versions).map((version) => asObject(version).version),
      [1, 2],
    );

    const effectiveAt = encodeURIComponent(String(firstMemory.effectiveFrom));
    const knownAt = encodeURIComponent(String(firstMemory.confirmedAt));
    result = await request(
      "GET",
      `/api/v1/projects/${project.id}/memories/${logicalMemoryId}/as-of?effectiveAt=${effectiveAt}&knownAt=${knownAt}`,
      ownerId,
    );
    assert.equal(result.status, 200);
    assert.equal(asObject(result.body.memory).version, 1);

    result = await request("PATCH", `/api/v1/projects/${project.id}/memories/${currentMemory.id}/conflict`, ownerId, {
      expectedVersion: 2,
      conflictStatus: "disputed",
    });
    assert.equal(result.status, 200);
    assert.equal(asObject(result.body.memory).conflictStatus, "disputed");

    result = await request("GET", `/api/v1/workspaces/${workspace.id}/memories`, ownerId);
    assert.equal(result.status, 410);
    result = await request("DELETE", `/api/v1/memories/${memoryId}`, ownerId, { expectedVersion: 2 });
    assert.equal(result.status, 410);

    result = await request("DELETE", `/api/v1/projects/${project.id}/memories/${currentMemory.id}`, ownerId, {
      expectedVersion: 2,
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(
      asArray(asObject((await request("GET", `/api/v1/projects/${project.id}/memories`, ownerId)).body.memory).project),
      [],
    );

    const [sourceMessage] = await db
      .insert(conversationMessages)
      .values({ conversationId: conversation.id, role: "user", content: "合成记忆撤销来源" })
      .returning();
    const createSourcedMemory = (memoryKey: string) =>
      request("POST", `/api/v1/projects/${project.id}/memories`, ownerId, {
        memoryKey,
        memoryType: "business_rule",
        statement: `合成来源记忆 ${memoryKey}`,
        value: {},
        sourceConversationId: conversation.id,
        sourceMessageIds: [sourceMessage.id],
        idempotencyKey: `memory-source-${suffix}-${memoryKey}`,
      });
    const targetSourceMemory = await createSourcedMemory("rule.source.target");
    assert.equal(targetSourceMemory.status, 201, JSON.stringify(targetSourceMemory.body));
    const targetSourceMemoryId = String(asObject(targetSourceMemory.body.memory).id);
    const siblingSourceMemory = await createSourcedMemory("rule.source.sibling");
    assert.equal(siblingSourceMemory.status, 201, JSON.stringify(siblingSourceMemory.body));

    const [candidate] = await db
      .insert(memoryCandidates)
      .values({
        workspaceId: workspace.id,
        projectId: project.id,
        conversationId: conversation.id,
        sourceMessageIds: [sourceMessage.id],
        candidateFingerprint: `source-race-${suffix}`,
        memoryKey: "rule.source.candidate",
        memoryType: "business_rule",
        statement: "候选来源已撤销",
        value: {},
        scopeHint: "project",
        confidence: 0.9,
        extractorVersion: "synthetic-test-v1",
      })
      .returning();

    const sourceLockReady = deferred<void>();
    const releaseSourceLock = deferred<void>();
    const sourceLockTransaction = db.transaction(async (tx) => {
      const lockedRows = await tx
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(eq(conversationMessages.id, sourceMessage.id))
        .for("update");
      assert.equal(lockedRows.length, 1);
      sourceLockReady.resolve();
      await releaseSourceLock.promise;
    });
    await sourceLockReady.promise;

    let deletionSettled = false;
    let acceptanceSettled = false;
    const concurrentDeletion = request(
      "DELETE",
      `/api/v1/projects/${project.id}/memories/${targetSourceMemoryId}`,
      ownerId,
      { expectedVersion: 1 },
    ).then((value) => {
      deletionSettled = true;
      return value;
    });
    const concurrentAcceptance = request("POST", `/api/v1/memory-candidates/${candidate.id}/accept`, ownerId, {
      targetScope: "project",
      expectedVersion: 1,
      idempotencyKey: `memory-source-accept-${suffix}`,
    }).then((value) => {
      acceptanceSettled = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const deletionWaitedForSourceLock = !deletionSettled;
    const acceptanceWaitedForSourceLock = !acceptanceSettled;
    releaseSourceLock.resolve();
    await sourceLockTransaction;
    const [concurrentDeleteResult, concurrentAcceptResult] = await Promise.all([
      concurrentDeletion,
      concurrentAcceptance,
    ]);
    assert.equal(deletionWaitedForSourceLock, true, "deletion locks the source message before suppression");
    assert.equal(acceptanceWaitedForSourceLock, true, "candidate acceptance shares the source-message lock");
    assert.equal(concurrentDeleteResult.status, 200, JSON.stringify(concurrentDeleteResult.body));
    assert.ok([200, 409].includes(concurrentAcceptResult.status), JSON.stringify(concurrentAcceptResult.body));

    const visibleAfterSourceDeletion = asArray(
      asObject((await request("GET", `/api/v1/projects/${project.id}/memories`, ownerId)).body.memory).project,
    );
    assert.equal(
      visibleAfterSourceDeletion.some((record) =>
        ["rule.source.target", "rule.source.sibling", "rule.source.candidate"].includes(
          String(asObject(record).memoryKey),
        ),
      ),
      false,
    );
    const generationMemoryContext = await getMemoryContextForGeneration({
      projectId: project.id,
      conversationId: conversation.id,
      userId: ownerId,
    });
    assert.equal(
      generationMemoryContext.project.some((record) => record.memoryKey.startsWith("rule.source.")),
      false,
    );
    const siblingSourceVersion = asObject(siblingSourceMemory.body.memory);
    assert.equal(
      await getProjectMemoryAsOf({
        projectId: project.id,
        logicalMemoryId: String(siblingSourceVersion.logicalMemoryId),
        userId: ownerId,
        effectiveAt: new Date(String(siblingSourceVersion.effectiveFrom)),
        knownAt: new Date(String(siblingSourceVersion.confirmedAt)),
      }),
      null,
    );

    result = await createSourcedMemory("rule.source.manual-after-delete");
    assert.equal(result.status, 409, JSON.stringify(result.body));
    assert.equal(result.body.code, "MEMORY_SOURCE_REVOKED");
    const [staleCandidate] = await db
      .insert(memoryCandidates)
      .values({
        workspaceId: workspace.id,
        projectId: project.id,
        conversationId: conversation.id,
        sourceMessageIds: [sourceMessage.id],
        candidateFingerprint: `source-after-delete-${suffix}`,
        memoryKey: "rule.source.candidate-after-delete",
        memoryType: "business_rule",
        statement: "删除之后不能接受",
        value: {},
        scopeHint: "project",
        confidence: 0.9,
        extractorVersion: "synthetic-test-v1",
      })
      .returning();
    result = await request("POST", `/api/v1/memory-candidates/${staleCandidate.id}/accept`, ownerId, {
      targetScope: "project",
      expectedVersion: 1,
      idempotencyKey: `memory-source-stale-accept-${suffix}`,
    });
    assert.equal(result.status, 409, JSON.stringify(result.body));
    assert.equal(result.body.code, "MEMORY_SOURCE_REVOKED");

    result = await request("DELETE", `/api/v1/me/preferences/${currentPreferenceId}`, ownerId, { expectedVersion: 2 });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual((await request("GET", "/api/v1/me/preferences", ownerId)).body.preferences, []);
    assert.deepEqual((await request("GET", "/api/v1/me/memory-usage", ownerId)).body.usage, []);
    const [revokedJobContext] = await db
      .select()
      .from(privateGenerationMemoryContexts)
      .where(eq(privateGenerationMemoryContexts.generationJobId, generationJobId));
    assert.deepEqual(revokedJobContext?.preferenceVersionIds, []);
    assert.equal(
      (await db.select().from(userPreferenceMemories).where(eq(userPreferenceMemories.ownerId, ownerId))).length,
      0,
    );
    assert.equal(
      (
        await db
          .select()
          .from(userPreferenceMemoryRevocations)
          .where(
            and(
              eq(userPreferenceMemoryRevocations.ownerId, ownerId),
              eq(userPreferenceMemoryRevocations.logicalMemoryId, String(preference.logicalMemoryId)),
            ),
          )
      ).length,
      1,
    );
    const workspaceAuditEvents = await db.select().from(auditEvents).where(eq(auditEvents.workspaceId, workspace.id));
    const auditPayload = JSON.stringify(workspaceAuditEvents);
    assert.equal(auditPayload.includes(privateStatement), false);
    assert.equal(auditPayload.includes(preferenceId), false);
    assert.equal(auditPayload.includes(preferenceLogicalId), false);
  } finally {
    if (app) await app.close();
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(eq(users.id, ownerId));
    await db.delete(users).where(eq(users.id, otherUserId));
    await closeDatabase();
  }
});
