"use client";

import { useEffect, useReducer, useRef } from "react";
import { watchGenerationJob, type GenerationJobStatusSnapshot } from "../../app/generation-job-status-watcher";
import { generationReducer, initialGenerationState, type GenerationState } from "./generation-state";

export type GenerationJobWatcherOptions = {
  jobId: string | null;
  enabled: boolean;
  afterVersion?: number;
  headers?: HeadersInit;
  request: (path: string, init: RequestInit) => Promise<Response>;
  onStatus: (snapshot: GenerationJobStatusSnapshot) => void | Promise<void>;
  onTerminal: (snapshot: GenerationJobStatusSnapshot, isCurrent: () => boolean, signal: AbortSignal) => Promise<void>;
  onError?: (error: unknown) => void;
};

export function useGenerationJob(options: GenerationJobWatcherOptions): GenerationState {
  const [state, dispatch] = useReducer(generationReducer, initialGenerationState);
  const generationWatchRef = useRef(0);
  const { jobId, enabled, afterVersion, headers, request, onStatus, onTerminal, onError } = options;

  useEffect(() => {
    if (!enabled || !jobId) {
      dispatch({ type: "reset" });
      return;
    }
    const controller = new AbortController();
    const session = generationWatchRef.current + 1;
    generationWatchRef.current = session;
    const isCurrent = () => generationWatchRef.current === session && !controller.signal.aborted;
    const abortForLogout = () => controller.abort();
    window.addEventListener("langreport:generation-abort", abortForLogout);
    dispatch({ type: "watching" });

    void watchGenerationJob({
      jobId,
      afterVersion,
      headers,
      signal: controller.signal,
      request,
      onStatus: async (snapshot) => {
        if (!isCurrent()) return;
        if (snapshot.job.terminal) {
          dispatch({ type: "refreshing-result" });
          await onTerminal(snapshot, isCurrent, controller.signal);
          if (isCurrent()) dispatch({ type: "terminal", status: snapshot.job.status });
          return;
        }
        await onStatus(snapshot);
      }
    }).catch((watchError) => {
      if (isCurrent() && !(watchError instanceof DOMException && watchError.name === "AbortError")) {
        dispatch({ type: "error", message: watchError instanceof Error ? watchError.message : "无法读取生成状态" });
        onError?.(watchError);
      }
    });

    return () => {
      window.removeEventListener("langreport:generation-abort", abortForLogout);
      controller.abort();
      if (generationWatchRef.current === session) generationWatchRef.current += 1;
    };
  // The watcher owns its cursor. Do not restart it for every statusVersion update
  // delivered by onStatus; only a new job or context should create a new flight.
  }, [enabled, headers, jobId, onError, onStatus, onTerminal, request]);

  return state;
}
