import { assembleVegaLite } from "flint-chart";
import sharp from "sharp";
import type { FlintSpec, ValidationRecord } from "@langreport/contracts";

export const FLINT_VERSION = "0.5.1";
export const RENDERER_VERSION = "vega-lite-svg-v1";
export const DESIGN_FONT_FAMILIES = {
  sans: 'Inter, "SF Pro Display", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  mono: '"JetBrains Mono", "SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace'
} as const;
export const DESIGN_CHART_COLORS = ["#2457C5", "#5B6875", "#18794E"] as const;

export type RenderedChart = {
  vegaLiteSpec: Record<string, unknown>;
  svg: string;
  png: Buffer;
};

export type StaticSvgHtmlInput = {
  svg: string;
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
  validate(rendered: RenderedChart): ValidationRecord;
};

const vegaLiteRenderer: RendererAdapter = {
  id: "vega-lite",
  version: RENDERER_VERSION,
  render: renderChart,
  validate: validateRenderedChart
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
export function validateRenderedChart(rendered: RenderedChart): ValidationRecord {
  const errors: ValidationRecord["errors"] = [];
  if (Object.keys(rendered.vegaLiteSpec).length === 0) {
    errors.push({
      code: "RENDER_VEGA_LITE_EMPTY",
      path: "vegaLiteSpec",
      message: "渲染器没有产出 Vega-Lite 规范",
      severity: "error"
    });
  }
  if (!rendered.svg.trim()) {
    errors.push({
      code: "RENDER_SVG_EMPTY",
      path: "svg",
      message: "渲染器没有产出 SVG",
      severity: "error"
    });
  } else if (!rendered.svg.includes("<svg") || !rendered.svg.includes("</svg>")) {
    errors.push({
      code: "RENDER_SVG_INVALID",
      path: "svg",
      message: "SVG 输出缺少完整根元素",
      severity: "error"
    });
  }
  if (rendered.png.byteLength === 0) {
    errors.push({
      code: "RENDER_PNG_EMPTY",
      path: "png",
      message: "渲染器没有产出 PNG",
      severity: "error"
    });
  } else if (!hasPngSignature(rendered.png)) {
    errors.push({
      code: "RENDER_PNG_INVALID",
      path: "png",
      message: "PNG 输出不包含有效文件签名",
      severity: "error"
    });
  }
  return {
    status: errors.length === 0 ? "passed" : "failed",
    errors,
    validatorVersion: "flint-render-v1",
    checkedAt: new Date().toISOString()
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
      :root { color-scheme: light; font-family: Inter, "SF Pro Display", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #17212b; background: #f5f7fa; }
      body { margin: 0; padding: 32px; }
      main { max-width: 1080px; margin: 0 auto; background: #fff; border: 1px solid #d7dee6; border-radius: 12px; padding: 32px; box-sizing: border-box; }
      h1, h2, p { margin: 0; }
      h1 { font-size: 26px; line-height: 1.25; font-weight: 600; }
      h2 { font-size: 16px; line-height: 1.5; font-weight: 600; margin-bottom: 8px; }
      .eyebrow, .meta { font-family: "JetBrains Mono", Consolas, monospace; font-size: 11px; line-height: 1.4; letter-spacing: .2px; color: #5b6875; }
      .eyebrow { margin-bottom: 8px; }
      .chart { margin: 24px 0; overflow-x: auto; }
      .chart svg { display: block; max-width: 100%; height: auto; }
      .finding { border-top: 1px solid #e8edf2; padding-top: 20px; font-size: 16px; line-height: 1.6; }
      .metadata { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 24px; margin-top: 24px; padding-top: 16px; border-top: 1px solid #e8edf2; }
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
      errors.push({ code: "RENDER_HTML_INVALID", path: "html", message: "HTML 输出缺少完整文档结构", severity: "error" });
    }
    if (!/<svg[\s>]/i.test(value) || !/<\/svg>/i.test(value)) {
      errors.push({ code: "RENDER_HTML_SVG_MISSING", path: "html", message: "HTML 输出缺少 SVG 内容", severity: "error" });
    }
    if (containsExecutableMarkup(value) || /<script\b|javascript:|\son[a-z]+\s*=/i.test(value)) {
      errors.push({ code: "RENDER_HTML_UNSAFE", path: "html", message: "HTML 输出包含不允许的脚本或事件处理器", severity: "error" });
    }
    if (/<(?:link|img|iframe|object|embed)\b[^>]*(?:src|href)\s*=/i.test(value) || /\b(?:src|href|xlink:href)\s*=\s*["'](?:https?:|\/\/)/i.test(value) || /@import\b|url\(\s*["']?(?:https?:|\/\/)/i.test(value)) {
      errors.push({ code: "RENDER_HTML_EXTERNAL_RESOURCE", path: "html", message: "HTML 输出不能依赖外部资源", severity: "error" });
    }
  }
  return {
    status: errors.length === 0 ? "passed" : "failed",
    errors,
    validatorVersion: "langreport-static-svg-html-v1",
    checkedAt: new Date().toISOString()
  };
}

function hasPngSignature(value: Buffer): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return value.byteLength >= signature.length && signature.every((byte, index) => value[index] === byte);
}

/** Convert the platform-owned Flint Spec into Flint's native input shape. */
export function toFlintAssemblyInput(spec: FlintSpec): Record<string, unknown> {
  const themeConfig = { ...spec.themeConfig };
  const configuredParent = typeof themeConfig.extends === "string" ? themeConfig.extends : spec.theme;
  delete themeConfig.extends;
  const themeSpec = configuredParent === "default" && Object.keys(themeConfig).length === 0
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
      baseSize: spec.chartSpec.baseSize
    },
    ...(themeSpec ? { theme_spec: themeSpec } : {}),
    options: { addTooltips: true }
  };
}

export function compileVegaLite(spec: FlintSpec): Record<string, unknown> {
  return assembleVegaLite(toFlintAssemblyInput(spec) as never) as Record<string, unknown>;
}

/**
 * Render the stable MVP export. Flint intentionally emits a Vega-Lite spec;
 * this worker owns the final SVG/PNG bytes so exports do not depend on a
 * browser session. The SVG renderer is deterministic and uses the same data
 * and encodings as the compiled spec.
 */
export async function renderChart(spec: FlintSpec): Promise<RenderedChart> {
  const vegaLiteSpec = compileVegaLite(spec);
  const svg = renderDeterministicSvg(spec);
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return { vegaLiteSpec, svg, png };
}

function renderDeterministicSvg(spec: FlintSpec): string {
  const width = spec.chartSpec.baseSize.width;
  const height = spec.chartSpec.baseSize.height;
  const left = 78;
  const top = 78;
  const right = 26;
  const bottom = 66;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const xField = spec.chartSpec.encodings.x.field;
  const yField = spec.chartSpec.encodings.y.field;
  const colorField = spec.chartSpec.encodings.color?.field;
  const rows = spec.data.values;
  const xValues = [...new Set(rows.map((row) => String(row[xField] ?? "")))];
  const series = colorField ? [...new Set(rows.map((row) => String(row[colorField] ?? "")))] : [""];
  const numericValues = rows.map((row) => Number(row[yField])).filter(Number.isFinite);
  const maxValue = Math.max(...numericValues, 0);
  const minValue = Math.min(...numericValues, 0);
  const range = maxValue - minValue || 1;
  const configuredSingle = readNestedString(spec.themeConfig, ["ink", "series", "single"]);
  const colors = configuredSingle ? [configuredSingle, ...DESIGN_CHART_COLORS.slice(1)] : DESIGN_CHART_COLORS;
  const xPosition = (value: string) => xValues.length <= 1 ? plotWidth / 2 : xValues.indexOf(value) * plotWidth / (xValues.length - 1);
  const yPosition = (value: number) => plotHeight - ((value - minValue) / range) * plotHeight;
  const parts: string[] = [];
  const sansFont = escapeXml(DESIGN_FONT_FAMILIES.sans);
  const monoFont = escapeXml(DESIGN_FONT_FAMILIES.mono);
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-kerning="normal" role="img" aria-label="${escapeXml(spec.chartSpec.title)}">`);
  parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
  parts.push(`<text x="${left}" y="32" font-family="${sansFont}" font-size="22" font-weight="600" fill="#17212b">${escapeXml(spec.chartSpec.title)}</text>`);
  if (spec.chartSpec.subtitle) parts.push(`<text x="${left}" y="54" font-family="${sansFont}" font-size="12" fill="#17212b">${escapeXml(spec.chartSpec.subtitle)}</text>`);
  for (const [index, annotation] of (spec.chartSpec.annotations ?? []).entries()) {
    parts.push(`<text x="${left}" y="${76 + index * 16}" font-family="${sansFont}" font-size="12" fill="#5B6875">${escapeXml(annotation.text)}</text>`);
  }
  parts.push(`<line x1="${left}" y1="${top + plotHeight}" x2="${left + plotWidth}" y2="${top + plotHeight}" stroke="#17212b" stroke-width="1"/>`);
  parts.push(`<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotHeight}" stroke="#17212b" stroke-width="1"/>`);
  parts.push(`<text x="${left - 12}" y="${top + 4}" text-anchor="end" font-family="${monoFont}" font-size="11" fill="#17212b">${formatNumber(maxValue)}</text>`);
  parts.push(`<text x="${left - 12}" y="${top + plotHeight}" text-anchor="end" font-family="${monoFont}" font-size="11" fill="#17212b">${formatNumber(minValue)}</text>`);
  for (const [index, value] of xValues.entries()) {
    const x = left + (xValues.length <= 1 ? plotWidth / 2 : index * plotWidth / (xValues.length - 1));
    parts.push(`<text x="${x}" y="${top + plotHeight + 24}" text-anchor="middle" font-family="${monoFont}" font-size="11" fill="#17212b">${escapeXml(value)}</text>`);
  }
  for (const [seriesIndex, seriesValue] of series.entries()) {
    const points = rows.filter((row) => !colorField || String(row[colorField] ?? "") === seriesValue);
    if (spec.chartSpec.chartType === "Bar Chart") {
      const barWidth = Math.max(8, plotWidth / Math.max(xValues.length * series.length, 1) * 0.72);
      for (const [pointIndex, row] of points.entries()) {
        const xIndex = xValues.indexOf(String(row[xField] ?? ""));
        const value = Number(row[yField]);
        if (!Number.isFinite(value)) continue;
        const x = left + xPosition(String(row[xField] ?? "")) - ((series.length - 1) * barWidth) / 2 + seriesIndex * barWidth;
        const y = top + yPosition(Math.max(value, minValue));
        const baseline = top + yPosition(Math.min(value, minValue));
        parts.push(`<rect x="${x - barWidth / 2}" y="${Math.min(y, baseline)}" width="${barWidth - 2}" height="${Math.max(1, Math.abs(baseline - y))}" fill="${colors[seriesIndex % colors.length]}" opacity="0.86"><title>${escapeXml(`${String(row[xField] ?? "")}: ${formatNumber(value)}`)}</title></rect>`);
        if (spec.chartSpec.showValues && pointIndex < 40) {
          parts.push(`<text x="${x}" y="${Math.min(y, baseline) - 6}" text-anchor="middle" font-family="${monoFont}" font-size="10" fill="#17212b">${formatNumber(value)}</text>`);
        }
        void xIndex;
      }
    } else {
      const path = points
        .filter((row) => Number.isFinite(Number(row[yField])))
        .sort((leftRow, rightRow) => xValues.indexOf(String(leftRow[xField] ?? "")) - xValues.indexOf(String(rightRow[xField] ?? "")))
        .map((row, index) => `${index === 0 ? "M" : "L"}${left + xPosition(String(row[xField] ?? ""))},${top + yPosition(Number(row[yField]))}`)
        .join(" ");
      if (path) parts.push(`<path d="${path}" fill="none" stroke="${colors[seriesIndex % colors.length]}" stroke-width="3"/>`);
      for (const [pointIndex, row] of points.entries()) {
        const value = Number(row[yField]);
        if (!Number.isFinite(value)) continue;
        const cx = left + xPosition(String(row[xField] ?? ""));
        const cy = top + yPosition(value);
        parts.push(`<circle cx="${cx}" cy="${cy}" r="4" fill="${colors[seriesIndex % colors.length]}"><title>${escapeXml(`${String(row[xField] ?? "")}: ${formatNumber(value)}`)}</title></circle>`);
        if (spec.chartSpec.showValues && pointIndex < 40) {
          parts.push(`<text x="${cx}" y="${cy - 8}" text-anchor="middle" font-family="${monoFont}" font-size="10" fill="#17212b">${formatNumber(value)}</text>`);
        }
      }
    }
    if (colorField && seriesValue && spec.chartSpec.showLegend !== false) {
      const legendX = left + seriesIndex * 120;
      parts.push(`<circle cx="${legendX}" cy="${height - 18}" r="4" fill="${colors[seriesIndex % colors.length]}"/>`);
      parts.push(`<text x="${legendX + 10}" y="${height - 14}" font-family="${monoFont}" font-size="11" fill="#17212b">${escapeXml(seriesValue)}</text>`);
    }
  }
  parts.push("</svg>");
  return parts.join("");
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
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

function readNestedString(value: Record<string, unknown>, path: string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null || !(key in current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && /^#[0-9a-f]{6}$/i.test(current) ? current : undefined;
}
