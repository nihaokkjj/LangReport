import { MAX_CHART_POINTS } from "./chart-points";

const forbiddenKeys = new Set([
  "url",
  "href",
  "expr",
  "signal",
  "calculate",
  "filter",
  "params",
  "selection",
  "datasets",
  "data",
  "test",
  "spec",
  "concat",
  "hconcat",
  "vconcat",
  "repeat",
  "transform",
]);

/** Only platform-assembled, inline, single-view chart specifications may reach Vega. */
export function assertSafeVegaLiteSpec(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("CHART_SPEC_INVALID");
  const spec = value as Record<string, unknown>;
  const data = spec.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("CHART_EXTERNAL_DATA_FORBIDDEN");
  const dataRecord = data as Record<string, unknown>;
  if (Object.keys(dataRecord).some((key) => key !== "values") || !Array.isArray(dataRecord.values)) {
    throw new Error("CHART_EXTERNAL_DATA_FORBIDDEN");
  }
  if (dataRecord.values.length > MAX_CHART_POINTS) throw new Error("CHART_POINT_BUDGET_EXCEEDED");
  const markType = (mark: unknown) =>
    typeof mark === "string" ? mark : (mark as { type?: unknown } | undefined)?.type;
  if (Array.isArray(spec.layer)) {
    if (
      spec.layer.length !== 2 ||
      spec.layer.some((layer) => !layer || typeof layer !== "object") ||
      !["bar", "line", "area"].includes(String(markType((spec.layer[0] as Record<string, unknown>).mark))) ||
      markType((spec.layer[1] as Record<string, unknown>).mark) !== "text"
    )
      throw new Error("CHART_MARK_FORBIDDEN");
  } else if (!["bar", "line", "area"].includes(String(markType(spec.mark)))) {
    throw new Error("CHART_MARK_FORBIDDEN");
  }
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (forbiddenKeys.has(key) || (key === "layer" && node !== grammar)) {
        throw new Error("CHART_EXECUTABLE_OR_RESOURCE_FORBIDDEN");
      }
      visit(child);
    }
  };
  const { data: _data, ...grammar } = spec;
  void _data;
  visit(grammar);
  for (const row of dataRecord.values) {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("CHART_NONSCALAR_DATA");
    if (Object.values(row).some((cell) => cell !== null && !["string", "number", "boolean"].includes(typeof cell))) {
      throw new Error("CHART_NONSCALAR_DATA");
    }
  }
  if (new TextEncoder().encode(JSON.stringify(spec)).byteLength > 32 * 1024 * 1024)
    throw new Error("CHART_SPEC_BUDGET_EXCEEDED");
}
