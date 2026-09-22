import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { TransformPlan } from "@langreport/contracts";
import {
  DataParseError,
  TransformExecutionError,
  detectSourceType,
  executeTransformPlan,
  parseData,
  summarizeTransformResult,
  type DataRow,
  type FieldLineage
} from "../../src/index.js";

const fixtureDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../tests/fixtures/consulting/monthly-regional-sales");

type ExpectedTransformFixture = {
  plan: TransformPlan;
  rows: DataRow[];
};

function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(fixtureDirectory, name), "utf8")) as T;
}

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

test("a CSV Data Snapshot remains immutable while its fixed TransformPlan reproduces rows and field lineage", () => {
  const table = parseData({
    sourceType: detectSourceType("monthly-regional-sales.csv", "text/csv"),
    bytes: readFileSync(resolve(fixtureDirectory, "sales.csv"))
  });
  const expected = readFixture<ExpectedTransformFixture>("expected-transform.json");
  const expectedLineage = readFixture<FieldLineage[]>("expected-lineage.json");
  const snapshotBeforeTransform = structuredClone(table.rows);
  table.rows.forEach((row) => Object.freeze(row));
  Object.freeze(table.rows);

  const result = executeTransformPlan(expected.plan, table.rows);

  assert.deepEqual(table.columns, ["月份", "区域", "销售额"]);
  assert.deepEqual(table.profiles.map(({ name, inferredType, nullCount, distinctCount }) => ({ name, inferredType, nullCount, distinctCount })), [
    { name: "月份", inferredType: "date", nullCount: 0, distinctCount: 6 },
    { name: "区域", inferredType: "string", nullCount: 0, distinctCount: 2 },
    { name: "销售额", inferredType: "number", nullCount: 0, distinctCount: 15 }
  ]);
  assert.deepEqual(table.rows, snapshotBeforeTransform);
  assert.deepEqual(result.rows, expected.rows);
  assert.deepEqual(result.lineage, expectedLineage);
  assert.deepEqual(result.steps.map(({ kind, inputRowCount, outputRowCount }) => ({ kind, inputRowCount, outputRowCount })), [
    { kind: "aggregate", inputRowCount: 24, outputRowCount: 12 },
    { kind: "derive", inputRowCount: 12, outputRowCount: 12 },
    { kind: "sort", inputRowCount: 12, outputRowCount: 12 }
  ]);
});

test("unsupported source types and missing TransformPlan fields fail with an actionable boundary error", () => {
  assert.throws(() => detectSourceType("monthly-regional-sales.parquet"), DataParseError);
  assert.throws(() => executeTransformPlan({
    version: "v1",
    rationale: "验证字段边界",
    steps: [{ kind: "filter", column: "不存在", operator: "eq", value: "x" }],
    expectedColumns: ["月份"]
  }, [{ 月份: "2026-01" }]), (error: unknown) => {
    assert.ok(error instanceof TransformExecutionError);
    assert.equal(error.stepIndex, 0);
    assert.match(error.message, /第 1 步缺少字段：不存在/);
    return true;
  });
});

test("result summary uses all transformed rows while preview remains bounded", () => {
  const rows = Array.from({ length: 600 }, (_, index) => ({
    月份: `2026-${String(index + 1).padStart(3, "0")}`,
    销售额: index + 1
  }));
  const transform = executeTransformPlan({
    version: "v1",
    rationale: "保留完整结果用于摘要",
    steps: [],
    expectedColumns: ["月份", "销售额"]
  }, rows);

  const summary = summarizeTransformResult({ sourceRowCount: rows.length, transform, previewLimit: 500 });

  assert.equal(summary.sourceRowCount, 600);
  assert.equal(summary.transformedRowCount, 600);
  assert.equal(summary.previewRowCount, 500);
  assert.deepEqual(summary.numericSummaries, [
    { field: "销售额", count: 600, sum: 180300, min: 1, max: 600 }
  ]);
  assert.deepEqual(summary.topGroups, [
    { field: "销售额", value: 600, dimensions: { 月份: "2026-600" } }
  ]);
});
