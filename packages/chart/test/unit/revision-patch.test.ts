import assert from "node:assert/strict";
import test from "node:test";
import type { ChartEditPatch, FlintSpec } from "@langreport/contracts";
import { applyRevisionPatch } from "../../src/index.js";

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
      y: { field: "销售额_sum", type: "quantitative" }
    },
    baseSize: { width: 920, height: 520 }
  },
  theme: "economist",
  themeVersion: "v1",
  themeConfig: {}
};

test("the Chart public patch returns isolated material for a new Revision", () => {
  const patch: ChartEditPatch = {
    title: "派生版本标题",
    subtitle: null,
    chartType: "Bar Chart",
    encodings: {
      x: { field: "区域", type: "nominal" },
      y: { field: "销售额_sum", type: "quantitative" }
    },
    annotations: [{ text: "关注华东", xField: "区域" }],
    showValues: true,
    showLegend: false,
    themeVersion: "project-v2"
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
