import assert from "node:assert/strict";
import test from "node:test";
import {
  ChartPointBudgetError,
  compileVegaLite,
  createStaticSvgHtml,
  DESIGN_CHART_COLORS,
  DESIGN_FONT_FAMILIES,
  MAX_CHART_POINTS,
  renderChart,
  resolveRendererAdapter,
  toFlintAssemblyInput,
  validateRenderedChart,
  validateStaticSvgHtml,
} from "../../src/index.js";
import { validateFlintTemplatePayload, validateFlintThemePayload } from "../../src/validation.js";
import { assertSafeVegaLiteSpec } from "@langreport/contracts/vega";

const spec = {
  version: "v1" as const,
  data: {
    values: [
      { 月份: "2026-01", 销售额: 10 },
      { 月份: "2026-02", 销售额: 20 },
    ],
  },
  semanticTypes: { 月份: "Month", 销售额: "Quantity" },
  chartSpec: {
    chartType: "Line Chart" as const,
    title: "销售趋势",
    encodings: { x: { field: "月份" }, y: { field: "销售额" } },
    baseSize: { width: 500, height: 300 },
  },
  theme: "economist" as const,
  themeVersion: "v1",
  themeConfig: { ink: { series: { single: "#2563EB" } } },
};

// CHG-2026-10-03-evidence-correctness-repair: TP02/TP03.
test("compiled chart retains the complete 600-row input", () => {
  const rows = Array.from({ length: 600 }, (_, index) => ({ category: `C${index + 1}`, amount: index + 1 }));
  const compiled = compileVegaLite({
    ...spec,
    data: { values: rows },
    semanticTypes: { category: "Category", amount: "Quantity" },
    chartSpec: {
      ...spec.chartSpec,
      chartType: "Bar Chart",
      encodings: { x: { field: "category" }, y: { field: "amount" } },
    },
  });
  const values = (compiled.data as { values: Array<{ amount: number }> }).values;
  assert.equal(values.length, 600);
  assert.equal(Math.max(...values.map((row) => row.amount)), 600);
  assert.equal(compiled.width, 500);
  assert.equal(compiled.height, 300);
});

test("10,000 drawing results are allowed and Flint receives an explicit no-truncation budget", async () => {
  const rows = Array.from({ length: MAX_CHART_POINTS }, (_, index) => ({ 月份: `M${index}`, 销售额: index }));
  const boundedSpec = { ...spec, data: { values: rows } };
  const input = toFlintAssemblyInput(boundedSpec);
  assert.deepEqual(input.options, {
    addTooltips: true,
    maxStretch: MAX_CHART_POINTS * 20,
    maxColorValues: MAX_CHART_POINTS,
  });
  assert.equal((input.data as { values: unknown[] }).values.length, MAX_CHART_POINTS);
  const compiled = compileVegaLite(boundedSpec);
  const values = (compiled.data as { values: Array<{ 销售额: number }> }).values;
  assert.equal(values.length, MAX_CHART_POINTS);
  assert.equal(values.at(-1)?.销售额, MAX_CHART_POINTS - 1);
  assert.equal(compiled.width, 500);
  assert.equal(compiled.height, 300);
  const rendered = await renderChart(boundedSpec);
  assert.match(rendered.svg, /M9999/);
  const linePath = rendered.svg.match(/class="mark-line role-mark marks"[^>]*><path[^>]*d="([^"]+)/)?.[1];
  assert.equal((linePath?.match(/L/g) ?? []).length, MAX_CHART_POINTS - 1);
  assert.ok((rendered.svg.match(/<text[^>]*>M\d+<\/text>/g) ?? []).length <= 12);
});

test("10,000-point Bar and Area exports retain the complete result", async () => {
  const rows = Array.from({ length: MAX_CHART_POINTS }, (_, index) => ({ category: `C${index}`, amount: index + 1 }));
  const input = {
    ...spec,
    data: { values: rows },
    semanticTypes: { category: "Category", amount: "Quantity" },
    chartSpec: { ...spec.chartSpec, encodings: { x: { field: "category" }, y: { field: "amount" } } },
  };
  const bar = await renderChart({ ...input, chartSpec: { ...input.chartSpec, chartType: "Bar Chart" } });
  assert.equal((bar.vegaLiteSpec.data as { values: unknown[] }).values.length, MAX_CHART_POINTS);
  assert.equal((bar.svg.match(/aria-roledescription="bar"/g) ?? []).length, MAX_CHART_POINTS);
  const area = await renderChart({ ...input, chartSpec: { ...input.chartSpec, chartType: "Area Chart" } });
  assert.equal((area.vegaLiteSpec.data as { values: unknown[] }).values.length, MAX_CHART_POINTS);
  assert.match(area.svg, /C9999/);
  assert.match(area.svg, /aria-roledescription="area mark"/);
});

test("more than 10,000 drawing results fail with an explicit aggregation action", async () => {
  const tooMany = {
    ...spec,
    data: {
      values: Array.from({ length: MAX_CHART_POINTS + 1 }, (_, index) => ({ 月份: `M${index}`, 销售额: index })),
    },
  };
  assert.throws(
    () => compileVegaLite(tooMany),
    (error: unknown) =>
      error instanceof ChartPointBudgetError &&
      error.code === "CHART_POINT_BUDGET_EXCEEDED" &&
      error.pointCount === MAX_CHART_POINTS + 1 &&
      /聚合/.test(error.message),
  );
  await assert.rejects(() => renderChart(tooMany), ChartPointBudgetError);
});

test("Vega execution refuses external data and expression-bearing grammar", () => {
  const compiled = compileVegaLite(spec);
  assert.doesNotThrow(() => assertSafeVegaLiteSpec(compiled));
  assert.throws(
    () => assertSafeVegaLiteSpec({ ...compiled, data: { url: "https://example.test/data.csv" } }),
    /CHART_EXTERNAL_DATA_FORBIDDEN/,
  );
  assert.throws(
    () => assertSafeVegaLiteSpec({ ...compiled, transform: [{ calculate: "datum.x", as: "injected" }] }),
    /CHART_EXECUTABLE_OR_RESOURCE_FORBIDDEN/,
  );
  assert.throws(
    () => assertSafeVegaLiteSpec({ ...compiled, mark: { type: "image", url: "https://example.test/pixel" } }),
    /CHART_MARK_FORBIDDEN/,
  );
});

test("Area exports have a filled data mark", async () => {
  const rendered = await renderChart({ ...spec, chartSpec: { ...spec.chartSpec, chartType: "Area Chart" } });
  const filledPaths = [...rendered.svg.matchAll(/<path\b[^>]*\bfill="([^"]+)"[^>]*>/g)].filter(
    (match) => match[1] !== "none",
  );
  assert.ok(filledPaths.length > 0, "Area must contain filled paths, not only a line");
});

test("multi-series charts keep grouped bars, unstacked areas and gaps at null values", () => {
  const multi = {
    ...spec,
    data: {
      values: [
        { 月份: "2026-01", 区域: "华东", 销售额: 10 },
        { 月份: "2026-01", 区域: "华南", 销售额: 20 },
        { 月份: "2026-02", 区域: "华东", 销售额: null },
        { 月份: "2026-02", 区域: "华南", 销售额: 30 },
      ],
    },
    semanticTypes: { 月份: "Month", 区域: "Category", 销售额: "Quantity" },
    chartSpec: {
      ...spec.chartSpec,
      encodings: { x: { field: "月份" }, y: { field: "销售额" }, color: { field: "区域" } },
    },
  };
  const bars = compileVegaLite({ ...multi, chartSpec: { ...multi.chartSpec, chartType: "Bar Chart" } });
  assert.deepEqual((bars.encoding as { xOffset: unknown }).xOffset, { field: "区域" });
  assert.equal((bars.encoding as { y: { stack: unknown } }).y.stack, null);
  for (const chartType of ["Line Chart", "Area Chart"] as const) {
    const compiled = compileVegaLite({ ...multi, chartSpec: { ...multi.chartSpec, chartType } });
    assert.equal((compiled.mark as { invalid: string }).invalid, "break-paths-filter-domains");
    assert.equal((compiled.encoding as { y: { stack: unknown } }).y.stack, null);
    assert.equal((compiled.data as { values: unknown[] }).values.length, 4);
  }
});

test("negative and positive bars have proportional heights and stay inside the canvas", async () => {
  const rendered = await renderChart({
    ...spec,
    data: {
      values: [
        { 月份: "A", 销售额: -10 },
        { 月份: "B", 销售额: 20 },
      ],
    },
    chartSpec: { ...spec.chartSpec, chartType: "Bar Chart" },
  });
  const bars = [...rendered.svg.matchAll(/aria-roledescription="bar" d="M[^"]+?h([\d.]+)v(-?[\d.]+)/g)].map(
    (match) => ({ width: Number(match[1]), height: Math.abs(Number(match[2])) }),
  );
  assert.equal(bars.length, 2);
  assert.ok(Math.abs(bars[0].height / bars[1].height - 0.5) < 0.01);
  assert.ok(bars.every((bar) => bar.width > 0 && bar.width < 500 && bar.height > 0 && bar.height < 300));
});

test("plugin theme config reaches Flint and deterministic SVG output", async () => {
  const input = toFlintAssemblyInput(spec);
  assert.deepEqual(input.theme_spec, { extends: "economist", ink: { series: { single: "#2563EB" } } });
  const rendered = await renderChart(spec);
  assert.match(rendered.svg, /#2563EB/);
  assert.ok(rendered.svg.includes(`font-family="${DESIGN_FONT_FAMILIES.sans.replaceAll('"', "&quot;")}"`));
  assert.ok(rendered.svg.includes(`font-family="${DESIGN_FONT_FAMILIES.mono.replaceAll('"', "&quot;")}"`));
});

test("default deterministic chart uses the warm workbench palette", async () => {
  const rendered = await renderChart({ ...spec, themeConfig: {} });
  assert.deepEqual([...DESIGN_CHART_COLORS], ["#FF4F00", "#939084", "#18794E"]);
  assert.ok(rendered.svg.includes(DESIGN_CHART_COLORS[0]));
  assert.doesNotMatch(rendered.svg, /#ff3d8b|#1f1d3d|#c5b0f4/i);
});

test("display annotations and value labels remain present in deterministic SVG exports", async () => {
  const rendered = await renderChart({
    ...spec,
    chartSpec: {
      ...spec.chartSpec,
      annotations: [{ text: "重点月份" }],
      showValues: true,
      showLegend: false,
    },
  });
  assert.match(rendered.svg, /重点月份/);
  assert.match(rendered.svg, />10<|>20</);
  assert.doesNotMatch(rendered.svg, /华东/);
});

test("render validation records concrete Vega-Lite, SVG, and PNG artifacts independently", async () => {
  const rendered = await renderChart(spec);
  const valid = await validateRenderedChart(rendered);
  assert.equal(valid.status, "passed");
  assert.equal(valid.validatorVersion, "flint-render-v1");

  const invalid = await validateRenderedChart({ vegaLiteSpec: {}, svg: "<svg>", png: Buffer.from("not-a-png") });
  assert.equal(invalid.status, "failed");
  assert.deepEqual(
    invalid.errors.map((error) => error.code),
    ["RENDER_VEGA_LITE_EMPTY", "RENDER_SVG_INVALID", "RENDER_PNG_INVALID"],
  );
});

test("render validation rejects malformed SVG and PNG with a valid signature", async () => {
  const rendered = await renderChart(spec);
  const invalid = await validateRenderedChart({
    ...rendered,
    svg: "<svg><broken></svg>",
    png: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]),
  });
  assert.equal(invalid.status, "failed");
  assert.deepEqual(
    invalid.errors.map((error) => error.code),
    ["RENDER_SVG_INVALID", "RENDER_PNG_INVALID"],
  );
});

test("static HTML wraps trusted SVG and escapes evidence metadata without scripts", async () => {
  const rendered = await renderChart(spec);
  const html = createStaticSvgHtml({
    svg: rendered.svg,
    revisionId: "revision-001",
    revision: 3,
    title: "标题 <不执行>",
    finding: "发现 & 结论",
    snapshotId: "snapshot-001",
    metricDefinition: { name: "销售额", formula: "sum(销售额)" },
    theme: "economist",
    themeVersion: "v1",
  });

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /#fffefb/i);
  assert.match(html, /#f8f4f0/i);
  assert.match(html, /#201515/i);
  assert.match(html, /&lt;不执行&gt;/);
  assert.match(html, /发现 &amp; 结论/);
  assert.doesNotMatch(html, /<script\b|javascript:/i);
  assert.equal(validateStaticSvgHtml(html).status, "passed");
  assert.equal(validateStaticSvgHtml(html.replace("</svg>", "<script>alert(1)</script></svg>")).status, "failed");
  assert.equal(
    validateStaticSvgHtml(html.replace("</svg>", '<image href="https://example.com/pixel.png"></image></svg>')).status,
    "failed",
  );
});

test("render validation explains every missing artifact before a Chart Revision can be drafted", async () => {
  const invalid = await validateRenderedChart({ vegaLiteSpec: {}, svg: "", png: Buffer.alloc(0) });

  assert.equal(invalid.status, "failed");
  assert.deepEqual(
    invalid.errors.map((error) => error.code),
    ["RENDER_VEGA_LITE_EMPTY", "RENDER_SVG_EMPTY", "RENDER_PNG_EMPTY"],
  );
  assert.deepEqual(
    invalid.errors.map((error) => error.path),
    ["vegaLiteSpec", "svg", "png"],
  );
});

test("default theme accepts adapter overrides without inventing a Flint preset", () => {
  const input = toFlintAssemblyInput({
    ...spec,
    theme: "default",
    themeConfig: { ink: { series: { single: "#2563EB" } } },
  });
  assert.deepEqual(input.theme_spec, { ink: { series: { single: "#2563EB" } } });
});

test("adapter payload validation rejects unknown fields and accepts the builtin fragments", () => {
  assert.deepEqual(
    validateFlintTemplatePayload({
      chartType: "Line Chart",
      encodings: { x: { fieldRole: "time" }, y: { fieldRole: "measure" } },
    }),
    [],
  );
  assert.equal(validateFlintTemplatePayload({ chartType: "Line Chart", unsupported: true })[0]?.path, "unsupported");
  assert.deepEqual(validateFlintThemePayload({ extends: "economist", ink: { series: { single: "#2563EB" } } }), []);
  assert.equal(validateFlintThemePayload({ extends: "economist", unsupported: true })[0]?.path, "unsupported");
});

test("platform renderer registry resolves only the built-in Vega-Lite adapter", () => {
  const renderer = resolveRendererAdapter("vega-lite");
  assert.equal(renderer.version, "vega-lite-svg-v4");
  assert.equal(renderer.render, renderChart);
  assert.throws(() => resolveRendererAdapter("untrusted-renderer"), /平台未注册渲染器/);
});
