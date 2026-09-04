"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./plugins.module.css";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "/api";
const devHeaders: Record<string, string> = process.env.NODE_ENV === "production"
  ? {}
  : { "x-user-id": process.env.NEXT_PUBLIC_DEV_USER_ID ?? "local-dev-user" };
const jsonHeaders = { ...devHeaders, "content-type": "application/json" };

function apiEndpoint(path: string): string {
  const base = apiUrl.replace(/\/$/, "");
  return base === "/api" && path.startsWith("/api/") ? `${base}${path.slice(4)}` : `${base}${path}`;
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(apiEndpoint(path), { ...init, cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as T & { error?: string; code?: string };
  if (!response.ok) throw new Error(`${payload.error ?? "请求失败"}${payload.code ? ` · ${payload.code}` : ""}`);
  return payload;
}

type Workspace = { id: string; name: string };
type Project = { id: string; name: string };
type Capability = { kind: string; id: string; pluginId: string; version: string; contentHash: string; capabilityKey?: string; payload?: unknown };
type Manifest = {
  metadata: { id: string; version: string; name: string; description?: string };
  compatibility: { flintAdapter: string; renderers: string[] };
  templates: Array<{ id: string; name: string; requiredFields: Array<{ role: string; semanticTypes: string[] }>; allowedRenderers: string[] }>;
  themes: Array<{ id: string; name: string; description?: string }>;
  semanticTypes: Array<{ id: string; description: string }>;
  validators: Array<{ id: string }>;
};
type CatalogPlugin = { pluginId: string; version: string; name: string; description: string | null; contentHash: string; manifest: Manifest; compatibility: Manifest["compatibility"]; capabilities: Array<{ kind: string; id: string; capabilityKey: string }> };
type PluginRecord = { installation: { id: string; workspaceId: string; pluginId: string; version: string; contentHash: string; status: "installed" | "revoked" | "incompatible"; updatedAt: string; }; manifest: { id: string; name: string; description: string | null; manifest: Manifest } };
type BindingRecord = { binding: { id: string; installationId: string; pluginId: string; version: string; status: "enabled" | "disabled"; versionNumber: number; }; installation: PluginRecord["installation"]; manifest: PluginRecord["manifest"] };
type CapabilityResponse = { context: { themeRef: ThemeRef | null }; manifests: Array<{ pluginId: string; version: string; contentHash: string; capabilities: Capability[] }> };
type ThemeRef = { source: "builtin"; id: string; version: string } | { source: "plugin"; pluginId: string; version: string; capabilityId: string; contentHash: string };
type ProjectTheme = { preset: string; themeRef: ThemeRef | null; version: number; config: Record<string, unknown> };

const statusLabels: Record<PluginRecord["installation"]["status"], string> = { installed: "可用", revoked: "已撤销", incompatible: "不兼容" };
const kindLabels: Record<string, string> = { template: "模板", theme: "主题", "semantic-type": "语义", validator: "校验", example: "示例", renderer: "Renderer" };
const emptyManifest = `{
  "apiVersion": "langreport.dev/v1",
  "kind": "ChartPlugin",
  "metadata": { "id": "my-plugin", "version": "1.0.0", "name": "我的图表插件" },
  "compatibility": { "flintAdapter": ">=0.1 <0.2", "renderers": ["vega-lite"] },
  "templates": [],
  "themes": [],
  "semanticTypes": [],
  "validators": [],
  "examples": []
}`;

export default function PluginsPage() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogPlugin[]>([]);
  const [installed, setInstalled] = useState<PluginRecord[]>([]);
  const [bindings, setBindings] = useState<BindingRecord[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityResponse | null>(null);
  const [projectTheme, setProjectTheme] = useState<ProjectTheme | null>(null);
  const [manifestText, setManifestText] = useState("");
  const [validationReport, setValidationReport] = useState<{ valid: boolean; issues: Array<{ path: string; message: string; severity: string }> } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedProject = useMemo(() => projects.find((project) => project.id === projectId) ?? null, [projects, projectId]);
  const enabledInstallationIds = useMemo(() => new Set(bindings.filter((record) => record.binding.status === "enabled").map((record) => record.binding.installationId)), [bindings]);
  const availableThemes = useMemo(() => (capabilities?.manifests ?? []).flatMap((manifest) => manifest.capabilities.filter((capability) => capability.kind === "theme")), [capabilities]);

  const load = useCallback(async (nextProjectId: string | null, workspaceId: string) => {
    const [catalogPayload, installedPayload, themePayload] = await Promise.all([
      apiFetch<{ plugins: CatalogPlugin[] }>(`/api/v1/workspaces/${workspaceId}/plugin-catalog`, { headers: devHeaders }),
      apiFetch<{ plugins: PluginRecord[] }>(`/api/v1/workspaces/${workspaceId}/plugins`, { headers: devHeaders }),
      nextProjectId ? apiFetch<{ theme: ProjectTheme }>(`/api/v1/projects/${nextProjectId}/theme`, { headers: devHeaders }) : Promise.resolve({ theme: null })
    ]);
    setCatalog(catalogPayload.plugins);
    setInstalled(installedPayload.plugins);
    setProjectTheme(themePayload.theme);
    if (!nextProjectId) {
      setBindings([]);
      setCapabilities(null);
      return;
    }
    const [bindingPayload, capabilityPayload] = await Promise.all([
      apiFetch<{ plugins: BindingRecord[] }>(`/api/v1/projects/${nextProjectId}/plugins`, { headers: devHeaders }),
      apiFetch<CapabilityResponse>(`/api/v1/projects/${nextProjectId}/capabilities`, { headers: devHeaders })
    ]);
    setBindings(bindingPayload.plugins);
    setCapabilities(capabilityPayload);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        setIsLoading(true);
        let payload = await apiFetch<{ workspace: Workspace | null; projects: Project[] }>("/api/v1/projects", { headers: devHeaders });
        if (!payload.workspace || payload.projects.length === 0) {
          await apiFetch("/api/v1/dev/bootstrap", { method: "POST", headers: jsonHeaders, body: "{}" });
          payload = await apiFetch<{ workspace: Workspace | null; projects: Project[] }>("/api/v1/projects", { headers: devHeaders });
        }
        if (cancelled) return;
        setWorkspace(payload.workspace);
        setProjects(payload.projects);
        const remembered = window.localStorage.getItem("langreport-project-id");
        const nextProjectId = payload.projects.find((project) => project.id === remembered)?.id ?? payload.projects[0]?.id ?? null;
        setProjectId(nextProjectId);
        if (payload.workspace) await load(nextProjectId, payload.workspace.id);
      } catch (bootError) {
        if (!cancelled) setError(bootError instanceof Error ? bootError.message : "无法读取插件工作区");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void boot();
    return () => { cancelled = true; };
  }, [load]);

  async function refresh() {
    if (!workspace) return;
    await load(projectId, workspace.id);
  }

  async function installManifest(manifest: Manifest, source: "builtin" | "uploaded", label: string) {
    if (!workspace || isBusy) return;
    setIsBusy(label);
    setError(null);
    try {
      const result = await apiFetch<{ reused: boolean }>(`/api/v1/workspaces/${workspace.id}/plugins`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ manifest, source, idempotencyKey: crypto.randomUUID() })
      });
      setNotice(result.reused ? "插件已经安装，未重复创建。" : "插件已安装到当前 Workspace。");
      await refresh();
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : "插件安装失败");
    } finally {
      setIsBusy(null);
    }
  }

  async function validateManifest() {
    if (!workspace || !manifestText.trim() || isBusy) return;
    setIsBusy("validate");
    setError(null);
    setValidationReport(null);
    try {
      const manifest = JSON.parse(manifestText) as Manifest;
      const result = await apiFetch<{ validationReport: { valid: boolean; issues: Array<{ path: string; message: string; severity: string }> } }>(`/api/v1/workspaces/${workspace.id}/plugins/validate`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(manifest)
      });
      setValidationReport(result.validationReport);
      if (result.validationReport.valid) setNotice("Manifest 校验通过，可以安装。");
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "Manifest 校验失败");
    } finally {
      setIsBusy(null);
    }
  }

  async function installValidatedManifest() {
    if (!validationReport?.valid) return;
    try {
      await installManifest(JSON.parse(manifestText) as Manifest, "uploaded", "install-uploaded");
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Manifest JSON 无效");
    }
  }

  async function togglePlugin(record: PluginRecord | BindingRecord, enabled: boolean) {
    if (!projectId || isBusy) return;
    const installation = record.installation;
    const binding = "binding" in record ? record.binding : undefined;
    setIsBusy(installation.id);
    setError(null);
    try {
      await apiFetch(`/api/v1/projects/${projectId}/plugins/${installation.id}`, {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ enabled, expectedVersion: binding?.versionNumber, idempotencyKey: crypto.randomUUID() })
      });
      setNotice(enabled ? `${installation.pluginId} 已为当前项目启用。` : `${installation.pluginId} 已停用。`);
      await refresh();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "项目插件状态更新失败");
    } finally {
      setIsBusy(null);
    }
  }

  async function changeTheme(theme: Capability | null) {
    if (!projectId || !projectTheme || isBusy || !theme) return;
    setIsBusy(`theme-${theme.id}`);
    setError(null);
    try {
      await apiFetch(`/api/v1/projects/${projectId}/theme`, {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({
          preset: projectTheme.preset,
          config: projectTheme.config,
          expectedVersion: projectTheme.version,
          themeRef: { source: "plugin", pluginId: theme.pluginId, version: theme.version, capabilityId: theme.id, contentHash: theme.contentHash }
        })
      });
      setNotice(`主题已切换为 ${theme.id}，下一次生成会固化该主题快照。`);
      await refresh();
    } catch (themeError) {
      setError(themeError instanceof Error ? themeError.message : "主题更新失败");
    } finally {
      setIsBusy(null);
    }
  }

  async function revoke(installationId: string) {
    if (!workspace || isBusy) return;
    setIsBusy(installationId);
    setError(null);
    try {
      await apiFetch(`/api/v1/workspaces/${workspace.id}/plugins/${installationId}/revoke`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ reason: "Workspace 管理员在插件设置中撤销" }) });
      setNotice("插件安装已撤销，相关 Project Binding 会自动停用。");
      await refresh();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "插件撤销失败");
    } finally {
      setIsBusy(null);
    }
  }

  async function restore(installationId: string) {
    if (!workspace || isBusy) return;
    setIsBusy(installationId);
    setError(null);
    try {
      await apiFetch(`/api/v1/workspaces/${workspace.id}/plugins/${installationId}/restore`, { method: "POST", headers: jsonHeaders, body: "{}" });
      setNotice("插件安装已恢复。");
      await refresh();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "插件恢复失败");
    } finally {
      setIsBusy(null);
    }
  }

  return <div className={styles.shell}>
    <header className={styles.topbar}><a className={styles.brand} href="/">L/ <span>LangReport</span></a><div className={styles.topbarMeta}><span>{workspace?.name ?? "Workspace"}</span><span className={styles.dot} /> <span>插件管理</span></div><a className="secondary-button" href="/">返回工作台 ↗</a></header>
    <main className={styles.main}>
      <div className={styles.pageHead}><div><div className="eyebrow">WORKSPACE / EXTENSIONS</div><h1>插件</h1><p>管理 Workspace 可用的声明式图表能力，并为每个 Project 固定启用版本。</p></div><div className={styles.scope}><span className="eyebrow">当前项目</span><select value={projectId ?? ""} onChange={(event) => { setProjectId(event.target.value || null); if (event.target.value) window.localStorage.setItem("langreport-project-id", event.target.value); if (workspace) void load(event.target.value || null, workspace.id); }}><option value="">选择项目</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></div></div>
      {error && <div className="alert error-alert" role="alert"><strong>错误</strong><span>{error}</span><button type="button" onClick={() => setError(null)}>×</button></div>}
      {notice && <div className="alert notice-alert" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>×</button></div>}
      {isLoading ? <div className={styles.loading}><span className={styles.loadingMark} />读取插件目录…</div> : <>
        <section className={styles.summaryGrid}><div><span className="eyebrow">已安装</span><strong>{installed.filter((record) => record.installation.status === "installed").length.toString().padStart(2, "0")}</strong><small>Workspace installations</small></div><div><span className="eyebrow">当前启用</span><strong>{enabledInstallationIds.size.toString().padStart(2, "0")}</strong><small>{selectedProject?.name ?? "尚未选择项目"}</small></div><div><span className="eyebrow">能力</span><strong>{(capabilities?.context ? capabilities.manifests.reduce((count, manifest) => count + manifest.capabilities.length, 0) : 0).toString().padStart(2, "0")}</strong><small>可追溯的模板 / 主题 / 校验</small></div></section>
        <div className={styles.columns}>
          <div className={styles.primaryColumn}>
            <section className={styles.section}><div className={styles.sectionHead}><div><div className="eyebrow">目录</div><h2>内置插件</h2></div><span className={styles.sectionNote}>先安装到 Workspace，再由 Project 启用</span></div><div className={styles.pluginList}>{catalog.map((item) => { const installation = installed.find((record) => record.installation.pluginId === item.pluginId && record.installation.version === item.version && record.installation.contentHash === item.contentHash); return <article className={styles.pluginRow} key={`${item.pluginId}@${item.version}`}><div className={styles.pluginIdentity}><span className={styles.pluginMark}>{item.name.slice(0, 1)}</span><div><h3>{item.name}</h3><p>{item.description ?? "声明式图表扩展"}</p><code>{item.pluginId}@{item.version}</code></div></div><div className={styles.capabilityTags}>{item.capabilities.map((capability) => <span key={`${capability.kind}-${capability.id}`}>{kindLabels[capability.kind] ?? capability.kind} · {capability.id}</span>)}</div><div className={styles.rowAction}>{installation ? <span className={`${styles.status} ${installation.installation.status === "installed" ? styles.statusGood : styles.statusMuted}`}>{statusLabels[installation.installation.status]}</span> : <button type="button" className="primary-button" onClick={() => void installManifest(item.manifest, "builtin", `install-${item.pluginId}`)} disabled={Boolean(isBusy)}>安装到 Workspace ↗</button>}</div></article>; })}</div></section>
            <section className={styles.section}><div className={styles.sectionHead}><div><div className="eyebrow">PROJECT / {selectedProject?.name ?? "未选择"}</div><h2>项目扩展</h2></div><span className={styles.sectionNote}>仅影响当前项目的生成周期</span></div>{!projectId ? <div className={styles.empty}>选择一个 Project 后管理启用状态。</div> : installed.length === 0 ? <div className={styles.empty}>Workspace 还没有安装插件。</div> : <div className={styles.bindingList}>{installed.map((record) => { const binding = bindings.find((candidate) => candidate.installation.id === record.installation.id); const enabled = binding?.binding.status === "enabled"; const available = record.installation.status === "installed"; return <div className={styles.bindingRow} key={record.installation.id}><div><strong>{record.manifest.name}</strong><small>{record.installation.pluginId}@{record.installation.version} · {available ? "安装可用" : statusLabels[record.installation.status]}</small></div><button type="button" className={enabled ? "primary-button" : "secondary-button"} onClick={() => void togglePlugin(binding ?? record, !enabled)} disabled={!available || Boolean(isBusy)}>{enabled ? "已启用 · 停用" : "启用到项目 ↗"}</button></div>; })}</div>}</section>
            <section className={styles.section}><div className={styles.sectionHead}><div><div className="eyebrow">UPLOAD / VALIDATE</div><h2>上传 Manifest</h2></div><label className="secondary-button"><input className={styles.fileInput} type="file" accept="application/json,.json" onChange={async (event) => { const file = event.target.files?.[0]; if (file) setManifestText(await file.text()); }} />读取 JSON 文件</label></div><p className={styles.helper}>插件是纯声明式 JSON。服务端会检查严格 Schema、禁止字段、Renderer、Theme 继承和 Validator DSL。</p><textarea className={styles.manifestEditor} value={manifestText} onChange={(event) => setManifestText(event.target.value)} placeholder={emptyManifest} spellCheck={false} /><div className={styles.formActions}><button type="button" className="secondary-button" onClick={() => void validateManifest()} disabled={!manifestText.trim() || Boolean(isBusy)}>{isBusy === "validate" ? "校验中" : "校验 Manifest"}</button><button type="button" className="primary-button" onClick={() => void installValidatedManifest()} disabled={!validationReport?.valid || Boolean(isBusy)}>安装已校验版本 ↗</button></div>{validationReport && <div className={`${styles.validation} ${validationReport.valid ? styles.validationGood : styles.validationBad}`}><strong>{validationReport.valid ? "校验通过" : "校验未通过"}</strong>{validationReport.issues.length > 0 && <ul>{validationReport.issues.slice(0, 5).map((issue) => <li key={`${issue.path}-${issue.message}`}>{issue.path} · {issue.message}</li>)}</ul>}</div>}</section>
          </div>
          <aside className={styles.sideColumn}>
            <section className={styles.sideSection}><div className="eyebrow">INSTALLED / ADMIN</div><h2>Workspace 安装</h2>{installed.length === 0 ? <p className={styles.muted}>尚未安装任何插件。</p> : <div className={styles.installedList}>{installed.map((record) => <div className={styles.installedItem} key={record.installation.id}><div><strong>{record.manifest.name}</strong><small>{record.installation.pluginId}@{record.installation.version}</small></div>{record.installation.status === "installed" ? <button type="button" className={styles.textAction} onClick={() => void revoke(record.installation.id)} disabled={Boolean(isBusy)}>撤销</button> : <button type="button" className={styles.textAction} onClick={() => void restore(record.installation.id)} disabled={Boolean(isBusy)}>恢复</button>}</div>)}</div>}</section>
            <section className={styles.sideSection}><div className="eyebrow">THEME / EXPLICIT</div><h2>项目主题</h2><p className={styles.muted}>插件主题只有在 Project 明确选择后才会生效，并写入下一次 Revision 的主题快照。</p><div className={styles.themeList}>{availableThemes.length === 0 ? <span className={styles.emptyInline}>先启用包含 Theme 的插件</span> : availableThemes.map((theme) => { const selected = projectTheme?.themeRef?.source === "plugin" && projectTheme.themeRef.pluginId === theme.pluginId && projectTheme.themeRef.capabilityId === theme.id; return <button type="button" className={`${styles.themeChoice} ${selected ? styles.themeSelected : ""}`} key={`${theme.pluginId}-${theme.id}`} onClick={() => void changeTheme(theme)} disabled={Boolean(isBusy)}><span>{selected ? "●" : "○"}</span><strong>{theme.id}</strong><small>{theme.pluginId}@{theme.version}</small></button>; })}</div></section>
            <section className={styles.sideSection}><div className="eyebrow">CAPABILITY CATALOG</div><h2>当前能力</h2>{capabilities?.manifests.length ? <div className={styles.capabilityList}>{capabilities.manifests.flatMap((manifest) => manifest.capabilities).map((capability) => <div key={`${capability.pluginId}-${capability.kind}-${capability.id}`}><span>{kindLabels[capability.kind] ?? capability.kind}</span><strong>{capability.id}</strong><small>{capability.pluginId}@{capability.version}</small></div>)}</div> : <p className={styles.muted}>当前项目未启用插件，因此生成时不会读取插件能力。</p>}</section>
          </aside>
        </div>
      </>}
    </main>
  </div>;
}
