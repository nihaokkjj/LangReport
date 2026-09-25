"use client";

import { useEffect, useRef } from "react";
import type { Cell } from "../../features/chart-editor/chart-editor-state";
import type {
  Snapshot,
  SnapshotPreviewStatus,
  SnapshotSummary,
} from "../../features/data-snapshot/use-snapshot-preview";

function formatDate(value?: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatValue(value: Cell): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
  return String(value);
}

function formatBytes(value?: number | null): string {
  if (value === null || value === undefined) return "不可用";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024)
    return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value / 1024)} KB`;
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value / (1024 * 1024))} MB`;
}

function snapshotSourceTypeLabel(value?: string | null): string {
  return value === "csv"
    ? "CSV"
    : value === "xlsx"
      ? "XLSX"
      : value === "json"
        ? "JSON"
        : value === "pasted"
          ? "粘贴表格"
          : "不可用";
}

function snapshotAssetStatusLabel(value?: string): string {
  return value === "processing"
    ? "处理中"
    : value === "failed"
      ? "处理失败"
      : value === "archived"
        ? "已归档"
        : value === "deleted"
          ? "已删除"
          : (value ?? "不可用");
}

function SnapshotPreviewTable({ snapshot }: { snapshot: Snapshot }) {
  const columns = snapshot.schema;
  const rows = snapshot.preview.slice(0, 25);
  if (columns.length === 0) return <div className="snapshot-preview-empty">当前 Snapshot 没有可展示的字段。</div>;
  return (
    <div className="snapshot-table-shell">
      <table className="snapshot-table">
        <caption>
          前 {rows.length} 行 / 共 {snapshot.rowCount.toLocaleString()} 行 · 只读预览
        </caption>
        <thead>
          <tr>
            {columns.map((column, columnIndex) => (
              <th
                className={columnIndex === 0 ? "snapshot-table-first" : undefined}
                key={column.name}
                scope="col"
                title={column.name}
              >
                {column.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${snapshot.id}-${rowIndex}`}>
              {columns.map((column, columnIndex) => {
                const text = formatValue(row[column.name]);
                const isLong = text.length > 32;
                return (
                  <td
                    className={columnIndex === 0 ? "snapshot-table-first" : undefined}
                    key={`${column.name}-${rowIndex}`}
                  >
                    <span
                      className={`snapshot-cell-value ${isLong ? "is-long" : ""}`}
                      title={isLong ? text : undefined}
                      aria-label={`${column.name}：${text}`}
                      tabIndex={isLong ? 0 : undefined}
                    >
                      {text}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type SnapshotPreviewModalProps = {
  assetName: string;
  assetStatus: string;
  summaries: SnapshotSummary[];
  selectedSnapshotId: string | null;
  snapshot: Snapshot | null;
  status: SnapshotPreviewStatus;
  error: string | null;
  onClose: () => void;
  onSelect: (snapshotId: string) => void;
  onRetry: () => void;
};

export function SnapshotPreviewModal({
  assetName: _assetName,
  assetStatus,
  summaries,
  selectedSnapshotId,
  snapshot,
  status,
  error,
  onClose,
  onSelect,
  onRetry,
}: SnapshotPreviewModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  const selectedSummary = summaries.find((summary) => summary.id === selectedSnapshotId) ?? null;
  return (
    <section
      className="right-drawer-view snapshot-preview-view"
      role="dialog"
      aria-modal="true"
      aria-labelledby="snapshot-preview-title"
      aria-describedby="snapshot-preview-description"
    >
      <div className="modal-head snapshot-preview-head">
        <div>
          <h2 id="snapshot-preview-title">查看数据</h2>
        </div>
        <button ref={closeButtonRef} type="button" className="icon-button" aria-label="关闭数据预览" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="snapshot-preview-layout">
        <aside className="snapshot-version-panel" aria-label="Snapshot 版本列表">
          <div className="snapshot-version-heading">
            <strong>版本</strong>
          </div>
          {status === "loading-list" ? (
            <div className="snapshot-version-state" role="status">
              读取中…
            </div>
          ) : summaries.length === 0 ? (
            <div className="snapshot-version-state">暂无可用 Snapshot</div>
          ) : (
            <div className="snapshot-version-list">
              {summaries.map((summary) => (
                <button
                  type="button"
                  className={`snapshot-version-item ${summary.id === selectedSnapshotId ? "selected" : ""}`}
                  aria-pressed={summary.id === selectedSnapshotId}
                  key={summary.id}
                  onClick={() => onSelect(summary.id)}
                >
                  <span>
                    <strong>v{summary.version}</strong>
                    <small>
                      {summary.rowCount.toLocaleString()} 行 · {summary.columnCount} 列
                    </small>
                  </span>
                  <time>{formatDate(summary.createdAt)}</time>
                </button>
              ))}
            </div>
          )}
        </aside>
        <div className="snapshot-preview-content">
          {status === "error" && (
            <div className="snapshot-preview-error" role="alert">
              <strong>预览暂时无法读取</strong>
              <span>{error ?? "请稍后重试。"}</span>
              <button type="button" className="secondary-button" onClick={onRetry}>
                重新加载
              </button>
            </div>
          )}
          {status === "loading-detail" && (
            <div className="snapshot-preview-state" role="status">
              <span className="state-mark pulse-mark" />
              <strong>正在读取 v{selectedSummary?.version ?? "—"}…</strong>
            </div>
          )}
          {status === "ready" && !snapshot && (
            <div className="snapshot-preview-state">
              <strong>
                {assetStatus === "ready" ? "暂无可用 Snapshot" : `当前状态：${snapshotAssetStatusLabel(assetStatus)}`}
              </strong>
              <span>处理完成后可重新打开查看数据。</span>
            </div>
          )}
          {status === "ready" && snapshot && (
            <>
              <div className="snapshot-detail-header">
                <div>
                  <div className="eyebrow">SNAPSHOT / V{snapshot.version}</div>
                  <h3>解析数据</h3>
                </div>
                <span className="snapshot-readonly-badge">只读</span>
              </div>
              <dl className="snapshot-metadata">
                <div>
                  <dt>来源文件</dt>
                  <dd title={snapshot.sourceName ?? undefined}>{snapshot.sourceName ?? "不可用"}</dd>
                </div>
                <div>
                  <dt>类型</dt>
                  <dd>{snapshotSourceTypeLabel(snapshot.sourceType)}</dd>
                </div>
                <div>
                  <dt>MIME</dt>
                  <dd>{snapshot.mimeType ?? "不可用"}</dd>
                </div>
                <div>
                  <dt>大小</dt>
                  <dd>{formatBytes(snapshot.sizeBytes)}</dd>
                </div>
                <div>
                  <dt>创建时间</dt>
                  <dd>{formatDate(snapshot.createdAt)}</dd>
                </div>
              </dl>
              <SnapshotPreviewTable snapshot={snapshot} />
            </>
          )}
        </div>
      </div>
    </section>
  );
}
