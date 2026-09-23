"use client";

import { useState, type MouseEvent } from "react";
import { apiDownload, formatApiError } from "../../lib/http-client";

export type RevisionExportFormat = "png" | "svg" | "html" | "vegaLite";
export type RevisionExportStatus = "draft" | "in_review" | "approved" | "changes_requested" | "archived";

const formatLabels: Record<RevisionExportFormat, string> = { png: "PNG", svg: "SVG", html: "HTML", vegaLite: "JSON" };
const formatExtensions: Record<RevisionExportFormat, string> = { png: "png", svg: "svg", html: "html", vegaLite: "json" };

export function revisionOutputPath(revisionId: string, format: RevisionExportFormat): string {
  return `/api/v1/chart-revisions/${revisionId}/outputs/${format}`;
}

export function revisionOutputFilename(revision: number, format: RevisionExportFormat): string {
  return `langreport-revision-r${revision}.${formatExtensions[format]}`;
}

function saveBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

export function RevisionExport({ revisionId, revision, status }: { revisionId?: string; revision?: number; status?: RevisionExportStatus }) {
  const [busy, setBusy] = useState<RevisionExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!revisionId || revision === undefined || status !== "approved") return null;
  const targetRevisionId = revisionId;
  const targetRevision = revision;

  async function download(format: RevisionExportFormat, event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(format);
    setError(null);
    try {
      const blob = await apiDownload(revisionOutputPath(targetRevisionId, format), {}, { fallback: `${formatLabels[format]} 导出失败` });
      saveBlob(blob, revisionOutputFilename(targetRevision, format));
    } catch (downloadError) {
      setError(formatApiError(downloadError, `${formatLabels[format]} 导出失败`));
    } finally {
      setBusy(null);
    }
  }

  return <>
    {(["png", "svg", "html", "vegaLite"] as RevisionExportFormat[]).map((format) => <a key={format} className="secondary-button" href={revisionOutputPath(targetRevisionId, format)} download={revisionOutputFilename(targetRevision, format)} aria-label={`导出 ${formatLabels[format]}`} aria-busy={busy === format} aria-disabled={Boolean(busy)} onClick={(event) => void download(format, event)}>{busy === format ? "导出中…" : `${formatLabels[format]} ↗`}</a>)}
    {error && <span className="export-error" role="alert">{error}</span>}
  </>;
}
