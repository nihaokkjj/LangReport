import assert from "node:assert/strict";
import test from "node:test";
import { loadBuiltinManifests } from "@langreport/plugin-sdk";
import type { ModelGateway, RuntimeModelRequest, ModelResult } from "@langreport/contracts";
import { GenerationCycle } from "./index.js";

const cycleInput = {
  cycle: {
    workspaceId: "workspace-1",
    projectId: "project-1",
    generationJobId: "job-1",
    invocationId: "invocation-1",
    routeSnapshotId: "route-1",
    budget: { deadlineAt: Date.now() + 30_000, maxOutputTokens: 2_000 }
  },
  analysisBriefSnapshot: {
    businessQuestion: "按月份展示各区域销售额趋势",
    audience: "客户汇报",
    timeRange: "2026-01 至 2026-02",
    timeGrain: "month",
    outputFormat: "evidence_block"
  },
  metricDefinitionSnapshot: {
    name: "销售额",
    meaning: "订单销售额合计",
    formula: "sum(销售额)",
    unit: "元",
    timeRule: "按月份统计",
    filterRule: null
  },
  prompt: "按月份展示各区域销售额趋势",
  profiles: [
    { name: "月份", inferredType: "date" as const, nullCount: 0, distinctCount: 2, sampleValues: ["2026-01", "2026-02"] },
    { name: "区域", inferredType: "string" as const, nullCount: 0, distinctCount: 2, sampleValues: ["华东", "华南"] },
    { name: "销售额", inferredType: "number" as const, nullCount: 0, distinctCount: 2, sampleValues: [120, 140] }
  ],
  rows: [
    { 月份: "2026-01", 区域: "华东", 销售额: 120 },
    { 月份: "2026-01", 区域: "华南", 销售额: 100 },
    { 月份: "2026-02", 区域: "华东", 销售额: 140 },
    { 月份: "2026-02", 区域: "华南", 销售额: 110 }
  ]
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
    pluginThemeRef: { source: "plugin", pluginId: manifest.pluginId, version: manifest.version, capabilityId: "sales-brand", contentHash: manifest.contentHash },
    pluginManifests: [manifest]
  });

  assert.equal(result.status, "drafted");
  if (result.status !== "drafted") return;
  assert.equal(result.artifacts.validation.valid, true);
  assert.equal(result.artifacts.flintSpec.themeConfig.ink && typeof result.artifacts.flintSpec.themeConfig.ink === "object", true);
  assert.equal(result.artifacts.pluginUsage.selectedTemplate?.id, "monthly-regional-sales");
  assert.equal(result.artifacts.pluginUsage.selectedTheme?.source, "plugin");
  assert.ok(result.artifacts.pluginUsage.usedCapabilities.some((capability) => capability.kind === "semantic-type" && capability.id === "Region"));
  assert.ok(result.artifacts.pluginUsage.usedCapabilities.some((capability) => capability.kind === "validator" && capability.id === "time-required-for-trend"));
  assert.equal(result.audit.contextPolicy, "canonical_text_context");
  assert.equal(result.audit.modelRun.requestedProfile, "deterministic-offline");
  assert.equal(result.audit.modelRun.effectiveProfile, "deterministic-offline");
  assert.deepEqual(result.audit.stages.map((stage) => stage.status), ["succeeded", "succeeded", "succeeded", "succeeded"]);
  assert.equal(result.audit.planValidation.status, "passed");
  assert.equal(result.audit.renderValidation.status, "pending");
});

test("Generation Cycle 在无法识别指标时返回 needs_clarification 而不是抛出异常", async () => {
  const result = await new GenerationCycle().run({
    ...cycleInput,
    profiles: [{ name: "区域", inferredType: "string", nullCount: 0, distinctCount: 2, sampleValues: ["华东", "华南"] }],
    rows: [{ 区域: "华东" }, { 区域: "华南" }]
  });

  assert.equal(result.status, "needs_clarification");
  if (result.status !== "needs_clarification") return;
  assert.ok(result.questions.some((question) => question.code === "measure_missing"));
  assert.equal(result.audit.planValidation.status, "pending");
});

test("Generation Cycle 将跨 seam 的非法模型输出归一为 failed", async () => {
  const invalidGateway: ModelGateway = {
    async generateStructured<T>(_request: RuntimeModelRequest<T>): Promise<ModelResult<T>> {
      return { status: "ok", data: {} as T, invocationId: "invocation-1" };
    }
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
    async generateStructured<T>(_request: RuntimeModelRequest<T>): Promise<ModelResult<T>> {
      return null as unknown as ModelResult<T>;
    }
  };

  const result = await new GenerationCycle(malformedGateway).run(cycleInput);

  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(result.error.code, "MODEL_OUTPUT_INVALID");
});
