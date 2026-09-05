import { assembleVegaLite, channels, resolveThemeSpec } from "flint-chart";

/** The adapter contract version used by plugin manifests. */
export const FLINT_ADAPTER_VERSION = "0.1.0";

export type FlintPayloadValidationIssue = {
  path: string;
  message: string;
};

const TEMPLATE_KEYS = new Set(["chartType", "title", "subtitle", "encodings", "baseSize", "canvasSize", "chartProperties"]);
const ENCODING_KEYS = new Set(["field", "fieldRole", "type", "aggregate", "sortOrder", "sortBy", "scheme"]);
const THEME_KEYS = new Set([
  "extends", "id", "label", "ink", "type", "structure", "marks", "labels", "legend", "dataLabels",
  "annotation", "furniture", "facets", "layout", "geometry", "chartDefaults", "compileDefaults", "interaction", "variants"
]);
const CHANNEL_KEYS = new Set<string>(channels);
const CHART_TYPES = new Set(["Line Chart", "Bar Chart", "Area Chart"]);
const ENCODING_TYPES = new Set(["quantitative", "nominal", "ordinal", "temporal"]);
const AGGREGATES = new Set(["count", "sum", "average", "mean"]);
const ROLE_NAMES = new Set(["time", "category", "measure"]);

/** Validate the declarative template fragment owned by the fixed adapter. */
export function validateFlintTemplatePayload(payload: unknown): FlintPayloadValidationIssue[] {
  const issues: FlintPayloadValidationIssue[] = [];
  const record = asRecord(payload, issues, "模板 payload 必须是对象");
  if (!record) return issues;

  rejectUnknownKeys(record, TEMPLATE_KEYS, "", issues, "模板 payload 不支持字段");
  const chartType = record.chartType;
  if (chartType !== undefined && (typeof chartType !== "string" || !CHART_TYPES.has(chartType))) {
    issues.push({ path: "chartType", message: "模板 chartType 不是当前固定 Flint Adapter 支持的图表类型" });
  }
  for (const key of ["title", "subtitle"]) {
    if (record[key] !== undefined && typeof record[key] !== "string") issues.push({ path: key, message: `${key} 必须是字符串` });
  }
  validateEncodings(record.encodings, issues);
  validateSize(record.baseSize, "baseSize", issues);
  validateSize(record.canvasSize, "canvasSize", issues);
  if (record.chartProperties !== undefined && !isRecord(record.chartProperties)) {
    issues.push({ path: "chartProperties", message: "chartProperties 必须是对象" });
  }

  if (typeof chartType === "string" && CHART_TYPES.has(chartType)) {
    try {
      assembleVegaLite(toAssemblyProbe(record, chartType) as never);
    } catch (error) {
      issues.push({ path: "", message: `模板 payload 无法被 Flint Adapter 编译：${errorMessage(error)}` });
    }
  }
  return issues;
}

/** Validate a resolved ThemeSpec fragment using the same Flint assembler. */
export function validateFlintThemePayload(payload: unknown): FlintPayloadValidationIssue[] {
  const issues: FlintPayloadValidationIssue[] = [];
  const record = asRecord(payload, issues, "Theme payload 必须是对象");
  if (!record) return issues;

  rejectUnknownKeys(record, THEME_KEYS, "", issues, "Theme payload 不支持字段");
  if (record.extends !== undefined && typeof record.extends !== "string") {
    issues.push({ path: "extends", message: "Theme extends 必须是 Flint 已注册的内置主题；default 应表示无继承" });
  }
  validateThemeValueTypes(record, issues);
  if (issues.length > 0) return issues;

  const themeSpec = { ...record };
  if (themeSpec.extends === "default") delete themeSpec.extends;
  try {
    resolveThemeSpec(themeSpec as never);
    assembleVegaLite({
      data: { values: [{ time: "2026-01", category: "A", measure: 1 }, { time: "2026-02", category: "B", measure: 2 }] },
      semantic_types: { time: "Month", category: "Category", measure: "Quantity" },
      chart_spec: {
        chartType: "Line Chart",
        title: "Theme validation",
        encodings: {
          x: { field: "time", type: "temporal" },
          y: { field: "measure", type: "quantitative" },
          color: { field: "category", type: "nominal" }
        }
      },
      theme_spec: themeSpec as never
    });
  } catch (error) {
    issues.push({ path: "", message: `Theme payload 无法被 Flint Adapter 编译：${errorMessage(error)}` });
  }
  return issues;
}

function validateEncodings(value: unknown, issues: FlintPayloadValidationIssue[]): void {
  if (value === undefined) return;
  const encodings = asRecord(value, issues, "encodings 必须是对象", "encodings");
  if (!encodings) return;
  for (const [channel, encoding] of Object.entries(encodings)) {
    if (!CHANNEL_KEYS.has(channel)) {
      issues.push({ path: `encodings.${channel}`, message: `Flint 不支持编码通道：${channel}` });
      continue;
    }
    if (Array.isArray(encoding)) {
      if (encoding.length === 0 || encoding.length > 16) issues.push({ path: `encodings.${channel}`, message: "编码数组长度必须在 1 到 16 之间" });
      encoding.forEach((entry, index) => validateEncoding(entry, `encodings.${channel}[${index}]`, issues));
    } else {
      validateEncoding(encoding, `encodings.${channel}`, issues);
    }
  }
}

function validateEncoding(value: unknown, path: string, issues: FlintPayloadValidationIssue[]): void {
  if (typeof value === "string") {
    if (!value.trim()) issues.push({ path, message: "编码字段不能为空" });
    return;
  }
  const encoding = asRecord(value, issues, "编码必须是字段名或对象", path);
  if (!encoding) return;
  rejectUnknownKeys(encoding, ENCODING_KEYS, path, issues, "编码对象不支持字段");
  if (encoding.field !== undefined && (typeof encoding.field !== "string" || !encoding.field.trim())) issues.push({ path: `${path}.field`, message: "field 必须是非空字符串" });
  if (encoding.fieldRole !== undefined && (typeof encoding.fieldRole !== "string" || !ROLE_NAMES.has(encoding.fieldRole))) issues.push({ path: `${path}.fieldRole`, message: "fieldRole 必须是 time、category 或 measure" });
  if (encoding.type !== undefined && (typeof encoding.type !== "string" || !ENCODING_TYPES.has(encoding.type))) issues.push({ path: `${path}.type`, message: "type 不是 Flint 支持的编码类型" });
  if (encoding.aggregate !== undefined && (typeof encoding.aggregate !== "string" || !AGGREGATES.has(encoding.aggregate))) issues.push({ path: `${path}.aggregate`, message: "aggregate 不是 Flint 支持的聚合方式" });
  if (encoding.sortOrder !== undefined && !["ascending", "descending"].includes(String(encoding.sortOrder))) issues.push({ path: `${path}.sortOrder`, message: "sortOrder 必须是 ascending 或 descending" });
  for (const key of ["sortBy", "scheme"]) {
    if (encoding[key] !== undefined && typeof encoding[key] !== "string") issues.push({ path: `${path}.${key}`, message: `${key} 必须是字符串` });
  }
  if (encoding.field === undefined && encoding.fieldRole === undefined) issues.push({ path, message: "编码必须提供 field 或 fieldRole" });
}

function validateSize(value: unknown, path: string, issues: FlintPayloadValidationIssue[]): void {
  if (value === undefined) return;
  const size = asRecord(value, issues, `${path} 必须是对象`, path);
  if (!size) return;
  rejectUnknownKeys(size, new Set(["width", "height"]), path, issues, `${path} 不支持字段`);
  for (const key of ["width", "height"]) {
    if (typeof size[key] !== "number" || !Number.isFinite(size[key]) || size[key] <= 0) issues.push({ path: `${path}.${key}`, message: `${key} 必须是正数` });
  }
}

function validateThemeValueTypes(theme: Record<string, unknown>, issues: FlintPayloadValidationIssue[]): void {
  if (theme.extends !== undefined && typeof theme.extends !== "string") issues.push({ path: "extends", message: "extends 必须是字符串" });
  for (const key of ["id", "label"]) {
    if (theme[key] !== undefined && typeof theme[key] !== "string") issues.push({ path: key, message: `${key} 必须是字符串` });
  }
  for (const key of ["ink", "type", "structure", "marks", "labels", "legend", "dataLabels", "annotation", "facets", "layout", "geometry", "chartDefaults", "compileDefaults", "interaction"]) {
    if (theme[key] !== undefined && !isRecord(theme[key])) issues.push({ path: key, message: `${key} 必须是对象` });
  }
  if (theme.furniture !== undefined && !Array.isArray(theme.furniture)) issues.push({ path: "furniture", message: "furniture 必须是数组" });
  if (theme.variants !== undefined && !Array.isArray(theme.variants)) issues.push({ path: "variants", message: "variants 必须是数组" });
  const singleColor = readNested(theme, ["ink", "series", "single"]);
  if (singleColor !== undefined && (typeof singleColor !== "string" || !/^#[0-9a-f]{6}$/i.test(singleColor))) {
    issues.push({ path: "ink.series.single", message: "Theme 颜色必须是六位十六进制颜色" });
  }
}

function toAssemblyProbe(payload: Record<string, unknown>, chartType: string): Record<string, unknown> {
  const source = isRecord(payload.encodings) ? payload.encodings : {};
  const encodings: Record<string, unknown> = {};
  for (const [channel, value] of Object.entries(source)) {
    const normalize = (entry: unknown) => {
      if (typeof entry === "string") return { field: entry };
      if (!isRecord(entry)) return entry;
      const field = typeof entry.field === "string" ? entry.field : roleField(entry.fieldRole);
      const { fieldRole: _fieldRole, ...rest } = entry;
      return { ...rest, field: field ?? "measure" };
    };
    encodings[channel] = Array.isArray(value) ? value.map(normalize) : normalize(value);
  }
  if (!encodings.x) encodings.x = { field: "time", type: "temporal" };
  if (!encodings.y) encodings.y = { field: "measure", type: "quantitative" };
  return {
    data: { values: [{ time: "2026-01", category: "A", measure: 1 }, { time: "2026-02", category: "B", measure: 2 }] },
    semantic_types: { time: "Month", category: "Category", measure: "Quantity" },
    chart_spec: {
      chartType,
      title: typeof payload.title === "string" ? payload.title : "Template validation",
      subtitle: typeof payload.subtitle === "string" ? payload.subtitle : undefined,
      encodings,
      baseSize: isRecord(payload.baseSize) ? payload.baseSize : undefined,
      canvasSize: isRecord(payload.canvasSize) ? payload.canvasSize : undefined,
      chartProperties: isRecord(payload.chartProperties) ? payload.chartProperties : undefined
    },
    options: { addTooltips: true }
  };
}

function roleField(role: unknown): string | undefined {
  return role === "time" ? "time" : role === "category" ? "category" : role === "measure" ? "measure" : undefined;
}

function asRecord(value: unknown, issues: FlintPayloadValidationIssue[], message: string, path = ""): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  issues.push({ path, message });
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: Set<string>, path: string, issues: FlintPayloadValidationIssue[], prefix: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) issues.push({ path: path ? `${path}.${key}` : key, message: `${prefix}：${key}` });
  }
}

function readNested(record: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = record;
  for (const key of path) {
    if (!isRecord(current) || !(key in current)) return undefined;
    current = current[key];
  }
  return current;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
