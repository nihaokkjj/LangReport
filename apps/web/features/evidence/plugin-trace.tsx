"use client";

export type PluginSnapshot = {
  version: "v1";
  flintAdapterVersion: string;
  renderer: { id: string; version: string };
  themeRef?: unknown;
  resolvedTheme?: unknown;
  plugins: Array<{ pluginId: string; version: string; contentHash: string; capabilities: Record<string, unknown[]> }>;
};

export type PluginTraceState =
  | { status: "idle" | "loading" | "empty" }
  | { status: "ready"; snapshot: PluginSnapshot }
  | { status: "invalid" | "error"; message: string };

export function PluginTrace({ state, revision }: { state: PluginTraceState; revision?: number }) {
  if (state.status === "idle") return null;
  if (state.status === "loading") return <section className="plugin-trace-banner" aria-label="Revision 插件上下文" role="status"><div><div className="eyebrow">REVISION / R{revision ?? "—"} / PLUGIN CONTEXT</div><strong>正在读取插件快照…</strong></div></section>;
  if (state.status === "invalid" || state.status === "error") return <section className="plugin-trace-banner plugin-trace-error" aria-label="Revision 插件上下文" role="alert"><div><div className="eyebrow">REVISION / R{revision ?? "—"} / PLUGIN CONTEXT</div><strong>插件追溯被阻止</strong><span>{state.message}</span></div></section>;
  if (state.status !== "ready") return null;
  const { snapshot } = state;
  if (snapshot.plugins.length === 0 && !snapshot.themeRef) return null;
  const capabilities = snapshot.plugins.flatMap((plugin) => Object.values(plugin.capabilities).flat());
  return <section className="plugin-trace-banner" aria-label="Revision 插件上下文"><div><div className="eyebrow">REVISION / R{revision ?? "—"} / PLUGIN CONTEXT</div><strong>{snapshot.plugins.length ? `${snapshot.plugins.length} 个插件 · ${capabilities.length} 项实际能力` : "本次未使用插件"}</strong></div><div className="plugin-trace-meta"><span>{snapshot.renderer.id} · {snapshot.renderer.version}</span><span>{snapshot.themeRef ? "含显式 ThemeRef" : "未选择插件主题"}</span></div></section>;
}
