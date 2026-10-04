import assert from "node:assert/strict";
import test from "node:test";
import type { ChartEditPatch, FlintSpec, ResultSummary } from "@langreport/contracts";
import {
  applyRevisionPatch,
  buildEvidenceFinding,
  freezeDerivedProvenance,
  freezeVisualRevisionInput,
} from "../../src/index.js";

test("derived jobs inherit isolated source provenance and only public project memory references", () => {
  const source = {
    analysisBriefSnapshot: { businessQuestion: "按月份统计销售额" },
    metricDefinitionSnapshot: { name: "销售额", formula: "sum(销售额)" },
    executionAssembly: null,
    memorySnapshot: [
      { id: "public", scope: "project", key: "revenue", version: 1, contentHash: "hash", statement: "不应复制正文" },
      { id: "private", scope: "user_preference", key: "tone", version: 1, contentHash: "secret", value: "私人偏好" },
      { id: "raw", scope: "project", value: "未经脱敏的旧记忆" },
    ],
  };
  const frozen = freezeDerivedProvenance(source);
  assert.deepEqual(frozen.memoryContext, [
    { id: "public", scope: "project", key: "revenue", version: 1, contentHash: "hash" },
  ]);
  assert.deepEqual(frozen.analysisBriefSnapshot, source.analysisBriefSnapshot);
  assert.deepEqual(frozen.metricDefinitionSnapshot, source.metricDefinitionSnapshot);
  source.analysisBriefSnapshot.businessQuestion = "项目后来改了口径";
  assert.equal(frozen.analysisBriefSnapshot.businessQuestion, "按月份统计销售额");
  assert.equal(frozen.executionAssembly, null);
});

test("derived jobs reject missing source Brief or metric instead of freezing empty objects", () => {
  const source = {
    analysisBriefSnapshot: { businessQuestion: "分析" },
    metricDefinitionSnapshot: { name: "销售", formula: "sum(x)" },
    memorySnapshot: [],
    executionAssembly: null,
  };
  for (const invalid of [
    { ...source, analysisBriefSnapshot: {} },
    { ...source, metricDefinitionSnapshot: null },
    { ...source, metricDefinitionSnapshot: { name: "销售" } },
  ]) {
    assert.throws(
      () => freezeDerivedProvenance(invalid),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "REVISION_PROVENANCE_INCOMPLETE",
    );
  }
});

const sourceSpec: FlintSpec = {
  version: "v1",
  data: { values: [{ 月份: "2026-01", 销售额_sum: 100 }] },
  semanticTypes: { 月份: "Month", 销售额_sum: "Quantity" },
  chartSpec: {
    chartType: "Line Chart",
    title: "原始标题",
    subtitle: "原始副标题",
    encodings: {
      x: { field: "月份", type: "temporal" },
      y: { field: "销售额_sum", type: "quantitative" },
    },
    baseSize: { width: 920, height: 520 },
  },
  theme: "economist",
  themeVersion: "v1",
  themeConfig: {},
};

test("the Chart public patch returns isolated material for a new Revision", () => {
  const patch: ChartEditPatch = {
    title: "派生版本标题",
    subtitle: null,
    chartType: "Bar Chart",
    encodings: {
      x: { field: "区域", type: "nominal" },
      y: { field: "销售额_sum", type: "quantitative" },
    },
    annotations: [{ text: "关注华东", xField: "区域" }],
    showValues: true,
    showLegend: false,
    themeVersion: "project-v2",
  };

  const derived = applyRevisionPatch(sourceSpec, patch);
  if (!patch.encodings) throw new Error("test patch must include encodings");
  patch.encodings.x.field = "被测试修改";

  assert.equal(derived.chartSpec.title, "派生版本标题");
  assert.equal(derived.chartSpec.subtitle, undefined);
  assert.equal(derived.chartSpec.chartType, "Bar Chart");
  assert.equal(derived.chartSpec.encodings.x.field, "区域");
  assert.deepEqual(derived.chartSpec.annotations, [{ text: "关注华东", xField: "区域" }]);
  assert.equal(derived.chartSpec.showValues, true);
  assert.equal(derived.chartSpec.showLegend, false);
  assert.equal(derived.themeVersion, "project-v2");
  assert.equal(sourceSpec.chartSpec.title, "原始标题");
  assert.equal(sourceSpec.chartSpec.subtitle, "原始副标题");
  assert.equal(sourceSpec.chartSpec.chartType, "Line Chart");
  assert.equal(sourceSpec.chartSpec.encodings.x.field, "月份");
});

test("Evidence finding reads the frozen complete result summary", () => {
  const summary: ResultSummary = {
    version: "v1",
    sourceRowCount: 600,
    transformedRowCount: 600,
    previewRowCount: 500,
    columns: ["月份", "销售额_sum"],
    numericSummaries: [{ field: "销售额_sum", count: 600, sum: 180300, min: 1, max: 600 }],
    topGroups: [{ field: "销售额_sum", value: 600, dimensions: { 月份: "2026-600" } }],
    qualityWarnings: [],
  };

  assert.equal(
    buildEvidenceFinding(sourceSpec, summary),
    "当前快照产生 600 个完整变换结果行，2026-600 的 销售额_sum 数值最高（600）。该候选发现不解释因果，也不替代人工审核。",
  );
});

test("visual revisions reuse the complete frozen result while logical patches require execution", () => {
  const rows = Array.from({ length: 600 }, (_, index) => ({ 月份: `分类${index}`, 销售额_sum: index }));
  const source = {
    flintSpec: { ...sourceSpec, data: { values: rows } },
    transformPlan: {
      version: "v1",
      rationale: "固定原计划",
      steps: [{ kind: "sort", column: "月份", direction: "asc" }],
      expectedColumns: ["月份", "销售额_sum"],
    },
    fieldLineage: [
      {
        outputColumn: "销售额_sum",
        sourceColumns: ["销售额"],
        directInputColumns: ["销售额"],
        operation: "aggregate:sum",
        stepIndex: 0,
      },
    ],
    resultSummary: {
      version: "v1",
      sourceRowCount: 100000,
      transformedRowCount: 600,
      previewRowCount: 500,
      columns: ["月份", "销售额_sum"],
      numericSummaries: [],
      topGroups: [],
      qualityWarnings: ["保留原警告"],
    },
  };
  const result = freezeVisualRevisionInput(source, { title: "新标题" });
  assert.ok(result);
  assert.equal(result.flintSpec.data.values.length, 600);
  assert.equal(result.flintSpec.chartSpec.title, "新标题");
  assert.deepEqual(result.resultSummary, source.resultSummary);
  assert.deepEqual(result.fieldLineage, source.fieldLineage);
  result.flintSpec.data.values[0].销售额_sum = -999;
  assert.equal(rows[0].销售额_sum, 0);
  assert.equal(freezeVisualRevisionInput(source, { encodings: sourceSpec.chartSpec.encodings }), null);
  assert.throws(
    () =>
      freezeVisualRevisionInput(
        { ...source, resultSummary: { ...source.resultSummary, transformedRowCount: 601 } },
        { title: "新标题" },
      ),
    /不一致/,
  );
});
