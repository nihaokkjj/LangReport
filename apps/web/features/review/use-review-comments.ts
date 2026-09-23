"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, devHeaders, formatApiError, jsonHeaders } from "../../lib/http-client";

export type ReviewComment = {
  id: string;
  revisionId: string;
  authorId: string;
  body: string;
  anchor: unknown;
  resolvedAt: string | null;
  createdAt: string;
};

export type ReviewCommentsCallbacks = {
  onClearError?: () => void;
  onError?: (message: string) => void;
  onNotice?: (message: string) => void;
};

type FetchOptions = { signal?: AbortSignal };

export async function fetchReviewComments(revisionId: string, options: FetchOptions = {}): Promise<ReviewComment[]> {
  const payload = await apiFetch<{ comments: ReviewComment[] }>(
    `/api/v1/chart-revisions/${revisionId}/comments`,
    { headers: devHeaders, signal: options.signal }
  );
  return payload.comments;
}

export async function createReviewComment(revisionId: string, body: string, options: FetchOptions = {}): Promise<ReviewComment> {
  const payload = await apiFetch<{ comment: ReviewComment }>(
    `/api/v1/chart-revisions/${revisionId}/comments`,
    { method: "POST", headers: jsonHeaders, body: JSON.stringify({ body }), signal: options.signal }
  );
  return payload.comment;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

type RequestHandle = { revisionId: string; id: number; controller: AbortController };

export function useReviewComments(revisionId: string | null, callbacks: ReviewCommentsCallbacks = {}) {
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [note, setNote] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const requestRef = useRef<RequestHandle | null>(null);
  const revisionRef = useRef(revisionId);
  revisionRef.current = revisionId;
  const { onClearError, onError, onNotice } = callbacks;

  const beginRequest = useCallback((): RequestHandle | null => {
    if (!revisionId) return null;
    requestRef.current?.controller.abort();
    const handle = {
      revisionId,
      id: (requestRef.current?.id ?? 0) + 1,
      controller: new AbortController()
    };
    requestRef.current = handle;
    return handle;
  }, [revisionId]);

  const isCurrentRequest = useCallback((handle: RequestHandle): boolean => {
    return requestRef.current?.id === handle.id && revisionRef.current === handle.revisionId && !handle.controller.signal.aborted;
  }, []);

  const refresh = useCallback(async () => {
    const handle = beginRequest();
    if (!handle) return;
    onClearError?.();
    setIsSaving(false);
    setIsLoading(true);
    try {
      const nextComments = await fetchReviewComments(handle.revisionId, { signal: handle.controller.signal });
      if (!isCurrentRequest(handle)) return;
      setComments(nextComments);
    } catch (error) {
      if (!isCurrentRequest(handle) || isAbortError(error)) return;
      onError?.(formatApiError(error, "无法读取审核评论"));
    } finally {
      if (isCurrentRequest(handle)) setIsLoading(false);
    }
  }, [beginRequest, isCurrentRequest, onClearError, onError]);

  const addComment = useCallback(async () => {
    const body = note.trim();
    if (!revisionId || !body || isSaving) return;
    const handle = beginRequest();
    if (!handle) return;
    onClearError?.();
    setIsLoading(false);
    setIsSaving(true);
    try {
      const comment = await createReviewComment(handle.revisionId, body, { signal: handle.controller.signal });
      if (!isCurrentRequest(handle)) return;
      setComments((current) => [...current, comment]);
      onNotice?.("审核评论已添加到当前 Revision。");
    } catch (error) {
      if (!isCurrentRequest(handle) || isAbortError(error)) return;
      onError?.(formatApiError(error, "无法添加审核评论"));
    } finally {
      if (isCurrentRequest(handle)) setIsSaving(false);
    }
  }, [beginRequest, isCurrentRequest, isSaving, note, onClearError, onError, onNotice, revisionId]);

  const updateNote = useCallback((value: string) => setNote(value), []);
  const clearNote = useCallback(() => setNote(""), []);

  useEffect(() => {
    requestRef.current?.controller.abort();
    requestRef.current = null;
    setComments([]);
    setNote("");
    setIsLoading(false);
    setIsSaving(false);
  }, [revisionId]);

  useEffect(() => () => {
    requestRef.current?.controller.abort();
  }, []);

  return { comments, note, isLoading, isSaving, setNote: updateNote, clearNote, refresh, addComment };
}
