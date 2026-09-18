import assert from "node:assert/strict";
import test from "node:test";
import { evaluateGenerationReadiness } from "../../src/readiness-gate.js";

const profiles = [
  { name: "月份", inferredType: "date" as const, nullCount: 0, distinctCount: 2, sampleValues: ["2026-01", "2026-02"] },
  { name: "区域", inferredType: "string" as const, nullCount: 1, distinctCount: 2, sampleValues: ["华东", "华南"] },
  { name: "销售额", inferredType: "number" as const, nullCount: 0, distinctCount: 4, sampleValues: [100, 120] }
];

test("Readiness Gate 用确定性证据生成候选和推荐，但保留用户确认门", () => {
  const result = evaluateGenerationReadiness({
    stage: "compiling",
    profiles,
    intent: {
      version: "v1",
      language: "zh-CN",
      originalPrompt: "按月份展示各区域销售额趋势",
      chartType: "line",
      timeColumn: "月份",
      timeGrain: "month",
      dimensionColumns: ["区域"],
      measureColumns: ["销售额"],
      comparison: "none",
      title: "销售额趋势",
      confidence: 0.8
    },
    transform: { rows: [{ 区域: "华东", 销售额_sum: 100 }], columns: ["区域", "销售额_sum"], lineage: [], steps: [] },
    error: { code: "MISSING_X_FIELD", message: "缺少图表横轴字段" }
  });

  assert.equal(result.decision, "needs_clarification");
  if (result.decision !== "needs_clarification") return;
  assert.equal(result.diagnostic.code, "MISSING_X_FIELD");
  assert.equal(result.proposal.target, "x_field");
  assert.equal(result.proposal.stage, "compiling");
  assert.equal(result.proposal.severity, "blocking");
  assert.equal(result.proposal.recommendedCandidate?.value, "月份");
  assert.ok(result.proposal.candidates.some((candidate) => candidate.value === "区域"));
  assert.ok(result.diagnostic.evidence.some((item) => item.label === "当前 Transform 输出"));
  assert.equal(result.proposal.candidates.find((candidate) => candidate.value === "月份")?.source, "snapshot_requires_transform");
});

test("Readiness Gate 没有候选字段时继续要求澄清，不伪造字段", () => {
  const result = evaluateGenerationReadiness({
    stage: "compiling",
    profiles: [{ name: "销售额", inferredType: "number", nullCount: 0, distinctCount: 2, sampleValues: [100, 120] }],
    intent: {
      version: "v1",
      language: "zh-CN",
      originalPrompt: "展示销售额",
      chartType: "line",
      dimensionColumns: [],
      measureColumns: ["销售额"],
      comparison: "none",
      title: "销售额",
      confidence: 0.5
    },
    transform: { rows: [{ 销售额_sum: 100 }], columns: ["销售额_sum"], lineage: [], steps: [] },
    error: { code: "MISSING_X_FIELD", message: "缺少图表横轴字段" }
  });

  assert.equal(result.decision, "needs_clarification");
  if (result.decision !== "needs_clarification") return;
  assert.deepEqual(result.proposal.candidates, []);
  assert.equal(result.proposal.recommendedCandidate, null);
});

test("Readiness Gate 只有一个候选时也不会自动采用", () => {
  const result = evaluateGenerationReadiness({
    stage: "compiling",
    profiles: [
      { name: "月份", inferredType: "date", nullCount: 0, distinctCount: 2, sampleValues: ["2026-01", "2026-02"] },
      { name: "销售额", inferredType: "number", nullCount: 0, distinctCount: 2, sampleValues: [100, 120] }
    ],
    intent: {
      version: "v1",
      language: "zh-CN",
      originalPrompt: "展示销售额趋势",
      chartType: "line",
      timeColumn: "月份",
      timeGrain: "month",
      dimensionColumns: [],
      measureColumns: ["销售额"],
      comparison: "none",
      title: "销售额趋势",
      confidence: 0.7
    },
    transform: { rows: [{ 销售额_sum: 100 }], columns: ["销售额_sum"], lineage: [], steps: [] },
    error: { code: "MISSING_X_FIELD", message: "缺少图表横轴字段" }
  });

  assert.equal(result.decision, "needs_clarification");
  if (result.decision !== "needs_clarification") return;
  assert.equal(result.proposal.candidates.length, 1);
  assert.equal(result.proposal.recommendedCandidate?.value, "月份");
});

test("Readiness Gate 对未覆盖的系统错误返回 blocked", () => {
  const result = evaluateGenerationReadiness({ stage: "validating", profiles, error: { code: "PLUGIN_VALIDATION_FAILED", message: "主题校验失败" } });
  assert.equal(result.decision, "blocked");
  if (result.decision !== "blocked") return;
  assert.equal(result.code, "PLUGIN_VALIDATION_FAILED");
  assert.equal(result.message, "主题校验失败");
  assert.equal(result.diagnostic.source, "deterministic_gate");
});

test("Readiness Gate 只按诊断代码识别缺失横轴，不从错误文案猜测", () => {
  const result = evaluateGenerationReadiness({ stage: "compiling", profiles, error: { message: "缺少图表横轴字段" } });
  assert.equal(result.decision, "blocked");
});
