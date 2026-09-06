import assert from "node:assert/strict";
import test from "node:test";
import {
  chartPlanDecisionSchema,
  createChartPlanOutputDescriptor,
  historyPolicySchema,
  modelErrorCodeSchema,
  modelProfileSchema,
  modelResultSchema,
  modelRunSnapshotSchema,
  persistedModelRequestSchema,
  preparedModelContextSchema,
  type ModelGateway,
  type RuntimeModelRequest,
  validationRecordSchema
} from "./index.js";

const validIntent = {
  version: "v1" as const,
  language: "zh-CN" as const,
  originalPrompt: "按月份展示各区域销售额",
  chartType: "line" as const,
  timeColumn: "月份",
  timeGrain: "month" as const,
  dimensionColumns: ["区域"],
  measureColumns: ["销售额"],
  comparison: "none" as const,
  title: "各区域月度销售额",
  confidence: 0.92
};

const validPlan = {
  version: "v1" as const,
  rationale: "按月份和区域汇总销售额",
  steps: [{
    kind: "aggregate" as const,
    groupBy: ["月份", "区域"],
    measures: [{ column: "销售额", operation: "sum" as const, outputColumn: "销售额_sum" }]
  }],
  expectedColumns: ["月份", "区域", "销售额_sum"]
};

const validChartSelection = {
  chartType: "line" as const,
  xField: "月份",
  yField: "销售额_sum",
  seriesField: "区域",
  tooltipFields: ["销售额_sum"]
};

const validPreparedModelContext = {
  version: "v1" as const,
  historyPolicy: {
    strategy: "canonical_text_context" as const,
    adapterVersion: "v1"
  },
  brief: {
    businessQuestion: "按月份展示各区域销售额和同比变化",
    audience: "客户汇报",
    timeRange: "2025-01 至 2026-03",
    timeGrain: "month",
    outputFormat: "evidence_block"
  },
  metricDefinition: {
    name: "销售额同比",
    meaning: "按区域汇总每个自然月销售额，并与上年同月比较",
    formula: "(本月销售额 - 上年同月销售额) / ABS(上年同月销售额)",
    unit: "%",
    timeRule: "按自然月分组；同比匹配前 12 个月；缺少基期时返回空值",
    filterRule: null
  },
  memories: [{
    scope: "project" as const,
    statement: "客户汇报优先使用中文标题和直接标注单位"
  }],
  fieldProfiles: [{
    name: "月份",
    inferredType: "date" as const,
    nullCount: 0,
    distinctCount: 6,
    sampleValues: ["2025-01", "2025-02"]
  }, {
    name: "销售额",
    inferredType: "number" as const,
    nullCount: 0,
    distinctCount: 15,
    sampleValues: [60, 40]
  }],
  statistics: [{
    name: "row_count",
    value: 24,
    unit: "rows"
  }],
  samples: [{
    label: "2026-01 / 华东",
    text: "月份=2026-01；区域=华东；销售额=125"
  }],
  allowedOperations: ["aggregate" as const, "derive" as const, "sort" as const],
  allowedChartTypes: ["line" as const, "bar" as const, "area" as const],
  templateConstraints: {
    templateId: "consulting-evidence-v1",
    templateVersion: "v1",
    requirements: ["必须展示单位", "必须保留数据限制说明"]
  }
};

test("chart-plan ready decision contains a plan and chart selection", () => {
  const decision = chartPlanDecisionSchema.parse({
    decision: "ready",
    intent: validIntent,
    plan: validPlan,
    chartSelection: validChartSelection,
    questions: []
  });

  assert.equal(decision.decision, "ready");
  assert.equal(decision.plan.expectedColumns[2], "销售额_sum");
  assert.equal(decision.chartSelection.yField, "销售额_sum");
  assert.deepEqual(decision.questions, []);
});

test("chart-plan needs_clarification decision contains actionable questions and no plan", () => {
  const decision = chartPlanDecisionSchema.parse({
    decision: "needs_clarification",
    intent: null,
    plan: null,
    chartSelection: null,
    questions: [{
      code: "metric_ambiguous",
      question: "请确认销售额是否包含退款？",
      reason: "数据中同时存在销售额和净销售额字段",
      field: "销售额"
    }]
  });

  assert.equal(decision.decision, "needs_clarification");
  assert.equal(decision.plan, null);
  assert.equal(decision.questions[0]?.code, "metric_ambiguous");
});

test("chart-plan decisions cannot contain both a plan and clarification questions", () => {
  assert.throws(() => chartPlanDecisionSchema.parse({
    decision: "ready",
    intent: validIntent,
    plan: validPlan,
    chartSelection: validChartSelection,
    questions: [{
      code: "extra_question",
      question: "不应出现在 ready 结果中"
    }]
  }));

  assert.throws(() => chartPlanDecisionSchema.parse({
    decision: "needs_clarification",
    intent: null,
    plan: validPlan,
    chartSelection: null,
    questions: [{
      code: "missing_time_range",
      question: "请确认时间范围"
    }]
  }));

  assert.throws(() => chartPlanDecisionSchema.parse({
    decision: "needs_clarification",
    intent: null,
    plan: null,
    chartSelection: null,
    questions: []
  }));
});

test("prepared model context is a strict canonical text projection", () => {
  const context = preparedModelContextSchema.parse(validPreparedModelContext);

  assert.equal(context.historyPolicy.strategy, "canonical_text_context");
  assert.equal(context.fieldProfiles[0]?.name, "月份");
  assert.equal(context.samples[0]?.text, "月份=2026-01；区域=华东；销售额=125");

  assert.throws(() => preparedModelContextSchema.parse({
    ...validPreparedModelContext,
    reasoning: "不得把隐藏推理放入首期上下文"
  }));
  assert.throws(() => preparedModelContextSchema.parse({
    ...validPreparedModelContext,
    historyPolicy: { strategy: "full_conversation", adapterVersion: "v1" }
  }));
});

test("chart-plan output descriptor is generated from the local decision contract", () => {
  const descriptor = createChartPlanOutputDescriptor();
  const jsonSchema = descriptor.jsonSchema as {
    $schema?: string;
    oneOf?: Array<{ properties?: Record<string, unknown> }>;
  };

  assert.equal(descriptor.schemaId, "chart-plan");
  assert.equal(descriptor.schemaVersion, "v1");
  assert.equal(jsonSchema.$schema, "http://json-schema.org/draft-07/schema#");
  assert.ok(jsonSchema.oneOf?.some((branch) => branch.properties?.decision !== undefined));
  assert.match(JSON.stringify(jsonSchema), /needs_clarification/);
});

test("persisted request excludes runtime parser and cancellation objects", () => {
  const persistedRequest = persistedModelRequestSchema.parse({
    version: "v1",
    workspaceId: "workspace-001",
    projectId: "project-001",
    generationJobId: "job-001",
    invocationId: "invocation-001",
    task: "chart-plan",
    routeSnapshotId: "route-001",
    context: validPreparedModelContext,
    output: createChartPlanOutputDescriptor(),
    budget: {
      deadlineAt: 1799011200000,
      maxOutputTokens: 2048
    }
  });

  assert.equal(persistedRequest.output.schemaId, "chart-plan");
  assert.throws(() => persistedModelRequestSchema.parse({
    ...persistedRequest,
    output: {
      ...persistedRequest.output,
      parse: () => validIntent
    }
  }));
});

test("model result has mutually exclusive success and error envelopes", () => {
  const success = modelResultSchema.parse({
    status: "ok",
    data: { decision: "needs_clarification" },
    invocationId: "invocation-001"
  });
  const failure = modelResultSchema.parse({
    status: "error",
    code: "MODEL_TIMEOUT",
    message: "模型调用超过截止时间",
    retryable: true,
    invocationId: "invocation-001"
  });

  assert.equal(success.status, "ok");
  assert.equal(failure.status, "error");
  assert.throws(() => modelResultSchema.parse({
    status: "ok",
    data: validIntent,
    code: "MODEL_TIMEOUT",
    invocationId: "invocation-001"
  }));
  assert.throws(() => modelResultSchema.parse({
    status: "error",
    data: validIntent,
    code: "MODEL_TIMEOUT",
    message: "非法混合结果",
    retryable: true,
    invocationId: "invocation-001"
  }));
});

test("model gateway interface keeps parsing and cancellation runtime-only", async () => {
  const gateway: ModelGateway = {
    async generateStructured<T>(request: RuntimeModelRequest<T>) {
      return {
        status: "ok" as const,
        data: request.output.parse({}),
        invocationId: request.invocationId
      };
    }
  };

  const result = await gateway.generateStructured({
    version: "v1",
    workspaceId: "workspace-001",
    projectId: "project-001",
    generationJobId: "job-001",
    invocationId: "invocation-001",
    task: "chart-plan",
    routeSnapshotId: "route-001",
    context: validPreparedModelContext,
    output: {
      ...createChartPlanOutputDescriptor(),
      parse: () => validIntent
    },
    budget: {
      deadlineAt: 1799011200000,
      maxOutputTokens: 2048
    },
    signal: new AbortController().signal
  });

  assert.equal(result.status, "ok");
  assert.equal(result.invocationId, "invocation-001");
});

test("history policy fixes the first context strategy", () => {
  const policy = historyPolicySchema.parse({
    strategy: "canonical_text_context",
    adapterVersion: "v1"
  });

  assert.equal(policy.strategy, "canonical_text_context");
  assert.throws(() => historyPolicySchema.parse({
    strategy: "full_conversation",
    adapterVersion: "v1"
  }));
});

test("model profile and run snapshot retain effective routing and options", () => {
  const profile = modelProfileSchema.parse({
    version: "v1",
    profileId: "bailian-planner-v1",
    connectionId: "bailian-cn",
    provider: "bailian",
    protocol: "chat-completions",
    modelId: "qwen-test",
    profileVersion: "v1",
    adapterVersion: "v1",
    enabled: true,
    tasks: ["chart-plan"],
    structuredOutput: {
      methods: ["jsonSchema", "jsonMode"],
      schemaVersion: "v1"
    },
    capabilities: {
      streaming: false,
      cancellation: true,
      usageMetadata: true,
      toolCalling: false
    },
    historyPolicy: {
      strategy: "canonical_text_context",
      adapterVersion: "v1"
    },
    verifiedAt: "2026-09-05T00:00:00.000Z"
  });

  const snapshot = modelRunSnapshotSchema.parse({
    version: "v1",
    task: "chart-plan",
    routeSnapshotId: "route-001",
    requestedProfile: "bailian-planner-v1",
    effectiveProfile: "bailian-planner-v1",
    requestedOptions: { temperature: 0.1 },
    effectiveOptions: { temperature: 0.1, maxOutputTokens: 2048 },
    historyPolicy: {
      strategy: "canonical_text_context",
      adapterVersion: "v1"
    },
    contextProjectionHash: "sha256:run-context",
    capturedAt: "2026-09-05T00:00:00.000Z"
  });

  assert.equal(profile.modelId, "qwen-test");
  assert.equal(snapshot.effectiveProfile, "bailian-planner-v1");
  assert.equal(snapshot.effectiveOptions.maxOutputTokens, 2048);
});

test("validation records have explicit status, errors, and validator version", () => {
  const record = validationRecordSchema.parse({
    status: "failed",
    errors: [{
      code: "FIELD_NOT_FOUND",
      path: "chartSelection.yField",
      message: "字段不存在于 Data Snapshot",
      severity: "error"
    }],
    validatorVersion: "plan-validator-v1",
    checkedAt: "2026-09-05T00:00:00.000Z"
  });

  assert.equal(record.status, "failed");
  assert.equal(record.errors[0]?.path, "chartSelection.yField");
  assert.throws(() => validationRecordSchema.parse({
    status: "passed",
    errors: [{
      code: "FIELD_NOT_FOUND",
      message: "不应在通过记录中出现错误",
      severity: "error"
    }],
    validatorVersion: "plan-validator-v1"
  }));
});

test("model error codes distinguish authentication, throttling, timeout, capability, tool, output, and budget failures", () => {
  const requiredCodes = [
    "MODEL_AUTH_FAILED",
    "MODEL_RATE_LIMITED",
    "MODEL_TIMEOUT",
    "MODEL_CAPABILITY_UNSUPPORTED",
    "MODEL_TOOL_FAILED",
    "MODEL_OUTPUT_INVALID",
    "MODEL_BUDGET_EXCEEDED"
  ] as const;

  for (const code of requiredCodes) assert.equal(modelErrorCodeSchema.parse(code), code);
  assert.throws(() => modelErrorCodeSchema.parse("MODEL_UNKNOWN_FAILURE"));
});
