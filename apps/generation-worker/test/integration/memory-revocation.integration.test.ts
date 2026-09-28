import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  closeDatabase,
  conversations,
  dataAssets,
  dataSnapshots,
  db,
  generationJobs,
  generationMemoryInvocationUsage,
  members,
  privateGenerationMemoryContexts,
  privateMemoryInvocationUsage,
  projectMembers,
  projects,
  users,
  workspaces,
} from "@langreport/db";
import {
  createUserPreferenceMemory,
  createProjectMemory,
  deleteProjectMemory,
  deleteUserPreferenceMemory,
  getMemoryContextForGeneration,
} from "@langreport/memory";
import {
  chartPlanDecisionSchema,
  createChartPlanOutputDescriptor,
  type MemoryContext,
  type ModelGateway,
  type ModelResult,
  type ModelRouteSnapshot,
  type PreparedModelContext,
  type RuntimeModelRequest,
} from "@langreport/contracts";
import { projectConversationToCanonicalTextContext } from "@langreport/generation";
import {
  admitMemoryInvocation,
  completeMemoryInvocationUsage,
  listUserPreferenceMemories,
  listUserPreferenceMemoryUsage,
} from "@langreport/memory";
import {
  estimateBailianRequestTokenUpperBound,
  MAX_HARD_REQUEST_TOKEN_UPPER_BOUND,
  resolveModelRouteSnapshot,
} from "@langreport/model-gateway";
import { MemoryInvocationGateway } from "../../src/memory-invocation-gateway.js";

const route = resolveModelRouteSnapshot({
  NODE_ENV: "test",
  GENERATION_MODE: "llm",
  BAILIAN_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  BAILIAN_MODEL_ID: "qwen-plus",
  BAILIAN_STRUCTURED_OUTPUT: "json_schema",
});

test("database admission gate orders preference deletion before and after model send admission", async () => {
  const suffix = randomUUID();
  const userId = `memory-revocation-${suffix}`;
  let workspaceId: string | undefined;

  try {
    await db.insert(users).values({
      id: userId,
      username: `memory-${suffix}`,
      usernameKey: `memory-${suffix}`,
      passwordHash: "synthetic-only",
    });
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: `Memory revocation ${suffix}` })
      .returning();
    workspaceId = workspace.id;
    const [project] = await db
      .insert(projects)
      .values({
        workspaceId,
        name: `Memory revocation project ${suffix}`,
        slug: `memory-revoke-${suffix.slice(0, 8)}`,
      })
      .returning();
    await db.insert(members).values({ workspaceId, userId, role: "owner" });
    await db.insert(projectMembers).values({ projectId: project.id, userId, role: "editor" });
    const [conversation] = await db
      .insert(conversations)
      .values({
        projectId: project.id,
        title: "Synthetic memory invocation",
        createdBy: userId,
      })
      .returning();
    await db.insert(dataAssets).values({
      projectId: project.id,
      sourceConversationId: conversation.id,
      name: "synthetic.csv",
      sourceType: "pasted",
      mimeType: "text/csv",
      sizeBytes: 1,
      status: "ready",
      createdBy: userId,
    });
    const [asset] = await db.select().from(dataAssets).where(eq(dataAssets.projectId, project.id)).limit(1);
    const [snapshot] = await db
      .insert(dataSnapshots)
      .values({
        assetId: asset.id,
        version: 1,
        rowCount: 1,
        columnCount: 1,
        schema: [{ name: "销售额", inferredType: "number", nullCount: 0, distinctCount: 1, sampleValues: [100] }],
        preview: [{ 销售额: 100 }],
        sourceObjectKey: `synthetic/${suffix}/source.csv`,
        normalizedObjectKey: `synthetic/${suffix}/normalized.json`,
      })
      .returning();
    const beforeAdmissionProjectMemory = await createProjectMemory({
      projectId: project.id,
      userId,
      memoryKey: "rule.revenue.tax",
      memoryType: "business_rule",
      statement: "项目收入按不含税金额统计",
      value: {},
      idempotencyKey: `memory-project-before-${suffix}`,
    });
    const inFlightProjectMemory = await createProjectMemory({
      projectId: project.id,
      userId,
      memoryKey: "rule.revenue.period",
      memoryType: "business_rule",
      statement: "项目收入按自然月汇总",
      value: {},
      idempotencyKey: `memory-project-inflight-${suffix}`,
    });

    async function createJobAndPreferenceContext(jobSuffix: string, preferenceVersionIds: string | string[]) {
      const [job] = await db
        .insert(generationJobs)
        .values({
          projectId: project.id,
          conversationId: conversation.id,
          dataAssetId: asset.id,
          snapshotId: snapshot.id,
          prompt: "按月份展示销售额趋势",
          idempotencyKey: `memory-job-${suffix}-${jobSuffix}`,
          inputFingerprint: `memory-fingerprint-${suffix}-${jobSuffix}`,
          createdBy: userId,
        })
        .returning();
      await db.insert(privateGenerationMemoryContexts).values({
        generationJobId: job.id,
        ownerId: userId,
        preferenceVersionIds: Array.isArray(preferenceVersionIds) ? preferenceVersionIds : [preferenceVersionIds],
      });
      return job.id;
    }

    const memoryContext = await getMemoryContextForGeneration({
      projectId: project.id,
      conversationId: conversation.id,
      userId,
    });
    const beforeAdmissionPreference = await createUserPreferenceMemory({
      ownerId: userId,
      category: "language",
      statement: "回答使用简体中文，语气简洁",
      value: {},
    });
    const beforeAdmissionJobId = await createJobAndPreferenceContext("before", beforeAdmissionPreference.id);
    const beforeAdmission = deferred<void>();
    const releaseBeforeAdmission = deferred<void>();
    const sentBeforeDelete: string[][] = [];
    const projectMemoriesSentBeforeDelete: string[][] = [];
    const beforeAdmissionGateway = new MemoryInvocationGateway(
      fakeGateway((request) => {
        sentBeforeDelete.push(request.context.userPreferences);
        projectMemoriesSentBeforeDelete.push(request.context.memories.map((memory) => memory.memoryKey));
      }),
      route,
      gatewayIdentity(userId, workspaceId, project.id, conversation.id, beforeAdmissionJobId, memoryContext),
      {
        admit: async (input) => {
          beforeAdmission.resolve();
          await releaseBeforeAdmission.promise;
          return admitMemoryInvocation(input);
        },
        complete: completeMemoryInvocationUsage,
        discard: async () => {},
      },
    );
    const beforeDeleteInvocation = beforeAdmissionGateway.generateStructured(
      runtimeRequest(route, memoryContext, beforeAdmissionPreference.statement, "invocation-before-delete", {
        workspaceId,
        projectId: project.id,
        jobId: beforeAdmissionJobId,
      }),
    );
    await beforeAdmission.promise;
    await deleteUserPreferenceMemory({
      ownerId: userId,
      preferenceId: beforeAdmissionPreference.id,
      expectedVersion: beforeAdmissionPreference.version,
    });
    await deleteProjectMemory({
      projectId: project.id,
      userId,
      memoryId: beforeAdmissionProjectMemory.id,
      expectedVersion: beforeAdmissionProjectMemory.version,
    });
    releaseBeforeAdmission.resolve();
    await beforeDeleteInvocation;
    assert.deepEqual(
      sentBeforeDelete,
      [[]],
      "deletion committed before the database admission must remove the preference",
    );
    assert.deepEqual(
      projectMemoriesSentBeforeDelete,
      [["rule.revenue.period"]],
      "Project Memory deleted before admission must be removed while the surviving Project Memory remains",
    );
    assert.deepEqual(await listUserPreferenceMemories(userId), []);

    const inFlightPreference = await createUserPreferenceMemory({
      ownerId: userId,
      category: "language",
      statement: "回答简洁，优先给出结论",
      value: {},
    });
    const inFlightJobId = await createJobAndPreferenceContext("in-flight", inFlightPreference.id);
    const sendStarted = deferred<void>();
    const releaseSend = deferred<void>();
    const observedPreferences: string[][] = [];
    const observedProjectMemories: string[][] = [];
    let sendCount = 0;
    const provider: ModelGateway = {
      async generateStructured<T>(request: RuntimeModelRequest<T>): Promise<ModelResult<T>> {
        sendCount += 1;
        observedPreferences.push(request.context.userPreferences);
        observedProjectMemories.push(request.context.memories.map((memory) => memory.memoryKey));
        if (sendCount === 1) {
          sendStarted.resolve();
          await releaseSend.promise;
        }
        return {
          status: "error",
          code: "MODEL_REFUSED",
          message: "synthetic adapter result",
          retryable: false,
          invocationId: request.invocationId,
        };
      },
    };
    const inFlightGateway = new MemoryInvocationGateway(
      provider,
      route,
      gatewayIdentity(userId, workspaceId, project.id, conversation.id, inFlightJobId, memoryContext),
    );
    const inFlightInvocation = inFlightGateway.generateStructured(
      runtimeRequest(route, memoryContext, inFlightPreference.statement, "invocation-admitted-first", {
        workspaceId,
        projectId: project.id,
        jobId: inFlightJobId,
      }),
    );
    await sendStarted.promise;
    await deleteUserPreferenceMemory({
      ownerId: userId,
      preferenceId: inFlightPreference.id,
      expectedVersion: inFlightPreference.version,
    });
    await deleteProjectMemory({
      projectId: project.id,
      userId,
      memoryId: inFlightProjectMemory.id,
      expectedVersion: inFlightProjectMemory.version,
    });
    releaseSend.resolve();
    await inFlightInvocation;
    await inFlightGateway.generateStructured(
      runtimeRequest(route, memoryContext, inFlightPreference.statement, "invocation-after-delete", {
        workspaceId,
        projectId: project.id,
        jobId: inFlightJobId,
      }),
    );

    assert.deepEqual(observedPreferences, [[inFlightPreference.statement], []]);
    assert.deepEqual(observedProjectMemories, [["rule.revenue.period"], []]);
    assert.deepEqual(await listUserPreferenceMemories(userId), []);
    assert.ok((await listUserPreferenceMemoryUsage(userId)).every((usage) => usage.preferences.length === 0));
    const privateRows = await db
      .select()
      .from(privateMemoryInvocationUsage)
      .where(eq(privateMemoryInvocationUsage.ownerId, userId));
    assert.ok(
      privateRows.every(
        (usage) => Array.isArray(usage.preferenceVersionIds) && usage.preferenceVersionIds.length === 0,
      ),
    );

    const budgetPreferences = await Promise.all(
      (["language", "tone", "detail", "interaction", "output_format"] as const).map((category) =>
        createUserPreferenceMemory({
          ownerId: userId,
          category,
          statement: "超".repeat(1000),
          value: {},
        }),
      ),
    );
    const budgetJobId = await createJobAndPreferenceContext(
      "budget-reject",
      budgetPreferences.map((row) => row.id),
    );
    let budgetRejectedSendCount = 0;
    const budgetGateway = new MemoryInvocationGateway(
      fakeGateway(() => {
        budgetRejectedSendCount += 1;
      }),
      route,
      gatewayIdentity(userId, workspaceId, project.id, conversation.id, budgetJobId, memoryContext),
    );
    const budgetRequest = runtimeRequest(route, memoryContext, "小型占位偏好", "invocation-budget-reject", {
      workspaceId: workspace.id,
      projectId: project.id,
      jobId: budgetJobId,
    });
    const remainingOutputBudget =
      MAX_HARD_REQUEST_TOKEN_UPPER_BOUND - estimateBailianRequestTokenUpperBound(route, budgetRequest) - 1;
    assert.ok(remainingOutputBudget > 0);
    budgetRequest.budget.maxOutputTokens = remainingOutputBudget;
    await assert.rejects(
      () => budgetGateway.generateStructured(budgetRequest),
      (error: unknown) =>
        typeof error === "object" && error !== null && "code" in error && error.code === "MODEL_BUDGET_EXCEEDED",
    );
    assert.equal(budgetRejectedSendCount, 0);
    assert.deepEqual(
      await db
        .select()
        .from(privateMemoryInvocationUsage)
        .where(eq(privateMemoryInvocationUsage.generationJobId, budgetJobId)),
      [],
    );
    assert.deepEqual(
      await db
        .select()
        .from(generationMemoryInvocationUsage)
        .where(eq(generationMemoryInvocationUsage.generationJobId, budgetJobId)),
      [],
    );
    assert.deepEqual(
      (await listUserPreferenceMemoryUsage(userId)).filter((usage) => usage.generationJobId === budgetJobId),
      [],
    );
  } finally {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(eq(users.id, userId));
    await closeDatabase();
  }
});

function fakeGateway(onSend: (request: RuntimeModelRequest<unknown>) => void): ModelGateway {
  return {
    async generateStructured<T>(request: RuntimeModelRequest<T>): Promise<ModelResult<T>> {
      onSend(request as RuntimeModelRequest<unknown>);
      return {
        status: "error",
        code: "MODEL_REFUSED",
        message: "synthetic adapter result",
        retryable: false,
        invocationId: request.invocationId,
      };
    },
  };
}

function gatewayIdentity(
  ownerId: string,
  workspaceId: string,
  projectId: string,
  conversationId: string,
  generationJobId: string,
  memoryContext: MemoryContext,
) {
  return {
    ownerId,
    workspaceId,
    projectId,
    conversationId,
    generationJobId,
    prompt: "按月份展示销售额趋势",
    memoryContext,
  };
}

function runtimeRequest(
  routeSnapshot: ModelRouteSnapshot,
  memoryContext: MemoryContext,
  preference: string,
  invocationId: string,
  ids: { workspaceId: string; projectId: string; jobId: string },
): RuntimeModelRequest<unknown> {
  const conversation = projectConversationToCanonicalTextContext([{ role: "user", content: "按月份展示销售额趋势" }]);
  const context: PreparedModelContext = {
    version: "v1",
    historyPolicy: { strategy: "canonical_text_context", adapterVersion: conversation.version },
    conversation,
    brief: {
      businessQuestion: "按月份展示销售额趋势",
      audience: "客户汇报",
      timeRange: null,
      timeGrain: "month",
      outputFormat: "evidence_block",
    },
    metricDefinition: {
      name: "销售额",
      meaning: "销售额合计",
      formula: "sum(销售额)",
      unit: "元",
      timeRule: "按月份",
      filterRule: null,
    },
    memories: memoryContext.project.map((memory) => ({
      scope: "project",
      memoryKey: memory.memoryKey,
      statement: memory.statement,
    })),
    userPreferences: [preference],
    fieldProfiles: [{ name: "月份", inferredType: "date", nullCount: 0, distinctCount: 1, sampleValues: ["2026-01"] }],
    statistics: [],
    samples: [],
    allowedOperations: ["filter", "derive", "aggregate", "sort", "limit"],
    allowedChartTypes: ["line", "bar", "area"],
    templateConstraints: { templateId: "builtin-default", templateVersion: "v1", requirements: [] },
  };
  return {
    version: "v1",
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    generationJobId: ids.jobId,
    invocationId,
    task: "chart-plan",
    routeSnapshotId: routeSnapshot.routeSnapshotId,
    context,
    output: { ...createChartPlanOutputDescriptor(), parse: (value) => chartPlanDecisionSchema.parse(value) },
    budget: { deadlineAt: Date.now() + 30_000, maxOutputTokens: 512 },
    signal: new AbortController().signal,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
