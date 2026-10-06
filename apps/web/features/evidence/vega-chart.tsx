"use client";

import { useEffect, useRef, useState } from "react";
import { assertSafeVegaLiteSpec } from "./vega-policy";
import type { Cell } from "../chart-editor/chart-editor-state";

type ChartInput = {
  chartSpec: {
    chartType: "Line Chart" | "Bar Chart" | "Area Chart";
    title: string;
    encodings: Record<string, { field: string }>;
    showLegend?: boolean;
    showValues?: boolean;
    annotations?: Array<{ text: string }>;
  };
};

type Props = {
  vegaLiteSpec: Record<string, unknown> | null;
  spec: ChartInput;
  rows?: Array<Record<string, Cell>>;
  draft?: boolean;
};

function draftSpec(base: Record<string, unknown>, spec: ChartInput, rows: Array<Record<string, Cell>>) {
  const next = structuredClone(base);
  next.data = { values: rows };
  const annotations = spec.chartSpec.annotations?.map((entry) => entry.text).filter(Boolean) ?? [];
  next.title = annotations.length ? { text: spec.chartSpec.title, subtitle: annotations } : spec.chartSpec.title;
  const markType = spec.chartSpec.chartType === "Bar Chart" ? "bar" : spec.chartSpec.chartType === "Area Chart" ? "area" : "line";
  next.mark = {
    type: markType,
    tooltip: true,
    ...(markType === "line" || markType === "area" ? { invalid: "break-paths-filter-domains" } : {}),
  };
  delete next.layer;
  const encoding = (next.encoding ?? {}) as Record<string, unknown>;
  next.encoding = {
    ...encoding,
    x: {
      ...(encoding.x as Record<string, unknown> | undefined),
      field: spec.chartSpec.encodings.x?.field,
      type: "nominal",
    },
    y: {
      ...(encoding.y as Record<string, unknown> | undefined),
      field: spec.chartSpec.encodings.y?.field,
      type: "quantitative",
      scale: { zero: true },
      stack: null,
    },
    ...(spec.chartSpec.encodings.color
      ? {
          color: {
            ...(encoding.color as Record<string, unknown> | undefined),
            field: spec.chartSpec.encodings.color.field,
            legend:
              spec.chartSpec.showLegend === false ? null : (encoding.color as { legend?: unknown } | undefined)?.legend,
          },
        }
      : { color: undefined }),
    xOffset: markType === "bar" && spec.chartSpec.encodings.color
      ? { field: spec.chartSpec.encodings.color.field }
      : undefined,
  };
  if (spec.chartSpec.showValues && rows.length <= 40) {
    const chartMark = next.mark;
    delete next.mark;
    next.layer = [
      { mark: chartMark },
      { mark: { type: "text", dy: -8, color: "#201515", fontSize: 11 },
        encoding: { text: { field: spec.chartSpec.encodings.y?.field, type: "quantitative", format: ",.2f" } } },
    ];
  }
  return next;
}

export function VegaChart({ vegaLiteSpec, spec, rows, draft = false }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [readout, setReadout] = useState("选择数据点查看数值；键盘左右键可逐点查看");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderedPoints, setRenderedPoints] = useState<number | null>(null);
  const pointIndex = useRef(-1);
  const data = draft
    ? (rows ?? [])
    : ((vegaLiteSpec?.data as { values?: Array<Record<string, Cell>> } | undefined)?.values ?? []);
  const xField = spec.chartSpec.encodings.x?.field;
  const yField = spec.chartSpec.encodings.y?.field;
  const colorField = spec.chartSpec.encodings.color?.field;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !vegaLiteSpec) return;
    let disposed = false;
    let view: import("vega").View | undefined;
    const start = performance.now();
    setRenderedPoints(null);
    setRenderError(null);
    const run = async () => {
      const chart = draft ? draftSpec(vegaLiteSpec, spec, rows ?? []) : vegaLiteSpec;
      assertSafeVegaLiteSpec(chart);
      const [{ View, loader, parse }, { compile }] = await Promise.all([import("vega"), import("vega-lite")]);
      if (disposed) return;
      let rejectedResource = false;
      const deny = async () => {
        rejectedResource = true;
        throw new Error("CHART_EXTERNAL_RESOURCE_FORBIDDEN");
      };
      const guardedLoader = loader();
      guardedLoader.load = deny;
      guardedLoader.sanitize = deny;
      const count = (chart.data as { values: unknown[] }).values.length;
      view = new View(parse(compile(chart as unknown as import("vega-lite").TopLevelSpec).spec), {
        renderer: count > 1_000 ? "canvas" : "svg",
        container: host,
        loader: guardedLoader,
      });
      view.addEventListener("mouseover", (_event, item) => {
        const datum = item?.datum as Record<string, Cell> | undefined;
        if (datum && xField && yField && datum[xField] !== undefined) {
          setReadout(
            `${String(datum[xField])} · ${colorField ? `${String(datum[colorField])} · ` : ""}${String(datum[yField] ?? "—")}`,
          );
        }
      });
      await view.runAsync();
      if (rejectedResource) throw new Error("CHART_EXTERNAL_RESOURCE_FORBIDDEN");
      if (!disposed) {
        setRenderedPoints(count);
        host.dataset.renderMs = String(Math.round(performance.now() - start));
        host.dispatchEvent(
          new CustomEvent("langreport:chart-rendered", {
            bubbles: true,
            detail: { count, ms: performance.now() - start },
          }),
        );
      }
    };
    void run().catch((error: unknown) => {
      if (!disposed) setRenderError(error instanceof Error ? error.message : "图表渲染失败");
    });
    return () => {
      disposed = true;
      view?.finalize();
      host.replaceChildren();
    };
  }, [vegaLiteSpec, spec, rows, draft, xField, yField, colorField]);

  if (!vegaLiteSpec) return <div className="chart-empty">图表规范不可用</div>;
  const readRow = (direction: number) => {
    if (!data.length || !xField || !yField) return;
    pointIndex.current = (pointIndex.current + direction + data.length) % data.length;
    const row = data[pointIndex.current];
    setReadout(
      `${String(row[xField] ?? "—")} · ${colorField ? `${String(row[colorField] ?? "—")} · ` : ""}${String(row[yField] ?? "—")}`,
    );
  };
  return (
    <div
      className="chart-visual"
      aria-label={`${spec.chartSpec.title}图表预览`}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          readRow(1);
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          readRow(-1);
        }
        if (event.key === "End" && data.length) {
          event.preventDefault();
          pointIndex.current = data.length - 2;
          readRow(1);
        }
      }}
    >
      {renderError ? (
        <div className="chart-empty" role="alert">
          图表渲染失败：{renderError}
        </div>
      ) : null}
      <div ref={hostRef} className="vega-host" data-rendered-points={renderedPoints ?? ""} />
      <div className="chart-readout" aria-live="polite">
        {readout}
      </div>
    </div>
  );
}
