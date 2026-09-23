import assert from "node:assert/strict";
import test from "node:test";
import { buildEditorTransformPlan, chartEditorReducer, editorStateFromRevision, initialChartEditorState } from "../../features/chart-editor/chart-editor-state";

test("chart editor reducer resets from a revision and updates one field immutably", () => {
  const reset = chartEditorReducer(initialChartEditorState, { type: "reset", value: { ...initialChartEditorState, title: "区域销售", chartType: "Bar Chart" } });
  assert.equal(reset.title, "区域销售");
  assert.equal(reset.chartType, "Bar Chart");
  const updated = chartEditorReducer(reset, { type: "set-field", field: "showValues", value: true });
  assert.equal(updated.showValues, true);
  assert.equal(updated.title, "区域销售");
  assert.equal(reset.showValues, false);
});

test("editor state projection keeps chart and transform decisions auditable", () => {
  const state = editorStateFromRevision({
    flintSpec: {
      chartSpec: {
        title: "区域销售",
        chartType: "Area Chart",
        encodings: { x: { field: "月份" }, y: { field: "销售额_sum" }, color: { field: "区域" } },
        annotations: [{ text: "重点区域" }],
        showValues: true,
        showLegend: true
      }
    },
    transformPlan: {
      version: "v1",
      steps: [
        { kind: "filter", column: "区域", operator: "contains", value: "华" },
        { kind: "aggregate", groupBy: ["月份", "区域"], measures: [{ column: "销售额", operation: "avg", outputColumn: "销售额_sum" }] },
        { kind: "sort", column: "月份", direction: "desc" }
      ]
    }
  });
  assert.deepEqual(state, { title: "区域销售", chartType: "Area Chart", xField: "月份", yField: "销售额_sum", seriesField: "区域", aggregateOperation: "avg", filterField: "区域", filterOperator: "contains", filterValue: "华", sortField: "月份", sortDirection: "desc", annotation: "重点区域", showValues: true, showLegend: true });
});

test("editor transform plan normalizes typed filters and preserves derive steps", () => {
  const plan = buildEditorTransformPlan({ version: "v1", steps: [{ kind: "derive", outputColumn: "同比" }], expectedColumns: ["月份"] }, [
    { name: "月份", inferredType: "string", nullCount: 0, distinctCount: 2, sampleValues: ["2026-01"] },
    { name: "销售额", inferredType: "number", nullCount: 0, distinctCount: 2, sampleValues: [100, 200] },
    { name: "区域", inferredType: "string", nullCount: 0, distinctCount: 2, sampleValues: ["华东"] }
  ], {
    ...initialChartEditorState,
    xField: "月份",
    yField: "销售额",
    aggregateOperation: "sum",
    filterField: "销售额",
    filterOperator: "gt",
    filterValue: "100",
    sortField: "缺失字段",
    sortDirection: "desc"
  });
  assert.equal(plan.steps?.[0]?.kind, "filter");
  assert.equal(plan.steps?.[0]?.value, 100);
  assert.equal(plan.steps?.[1]?.kind, "aggregate");
  assert.equal(plan.steps?.[2]?.kind, "derive");
  assert.deepEqual(plan.steps?.[3], { kind: "sort", column: "销售额_sum", direction: "desc" });
  assert.deepEqual(plan.expectedColumns, ["月份", "销售额_sum"]);
});
