import { assembleVegaLite } from "flint-chart";
import sharp from "sharp";
import type { FlintSpec } from "@langreport/contracts";

export const FLINT_VERSION = "0.5.1";
export const RENDERER_VERSION = "vega-lite-svg-v1";
export const DESIGN_FONT_FAMILIES = {
  sans: 'Inter, "SF Pro Display", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  mono: '"JetBrains Mono", "SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace'
} as const;

export type RenderedChart = {
  vegaLiteSpec: Record<string, unknown>;
  svg: string;
  png: Buffer;
};

/** Convert the platform-owned Flint Spec into Flint's native input shape. */
export function toFlintAssemblyInput(spec: FlintSpec): Record<string, unknown> {
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
    ...(spec.theme === "default" && Object.keys(spec.themeConfig).length === 0 ? {} : { theme_spec: { extends: spec.theme, ...spec.themeConfig } }),
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
  const colors = configuredSingle
    ? [configuredSingle, "#ff3d8b", "#1ea64a", "#1f1d3d"]
    : spec.theme === "swiss" ? ["#ff3d8b", "#1f1d3d", "#1ea64a", "#c5b0f4"] : ["#000000", "#ff3d8b", "#1ea64a", "#1f1d3d"];
  const xPosition = (value: string) => xValues.length <= 1 ? plotWidth / 2 : xValues.indexOf(value) * plotWidth / (xValues.length - 1);
  const yPosition = (value: number) => plotHeight - ((value - minValue) / range) * plotHeight;
  const parts: string[] = [];
  const sansFont = escapeXml(DESIGN_FONT_FAMILIES.sans);
  const monoFont = escapeXml(DESIGN_FONT_FAMILIES.mono);
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(spec.chartSpec.title)}">`);
  parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
  parts.push(`<text x="${left}" y="32" font-family="${sansFont}" font-size="22" font-weight="540" fill="#000000">${escapeXml(spec.chartSpec.title)}</text>`);
  if (spec.chartSpec.subtitle) parts.push(`<text x="${left}" y="54" font-family="${sansFont}" font-size="12" fill="#000000">${escapeXml(spec.chartSpec.subtitle)}</text>`);
  parts.push(`<line x1="${left}" y1="${top + plotHeight}" x2="${left + plotWidth}" y2="${top + plotHeight}" stroke="#000000" stroke-width="1"/>`);
  parts.push(`<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotHeight}" stroke="#000000" stroke-width="1"/>`);
  parts.push(`<text x="${left - 12}" y="${top + 4}" text-anchor="end" font-family="${monoFont}" font-size="11" fill="#000000">${formatNumber(maxValue)}</text>`);
  parts.push(`<text x="${left - 12}" y="${top + plotHeight}" text-anchor="end" font-family="${monoFont}" font-size="11" fill="#000000">${formatNumber(minValue)}</text>`);
  for (const [index, value] of xValues.entries()) {
    const x = left + (xValues.length <= 1 ? plotWidth / 2 : index * plotWidth / (xValues.length - 1));
    parts.push(`<text x="${x}" y="${top + plotHeight + 24}" text-anchor="middle" font-family="${monoFont}" font-size="10" fill="#000000">${escapeXml(value)}</text>`);
  }
  for (const [seriesIndex, seriesValue] of series.entries()) {
    const points = rows.filter((row) => !colorField || String(row[colorField] ?? "") === seriesValue);
    if (spec.chartSpec.chartType === "Bar Chart") {
      const barWidth = Math.max(8, plotWidth / Math.max(xValues.length * series.length, 1) * 0.72);
      for (const row of points) {
        const xIndex = xValues.indexOf(String(row[xField] ?? ""));
        const value = Number(row[yField]);
        if (!Number.isFinite(value)) continue;
        const x = left + xPosition(String(row[xField] ?? "")) - ((series.length - 1) * barWidth) / 2 + seriesIndex * barWidth;
        const y = top + yPosition(Math.max(value, minValue));
        const baseline = top + yPosition(Math.min(value, minValue));
        parts.push(`<rect x="${x - barWidth / 2}" y="${Math.min(y, baseline)}" width="${barWidth - 2}" height="${Math.max(1, Math.abs(baseline - y))}" fill="${colors[seriesIndex % colors.length]}" opacity="0.86"><title>${escapeXml(`${String(row[xField] ?? "")}: ${formatNumber(value)}`)}</title></rect>`);
        void xIndex;
      }
    } else {
      const path = points
        .filter((row) => Number.isFinite(Number(row[yField])))
        .sort((leftRow, rightRow) => xValues.indexOf(String(leftRow[xField] ?? "")) - xValues.indexOf(String(rightRow[xField] ?? "")))
        .map((row, index) => `${index === 0 ? "M" : "L"}${left + xPosition(String(row[xField] ?? ""))},${top + yPosition(Number(row[yField]))}`)
        .join(" ");
      if (path) parts.push(`<path d="${path}" fill="none" stroke="${colors[seriesIndex % colors.length]}" stroke-width="3"/>`);
      for (const row of points) {
        const value = Number(row[yField]);
        if (!Number.isFinite(value)) continue;
        const cx = left + xPosition(String(row[xField] ?? ""));
        const cy = top + yPosition(value);
        parts.push(`<circle cx="${cx}" cy="${cy}" r="4" fill="${colors[seriesIndex % colors.length]}"><title>${escapeXml(`${String(row[xField] ?? "")}: ${formatNumber(value)}`)}</title></circle>`);
      }
    }
    if (colorField && seriesValue) {
      const legendX = left + seriesIndex * 120;
      parts.push(`<circle cx="${legendX}" cy="${height - 18}" r="4" fill="${colors[seriesIndex % colors.length]}"/>`);
      parts.push(`<text x="${legendX + 10}" y="${height - 14}" font-family="${monoFont}" font-size="10" fill="#000000">${escapeXml(seriesValue)}</text>`);
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

function readNestedString(value: Record<string, unknown>, path: string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null || !(key in current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && /^#[0-9a-f]{6}$/i.test(current) ? current : undefined;
}
