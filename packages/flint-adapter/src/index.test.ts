import assert from "node:assert/strict";
import test from "node:test";
import { DESIGN_CHART_COLORS, DESIGN_FONT_FAMILIES, renderChart, toFlintAssemblyInput, validateRenderedChart } from "./index.js";
import { validateFlintTemplatePayload, validateFlintThemePayload } from "./validation.js";

const spec = {
  version: "v1" as const,
  data: { values: [{ 月份: "2026-01", 销售额: 10 }, { 月份: "2026-02", 销售额: 20 }] },
  semanticTypes: { 月份: "Month", 销售额: "Quantity" },
  chartSpec: { chartType: "Line Chart" as const, title: "销售趋势", encodings: { x: { field: "月份" }, y: { field: "销售额" } }, baseSize: { width: 500, height: 300 } },
  theme: "economist" as const,
  themeVersion: "v1",
  themeConfig: { ink: { series: { single: "#2563EB" } } }
};

test("plugin theme config reaches Flint and deterministic SVG output", async () => {
  const input = toFlintAssemblyInput(spec);
  assert.deepEqual(input.theme_spec, { extends: "economist", ink: { series: { single: "#2563EB" } } });
  const rendered = await renderChart(spec);
  assert.match(rendered.svg, /#2563EB/);
  assert.ok(rendered.svg.includes(`font-family="${DESIGN_FONT_FAMILIES.sans.replaceAll('"', "&quot;")}"`));
  assert.ok(rendered.svg.includes(`font-family="${DESIGN_FONT_FAMILIES.mono.replaceAll('"', "&quot;")}"`));
});

test("default deterministic chart uses the restrained design palette", async () => {
  const rendered = await renderChart({ ...spec, themeConfig: {} });
  assert.ok(rendered.svg.includes(DESIGN_CHART_COLORS[0]));
  assert.doesNotMatch(rendered.svg, /#ff3d8b|#1f1d3d|#c5b0f4/i);
});

test("render validation records concrete Vega-Lite, SVG, and PNG artifacts independently", async () => {
  const rendered = await renderChart(spec);
  const valid = validateRenderedChart(rendered);
  assert.equal(valid.status, "passed");
  assert.equal(valid.validatorVersion, "flint-render-v1");

  const invalid = validateRenderedChart({ vegaLiteSpec: {}, svg: "<svg>", png: Buffer.from("not-a-png") });
  assert.equal(invalid.status, "failed");
  assert.deepEqual(invalid.errors.map((error) => error.code), ["RENDER_VEGA_LITE_EMPTY", "RENDER_SVG_INVALID", "RENDER_PNG_INVALID"]);
});

test("default theme accepts adapter overrides without inventing a Flint preset", () => {
  const input = toFlintAssemblyInput({ ...spec, theme: "default", themeConfig: { ink: { series: { single: "#2563EB" } } } });
  assert.deepEqual(input.theme_spec, { ink: { series: { single: "#2563EB" } } });
});

test("adapter payload validation rejects unknown fields and accepts the builtin fragments", () => {
  assert.deepEqual(validateFlintTemplatePayload({ chartType: "Line Chart", encodings: { x: { fieldRole: "time" }, y: { fieldRole: "measure" } } }), []);
  assert.equal(validateFlintTemplatePayload({ chartType: "Line Chart", unsupported: true })[0]?.path, "unsupported");
  assert.deepEqual(validateFlintThemePayload({ extends: "economist", ink: { series: { single: "#2563EB" } } }), []);
  assert.equal(validateFlintThemePayload({ extends: "economist", unsupported: true })[0]?.path, "unsupported");
});
