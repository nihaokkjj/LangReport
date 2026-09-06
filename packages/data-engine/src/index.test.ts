import assert from "node:assert/strict";
import test from "node:test";
import { executeTransformPlan } from "./index.js";

test("monthly YoY uses the prior calendar year across the year boundary", () => {
  const result = executeTransformPlan({
    version: "v1",
    rationale: "按月和区域汇总销售额并匹配上年同月",
    steps: [
      {
        kind: "aggregate",
        groupBy: ["月份", "区域"],
        measures: [{ column: "销售额", operation: "sum", outputColumn: "销售额_sum" }]
      },
      {
        kind: "derive",
        outputColumn: "销售额_yoy",
        expression: "percent_change",
        inputColumns: ["销售额_sum"],
        partitionBy: ["区域"],
        orderBy: "月份",
        periodColumn: "月份",
        periodOffset: 12
      },
      { kind: "sort", column: "月份", direction: "asc" }
    ],
    expectedColumns: ["月份", "区域", "销售额_sum", "销售额_yoy"]
  }, [
    { 月份: "2025-01", 区域: "华东", 销售额: 60 },
    { 月份: "2025-01", 区域: "华东", 销售额: 40 },
    { 月份: "2025-02", 区域: "华东", 销售额: 80 },
    { 月份: "2025-02", 区域: "华东", 销售额: 40 },
    { 月份: "2026-01", 区域: "华东", 销售额: 75 },
    { 月份: "2026-01", 区域: "华东", 销售额: 75 },
    { 月份: "2026-02", 区域: "华东", 销售额: 100 },
    { 月份: "2026-02", 区域: "华东", 销售额: 80 }
  ]);

  assert.deepEqual(result.rows, [
    { 月份: "2025-01", 区域: "华东", 销售额_sum: 100, 销售额_yoy: null },
    { 月份: "2025-02", 区域: "华东", 销售额_sum: 120, 销售额_yoy: null },
    { 月份: "2026-01", 区域: "华东", 销售额_sum: 150, 销售额_yoy: 0.5 },
    { 月份: "2026-02", 区域: "华东", 销售额_sum: 180, 销售额_yoy: 0.5 }
  ]);
});

test("a missing month is not synthesized as a zero row", () => {
  const result = executeTransformPlan({
    version: "v1",
    rationale: "按月份汇总销售额",
    steps: [{
      kind: "aggregate",
      groupBy: ["月份"],
      measures: [{ column: "销售额", operation: "sum", outputColumn: "销售额_sum" }]
    }],
    expectedColumns: ["月份", "销售额_sum"]
  }, [
    { 月份: "2026-01", 销售额: 100 },
    { 月份: "2026-03", 销售额: 120 }
  ]);

  assert.deepEqual(result.rows, [
    { 月份: "2026-01", 销售额_sum: 100 },
    { 月份: "2026-03", 销售额_sum: 120 }
  ]);
  assert.equal(result.rows.some((row) => row["月份"] === "2026-02"), false);
});
