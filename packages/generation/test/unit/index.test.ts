import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadBuiltinManifests, parseManifest } from "@langreport/plugin-sdk";
import { parseData, type DataRow, type FieldLineage } from "@langreport/data-engine";
import type { ModelGateway, RuntimeModelRequest, ModelResult, TransformPlan } from "@langreport/contracts";
import {
  GenerationCycle,
  projectConversationToCanonicalTextContext,
  validateGenerationRevision,
} from "../../src/index.js";

const fixtureDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../tests/fixtures/consulting/monthly-regional-sales",
);

test("模型选择 avg 时编译器不得静默改用 sum，未知纵轴必须失败", async () => {
  for (const field of ["销售额_avg", "不存在的字段"]) {
    const gateway: ModelGateway = {
      async generateStructured<T>(request: RuntimeModelRequest<T>): Promise<ModelResult<T>> {
        return {
          status: "ok",
          invocationId: request.invocationId,
          data: request.output.parse({
            decision: "ready",
            proposal: null,
            intent: {
              version: "v1",
              language: "zh-CN",
              originalPrompt: "比较平均销售额",
              chartType: "bar",
              dimensionColumns: ["区域"],
              measureColumns: ["销售额"],
              comparison: "none",
              title: "平均销售额",
              confidence: 1,
            },
            plan: {
              version: "v1",
              rationale: "同时计算总额与均值，展示均值",
              steps: [
                {
                  kind: "aggregate",
                  groupBy: ["区域"],
                  measures: [
                    { column: "销售额", operation: "sum", outputColumn: "销售额_sum" },
                    { column: "销售额", operation: "avg", outputColumn: "销售额_avg" },
                  ],
                },
              ],
              expectedColumns: ["区域", "销售额_sum", "销售额_avg"],
            },
            chartSelection: { chartType: "bar", xField: "区域", yField: field, seriesField: null, tooltipFields: [] },
          }),
        };
      },
    };
    const result = await new GenerationCycle(gateway).run({
      ...cycleInput,
      cycle: { ...cycleInput.cycle, budget: { deadlineAt: Date.now() + 30_000, maxOutputTokens: 2000 } },
      rows: [
        { 区域: "华东", 销售额: 100 },
        { 区域: "华东", 销售额: 300 },
      ],
    });
    if (field === "不存在的字段") {
      assert.equal(result.status, "failed");
      continue;
    }
    assert.equal(result.status, "drafted");
    if (result.status !== "drafted") continue;
    assert.equal(result.artifacts.flintSpec.chartSpec.encodings.y.field, "销售额_avg");
    assert.equal(result.artifacts.flintSpec.data.values[0]?.销售额_avg, 200);
    assert.equal(result.artifacts.flintSpec.data.values[0]?.销售额_sum, 400);
  }
});

type ExpectedTransformFixture = {
  plan: TransformPlan;
  rows: DataRow[];
};

function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(fixtureDirectory, name), "utf8")) as T;
}

function readSalesSnapshot() {
  return parseData({
    sourceType: "csv",
    bytes: readFileSync(resolve(fixtureDirectory, "sales.csv")),
  });
}

test("v2 deterministic calendar plans aggregate months and compare quarters and years", async () => {
  for (const [prompt, csv, expected] of [
    ["按月份展示销售额同比", "月份,销售额\n2025-01-01,40\n2025-01-02,60\n2026-01-01,120\n", 0.2],
    ["按季度展示销售额同比", "季度,销售额\n2025-Q1,100\n2026-Q1,150\n", 0.5],
    ["按年度展示销售额同比", "年份,销售额\n2025,100\n2026,120\n", 0.2],
  ] as const) {
    const table = parseData({ sourceType: "csv", bytes: Buffer.from(csv) });
    const result = await new GenerationCycle().run({
      ...cycleInput,
      prompt,
      analysisBriefSnapshot: { ...cycleInput.analysisBriefSnapshot, businessQuestion: prompt },
      rows: table.rows,
      profiles: table.profiles,
      transformExecutorVersion: "v2",
      cycle: { ...cycleInput.cycle, budget: { deadlineAt: Date.now() + 30000, maxOutputTokens: 2000 } },
    });
    assert.equal(result.status, "drafted", JSON.stringify(result));
    if (result.status !== "drafted") continue;
    assert.equal(result.artifacts.transform.rows.length, 2);
    assert.equal(result.artifacts.transform.rows.at(-1)?.销售额_yoy, expected);
    const comparison = result.artifacts.plan.steps.find(
      (step) => step.kind === "derive" && step.expression === "percent_change",
    );
    assert.ok(comparison && "periodUnit" in comparison);
  }
});

test("v2 normalizes every time value before aggregating, including unsampled dates and intraday timestamps", async () => {
  for (const [prompt, csv, count, period, sum] of [
    [
      "按月份展示销售额",
      "月份,销售额\n2026-01,10\n2026-02,20\n2026-03,30\n2026-04,40\n2026-05,50\n2026-01-15,60\n",
      5,
      "2026-01",
      70,
    ],
    [
      "按日展示销售额同比",
      "日期,销售额\n2025-01-01T08:00:00Z,40\n2025-01-01T12:00:00Z,60\n2026-01-01T08:00:00Z,120\n",
      2,
      "2025-01-01",
      100,
    ],
  ] as const) {
    const table = parseData({ sourceType: "csv", bytes: Buffer.from(csv) });
    const result = await new GenerationCycle().run({
      ...cycleInput,
      prompt,
      analysisBriefSnapshot: { ...cycleInput.analysisBriefSnapshot, businessQuestion: prompt },
      rows: table.rows,
      profiles: table.profiles,
      transformExecutorVersion: "v2",
      cycle: { ...cycleInput.cycle, budget: { deadlineAt: Date.now() + 30000, maxOutputTokens: 2000 } },
    });
    assert.equal(result.status, "drafted", JSON.stringify(result));
    if (result.status !== "drafted") continue;
    assert.equal(result.artifacts.transform.rows.length, count);
    const timeColumn = table.columns[0];
    assert.equal(result.artifacts.transform.rows.find((row) => row[timeColumn] === period)?.销售额_sum, sum);
    if (prompt.includes("同比")) assert.equal(result.artifacts.transform.rows.at(-1)?.销售额_yoy, 0.2);
  }
});

test("legacy deterministic jobs retain plans without the new calendar-unit field", async () => {
  const result = await new GenerationCycle().run({
    ...cycleInput,
    prompt: "按月份展示销售额同比",
    analysisBriefSnapshot: { ...cycleInput.analysisBriefSnapshot, businessQuestion: "按月份展示销售额同比" },
    transformExecutorVersion: "v1",
    cycle: { ...cycleInput.cycle, budget: { deadlineAt: Date.now() + 30000, maxOutputTokens: 2000 } },
  });
  assert.equal(result.status, "drafted");
  if (result.status !== "drafted") return;
  const step = result.artifacts.plan.steps.find(
    (candidate) => candidate.kind === "derive" && candidate.expression === "percent_change",
  );
  assert.ok(step && step.kind === "derive");
  assert.equal(step.periodOffset, 12);
  assert.equal(step.periodUnit, undefined);
});

const cycleInput = {
  cycle: {
    workspaceId: "workspace-1",
    projectId: "project-1",
    generationJobId: "job-1",
    invocationId: "invocation-1",
    routeSnapshotId: "route-1",
    budget: { deadlineAt: Date.now() + 30_000, maxOutputTokens: 2_000 },
  },
  analysisBriefSnapshot: {
    businessQuestion: "按月份展示各区域销售额趋势",
    audience: "客户汇报",
    timeRange: "2026-01 至 2026-02",
    timeGrain: "month",
    outputFormat: "evidence_block",
  },
  metricDefinitionSnapshot: {
    name: "销售额",
    meaning: "订单销售额合计",
    formula: "sum(销售额)",
    unit: "元",
    timeRule: "按月份统计",
    filterRule: null,
  },
  prompt: "按月份展示各区域销售额趋势",
  profiles: [
    {
      name: "月份",
      inferredType: "date" as const,
      nullCount: 0,
      distinctCount: 2,
      sampleValues: ["2026-01", "2026-02"],
    },
    { name: "区域", inferredType: "string" as const, nullCount: 0, distinctCount: 2, sampleValues: ["华东", "华南"] },
    { name: "销售额", inferredType: "number" as const, nullCount: 0, distinctCount: 2, sampleValues: [120, 140] },
  ],
  rows: [
    { 月份: "2026-01", 区域: "华东", 销售额: 120 },
    { 月份: "2026-01", 区域: "华南", 销售额: 100 },
    { 月份: "2026-02", 区域: "华东", 销售额: 140 },
    { 月份: "2026-02", 区域: "华南", 销售额: 110 },
  ],
};

test("Generation Cycle 通过确定性 adapter 产出 drafted 和完整审计", async () => {
  const [manifest] = loadBuiltinManifests();
  assert.ok(manifest);
  if (!manifest) throw new Error("builtin fixture missing");
  const result = await new GenerationCycle().run({
    ...cycleInput,
    theme: "economist",
    themeVersion: "project-v2",
    themeConfig: { ink: { series: { single: "#2563EB" } } },
    pluginThemeRef: {
      source: "plugin",
      pluginId: manifest.pluginId,
      version: manifest.version,
      capabilityId: "sales-brand",
      contentHash: manifest.contentHash,
    },
    pluginManifests: [manifest],
  });

  assert.equal(result.status, "drafted");
  if (result.status !== "drafted") return;
  assert.equal(result.artifacts.validation.valid, true);
  assert.equal(
    result.artifacts.flintSpec.themeConfig.ink && typeof result.artifacts.flintSpec.themeConfig.ink === "object",
    true,
  );
  assert.equal(result.artifacts.pluginUsage.selectedTemplate?.id, "monthly-regional-sales");
  assert.equal(result.artifacts.pluginUsage.selectedTheme?.source, "plugin");
  assert.ok(
    result.artifacts.pluginUsage.usedCapabilities.some(
      (capability) => capability.kind === "semantic-type" && capability.id === "Region",
    ),
  );
  assert.ok(
    result.artifacts.pluginUsage.usedCapabilities.some(
      (capability) => capability.kind === "validator" && capability.id === "time-required-for-trend",
    ),
  );
  assert.equal(result.audit.contextPolicy, "canonical_text_context");
  assert.equal(result.audit.modelRun.requestedProfile, "deterministic-offline");
  assert.equal(result.audit.modelRun.effectiveProfile, "deterministic-offline");
  assert.equal(result.audit.modelRun.historyPolicy.adapterVersion, "canonical-text-context-v1");
  assert.match(result.audit.modelRun.contextProjectionHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(result.audit.contextFallbacks, ["legacy-prompt-projection-v1"]);
  assert.deepEqual(
    result.audit.stages.map((stage) => stage.status),
    ["succeeded", "succeeded", "succeeded", "succeeded"],
  );
  assert.equal(result.audit.planValidation.status, "passed");
  assert.equal(result.audit.renderValidation.status, "pending");
});

test("Generation Cycle 将冻结的 Conversation 投影交给 Model Gateway，并在审计中保留版本和哈希", async () => {
  const projection = projectConversationToCanonicalTextContext([
    { role: "user", content: "先比较各区域销售额" },
    { role: "assistant", content: "已记录，等待你确认指标。" },
    { role: "user", content: "确认销售额，按月份展示趋势" },
  ]);
  let receivedContext: unknown;
  const gateway: ModelGateway = {
    async generateStructured<T>(request: RuntimeModelRequest<T>): Promise<ModelResult<T>> {
      receivedContext = request.context;
      return {
        status: "ok",
        data: request.output.parse({
          decision: "needs_clarification",
          intent: null,
          plan: null,
          chartSelection: null,
          proposal: {
            version: "v1",
            diagnostic: {
              version: "v1",
              code: "test",
              stage: "planning",
              severity: "blocking",
              source: "model_output",
              message: "请确认分析期间",
              field: null,
              evidence: [],
            },
            code: "test",
            target: "metric",
            stage: "planning",
            severity: "blocking",
            question: "请确认分析期间",
            reason: "需要用户确认后才能继续生成。",
            field: null,
            candidates: [],
            recommendedCandidate: null,
            requiresUserDecision: true,
          },
        }),
        invocationId: request.invocationId,
      };
    },
  };

  const result = await new GenerationCycle(gateway).run({ ...cycleInput, conversationProjection: projection });

  assert.equal(result.status, "needs_clarification");
  assert.deepEqual((receivedContext as { conversation?: unknown }).conversation, projection);
  assert.equal(result.audit.modelRun.historyPolicy.adapterVersion, projection.version);
  assert.equal(result.audit.modelRun.contextProjectionHash, projection.hash);
  assert.deepEqual(result.audit.contextFallbacks, []);
});

test("Generation Cycle 将 Gateway 的有界模型调用摘要保留在审计中", async () => {
  const gateway: ModelGateway = {
    async generateStructured<T>(request: RuntimeModelRequest<T>): Promise<ModelResult<T>> {
      return {
        status: "error",
        code: "MODEL_RATE_LIMITED",
        message: "供应商暂时限流",
        retryable: true,
        invocationId: request.invocationId,
        invocation: {
          version: "v1",
          invocationId: request.invocationId,
          routeSnapshotId: request.routeSnapshotId,
          provider: "bailian",
          modelId: "qwen-plus",
          adapterVersion: "bailian-qwen-native-http-v1",
          startedAt: "2026-09-06T00:00:00.000Z",
          completedAt: "2026-09-06T00:00:01.000Z",
          outcome: "failed",
          providerRequestId: "chatcmpl-001",
          providerModelId: "qwen-plus",
          finishReason: null,
          usage: { inputTokens: null, outputTokens: null, totalTokens: null },
          httpStatus: 429,
          errorCode: "MODEL_RATE_LIMITED",
        },
      };
    },
  };

  const result = await new GenerationCycle(gateway).run(cycleInput);

  assert.equal(result.status, "failed");
  assert.equal(result.audit.modelInvocation?.providerRequestId, "chatcmpl-001");
  assert.equal(result.audit.modelInvocation?.httpStatus, 429);
  assert.equal(result.audit.modelInvocation?.errorCode, "MODEL_RATE_LIMITED");
});

test("Generation Cycle 在 Compile 缺少横轴时返回可执行的 Clarification Proposal", async () => {
  const gateway: ModelGateway = {
    async generateStructured<T>(request: RuntimeModelRequest<T>): Promise<ModelResult<T>> {
      return {
        status: "ok",
        data: request.output.parse({
          decision: "ready",
          intent: {
            version: "v1",
            language: "zh-CN",
            originalPrompt: cycleInput.prompt,
            chartType: "line",
            timeColumn: "月份",
            timeGrain: "month",
            dimensionColumns: ["区域"],
            measureColumns: ["销售额"],
            comparison: "none",
            title: "销售额趋势",
            confidence: 0.72,
          },
          plan: {
            version: "v1",
            rationale: "测试一个没有保留月份字段的 TransformPlan",
            steps: [
              {
                kind: "aggregate",
                groupBy: ["区域"],
                measures: [{ column: "销售额", operation: "sum", outputColumn: "销售额_sum" }],
              },
            ],
            expectedColumns: ["区域", "销售额_sum"],
          },
          chartSelection: {
            chartType: "line",
            xField: "月份",
            yField: "销售额_sum",
            seriesField: null,
            tooltipFields: [],
          },
          proposal: null,
        }),
        invocationId: request.invocationId,
      };
    },
  };

  const result = await new GenerationCycle(gateway).run(cycleInput);

  assert.equal(result.status, "needs_clarification");
  if (result.status !== "needs_clarification") return;
  assert.equal(result.diagnostic.code, "MISSING_X_FIELD");
  assert.equal(result.proposal.target, "x_field");
  assert.equal(result.proposal.recommendedCandidate?.value, "月份");
  assert.equal(result.audit.readinessDiagnostic?.code, "MISSING_X_FIELD");
  assert.equal(result.audit.stages.find((stage) => stage.name === "compiling")?.status, "needs_clarification");
  assert.equal(result.audit.planValidation.status, "failed");
});

test("Generation Cycle 只在当前周期应用用户选择的候选横轴", async () => {
  const result = await new GenerationCycle().run({
    ...cycleInput,
    generationDecision: {
      action: "select_candidate",
      parentJobId: "00000000-0000-4000-8000-000000000099",
      questionCode: "MISSING_X_FIELD",
      target: "x_field",
      selectedValue: "区域",
    },
  });

  assert.equal(result.status, "drafted");
  if (result.status !== "drafted") return;
  assert.equal(result.artifacts.intent.timeColumn, undefined);
  assert.deepEqual(result.artifacts.intent.dimensionColumns, ["区域"]);
  assert.equal(result.artifacts.flintSpec.chartSpec.encodings.x.field, "区域");
  assert.deepEqual(result.audit.generationDecision, {
    action: "select_candidate",
    parentJobId: "00000000-0000-4000-8000-000000000099",
    questionCode: "MISSING_X_FIELD",
    target: "x_field",
    selectedValue: "区域",
  });
});

test("Generation Cycle 在无法识别指标时返回 needs_clarification 而不是抛出异常", async () => {
  const result = await new GenerationCycle().run({
    ...cycleInput,
    profiles: [
      { name: "区域", inferredType: "string", nullCount: 0, distinctCount: 2, sampleValues: ["华东", "华南"] },
    ],
    rows: [{ 区域: "华东" }, { 区域: "华南" }],
  });

  assert.equal(result.status, "needs_clarification");
  if (result.status !== "needs_clarification") return;
  assert.equal(result.proposal.code, "measure_missing");
  assert.equal(result.diagnostic.code, "measure_missing");
  assert.equal(result.audit.planValidation.status, "pending");
});

test("Generation Cycle 将跨 seam 的非法模型输出归一为 failed", async () => {
  const invalidGateway: ModelGateway = {
    async generateStructured<T>(): Promise<ModelResult<T>> {
      return { status: "ok", data: {} as T, invocationId: "invocation-1" };
    },
  };

  const result = await new GenerationCycle(invalidGateway).run(cycleInput);

  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(result.error.code, "MODEL_OUTPUT_INVALID");
  assert.equal(result.audit.stages[0]?.status, "failed");
  assert.equal(result.audit.planValidation.status, "failed");
});

test("Generation Cycle 将破损的 Model Gateway envelope 归一为 failed", async () => {
  const malformedGateway: ModelGateway = {
    async generateStructured<T>(): Promise<ModelResult<T>> {
      return null as unknown as ModelResult<T>;
    },
  };

  const result = await new GenerationCycle(malformedGateway).run(cycleInput);

  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(result.error.code, "MODEL_OUTPUT_INVALID");
});

test("Generation Cycle deterministically turns one frozen sales Snapshot into a validated draft with fixed TransformPlan lineage", async () => {
  const snapshot = readSalesSnapshot();
  const sourceRowsBeforeCycle = structuredClone(snapshot.rows);
  const brief = readFixture<Record<string, unknown>>("brief.json");
  const metricDefinition = readFixture<Record<string, unknown>>("metric-definition.json");
  const expected = readFixture<ExpectedTransformFixture>("expected-transform.json");
  const expectedLineage = readFixture<FieldLineage[]>("expected-lineage.json");

  const result = await new GenerationCycle().run({
    cycle: {
      workspaceId: "workspace-fixture",
      projectId: "project-fixture",
      generationJobId: "job-fixture",
      invocationId: "invocation-fixture",
      routeSnapshotId: "deterministic-route-fixture",
      budget: { deadlineAt: Date.now() + 30_000, maxOutputTokens: 1_024 },
    },
    analysisBriefSnapshot: brief,
    metricDefinitionSnapshot: metricDefinition,
    prompt: String(brief.businessQuestion),
    profiles: snapshot.profiles,
    rows: snapshot.rows,
  });

  assert.equal(result.status, "drafted");
  if (result.status !== "drafted") return;
  assert.deepEqual(snapshot.rows, sourceRowsBeforeCycle);
  assert.deepEqual(result.artifacts.transform.rows, expected.rows);
  assert.deepEqual(result.artifacts.transform.lineage, [
    {
      outputColumn: "月份",
      sourceColumns: ["月份"],
      directInputColumns: ["月份"],
      operation: "derive:month",
      stepIndex: 0,
    },
    expectedLineage[1],
    { ...expectedLineage[2], stepIndex: 1 },
    { ...expectedLineage[3], stepIndex: 2 },
  ]);
  assert.equal(result.artifacts.flintSpec.chartSpec.chartType, "Line Chart");
  assert.equal(result.artifacts.validation.valid, true);
  assert.equal(result.artifacts.repairCount, 0);
  assert.equal(result.audit.planValidation.status, "passed");
  assert.equal(result.audit.renderValidation.status, "pending");
});

test("Generation Cycle stops after two public repair attempts when a fixed validator remains unsatisfied", async () => {
  const [builtin] = loadBuiltinManifests();
  assert.ok(builtin);
  if (!builtin) return;
  const manifestInput = structuredClone(builtin.manifest);
  manifestInput.metadata.id = "repair-budget-guard";
  manifestInput.validators = [
    {
      id: "requires-unavailable-role",
      rules: [
        {
          kind: "required-role",
          role: "unavailable-role",
          severity: "error",
          message: "测试 Validator 要求不存在的角色",
        },
      ],
    },
  ];
  const blockingPlugin = parseManifest(manifestInput);
  const snapshot = readSalesSnapshot();
  const brief = readFixture<Record<string, unknown>>("brief.json");
  const metricDefinition = readFixture<Record<string, unknown>>("metric-definition.json");

  const result = await new GenerationCycle().run({
    cycle: {
      workspaceId: "workspace-fixture",
      projectId: "project-fixture",
      generationJobId: "job-repair-budget",
      invocationId: "invocation-repair-budget",
      routeSnapshotId: "deterministic-route-fixture",
      budget: { deadlineAt: Date.now() + 30_000, maxOutputTokens: 1_024 },
    },
    analysisBriefSnapshot: brief,
    metricDefinitionSnapshot: metricDefinition,
    prompt: String(brief.businessQuestion),
    profiles: snapshot.profiles,
    rows: snapshot.rows,
    pluginManifests: [blockingPlugin],
  });

  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(result.error.code, "MODEL_BUDGET_EXCEEDED");
  assert.equal(result.audit.repairCount, 2);
  assert.equal(result.audit.planValidation.status, "failed");
  assert.ok(result.audit.planValidation.errors.some((issue) => issue.code === "PLUGIN_REQUIRED_ROLE_MISSING"));
  assert.equal(result.audit.stages.find((stage) => stage.name === "validating")?.status, "failed");
});

test("Generation revision validation returns field-specific errors instead of a draftable result", () => {
  const validation = validateGenerationRevision({
    version: "v1",
    data: { values: [{ 月份: "2026-01" }] },
    semanticTypes: { 月份: "Month", 销售额_sum: "Quantity" },
    chartSpec: {
      chartType: "Line Chart",
      title: "缺少指标字段",
      encodings: {
        x: { field: "月份", type: "temporal" },
        y: { field: "销售额_sum", type: "quantitative" },
      },
      baseSize: { width: 920, height: 520 },
    },
    theme: "economist",
    themeVersion: "v1",
    themeConfig: {},
  });

  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.code === "DATA_FIELD_MISSING"));
  assert.ok(validation.issues.some((issue) => issue.code === "VISUAL_RULE_FAILED"));
});
