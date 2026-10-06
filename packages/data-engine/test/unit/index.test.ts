import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import * as XLSX from "xlsx";
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
  type FieldLineage,
} from "../../src/index.js";

const fixtureDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../tests/fixtures/consulting/monthly-regional-sales",
);

test("high-cardinality profiles keep exact counts and the first five typed samples", () => {
  const rows = Array.from({ length: 20_000 }, (_, index) => ({
    id: index % 1_000 === 0 ? null : `row-${index}`,
    mixed: index % 4 === 0 ? 1 : index % 4 === 1 ? "1" : index % 4 === 2 ? true : null,
  }));
  const table = parseData({ sourceType: "json", bytes: Buffer.from(JSON.stringify(rows)) });
  assert.deepEqual(table.profiles, [
    {
      name: "id",
      inferredType: "string",
      nullCount: 20,
      distinctCount: 19_980,
      sampleValues: ["row-1", "row-2", "row-3", "row-4", "row-5"],
    },
    {
      name: "mixed",
      inferredType: "string",
      nullCount: 5_000,
      distinctCount: 2,
      sampleValues: [1, "1", true],
    },
  ]);
});

test("explicit calendar units match days across leap years without substituting another day", () => {
  const plan: TransformPlan = {
    version: "v1",
    rationale: "逐日同比",
    steps: [
      {
        kind: "derive",
        expression: "percent_change",
        inputColumns: ["amount"],
        outputColumn: "change",
        periodColumn: "date",
        periodUnit: "year",
        periodOffset: 1,
      },
    ],
    expectedColumns: ["change"],
  };
  const rows = [
    { date: "2023-02-28", amount: 100 },
    { date: "2024-02-28", amount: 120 },
    { date: "2024-02-29", amount: 130 },
  ];
  assert.deepEqual(
    executeTransformPlan(plan, rows).rows.map((row) => row.change),
    [null, 0.2, null],
  );
  assert.throws(() => executeTransformPlan(plan, rows, "v1"), /执行版本/);
});

test("JSON whitespace-colliding keys and XLSX positional headers preserve typed cells", () => {
  const json = parseData({ sourceType: "json", bytes: Buffer.from('[{"amount":1," amount ":2,"id":"001"}]') });
  assert.deepEqual(Object.values(json.rows[0]), [1, 2, "001"]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["amount", "amount", " amount ", "id"],
      [1, 2, 3, "001"],
    ]),
    "Data",
  );
  const parsed = parseData({ sourceType: "xlsx", bytes: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) });
  assert.deepEqual(Object.values(parsed.rows[0]), [1, 2, 3, "001"]);
  assert.deepEqual(
    parsed.columnMapping?.map((column) => column.originalName),
    ["amount", "amount", " amount ", "id"],
  );
});

// CHG-2026-10-03-evidence-correctness-repair: TP16–TP20.
test("percent change respects orderBy while retaining the source row order", () => {
  const result = executeTransformPlan(
    {
      version: "v1",
      rationale: "按月份而非输入顺序计算环比",
      steps: [
        {
          kind: "derive",
          expression: "percent_change",
          inputColumns: ["amount"],
          outputColumn: "change",
          orderBy: "month",
          periodOffset: 1,
        },
      ],
      expectedColumns: ["month", "amount", "change"],
    },
    [
      { month: "2026-03", amount: 150 },
      { month: "2026-01", amount: 100 },
      { month: "2026-02", amount: 120 },
    ],
  );
  assert.deepEqual(
    result.rows.map((row) => row.change),
    [0.25, null, 0.2],
  );
});

test("ambiguous duplicate calendar periods require aggregation", () => {
  assert.throws(
    () =>
      executeTransformPlan(
        {
          version: "v1",
          rationale: "不能任取同月的一行作为基数",
          steps: [
            {
              kind: "derive",
              expression: "percent_change",
              inputColumns: ["amount"],
              outputColumn: "change",
              periodColumn: "month",
              periodOffset: 1,
            },
          ],
          expectedColumns: ["change"],
        },
        [
          { month: "2026-01", amount: 100 },
          { month: "2026-01", amount: 200 },
          { month: "2026-02", amount: 150 },
        ],
      ),
    TransformExecutionError,
  );
});

test("explicit legacy execution preserves the frozen v1 ordering semantics", () => {
  const plan: TransformPlan = {
    version: "v1",
    rationale: "重放旧任务",
    steps: [
      {
        kind: "derive",
        expression: "percent_change",
        inputColumns: ["amount"],
        outputColumn: "change",
        orderBy: "month",
        periodOffset: 1,
      },
    ],
    expectedColumns: ["change"],
  };
  const rows = [
    { month: "2026-03", amount: 150 },
    { month: "2026-01", amount: 100 },
    { month: "2026-02", amount: 120 },
  ];
  assert.deepEqual(
    executeTransformPlan(plan, rows, "v1").rows.map((row) => row.change),
    [null, -1 / 3, 0.2],
  );
  assert.deepEqual(
    executeTransformPlan(plan, rows, "v2").rows.map((row) => row.change),
    [0.25, null, 0.2],
  );
});

test("calendar comparison handles partitions, missing periods and negative or zero bases", () => {
  const plan: TransformPlan = {
    version: "v1",
    rationale: "按分组和真实时期计算",
    steps: [
      {
        kind: "derive",
        expression: "percent_change",
        inputColumns: ["amount"],
        outputColumn: "change",
        partitionBy: ["region"],
        periodColumn: "month",
        periodOffset: 1,
      },
    ],
    expectedColumns: ["change"],
  };
  const rows = [
    { region: "A", month: "2025-12", amount: -10 },
    { region: "A", month: "2026-01", amount: 20 },
    { region: "A", month: "2026-03", amount: 30 },
    { region: "B", month: "2025-12", amount: 0 },
    { region: "B", month: "2026-01", amount: 20 },
  ];
  assert.deepEqual(
    executeTransformPlan(plan, rows).rows.map((row) => row.change),
    [null, 3, null, null, null],
  );
  assert.throws(
    () => executeTransformPlan(plan, [{ region: "A", month: "2026-13", amount: 1 }]),
    TransformExecutionError,
  );
});

test("XLSX ISO dates and date-only inputs retain monthly offset semantics", () => {
  const plan: TransformPlan = {
    version: "v1",
    rationale: "日期单元格的月度同比",
    steps: [
      {
        kind: "derive",
        expression: "percent_change",
        inputColumns: ["amount"],
        outputColumn: "change",
        periodColumn: "date",
        periodOffset: 12,
      },
    ],
    expectedColumns: ["change"],
  };
  for (const suffix of ["-01", "-01T00:00:00.000Z"]) {
    assert.deepEqual(
      executeTransformPlan(plan, [
        { date: `2025-01${suffix}`, amount: 100 },
        { date: `2026-01${suffix}`, amount: 150 },
      ]).rows.map((row) => row.change),
      [null, 0.5],
    );
  }
});

test("parser metadata maps each duplicate header and records conservative inference", () => {
  const result = parseData({ sourceType: "csv", bytes: Buffer.from("id,id\n001,12\n002,bad\n") });
  assert.equal(result.parserVersion, "local-table-v2");
  assert.deepEqual(result.columnMapping, [
    { position: 0, originalName: "id", name: "id" },
    { position: 1, originalName: "id", name: "id (2)" },
  ]);
  assert.equal(result.warnings?.length, 2);
});

test("numeric aggregation never silently drops invalid mixed-column cells", () => {
  const parsed = parseData({ sourceType: "csv", bytes: Buffer.from("group,amount\nA,12\nA,bad\n") });
  const plan: TransformPlan = {
    version: "v1",
    rationale: "不忽略非法金额",
    steps: [
      {
        kind: "aggregate",
        groupBy: ["group"],
        measures: [{ column: "amount", operation: "sum", outputColumn: "total" }],
      },
    ],
    expectedColumns: ["total"],
  };
  assert.throws(() => executeTransformPlan(plan, parsed.rows), /无法安全计算/);
});

test("duplicate and normalized headers preserve every positional cell", () => {
  const parsed = parseData({
    sourceType: "csv",
    bytes: Buffer.from("amount,amount,amount (2), , Unnamed column\n10,20,30,40,50\n"),
  });
  assert.equal(parsed.columns.length, 5);
  assert.equal(new Set(parsed.columns).size, 5);
  assert.deepEqual(Object.values(parsed.rows[0]), [10, 20, 30, 40, 50]);
  assert.equal(parsed.rows[0]["amount (2)"], 30);
});

test("CSV rows wider than the header fail explicitly instead of losing cells", () => {
  assert.throws(() => parseData({ sourceType: "csv", bytes: Buffer.from("amount\n10,20\n") }), DataParseError);
});

test("pasted identifiers and unsafe integers stay text while plain amounts stay numeric", () => {
  const parsed = parseData({
    sourceType: "pasted",
    bytes: Buffer.from("id\tlarge\tamount\n001\t9007199254740993\t12.5\n-001\t9007199254740995\t-3\n"),
  });
  assert.deepEqual(parsed.rows, [
    { id: "001", large: "9007199254740993", amount: 12.5 },
    { id: "-001", large: "9007199254740995", amount: -3 },
  ]);
});

test("mixed CSV columns preserve numeric-looking text without per-cell coercion", () => {
  const parsed = parseData({ sourceType: "csv", bytes: Buffer.from("value\n12\nunknown\n") });
  assert.deepEqual(parsed.rows, [{ value: "12" }, { value: "unknown" }]);
});

type ExpectedTransformFixture = {
  plan: TransformPlan;
  rows: DataRow[];
};

function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(fixtureDirectory, name), "utf8")) as T;
}

test("monthly YoY uses the prior calendar year across the year boundary", () => {
  const result = executeTransformPlan(
    {
      version: "v1",
      rationale: "按月和区域汇总销售额并匹配上年同月",
      steps: [
        {
          kind: "aggregate",
          groupBy: ["月份", "区域"],
          measures: [{ column: "销售额", operation: "sum", outputColumn: "销售额_sum" }],
        },
        {
          kind: "derive",
          outputColumn: "销售额_yoy",
          expression: "percent_change",
          inputColumns: ["销售额_sum"],
          partitionBy: ["区域"],
          orderBy: "月份",
          periodColumn: "月份",
          periodOffset: 12,
        },
        { kind: "sort", column: "月份", direction: "asc" },
      ],
      expectedColumns: ["月份", "区域", "销售额_sum", "销售额_yoy"],
    },
    [
      { 月份: "2025-01", 区域: "华东", 销售额: 60 },
      { 月份: "2025-01", 区域: "华东", 销售额: 40 },
      { 月份: "2025-02", 区域: "华东", 销售额: 80 },
      { 月份: "2025-02", 区域: "华东", 销售额: 40 },
      { 月份: "2026-01", 区域: "华东", 销售额: 75 },
      { 月份: "2026-01", 区域: "华东", 销售额: 75 },
      { 月份: "2026-02", 区域: "华东", 销售额: 100 },
      { 月份: "2026-02", 区域: "华东", 销售额: 80 },
    ],
  );

  assert.deepEqual(result.rows, [
    { 月份: "2025-01", 区域: "华东", 销售额_sum: 100, 销售额_yoy: null },
    { 月份: "2025-02", 区域: "华东", 销售额_sum: 120, 销售额_yoy: null },
    { 月份: "2026-01", 区域: "华东", 销售额_sum: 150, 销售额_yoy: 0.5 },
    { 月份: "2026-02", 区域: "华东", 销售额_sum: 180, 销售额_yoy: 0.5 },
  ]);
});

test("a missing month is not synthesized as a zero row", () => {
  const result = executeTransformPlan(
    {
      version: "v1",
      rationale: "按月份汇总销售额",
      steps: [
        {
          kind: "aggregate",
          groupBy: ["月份"],
          measures: [{ column: "销售额", operation: "sum", outputColumn: "销售额_sum" }],
        },
      ],
      expectedColumns: ["月份", "销售额_sum"],
    },
    [
      { 月份: "2026-01", 销售额: 100 },
      { 月份: "2026-03", 销售额: 120 },
    ],
  );

  assert.deepEqual(result.rows, [
    { 月份: "2026-01", 销售额_sum: 100 },
    { 月份: "2026-03", 销售额_sum: 120 },
  ]);
  assert.equal(
    result.rows.some((row) => row["月份"] === "2026-02"),
    false,
  );
});

test("a CSV Data Snapshot remains immutable while its fixed TransformPlan reproduces rows and field lineage", () => {
  const table = parseData({
    sourceType: detectSourceType("monthly-regional-sales.csv", "text/csv"),
    bytes: readFileSync(resolve(fixtureDirectory, "sales.csv")),
  });
  const expected = readFixture<ExpectedTransformFixture>("expected-transform.json");
  const expectedLineage = readFixture<FieldLineage[]>("expected-lineage.json");
  const snapshotBeforeTransform = structuredClone(table.rows);
  table.rows.forEach((row) => Object.freeze(row));
  Object.freeze(table.rows);

  const result = executeTransformPlan(expected.plan, table.rows);

  assert.deepEqual(table.columns, ["月份", "区域", "销售额"]);
  assert.deepEqual(
    table.profiles.map(({ name, inferredType, nullCount, distinctCount }) => ({
      name,
      inferredType,
      nullCount,
      distinctCount,
    })),
    [
      { name: "月份", inferredType: "date", nullCount: 0, distinctCount: 6 },
      { name: "区域", inferredType: "string", nullCount: 0, distinctCount: 2 },
      { name: "销售额", inferredType: "number", nullCount: 0, distinctCount: 15 },
    ],
  );
  assert.deepEqual(table.rows, snapshotBeforeTransform);
  assert.deepEqual(result.rows, expected.rows);
  assert.deepEqual(result.lineage, expectedLineage);
  assert.deepEqual(
    result.steps.map(({ kind, inputRowCount, outputRowCount }) => ({ kind, inputRowCount, outputRowCount })),
    [
      { kind: "aggregate", inputRowCount: 24, outputRowCount: 12 },
      { kind: "derive", inputRowCount: 12, outputRowCount: 12 },
      { kind: "sort", inputRowCount: 12, outputRowCount: 12 },
    ],
  );
});

test("unsupported source types and missing TransformPlan fields fail with an actionable boundary error", () => {
  assert.throws(() => detectSourceType("monthly-regional-sales.parquet"), DataParseError);
  assert.throws(
    () =>
      executeTransformPlan(
        {
          version: "v1",
          rationale: "验证字段边界",
          steps: [{ kind: "filter", column: "不存在", operator: "eq", value: "x" }],
          expectedColumns: ["月份"],
        },
        [{ 月份: "2026-01" }],
      ),
    (error: unknown) => {
      assert.ok(error instanceof TransformExecutionError);
      assert.equal(error.stepIndex, 0);
      assert.match(error.message, /第 1 步缺少字段：不存在/);
      return true;
    },
  );
});

test("result summary uses all transformed rows while preview remains bounded", () => {
  const rows = Array.from({ length: 600 }, (_, index) => ({
    月份: `2026-${String(index + 1).padStart(3, "0")}`,
    销售额: index + 1,
  }));
  const transform = executeTransformPlan(
    {
      version: "v1",
      rationale: "保留完整结果用于摘要",
      steps: [],
      expectedColumns: ["月份", "销售额"],
    },
    rows,
  );

  const summary = summarizeTransformResult({ sourceRowCount: rows.length, transform, previewLimit: 500 });

  assert.equal(summary.sourceRowCount, 600);
  assert.equal(summary.transformedRowCount, 600);
  assert.equal(summary.previewRowCount, 500);
  assert.deepEqual(summary.numericSummaries, [{ field: "销售额", count: 600, sum: 180300, min: 1, max: 600 }]);
  assert.deepEqual(summary.topGroups, [{ field: "销售额", value: 600, dimensions: { 月份: "2026-600" } }]);
});
