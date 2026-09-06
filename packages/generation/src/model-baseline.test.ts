import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateChartPlanDecision,
  regionalSalesYoyBaseline
} from "./model-baseline.js";

test("the regional sales baseline contains an independent expected monthly YoY result", () => {
  assert.equal(regionalSalesYoyBaseline.id, "regional-sales-yoy-v1");
  assert.equal(regionalSalesYoyBaseline.analysisBrief.status, "confirmed");
  assert.equal(regionalSalesYoyBaseline.metricDefinition.status, "confirmed");
  assert.equal(regionalSalesYoyBaseline.rows.length, 24);
  assert.equal(regionalSalesYoyBaseline.expectedRows.length, 12);
  assert.deepEqual(regionalSalesYoyBaseline.expectedRows, [
    { 月份: "2025-01", 区域: "华东", 销售额_sum: 100, 销售额_yoy: null },
    { 月份: "2025-01", 区域: "华南", 销售额_sum: 80, 销售额_yoy: null },
    { 月份: "2025-02", 区域: "华东", 销售额_sum: 120, 销售额_yoy: null },
    { 月份: "2025-02", 区域: "华南", 销售额_sum: 100, 销售额_yoy: null },
    { 月份: "2025-03", 区域: "华东", 销售额_sum: 150, 销售额_yoy: null },
    { 月份: "2025-03", 区域: "华南", 销售额_sum: 110, 销售额_yoy: null },
    { 月份: "2026-01", 区域: "华东", 销售额_sum: 125, 销售额_yoy: 0.25 },
    { 月份: "2026-01", 区域: "华南", 销售额_sum: 96, 销售额_yoy: 0.2 },
    { 月份: "2026-02", 区域: "华东", 销售额_sum: 144, 销售额_yoy: 0.2 },
    { 月份: "2026-02", 区域: "华南", 销售额_sum: 120, 销售额_yoy: 0.2 },
    { 月份: "2026-03", 区域: "华东", 销售额_sum: 180, 销售额_yoy: 0.2 },
    { 月份: "2026-03", 区域: "华南", 销售额_sum: 99, 销售额_yoy: -0.1 }
  ]);
});

test("a ready chart-plan decision is correct when its plan and fields reproduce the baseline", () => {
  const result = evaluateChartPlanDecision({
    decision: "ready",
    intent: regionalSalesYoyBaseline.intent,
    plan: regionalSalesYoyBaseline.plan,
    chartSelection: regionalSalesYoyBaseline.chartSelection,
    questions: []
  });

  assert.equal(result.status, "correct");
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.transform?.rows, regionalSalesYoyBaseline.expectedRows);
});

test("an executable decision with a missing chart field is invalid with a structured error", () => {
  const result = evaluateChartPlanDecision({
    decision: "ready",
    intent: regionalSalesYoyBaseline.intent,
    plan: regionalSalesYoyBaseline.plan,
    chartSelection: {
      ...regionalSalesYoyBaseline.chartSelection,
      yField: "不存在的字段"
    },
    questions: []
  });

  assert.equal(result.status, "invalid");
  const fieldError = result.errors.find((error) => error.code === "CHART_FIELD_NOT_FOUND");
  assert.equal(fieldError?.path, "chartSelection.yField");
  assert.equal(fieldError?.severity, "error");
});

test("a valid clarification decision is classified without executing a plan", () => {
  const result = evaluateChartPlanDecision({
    decision: "needs_clarification",
    intent: null,
    plan: null,
    chartSelection: null,
    questions: [{
      code: "time_range_missing",
      question: "请确认需要展示的月份范围",
      reason: "Analysis Brief 没有明确时间范围"
    }]
  });

  assert.equal(result.status, "needs_clarification");
  assert.deepEqual(result.errors, []);
  assert.equal(result.transform, undefined);
});

test("malformed model output is invalid before any data execution", () => {
  const result = evaluateChartPlanDecision({
    decision: "ready",
    intent: regionalSalesYoyBaseline.intent,
    plan: null,
    chartSelection: null,
    questions: []
  });

  assert.equal(result.status, "invalid");
  assert.equal(result.errors[0]?.code, "MODEL_OUTPUT_INVALID");
  assert.equal(result.errors[0]?.severity, "error");
});
