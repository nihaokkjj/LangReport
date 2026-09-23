"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, devHeaders, formatApiError } from "../../lib/http-client";
import type { PluginSnapshot, PluginTraceState } from "./plugin-trace";

type FetchOptions = { signal?: AbortSignal };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parsePluginSnapshot(value: unknown): PluginTraceState {
  if (value === null || value === undefined || !isRecord(value) || Object.keys(value).length === 0) {
    return { status: "empty" };
  }

  const renderer = value.renderer;
  const plugins = value.plugins;
  if (
    value.version !== "v1" ||
    typeof value.flintAdapterVersion !== "string" ||
    !isRecord(renderer) ||
    typeof renderer.id !== "string" ||
    typeof renderer.version !== "string" ||
    !Array.isArray(plugins)
  ) {
    return { status: "invalid", message: "插件快照缺少可验证的版本、Renderer 或插件列表。" };
  }

  for (const plugin of plugins) {
    if (
      !isRecord(plugin) ||
      typeof plugin.pluginId !== "string" ||
      typeof plugin.version !== "string" ||
      typeof plugin.contentHash !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(plugin.contentHash) ||
      !isRecord(plugin.capabilities) ||
      Object.values(plugin.capabilities).some((items) => !Array.isArray(items))
    ) {
      return { status: "invalid", message: "插件快照中的来源哈希或能力结构无法验证。" };
    }
  }

  return { status: "ready", snapshot: value as unknown as PluginSnapshot };
}

export async function fetchPluginSnapshot(revisionId: string, options: FetchOptions = {}): Promise<PluginTraceState> {
  const payload = await apiFetch<{ pluginSnapshot: unknown }>(
    `/api/v1/chart-revisions/${revisionId}/plugin-context`,
    { headers: devHeaders, signal: options.signal }
  );
  return parsePluginSnapshot(payload.pluginSnapshot);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function usePluginTrace(revisionId: string | null): PluginTraceState {
  const [state, setState] = useState<PluginTraceState>({ status: "idle" });
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const controller = new AbortController();

    if (!revisionId) {
      setState({ status: "idle" });
      return () => controller.abort();
    }

    setState({ status: "loading" });
    void fetchPluginSnapshot(revisionId, { signal: controller.signal })
      .then((nextState) => {
        if (requestIdRef.current === requestId && !controller.signal.aborted) setState(nextState);
      })
      .catch((error: unknown) => {
        if (requestIdRef.current !== requestId || controller.signal.aborted || isAbortError(error)) return;
        setState({ status: "error", message: formatApiError(error, "无法读取插件快照。") });
      });

    return () => controller.abort();
  }, [revisionId]);

  return state;
}
