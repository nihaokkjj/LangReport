import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeVegaLiteSpec } from "../../features/evidence/vega-policy";

const safe = {
  data: { values: [{ month: "2026-01", sales: 12 }] },
  mark: { type: "line", tooltip: true },
  encoding: { x: { field: "month", type: "ordinal" }, y: { field: "sales", type: "quantitative" } },
};

test("browser Vega policy accepts inline chart data and rejects remote or executable grammar", () => {
  assert.doesNotThrow(() => assertSafeVegaLiteSpec(safe));
  assert.throws(() => assertSafeVegaLiteSpec({ ...safe, data: { url: "https://example.test/data.csv" } }),
    /CHART_EXTERNAL_DATA_FORBIDDEN/);
  assert.throws(() => assertSafeVegaLiteSpec({ ...safe, transform: [{ calculate: "datum.sales * 2", as: "value" }] }),
    /CHART_EXECUTABLE_OR_RESOURCE_FORBIDDEN/);
  assert.throws(() => assertSafeVegaLiteSpec({ ...safe, mark: { type: "image", url: "https://example.test/pixel" } }),
    /CHART_MARK_FORBIDDEN/);
  assert.throws(() => assertSafeVegaLiteSpec({ ...safe, data: { values: Array.from({ length: 10_001 }, () => ({ sales: 1 })) } }),
    /CHART_POINT_BUDGET_EXCEEDED/);
});
