import assert from "node:assert/strict";
import test from "node:test";
import {
  chartPlanDecisionSchema,
  createChartPlanOutputDescriptor,
  type ChartPlanDecision,
  type RuntimeModelRequest
} from "@langreport/contracts";
import {
  createBailianQwenGateway,
  decryptWorkspaceModelCredential,
  encryptWorkspaceModelCredential,
  ModelCredentialEncryptionError,
  ModelGatewayConfigurationError,
  resolveModelRouteSnapshot,
  type FetchLike
} from "./index.js";

const capturedAt = "2026-09-06T00:00:00.000Z";
const baseEnvironment = {
  NODE_ENV: "production",
  GENERATION_MODE: "llm",
  BAILIAN_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  BAILIAN_MODEL_ID: "qwen-plus",
  BAILIAN_STRUCTURED_OUTPUT: "json_schema",
  BAILIAN_TEMPERATURE: "0.1"
};

test("freezes a non-secret Bailian JSON Schema route and rejects incomplete production config", () => {
  const route = resolveModelRouteSnapshot(baseEnvironment, capturedAt);

  assert.equal(route.generationMode, "llm");
  assert.equal(route.baseUrl, baseEnvironment.BAILIAN_BASE_URL);
  assert.equal(route.structuredOutputMethod, "jsonSchema");
  assert.equal(route.effectiveOptions.enableThinking, false);
  assert.match(route.routeSnapshotId, /^sha256:[a-f0-9]{64}$/);
  assert.match(route.outputSchemaHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(route).includes("API_KEY"), false);
  assert.throws(
    () => resolveModelRouteSnapshot({ NODE_ENV: "production", GENERATION_MODE: "llm" }, capturedAt),
    ModelGatewayConfigurationError
  );
  assert.throws(
    () => resolveModelRouteSnapshot({ ...baseEnvironment, BAILIAN_BASE_URL: "http://example.com/compatible-mode/v1" }, capturedAt),
    ModelGatewayConfigurationError
  );
});

test("encrypts Workspace credentials without retaining their plaintext", () => {
  const apiKey = "sk-workspace-secret-value";
  const masterKey = Buffer.alloc(32, 7).toString("base64");
  const encrypted = encryptWorkspaceModelCredential(apiKey, masterKey);

  assert.match(encrypted, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(encrypted.includes(apiKey), false);
  assert.equal(decryptWorkspaceModelCredential(encrypted, masterKey), apiKey);
  assert.throws(
    () => decryptWorkspaceModelCredential(encrypted, Buffer.alloc(32, 8).toString("base64")),
    ModelCredentialEncryptionError
  );
  assert.throws(
    () => encryptWorkspaceModelCredential(apiKey, undefined),
    ModelCredentialEncryptionError
  );
});

test("sends one Qwen Chat Completions JSON Schema request and preserves invocation metadata", async () => {
  const route = resolveModelRouteSnapshot(baseEnvironment, capturedAt);
  const requests: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  const fetcher: FetchLike = async (input, init) => {
    requests.push({ input, init });
    return jsonResponse({
      id: "chatcmpl-bailian-001",
      model: "qwen-plus-2026-09-01",
      choices: [{
        finish_reason: "stop",
        message: { content: JSON.stringify(needsClarificationDecision()) }
      }],
      usage: { prompt_tokens: 101, completion_tokens: 37, total_tokens: 138 }
    });
  };
  const gateway = createBailianQwenGateway(route, { BAILIAN_API_KEY: "worker-secret" }, fetcher);

  const result = await gateway.generateStructured(runtimeRequest("invocation-001", route.routeSnapshotId));

  assert.equal(requests.length, 1, "adapter never retries HTTP itself");
  assert.equal(String(requests[0]?.input), "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
  const headers = new Headers(requests[0]?.init?.headers);
  assert.equal(headers.get("authorization"), "Bearer worker-secret");
  const body = JSON.parse(String(requests[0]?.init?.body)) as Record<string, any>;
  assert.equal(body.model, "qwen-plus");
  assert.equal(body.stream, false);
  assert.equal(body.max_completion_tokens, 512);
  assert.equal(body.enable_thinking, false);
  assert.deepEqual(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.match(body.messages[0].content, /JSON/);

  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.data.decision, "needs_clarification");
  assert.equal(result.invocation?.providerRequestId, "chatcmpl-bailian-001");
  assert.equal(result.invocation?.providerModelId, "qwen-plus-2026-09-01");
  assert.equal(result.invocation?.usage.totalTokens, 138);
  assert.equal(result.invocation?.outcome, "succeeded");
});

test("uses explicit JSON Object mode and normalizes provider failures without exposing raw output", async () => {
  const route = resolveModelRouteSnapshot({ ...baseEnvironment, BAILIAN_STRUCTURED_OUTPUT: "json_object" }, capturedAt);
  let capturedBody: Record<string, any> | undefined;
  const gateway = createBailianQwenGateway(route, { BAILIAN_API_KEY: "worker-secret" }, async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body));
    return jsonResponse({ choices: [{ finish_reason: "length", message: { content: "{}" } }] });
  });

  const result = await gateway.generateStructured(runtimeRequest("invocation-001", route.routeSnapshotId));

  assert.deepEqual(capturedBody?.response_format, { type: "json_object" });
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.equal(result.code, "MODEL_OUTPUT_TRUNCATED");
  assert.equal(result.retryable, false);
  assert.equal(result.invocation?.finishReason, "length");
  assert.equal(result.invocation?.errorCode, "MODEL_OUTPUT_TRUNCATED");
});

test("normalizes auth, rate-limit, timeout, empty, and malformed model responses", async () => {
  const route = resolveModelRouteSnapshot(baseEnvironment, capturedAt);
  const cases: Array<{ name: string; response: Response; code: string; retryable: boolean }> = [
    { name: "auth", response: jsonResponse({ error: { message: "invalid api key" } }, 401), code: "MODEL_AUTH_FAILED", retryable: false },
    { name: "rate", response: jsonResponse({ error: { message: "too many requests" } }, 429), code: "MODEL_RATE_LIMITED", retryable: true },
    { name: "timeout", response: jsonResponse({ error: { message: "gateway timeout" } }, 504), code: "MODEL_TIMEOUT", retryable: true },
    { name: "empty", response: jsonResponse({ choices: [{ finish_reason: "stop", message: { content: "" } }] }), code: "MODEL_OUTPUT_EMPTY", retryable: false },
    { name: "invalid-json", response: jsonResponse({ choices: [{ finish_reason: "stop", message: { content: "not json" } }] }), code: "MODEL_OUTPUT_INVALID", retryable: false }
  ];

  for (const item of cases) {
    const gateway = createBailianQwenGateway(route, { BAILIAN_API_KEY: "worker-secret" }, async () => item.response.clone());
    const result = await gateway.generateStructured(runtimeRequest(`invocation-${item.name}`, route.routeSnapshotId));
    assert.equal(result.status, "error", item.name);
    if (result.status !== "error") continue;
    assert.equal(result.code, item.code, item.name);
    assert.equal(result.retryable, item.retryable, item.name);
    assert.equal(result.invocation?.outcome, "failed", item.name);
    assert.equal(result.invocation?.errorCode, item.code, item.name);
  }
});

test("uses Harness deadline cancellation while retaining the existing timeout audit result", async () => {
  const route = resolveModelRouteSnapshot(baseEnvironment, capturedAt);
  let requestWasAborted = false;
  const gateway = createBailianQwenGateway(route, { BAILIAN_API_KEY: "worker-secret" }, async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      requestWasAborted = true;
      reject(new Error("aborted"));
    }, { once: true });
  }));

  const result = await gateway.generateStructured({ ...runtimeRequest("invocation-timeout", route.routeSnapshotId), budget: { deadlineAt: Date.now() + 5, maxOutputTokens: 512 } });

  assert.equal(requestWasAborted, true);
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.equal(result.code, "MODEL_TIMEOUT");
  assert.equal(result.retryable, true);
  assert.equal(result.invocation?.errorCode, "MODEL_TIMEOUT");
});

function runtimeRequest(invocationId = "invocation-001", routeSnapshotId = "route-001"): RuntimeModelRequest<ChartPlanDecision> {
  return {
    version: "v1",
    workspaceId: "workspace-001",
    projectId: "project-001",
    generationJobId: "job-001",
    invocationId,
    task: "chart-plan",
    routeSnapshotId,
    context: {
      version: "v1",
      historyPolicy: { strategy: "canonical_text_context", adapterVersion: "canonical-text-context-v1" },
      conversation: {
        version: "canonical-text-context-v1",
        messages: [{ role: "user", content: "按月份展示销售额趋势" }],
        omittedMessageCount: 0,
        truncatedMessageCount: 0,
        hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      },
      brief: { businessQuestion: "按月份展示销售额趋势", audience: "客户汇报", timeRange: null, timeGrain: "month", outputFormat: "evidence_block" },
      metricDefinition: { name: "销售额", meaning: "订单销售额合计", formula: "sum(销售额)", unit: "元", timeRule: "按月份统计", filterRule: null },
      memories: [],
      fieldProfiles: [{ name: "月份", inferredType: "date", nullCount: 0, distinctCount: 2, sampleValues: ["2026-01", "2026-02"] }],
      statistics: [],
      samples: [],
      allowedOperations: ["filter", "derive", "aggregate", "sort", "limit"],
      allowedChartTypes: ["line", "bar", "area"],
      templateConstraints: { templateId: "builtin-default", templateVersion: "v1", requirements: [] }
    },
    output: {
      ...createChartPlanOutputDescriptor(),
      parse: (value: unknown) => chartPlanDecisionSchema.parse(value)
    },
    budget: { deadlineAt: Date.now() + 30_000, maxOutputTokens: 512 },
    signal: new AbortController().signal
  };
}

function needsClarificationDecision() {
  return {
    decision: "needs_clarification",
    intent: null,
    plan: null,
    chartSelection: null,
    questions: [{ code: "period_required", question: "请确认分析时间范围" }]
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}
