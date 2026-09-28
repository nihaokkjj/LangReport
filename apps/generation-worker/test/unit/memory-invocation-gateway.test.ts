import assert from "node:assert/strict";
import test from "node:test";
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
import { resolveModelRouteSnapshot } from "@langreport/model-gateway";
import { MemoryInvocationGateway } from "../../src/memory-invocation-gateway.js";

const route = resolveModelRouteSnapshot({
  NODE_ENV: "production",
  GENERATION_MODE: "llm",
  BAILIAN_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  BAILIAN_MODEL_ID: "qwen-plus",
  BAILIAN_STRUCTURED_OUTPUT: "json_schema",
});
const memoryContext: MemoryContext = { conversation: null, project: [], workspace: [], conflicts: [] };

test("full provider request hard budget rejects before admission or gateway send", async () => {
  let admissions = 0;
  let sends = 0;
  const gateway = new MemoryInvocationGateway(
    baseGateway(() => {
      sends += 1;
    }),
    route,
    identity(),
    {
      async admit(request) {
        admissions += 1;
        return admitted(request.requestContext);
      },
      async complete() {},
      async discard() {},
    },
  );
  const request = runtimeRequest(route, ["偏好".repeat(4000), "偏好".repeat(4000), "偏好".repeat(4000)]);

  await assert.rejects(
    () => gateway.generateStructured(request),
    (error: unknown) =>
      typeof error === "object" && error !== null && "code" in error && error.code === "MODEL_BUDGET_EXCEEDED",
  );
  assert.equal(admissions, 0);
  assert.equal(sends, 0);
});

test("post-admission full request budget rejection discards usage and never reaches the gateway", async () => {
  let sends = 0;
  const discarded: string[] = [];
  const completed: string[] = [];
  const gateway = new MemoryInvocationGateway(
    baseGateway(() => {
      sends += 1;
    }),
    route,
    identity(),
    {
      async admit(request) {
        return {
          ...admitted(request.requestContext),
          requestContext: {
            ...request.requestContext,
            userPreferences: Array.from({ length: 5 }, () => "超".repeat(8000)),
          },
          preferenceVersionIds: ["private-version-001"],
          memoryVersionIds: ["project-version-001"],
        };
      },
      async complete(input) {
        completed.push(input.invocationId);
      },
      async discard(input) {
        discarded.push(input.invocationId);
      },
    },
  );

  await assert.rejects(
    () => gateway.generateStructured(runtimeRequest(route, ["回答用中文，语气简洁"])),
    (error: unknown) =>
      typeof error === "object" && error !== null && "code" in error && error.code === "MODEL_BUDGET_EXCEEDED",
  );
  assert.deepEqual(discarded, ["invocation-001"]);
  assert.deepEqual(completed, []);
  assert.equal(sends, 0);
});

test("revocation before admission removes preference; revocation after admission leaves only that call in flight", async () => {
  let deleted = false;
  const observedPreferences: string[][] = [];
  const completionStatuses: string[] = [];
  let releaseFirstSend!: () => void;
  let firstSendStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    firstSendStarted = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseFirstSend = resolve;
  });
  let sendCount = 0;
  const inner: ModelGateway = {
    async generateStructured<T>(request: RuntimeModelRequest<T>): Promise<ModelResult<T>> {
      sendCount += 1;
      observedPreferences.push(request.context.userPreferences);
      if (sendCount === 1) {
        firstSendStarted();
        await release;
      }
      return {
        status: "error",
        code: "MODEL_REFUSED",
        message: "fake result",
        retryable: false,
        invocationId: request.invocationId,
      };
    },
  };
  const gateway = new MemoryInvocationGateway(inner, route, identity(), {
    async admit(request) {
      const context = deleted ? { ...request.requestContext, userPreferences: [] } : request.requestContext;
      return admitted(context);
    },
    async complete(input) {
      completionStatuses.push(input.status);
    },
    async discard() {},
  });

  const first = gateway.generateStructured(runtimeRequest(route, ["回答用中文，语气简洁"]));
  await firstStarted;
  deleted = true;
  releaseFirstSend();
  await first;
  await gateway.generateStructured(runtimeRequest(route, ["回答用中文，语气简洁"], "invocation-002"));

  assert.deepEqual(observedPreferences, [["回答用中文，语气简洁"], []]);
  assert.deepEqual(completionStatuses, ["failed", "failed"]);
  assert.equal(sendCount, 2);
});

test("revocation completed before admission cannot send the stored preference", async () => {
  let sends = 0;
  const gateway = new MemoryInvocationGateway(
    baseGateway(() => {
      sends += 1;
    }),
    route,
    identity(),
    {
      async admit(request) {
        return admitted({ ...request.requestContext, userPreferences: [] });
      },
      async complete() {},
      async discard() {},
    },
  );
  await gateway.generateStructured(runtimeRequest(route, ["回答用中文，语气简洁"]));
  assert.equal(sends, 1);
});

test("unavailable revocation state blocks admission and provider send", async () => {
  let admissions = 0;
  let sends = 0;
  const gateway = new MemoryInvocationGateway(
    baseGateway(() => {
      sends += 1;
    }),
    route,
    identity(),
    {
      async admit(request) {
        admissions += 1;
        return admitted(request.requestContext);
      },
      async complete() {},
      async discard() {},
    },
    async () => {
      throw new Error("synthetic ledger unavailable");
    },
  );

  await assert.rejects(() => gateway.generateStructured(runtimeRequest(route, ["偏好"])), /ledger unavailable/u);
  assert.equal(admissions, 0);
  assert.equal(sends, 0);
});

function baseGateway(onSend: () => void): ModelGateway {
  return {
    async generateStructured<T>(request: RuntimeModelRequest<T>): Promise<ModelResult<T>> {
      onSend();
      return {
        status: "error",
        code: "MODEL_REFUSED",
        message: "fake result",
        retryable: false,
        invocationId: request.invocationId,
      };
    },
  };
}

function runtimeRequest(
  routeSnapshot: ModelRouteSnapshot,
  userPreferences: string[],
  invocationId = "invocation-001",
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
      timeGrain: null,
      outputFormat: "evidence_block",
    },
    metricDefinition: {
      name: "销售额",
      meaning: "订单销售额合计",
      formula: "sum(销售额)",
      unit: "元",
      timeRule: "按月份统计",
      filterRule: null,
    },
    memories: [],
    userPreferences,
    fieldProfiles: [{ name: "月份", inferredType: "date", nullCount: 0, distinctCount: 2, sampleValues: ["2026-01"] }],
    statistics: [],
    samples: [],
    allowedOperations: ["filter", "derive", "aggregate", "sort", "limit"],
    allowedChartTypes: ["line", "bar", "area"],
    templateConstraints: { templateId: "builtin-default", templateVersion: "v1", requirements: [] },
  };
  return {
    version: "v1",
    workspaceId: "workspace-001",
    projectId: "project-001",
    generationJobId: "job-001",
    invocationId,
    task: "chart-plan",
    routeSnapshotId: routeSnapshot.routeSnapshotId,
    context,
    output: { ...createChartPlanOutputDescriptor(), parse: (value) => chartPlanDecisionSchema.parse(value) },
    budget: { deadlineAt: Date.now() + 30_000, maxOutputTokens: 2_000 },
    signal: new AbortController().signal,
  };
}

function identity() {
  return {
    ownerId: "user-001",
    workspaceId: "workspace-001",
    projectId: "project-001",
    conversationId: "conversation-001",
    generationJobId: "job-001",
    prompt: "按月份展示销售额趋势",
    memoryContext,
  };
}

function admitted(requestContext: PreparedModelContext) {
  return {
    requestContext,
    preferenceVersionIds: [],
    memoryVersionIds: [],
    conversationMessages: [],
    receipt: { ownerId: "user-001", generationJobId: "job-001", invocationId: "invocation-001" },
  };
}
