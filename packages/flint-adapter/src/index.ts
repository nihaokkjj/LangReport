import { assembleVegaLite } from "flint-chart";
import sharp from "sharp";
import { View, loader, parse } from "vega";
import { compile } from "vega-lite";
import type { TopLevelSpec } from "vega-lite";
import { assertSafeVegaLiteSpec } from "@langreport/contracts/vega";
import {
  chartPointBudgetMessage,
  MAX_CHART_POINTS,
  type FlintSpec,
  type ValidationRecord,
} from "@langreport/contracts";

export const FLINT_VERSION = "0.5.1";
export const RENDERER_VERSION = "vega-lite-svg-v4";
export { MAX_CHART_POINTS } from "@langreport/contracts";

export class ChartPointBudgetError extends Error {
  readonly code = "CHART_POINT_BUDGET_EXCEEDED";

  constructor(readonly pointCount: number) {
    super(chartPointBudgetMessage(pointCount));
    this.name = "ChartPointBudgetError";
  }
}
export const DESIGN_FONT_FAMILIES = {
  display:
    '"Degular Display", Inter, "SF Pro Display", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  sans: 'Inter, "SF Pro Display", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  mono: '"JetBrains Mono", "SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
} as const;
export const DESIGN_CHART_COLORS = ["#FF4F00", "#939084", "#18794E"] as const;

export type RenderedChart = {
  vegaLiteSpec: Record<string, unknown>;
  svg: string;
  png: Buffer;
};

export type StaticSvgHtmlInput = {
  svg: string;
  artifactId?: string;
  revisionId: string;
  revision: number;
  title: string;
  finding: string;
  snapshotId: string;
  metricDefinition?: unknown;
  theme: string;
  themeVersion: string;
  generatedAt?: string;
};

export type RendererAdapter = {
  id: string;
  version: string;
  render(spec: FlintSpec): Promise<RenderedChart>;
  validate(rendered: RenderedChart): Promise<ValidationRecord>;
};

const vegaLiteRenderer: RendererAdapter = {
  id: "vega-lite",
  version: RENDERER_VERSION,
  render: renderChart,
  validate: validateRenderedChart,
};

const platformRendererAdapters = [vegaLiteRenderer] as const;

export function resolveRendererAdapter(id: string): RendererAdapter {
  const renderer = platformRendererAdapters.find((candidate) => candidate.id === id);
  if (!renderer) throw new Error(`平台未注册渲染器：${id}`);
  return renderer;
}

/**
 * Validate the concrete render artifacts independently from Flint Spec plan
 * validation. This is deliberately limited to the files this adapter owns.
 */
export async function validateRenderedChart(rendered: RenderedChart): Promise<ValidationRecord> {
  const errors: ValidationRecord["errors"] = [];
  if (Object.keys(rendered.vegaLiteSpec).length === 0) {
    errors.push({
      code: "RENDER_VEGA_LITE_EMPTY",
      path: "vegaLiteSpec",
      message: "渲染器没有产出 Vega-Lite 规范",
      severity: "error",
    });
  }
  if (!rendered.svg.trim()) {
    errors.push({
      code: "RENDER_SVG_EMPTY",
      path: "svg",
      message: "渲染器没有产出 SVG",
      severity: "error",
    });
  } else if (
    !/<svg[\s>]/i.test(rendered.svg) ||
    !/<\/svg>/i.test(rendered.svg) ||
    containsExecutableMarkup(rendered.svg)
  ) {
    errors.push({
      code: "RENDER_SVG_INVALID",
      path: "svg",
      message: "SVG 输出缺少完整根元素",
      severity: "error",
    });
  } else {
    try {
      const metadata = await sharp(Buffer.from(rendered.svg)).metadata();
      if (metadata.format !== "svg" || !metadata.width || !metadata.height) throw new Error("invalid SVG");
    } catch {
      errors.push({ code: "RENDER_SVG_INVALID", path: "svg", message: "SVG 输出无法解析", severity: "error" });
    }
  }
  if (rendered.png.byteLength === 0) {
    errors.push({
      code: "RENDER_PNG_EMPTY",
      path: "png",
      message: "渲染器没有产出 PNG",
      severity: "error",
    });
  } else if (!hasPngSignature(rendered.png)) {
    errors.push({
      code: "RENDER_PNG_INVALID",
      path: "png",
      message: "PNG 输出不包含有效文件签名",
      severity: "error",
    });
  } else {
    try {
      const image = sharp(rendered.png, { failOn: "error" });
      const metadata = await image.metadata();
      if (metadata.format !== "png" || !metadata.width || !metadata.height) throw new Error("invalid PNG");
      await image.raw().toBuffer();
    } catch {
      errors.push({ code: "RENDER_PNG_INVALID", path: "png", message: "PNG 输出无法解码", severity: "error" });
    }
  }
  return {
    status: errors.length === 0 ? "passed" : "failed",
    errors,
    validatorVersion: "flint-render-v1",
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Build the first-version downloadable HTML artifact. It deliberately embeds
 * only server-rendered SVG and escaped revision metadata; it does not contain
 * a script, external stylesheet, or executable user content.
 */
export function createStaticSvgHtml(input: StaticSvgHtmlInput): string {
  const svg = input.svg.trim();
  if (!svg) throw new Error("静态 HTML 缺少 SVG 输出");
  if (containsExecutableMarkup(svg)) throw new Error("SVG 输出包含不允许的可执行标记");
  const metric = metricSummary(input.metricDefinition);
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="generator" content="LangReport static revision export">
    <title>${escapeHtml(input.title)} · LangReport</title>
    <style>
      :root { color-scheme: light; font-family: ${DESIGN_FONT_FAMILIES.sans}; color: #201515; background: #f8f4f0; }
      body { margin: 0; padding: 32px; }
      main { max-width: 1080px; margin: 0 auto; background: #fffefb; border: 1px solid #c5c0b1; border-radius: 12px; padding: 32px; box-sizing: border-box; }
      h1, h2, p { margin: 0; }
      h1, h2 { font-family: ${DESIGN_FONT_FAMILIES.display}; }
      h1 { font-size: 26px; line-height: 1.25; font-weight: 600; }
      h2 { font-size: 16px; line-height: 1.5; font-weight: 600; margin-bottom: 8px; }
      .eyebrow, .meta { font-family: "JetBrains Mono", Consolas, monospace; font-size: 11px; line-height: 1.4; letter-spacing: .2px; color: #939084; }
      .eyebrow { margin-bottom: 8px; }
      .chart { margin: 24px 0; overflow-x: auto; }
      .chart svg { display: block; max-width: 100%; height: auto; }
      .finding { border-top: 1px solid #ebe4dd; padding-top: 20px; font-size: 16px; line-height: 1.6; }
      .metadata { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 24px; margin-top: 24px; padding-top: 16px; border-top: 1px solid #ebe4dd; }
      .metadata span { display: block; }
      @media (max-width: 640px) { body { padding: 12px; } main { padding: 20px; } .metadata { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">LANGREPORT / FIXED REVISION / R${escapeHtml(String(input.revision))}</div>
      <h1>${escapeHtml(input.title)}</h1>
      <div class="chart" aria-label="${escapeHtml(input.title)}">${svg}</div>
      <section class="finding" aria-labelledby="finding-title">
        <h2 id="finding-title">发现</h2>
        <p>${escapeHtml(input.finding)}</p>
      </section>
      <div class="metadata" aria-label="证据来源">
        ${input.artifactId ? `<div><span class="meta">ARTIFACT</span><span>${escapeHtml(input.artifactId)}</span></div>` : ""}
        <div><span class="meta">REVISION</span><span>${escapeHtml(input.revisionId)}</span></div>
        <div><span class="meta">SNAPSHOT</span><span>${escapeHtml(input.snapshotId)}</span></div>
        <div><span class="meta">METRIC</span><span>${escapeHtml(metric)}</span></div>
        <div><span class="meta">THEME</span><span>${escapeHtml(`${input.theme} · ${input.themeVersion}`)}</span></div>
        <div><span class="meta">GENERATED</span><span>${escapeHtml(generatedAt)}</span></div>
      </div>
    </main>
  </body>
</html>`;
}

export function validateStaticSvgHtml(value: string): ValidationRecord {
  const errors: ValidationRecord["errors"] = [];
  if (!value.trim()) {
    errors.push({ code: "RENDER_HTML_EMPTY", path: "html", message: "静态 HTML 输出为空", severity: "error" });
  } else {
    if (!/^<!doctype html>/i.test(value.trim()) || !/<html[\s>]/i.test(value) || !/<\/html>/i.test(value)) {
      errors.push({
        code: "RENDER_HTML_INVALID",
        path: "html",
        message: "HTML 输出缺少完整文档结构",
        severity: "error",
      });
    }
    if (!/<svg[\s>]/i.test(value) || !/<\/svg>/i.test(value)) {
      errors.push({
        code: "RENDER_HTML_SVG_MISSING",
        path: "html",
        message: "HTML 输出缺少 SVG 内容",
        severity: "error",
      });
    }
    if (containsExecutableMarkup(value) || /<script\b|javascript:|\son[a-z]+\s*=/i.test(value)) {
      errors.push({
        code: "RENDER_HTML_UNSAFE",
        path: "html",
        message: "HTML 输出包含不允许的脚本或事件处理器",
        severity: "error",
      });
    }
    if (
      /<(?:link|img|iframe|object|embed)\b[^>]*(?:src|href)\s*=/i.test(value) ||
      /\b(?:src|href|xlink:href)\s*=\s*["'](?:https?:|\/\/)/i.test(value) ||
      /@import\b|url\(\s*["']?(?:https?:|\/\/)/i.test(value)
    ) {
      errors.push({
        code: "RENDER_HTML_EXTERNAL_RESOURCE",
        path: "html",
        message: "HTML 输出不能依赖外部资源",
        severity: "error",
      });
    }
  }
  return {
    status: errors.length === 0 ? "passed" : "failed",
    errors,
    validatorVersion: "langreport-static-svg-html-v1",
    checkedAt: new Date().toISOString(),
  };
}

function hasPngSignature(value: Buffer): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return value.byteLength >= signature.length && signature.every((byte, index) => value[index] === byte);
}

/** Convert the platform-owned Flint Spec into Flint's native input shape. */
export function toFlintAssemblyInput(spec: FlintSpec): Record<string, unknown> {
  const pointCount = spec.data.values.length;
  if (pointCount > MAX_CHART_POINTS) throw new ChartPointBudgetError(pointCount);
  const themeConfig = { ...spec.themeConfig };
  const configuredParent = typeof themeConfig.extends === "string" ? themeConfig.extends : spec.theme;
  delete themeConfig.extends;
  const themeSpec =
    configuredParent === "default" && Object.keys(themeConfig).length === 0
      ? undefined
      : configuredParent === "default"
        ? themeConfig
        : { extends: configuredParent, ...themeConfig };
  return {
    data: spec.data,
    semantic_types: spec.semanticTypes,
    chart_spec: {
      chartType: spec.chartSpec.chartType,
      title: spec.chartSpec.title,
      subtitle: spec.chartSpec.subtitle,
      encodings: spec.chartSpec.encodings,
      baseSize: spec.chartSpec.baseSize,
    },
    ...(themeSpec ? { theme_spec: themeSpec } : {}),
    options: {
      addTooltips: true,
      // Flint's default overflow budget silently drops rows before producing Vega-Lite.
      maxStretch: Math.max(2, pointCount * 20),
      maxColorValues: Math.max(1, pointCount),
    },
  };
}

export function compileVegaLite(spec: FlintSpec): Record<string, unknown> {
  const assembled = assembleVegaLite(toFlintAssemblyInput(spec) as never) as Record<string, unknown>;
  const values = (assembled.data as { values?: unknown } | undefined)?.values;
  if (!Array.isArray(values) || values.length !== spec.data.values.length) {
    throw new Error(
      `Flint 编译后绘图结果数量不一致：输入 ${spec.data.values.length}，输出 ${Array.isArray(values) ? values.length : "未知"}。已拒绝发布图表，避免静默截断。`,
    );
  }
  // Flint themes may emit expression-bearing helper layers. Keep Flint's chart
  // choice and data, then assemble the narrow, auditable runtime grammar here.
  const firstLayer = Array.isArray(assembled.layer) ? (assembled.layer[0] as Record<string, unknown>) : assembled;
  const sourceMark = firstLayer.mark as string | { type?: string; color?: string };
  const markType = typeof sourceMark === "string" ? sourceMark : sourceMark?.type;
  if (!["bar", "line", "area"].includes(String(markType))) throw new Error("Flint 未产出受支持的图表类型");
  const sourceEncoding = (firstLayer.encoding ?? {}) as Record<string, Record<string, unknown>>;
  const xField = spec.chartSpec.encodings.x.field;
  const yField = spec.chartSpec.encodings.y.field;
  const configuredColor = (spec.themeConfig as { ink?: { series?: { single?: unknown } } }).ink?.series?.single;
  const sourceColor =
    typeof configuredColor === "string" && /^#[0-9a-f]{6}$/i.test(configuredColor)
      ? configuredColor
      : DESIGN_CHART_COLORS[0];
  const chartColors = [sourceColor, ...DESIGN_CHART_COLORS.filter((color) => color !== sourceColor)];
  const encoding: Record<string, unknown> = {
    x: {
      field: xField,
      type: sourceEncoding.x?.type ?? "nominal",
      sort: null,
      axis: { labelFont: DESIGN_FONT_FAMILIES.mono, titleFont: DESIGN_FONT_FAMILIES.mono, labelFontSize: 11 },
    },
    y: {
      field: yField,
      type: "quantitative",
      scale: { zero: true },
      stack: null,
      axis: { labelFont: DESIGN_FONT_FAMILIES.mono, titleFont: DESIGN_FONT_FAMILIES.mono, labelFontSize: 11 },
    },
  };
  if (spec.chartSpec.encodings.color) {
    if (markType === "bar") encoding.xOffset = { field: spec.chartSpec.encodings.color.field };
    encoding.color = {
      field: spec.chartSpec.encodings.color.field,
      type: "nominal",
      scale: { range: chartColors },
      legend: spec.chartSpec.showLegend === false ? null : { labelFont: DESIGN_FONT_FAMILIES.mono, labelFontSize: 11 },
    };
  }
  const compiled: Record<string, unknown> = {
    data: { values },
    mark: {
      type: markType,
      tooltip: true,
      ...(markType === "line" || markType === "area" ? { invalid: "break-paths-filter-domains" } : {}),
      ...(spec.chartSpec.encodings.color ? {} : { color: sourceColor }),
    },
    encoding,
    width: spec.chartSpec.baseSize.width,
    height: spec.chartSpec.baseSize.height,
    autosize: { type: "fit", contains: "padding" },
    title: spec.chartSpec.title,
    background: "#fffefb",
    config: {
      axis: { labelFont: DESIGN_FONT_FAMILIES.mono, titleFont: DESIGN_FONT_FAMILIES.mono, labelFontSize: 11 },
      title: { font: DESIGN_FONT_FAMILIES.sans, fontSize: 18 },
    },
  };
  const annotations = spec.chartSpec.annotations?.map((annotation) => annotation.text).filter(Boolean) ?? [];
  if (annotations.length || spec.chartSpec.subtitle) {
    compiled.title = {
      text: spec.chartSpec.title,
      subtitle: [spec.chartSpec.subtitle, ...annotations].filter(Boolean),
    };
  }
  const x = encoding.x as Record<string, unknown>;
  if (x && values.length > 12) {
    const xField = spec.chartSpec.encodings.x.field;
    const labels = [...new Set(values.map((row) => (row as Record<string, unknown>)[xField]))];
    const stride = Math.ceil(labels.length / 10);
    x.axis = {
      ...(x.axis as Record<string, unknown> | undefined),
      values: labels.filter((_, index) => index % stride === 0),
    };
  }
  if (spec.chartSpec.showValues && values.length <= 40) {
    const chartMark = compiled.mark;
    delete compiled.mark;
    compiled.layer = [
      { mark: chartMark },
      {
        mark: { type: "text", dy: -8, color: "#201515", font: DESIGN_FONT_FAMILIES.mono, fontSize: 11 },
        encoding: { text: { field: spec.chartSpec.encodings.y.field, type: "quantitative", format: ",.2f" } },
      },
    ];
  }
  assertSafeVegaLiteSpec(compiled);
  return compiled;
}

/**
 * Render the stable MVP export. Flint intentionally emits a Vega-Lite spec;
 * this worker owns the final SVG/PNG bytes so exports do not depend on a
 * browser session. The SVG renderer is deterministic and uses the same data
 * and encodings as the compiled spec.
 */
export async function renderChart(spec: FlintSpec): Promise<RenderedChart> {
  const vegaLiteSpec = compileVegaLite(spec);
  let rejectedResource = false;
  const deny = async () => {
    rejectedResource = true;
    throw new Error("CHART_EXTERNAL_RESOURCE_FORBIDDEN");
  };
  const guardedLoader = loader();
  guardedLoader.load = deny;
  guardedLoader.sanitize = deny;
  const view = new View(parse(compile(vegaLiteSpec as unknown as TopLevelSpec).spec), {
    renderer: "none",
    loader: guardedLoader,
  });
  let svg: string;
  try {
    svg = await view.toSVG();
    if (rejectedResource) throw new Error("CHART_EXTERNAL_RESOURCE_FORBIDDEN");
    if (Buffer.byteLength(svg) > 32 * 1024 * 1024) throw new Error("CHART_OUTPUT_BUDGET_EXCEEDED");
  } finally {
    view.finalize();
  }
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return { vegaLiteSpec, svg, png };
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character,
  );
}

function containsExecutableMarkup(value: string): boolean {
  return /<script\b|javascript:|\son[a-z]+\s*=/i.test(value);
}

function metricSummary(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "未提供";
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : "未命名指标";
  const formula = typeof record.formula === "string" ? record.formula : "未提供公式";
  return `${name} · ${formula}`;
}
