"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const devHeaders = { "x-user-id": "local-dev-user" };

type ColumnProfile = {
  name: string;
  inferredType: string;
  nullCount: number;
  distinctCount: number;
  sampleValues: Array<string | number | boolean | null>;
};

type Snapshot = {
  id: string;
  version: number;
  rowCount: number;
  columnCount: number;
  schema: ColumnProfile[];
  preview: Array<Record<string, string | number | boolean | null>>;
};

type Asset = {
  id: string;
  name: string;
  sourceType: string;
  sizeBytes: number;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  latestSnapshot: Snapshot | null;
};

type Project = {
  id: string;
  name: string;
};

type BootstrapResponse = {
  project: Project;
};

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export default function Home() {
  const [project, setProject] = useState<Project | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pasteContent, setPasteContent] = useState("");
  const [pasteName, setPasteName] = useState("pasted-data.csv");
  const [isBooting, setIsBooting] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedId) ?? assets[0] ?? null,
    [assets, selectedId]
  );

  const loadAssets = useCallback(async (projectId: string) => {
    const response = await fetch(`${apiUrl}/api/v1/projects/${projectId}/data-assets`, {
      headers: devHeaders,
      cache: "no-store"
    });
    if (!response.ok) throw new Error("无法读取数据资产");
    const payload = await response.json() as { assets: Asset[] };
    setAssets(payload.assets);
    setSelectedId((current) => current ?? payload.assets[0]?.id ?? null);
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      setIsBooting(true);
      const response = await fetch(`${apiUrl}/api/v1/dev/bootstrap`, {
        method: "POST",
        headers: { ...devHeaders, "content-type": "application/json" },
        body: "{}"
      });
      if (!response.ok) throw new Error("API 尚未就绪，请确认后端已启动");
      const payload = await response.json() as BootstrapResponse;
      setProject(payload.project);
      await loadAssets(payload.project.id);
    } catch (bootError) {
      setError(bootError instanceof Error ? bootError.message : "初始化失败");
    } finally {
      setIsBooting(false);
    }
  }, [loadAssets]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  async function uploadFile(file: File) {
    if (!project) return;
    setError(null);
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`${apiUrl}/api/v1/projects/${project.id}/data-assets/upload`, {
        method: "POST",
        headers: devHeaders,
        body: formData
      });
      const payload = await response.json() as { asset?: Asset; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "文件上传失败");
      await loadAssets(project.id);
      if (payload.asset) setSelectedId(payload.asset.id);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "文件上传失败");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function submitPaste() {
    if (!project || !pasteContent.trim()) return;
    setError(null);
    setIsUploading(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/projects/${project.id}/data-assets/paste`, {
        method: "POST",
        headers: { ...devHeaders, "content-type": "application/json" },
        body: JSON.stringify({ name: pasteName, content: pasteContent })
      });
      const payload = await response.json() as { asset?: Asset; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "粘贴数据失败");
      await loadAssets(project.id);
      if (payload.asset) setSelectedId(payload.asset.id);
      setPasteContent("");
    } catch (pasteError) {
      setError(pasteError instanceof Error ? pasteError.message : "粘贴数据失败");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="workspace-shell">
      <aside className="sidebar">
        <div className="brand-lockup"><span className="brand-mark">L/</span><span>LangReport</span></div>
        <div className="workspace-switcher"><span className="switcher-label">WORKSPACE</span><strong>LangReport Local</strong><span className="switcher-chevron">⌄</span></div>
        <nav className="side-nav" aria-label="项目导航">
          <button className="nav-item active" type="button"><span>◈</span>数据资产</button>
          <button className="nav-item" type="button" disabled><span>✦</span>图表产物 <em>Soon</em></button>
          <button className="nav-item" type="button" disabled><span>⌁</span>项目记忆 <em>Soon</em></button>
          <button className="nav-item" type="button" disabled><span>◇</span>项目设置 <em>Soon</em></button>
        </nav>
        <div className="sidebar-footer"><div className="user-line"><span className="avatar">LD</span><span>Local Developer</span></div><span className="version-label">MVP / PHASE 1</span></div>
      </aside>

      <main className="workspace-main">
        <header className="topbar"><div className="breadcrumbs"><span>Projects</span><b>/</b><strong>{project?.name ?? "销售分析 Demo"}</strong></div><div className="topbar-actions"><span className="connection-status"><i /> API ready</span><button type="button" className="icon-button" aria-label="帮助">?</button></div></header>
        <div className="content-frame">
              <section className="page-intro"><div><p className="section-kicker">PROJECT / DATA ASSETS</p><h1>数据资产<br /><span>总览。</span></h1><p className="intro-copy">导入 CSV、XLSX 或 JSON，生成可复现的数据快照，供后续图表生成使用。</p></div><div className="intro-meta"><span>01</span><span className="meta-line" /><span>DATA INTAKE</span></div></section>
          {error && <div className="error-banner" role="alert">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div>}
          <section className="workspace-grid">
            <div className="ingest-column">
              <div className="panel-heading"><div><p className="section-kicker">ADD SOURCE</p><h2>导入数据</h2></div><span className="panel-index">A</span></div>
              <label className={`drop-zone ${isUploading ? "is-loading" : ""}`}><input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.json" disabled={isUploading || isBooting} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFile(file); }} /><span className="drop-icon">＋</span><strong>{isUploading ? "正在处理数据…" : "选择文件或拖拽至此"}</strong><span>CSV / XLSX / JSON · 最大 50 MB</span></label>
              <div className="paste-divider"><span>OR PASTE TABLE</span></div>
              <div className="paste-form"><div className="field-row"><label htmlFor="paste-name">资产名称</label><input id="paste-name" value={pasteName} onChange={(event) => setPasteName(event.target.value)} /></div><textarea value={pasteContent} onChange={(event) => setPasteContent(event.target.value)} placeholder={"月份,区域,销售额\n2026-01,华东,120000\n2026-02,华东,138000"} disabled={isUploading || isBooting} /><button className="primary-button" type="button" onClick={() => void submitPaste()} disabled={!pasteContent.trim() || isUploading || isBooting}>解析并保存 <span>↗</span></button></div>
            </div>

            <div className="asset-column">
              <div className="panel-heading"><div><p className="section-kicker">SOURCE LIBRARY</p><h2>数据资产 <span>{assets.length.toString().padStart(2, "0")}</span></h2></div><span className="panel-index">B</span></div>
              <div className="asset-list" aria-live="polite">{isBooting ? <div className="empty-state">正在连接项目…</div> : assets.length === 0 ? <div className="empty-state"><span>◌</span><strong>还没有数据资产</strong><small>从左侧导入第一份数据</small></div> : assets.map((asset) => <button type="button" key={asset.id} className={`asset-row ${selectedAsset?.id === asset.id ? "selected" : ""}`} onClick={() => setSelectedId(asset.id)}><span className={`asset-type ${asset.sourceType}`}>{asset.sourceType === "pasted" ? "TXT" : asset.sourceType.toUpperCase()}</span><span className="asset-info"><strong>{asset.name}</strong><small>{formatBytes(asset.sizeBytes)} · {formatDate(asset.createdAt)}</small></span><span className={`asset-state ${asset.status}`}><i />{asset.status === "ready" ? "Ready" : asset.status}</span></button>)}</div>
            </div>

            <div className="preview-column">
              <div className="panel-heading"><div><p className="section-kicker">SNAPSHOT INSPECTOR</p><h2>数据预览</h2></div><span className="panel-index">C</span></div>
              {selectedAsset?.latestSnapshot ? <><div className="snapshot-summary"><div><span>ROWS</span><strong>{selectedAsset.latestSnapshot.rowCount.toLocaleString()}</strong></div><div><span>COLUMNS</span><strong>{selectedAsset.latestSnapshot.columnCount.toString().padStart(2, "0")}</strong></div><div><span>SNAPSHOT</span><strong>v{selectedAsset.latestSnapshot.version}</strong></div></div><div className="schema-list">{selectedAsset.latestSnapshot.schema.map((column) => <div className="schema-row" key={column.name}><span>{column.name}</span><small>{column.inferredType} · {column.distinctCount} unique</small></div>)}</div><div className="table-wrap"><table><thead><tr>{selectedAsset.latestSnapshot.schema.map((column) => <th key={column.name}>{column.name}</th>)}</tr></thead><tbody>{selectedAsset.latestSnapshot.preview.slice(0, 8).map((row, index) => <tr key={`${selectedAsset.id}-${index}`}>{selectedAsset.latestSnapshot?.schema.map((column) => <td key={column.name}>{String(row[column.name] ?? "—")}</td>)}</tr>)}</tbody></table></div></> : <div className="empty-state preview-empty"><span>⌁</span><strong>选择一个数据资产</strong><small>这里会显示字段画像和前 25 行预览</small></div>}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
