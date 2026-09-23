"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, devHeaders, formatApiError } from "../../lib/http-client";
import type { Cell, ColumnProfile } from "../chart-editor/chart-editor-state";

export type SnapshotSummary = {
  id: string;
  assetId: string;
  version: number;
  rowCount: number;
  columnCount: number;
  sourceName: string | null;
  sourceType: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
};

export type Snapshot = SnapshotSummary & {
  schema: ColumnProfile[];
  preview: Array<Record<string, Cell>>;
};

export type SnapshotPreviewStatus = "idle" | "loading-list" | "loading-detail" | "ready" | "error";

export type SnapshotPreviewState = {
  isOpen: boolean;
  assetId: string | null;
  summaries: SnapshotSummary[];
  selectedSnapshotId: string | null;
  snapshot: Snapshot | null;
  status: SnapshotPreviewStatus;
  error: string | null;
};

export type SnapshotPreviewController = SnapshotPreviewState & {
  open: (assetId: string) => Promise<void>;
  close: () => void;
  select: (snapshotId: string) => void;
  retry: () => void;
};

export const initialSnapshotPreviewState: SnapshotPreviewState = {
  isOpen: false,
  assetId: null,
  summaries: [],
  selectedSnapshotId: null,
  snapshot: null,
  status: "idle",
  error: null
};

type FetchOptions = { signal?: AbortSignal };

export function sortSnapshotSummaries(summaries: SnapshotSummary[]): SnapshotSummary[] {
  return [...summaries].sort((left, right) => right.version - left.version);
}

export async function fetchSnapshotSummaries(assetId: string, options: FetchOptions = {}): Promise<SnapshotSummary[]> {
  const payload = await apiFetch<{ snapshots: SnapshotSummary[] }>(
    `/api/v1/data-assets/${assetId}/snapshots`,
    { headers: devHeaders, signal: options.signal }
  );
  return sortSnapshotSummaries(payload.snapshots);
}

export async function fetchSnapshotDetail(assetId: string, snapshotId: string, options: FetchOptions = {}): Promise<Snapshot> {
  const payload = await apiFetch<{ snapshot: Snapshot }>(
    `/api/v1/data-assets/${assetId}/snapshots/${snapshotId}`,
    { headers: devHeaders, signal: options.signal }
  );
  return payload.snapshot;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

type RequestHandle = { id: number; controller: AbortController };

export function useSnapshotPreview(): SnapshotPreviewController {
  const [state, setState] = useState<SnapshotPreviewState>(initialSnapshotPreviewState);
  const requestRef = useRef<RequestHandle | null>(null);

  const beginRequest = useCallback((): RequestHandle => {
    requestRef.current?.controller.abort();
    const handle = { id: (requestRef.current?.id ?? 0) + 1, controller: new AbortController() };
    requestRef.current = handle;
    return handle;
  }, []);

  const isCurrentRequest = useCallback((handle: RequestHandle): boolean => {
    return requestRef.current?.id === handle.id && !handle.controller.signal.aborted;
  }, []);

  const loadDetail = useCallback(async (assetId: string, snapshotId: string, handle: RequestHandle) => {
    try {
      const snapshot = await fetchSnapshotDetail(assetId, snapshotId, { signal: handle.controller.signal });
      if (!isCurrentRequest(handle)) return;
      setState((current) => ({ ...current, selectedSnapshotId: snapshotId, snapshot, status: "ready", error: null }));
    } catch (error) {
      if (!isCurrentRequest(handle) || isAbortError(error)) return;
      setState((current) => ({ ...current, selectedSnapshotId: snapshotId, snapshot: null, status: "error", error: formatApiError(error, "无法读取此 Snapshot") }));
    }
  }, [isCurrentRequest]);

  const loadList = useCallback(async (assetId: string, handle: RequestHandle) => {
    try {
      const summaries = await fetchSnapshotSummaries(assetId, { signal: handle.controller.signal });
      if (!isCurrentRequest(handle)) return;
      const latest = summaries[0];
      setState((current) => ({
        ...current,
        summaries,
        selectedSnapshotId: latest?.id ?? null,
        snapshot: null,
        status: latest ? "loading-detail" : "ready",
        error: null
      }));
      if (latest) await loadDetail(assetId, latest.id, handle);
    } catch (error) {
      if (!isCurrentRequest(handle) || isAbortError(error)) return;
      setState((current) => ({ ...current, summaries: [], selectedSnapshotId: null, snapshot: null, status: "error", error: formatApiError(error, "无法读取 Snapshot 版本") }));
    }
  }, [isCurrentRequest, loadDetail]);

  const open = useCallback(async (assetId: string) => {
    if (!assetId) return;
    const handle = beginRequest();
    setState({ ...initialSnapshotPreviewState, isOpen: true, assetId, status: "loading-list" });
    await loadList(assetId, handle);
  }, [beginRequest, loadList]);

  const close = useCallback(() => {
    requestRef.current?.controller.abort();
    requestRef.current = null;
    setState(initialSnapshotPreviewState);
  }, []);

  const select = useCallback((snapshotId: string) => {
    const assetId = state.assetId;
    if (!assetId) return;
    const handle = beginRequest();
    setState((current) => ({ ...current, selectedSnapshotId: snapshotId, snapshot: null, status: "loading-detail", error: null }));
    void loadDetail(assetId, snapshotId, handle);
  }, [beginRequest, loadDetail, state.assetId]);

  const retry = useCallback(() => {
    const assetId = state.assetId;
    if (!assetId) return;
    const handle = beginRequest();
    if (state.selectedSnapshotId) {
      setState((current) => ({ ...current, snapshot: null, status: "loading-detail", error: null }));
      void loadDetail(assetId, state.selectedSnapshotId, handle);
      return;
    }
    setState((current) => ({ ...current, snapshot: null, status: "loading-list", error: null }));
    void loadList(assetId, handle);
  }, [beginRequest, loadDetail, loadList, state.assetId, state.selectedSnapshotId]);

  useEffect(() => () => {
    requestRef.current?.controller.abort();
  }, []);

  return { ...state, open, close, select, retry };
}
