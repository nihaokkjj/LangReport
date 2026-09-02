"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const devHeaders = { "x-user-id": "local-dev-user" };

type Cell = string | number | boolean | null;
type ColumnProfile = {
  name: string;
  inferredType: string;
  nullCount: number;
  distinctCount: number;
  sampleValues: Cell[];
};
type Snapshot = {
  id: string;
  version: number;
  rowCount: number;
  columnCount: number;
  schema: ColumnProfile[];
  preview: Array<Record<string, Cell>>;
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
type Project = { id: string; name: string };
type PreviewData = { columns: string[]; rows: Array<Record<string, Cell>>; steps: Array<{ stepIndex: number; kind: string; inputRowCount: number; outputRowCount: number }> };
type FlintSpec = {
  theme: string;
  themeVersion: string;
  chartSpec: {
    chartType: "Line Chart" | "Bar Chart" | "Area Chart";
    title: string;
    subtitle?: string;
    encodings: Record<string, { field: string; type?: string }>;
  };
};
type GenerationJob = {
  id: string;
  conversationId: string;
  status: string;
  prompt: string;
  snapshotId: string;
  repairCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  intent: { confidence?: number; timeColumn?: string; dimensionColumns?: string[]; measureColumns?: string[] } | null;
  transformPlan: { rationale?: string; steps?: Array<{ kind: string }> } | null;
  fieldLineage: Array<{ outputColumn: string; sourceColumns: string[]; operation: string }> | null;
  flintSpec: FlintSpec | null;
  validation: { valid: boolean; checks: { schema: boolean; semantics: boolean; dataFields: boolean; visual: boolean }; issues: Array<{ code: string; message: string }> } | null;
  previewData: PreviewData | null;
  outputs: { png?: string; svg?: string; vegaLite?: string } | null;
  memoryContext?: MemoryContext;
  revision: { id: string; artifactId: string; revision: number; status: string } | null;
};

type MemoryCandidate = {
  id: string;
  memoryKey: string;
  memoryType: string;
  statement: string;
  value: Record<string, unknown>;
  scopeHint: "project" | "workspace";
  confidence: number;
  status: "proposed" | "accepted" | "rejected";
  sourceMessageIds: string[];
  version: number;
  createdAt: string;
  memorySnapshot?: Array<{ id: string; scope: string; key: string; version: number }>;
};

type MemoryReference = {
  id: string;
  scope: "project" | "workspace";
  memoryKey: string;
  memoryType: string;
  statement: string;
  value: Record<string, unknown>;
  version: number;
  status: "active" | "superseded" | "deleted";
};

type MemoryContext = {
  project: MemoryReference[];
  workspace: MemoryReference[];
  conflicts: Array<{ memoryKey: string; records: MemoryReference[]; requiresDecision: boolean }>;
};

type ChartRevision = {
  id: string;
  artifactId: string;
  revision: number;
  status: "draft" | "in_review" | "approved" | "changes_requested" | "archived";
  parentRevisionId: string | null;
  createdBy: string;
  changeReason: string | null;
  snapshotId: string;
  flintSpec: FlintSpec;
  createdAt: string;
};

type ChartArtifact = {
  id: string;
  projectId: string;
  name: string;
  headRevisionId: string | null;
  publishedRevisionId: string | null;
  status: "active" | "archived";
  updatedAt: string;
  headRevision: ChartRevision | null;
  publishedRevision: ChartRevision | null;
  revisions?: ChartRevision[];
};

type ChartComment = {
  id: string;
  revisionId: string;
  authorId: string;
  body: string;
  resolvedAt: string | null;
  createdAt: string;
};

const revisionStatusLabels: Record<ChartRevision["status"], string> = {
  draft: "Draft",
  in_review: "In Review",
  approved: "Approved",
  changes_requested: "Changes Requested",
  archived: "Archived"
};

const statusLabels: Record<string, string> = {
  queued: "排队中",
  profiling: "读取快照",
  planning: "理解意图",
  transforming: "执行变换",
  compiling: "生成规范",
  rendering: "渲染图表",
  validating: "最后校验",
  succeeded: "已完成",
  failed: "生成失败"
};

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatValue(value: Cell): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
  return String(value);
}

function InteractiveChart({ rows, spec }: { rows: Array<Record<string, Cell>>; spec: FlintSpec }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const chart = spec.chartSpec;
  const xField = chart.encodings.x?.field;
  const yField = chart.encodings.y?.field;
  const colorField = chart.encodings.color?.field;
  const chartRows = useMemo(() => rows.filter((row) => xField && yField && typeof row[yField] === "number"), [rows, xField, yField]);
  if (!xField || !yField || chartRows.length === 0) return <div className="chart-empty">校验通过，但没有可绘制的数值行。</div>;

  const width = 920;
  const height = 420;
  const left = 72;
  const top = 66;
  const right = 28;
  const bottom = 60;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const xValues = [...new Set(chartRows.map((row) => String(row[xField] ?? "")))];
  const series = colorField ? [...new Set(chartRows.map((row) => String(row[colorField] ?? "")))] : [""];
  const values = chartRows.map((row) => Number(row[yField]));
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const colors = ["#000000", "#ff3d8b", "#1ea64a", "#1f1d3d"];
  const xPosition = (value: string) => xValues.length <= 1 ? plotWidth / 2 : xValues.indexOf(value) * plotWidth / (xValues.length - 1);
  const yPosition = (value: number) => plotHeight - ((value - min) / range) * plotHeight;

  return <div className="chart-visual" aria-label={`${chart.title}交互式预览`}>
    <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img">
      <line x1={left} y1={top + plotHeight} x2={left + plotWidth} y2={top + plotHeight} stroke="currentColor" />
      <line x1={left} y1={top} x2={left} y2={top + plotHeight} stroke="currentColor" />
      <text x={left - 12} y={top + 4} textAnchor="end">{formatValue(max)}</text>
      <text x={left - 12} y={top + plotHeight} textAnchor="end">{formatValue(min)}</text>
      {xValues.map((value, index) => <text key={value} x={left + (xValues.length <= 1 ? plotWidth / 2 : index * plotWidth / (xValues.length - 1))} y={top + plotHeight + 24} textAnchor="middle">{value}</text>)}
      {series.map((seriesValue, seriesIndex) => {
        const points = chartRows.filter((row) => !colorField || String(row[colorField] ?? "") === seriesValue).sort((a, b) => xValues.indexOf(String(a[xField] ?? "")) - xValues.indexOf(String(b[xField] ?? "")));
        const path = points.map((row, index) => `${index === 0 ? "M" : "L"}${left + xPosition(String(row[xField] ?? ""))},${top + yPosition(Number(row[yField]))}`).join(" ");
        return <g key={seriesValue || "default"}>
          {spec.chartSpec.chartType === "Bar Chart" ? points.map((row, index) => {
            const value = Number(row[yField]);
            const barWidth = Math.max(9, plotWidth / Math.max(xValues.length * series.length, 1) * 0.7);
            const x = left + xPosition(String(row[xField] ?? "")) - ((series.length - 1) * barWidth) / 2 + seriesIndex * barWidth;
            const y = top + yPosition(Math.max(value, min));
            const baseline = top + yPosition(Math.min(value, min));
            return <rect key={`${seriesValue}-${index}`} tabIndex={0} role="button" aria-label={`${String(row[xField] ?? "")}: ${formatValue(row[yField])}`} x={x - barWidth / 2} y={Math.min(y, baseline)} width={barWidth - 2} height={Math.max(2, Math.abs(baseline - y))} fill={colors[seriesIndex % colors.length]} opacity={activeIndex === index ? 1 : 0.8} onMouseEnter={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)} />;
          }) : <>
            <path d={path} fill="none" stroke={colors[seriesIndex % colors.length]} strokeWidth="3" />
            {points.map((row, index) => <circle key={`${seriesValue}-${index}`} tabIndex={0} role="button" aria-label={`${String(row[xField] ?? "")}: ${formatValue(row[yField])}`} cx={left + xPosition(String(row[xField] ?? ""))} cy={top + yPosition(Number(row[yField]))} r={activeIndex === index ? 7 : 5} fill={colors[seriesIndex % colors.length]} onMouseEnter={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)} />)}
          </>}
        </g>;
      })}
    </svg>
    <div className="chart-readout">{activeIndex === null ? <span>悬停或聚焦数据点查看数值</span> : <strong>{formatValue(chartRows[activeIndex]?.[yField])}</strong>}</div>
  </div>;
}

export default function Home() {
  const [project, setProject] = useState<Project | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pasteContent, setPasteContent] = useState("");
  const [pasteName, setPasteName] = useState("pasted-data.csv");
  const [prompt, setPrompt] = useState("按月份展示各区域销售额和同比变化");
  const [theme, setTheme] = useState("economist");
  const [isThemeOverride, setIsThemeOverride] = useState(false);
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [chartArtifacts, setChartArtifacts] = useState<ChartArtifact[]>([]);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const [comments, setComments] = useState<ChartComment[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [revisionTitle, setRevisionTitle] = useState("");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [chartNotice, setChartNotice] = useState<string | null>(null);
  const [memoryCandidates, setMemoryCandidates] = useState<MemoryCandidate[]>([]);
  const [memoryContext, setMemoryContext] = useState<MemoryContext>({ project: [], workspace: [], conflicts: [] });
  const [memoryNotice, setMemoryNotice] = useState<string | null>(null);
  const [memoryPendingId, setMemoryPendingId] = useState<string | null>(null);
  const [candidateScopes, setCandidateScopes] = useState<Record<string, "project" | "workspace">>({});
  const [candidateResolutions, setCandidateResolutions] = useState<Record<string, "adopt_candidate" | "keep_both">>({});
  const [isChartActionPending, setIsChartActionPending] = useState(false);
  const [isBooting, setIsBooting] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedAsset = useMemo(() => assets.find((asset) => asset.id === selectedId) ?? assets[0] ?? null, [assets, selectedId]);
  const selectedArtifact = useMemo(() => chartArtifacts.find((artifact) => artifact.id === selectedArtifactId) ?? chartArtifacts[0] ?? null, [chartArtifacts, selectedArtifactId]);
  const selectedRevision = useMemo(() => selectedArtifact?.revisions?.find((revision) => revision.id === selectedRevisionId) ?? selectedArtifact?.headRevision ?? selectedArtifact?.publishedRevision ?? null, [selectedArtifact, selectedRevisionId]);
  const isJobActive = Boolean(job && !["succeeded", "failed"].includes(job.status));

  const loadAssets = useCallback(async (projectId: string) => {
    const response = await fetch(`${apiUrl}/api/v1/projects/${projectId}/data-assets`, { headers: devHeaders, cache: "no-store" });
    if (!response.ok) throw new Error("无法读取数据资产");
    const payload = await response.json() as { assets: Asset[] };
    setAssets(payload.assets);
    setSelectedId((current) => current ?? payload.assets[0]?.id ?? null);
  }, []);

  const loadChartArtifacts = useCallback(async (projectId: string) => {
    const response = await fetch(`${apiUrl}/api/v1/projects/${projectId}/chart-artifacts`, { headers: devHeaders, cache: "no-store" });
    if (!response.ok) throw new Error("无法读取图表产物");
    const payload = await response.json() as { artifacts: ChartArtifact[] };
    setChartArtifacts(payload.artifacts);
    setSelectedArtifactId((current) => current ?? payload.artifacts[0]?.id ?? null);
  }, []);

  const loadChartDetails = useCallback(async (projectId: string, artifactId: string) => {
    const response = await fetch(`${apiUrl}/api/v1/projects/${projectId}/chart-artifacts/${artifactId}`, { headers: devHeaders, cache: "no-store" });
    if (!response.ok) throw new Error("无法读取图表版本");
    const payload = await response.json() as { artifact: ChartArtifact };
    setChartArtifacts((current) => current.map((artifact) => artifact.id === artifactId ? payload.artifact : artifact));
    setSelectedRevisionId((current) => current ?? payload.artifact.headRevisionId ?? payload.artifact.publishedRevisionId ?? null);
  }, []);

  const loadComments = useCallback(async (revisionId: string) => {
    const response = await fetch(`${apiUrl}/api/v1/chart-revisions/${revisionId}/comments`, { headers: devHeaders, cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json() as { comments: ChartComment[] };
    setComments(payload.comments);
  }, []);

  const loadMemory = useCallback(async (projectId: string) => {
    const [candidateResponse, memoryResponse] = await Promise.all([
      fetch(`${apiUrl}/api/v1/projects/${projectId}/memory-candidates?status=proposed`, { headers: devHeaders, cache: "no-store" }),
      fetch(`${apiUrl}/api/v1/projects/${projectId}/memories`, { headers: devHeaders, cache: "no-store" })
    ]);
    if (!candidateResponse.ok || !memoryResponse.ok) throw new Error("无法读取项目记忆");
    const candidatePayload = await candidateResponse.json() as { candidates: MemoryCandidate[] };
    const memoryPayload = await memoryResponse.json() as { memory: MemoryContext };
    setMemoryCandidates(candidatePayload.candidates);
    setMemoryContext(memoryPayload.memory);
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      setIsBooting(true);
      const response = await fetch(`${apiUrl}/api/v1/dev/bootstrap`, { method: "POST", headers: { ...devHeaders, "content-type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error("API 尚未就绪，请确认后端已启动");
      const payload = await response.json() as { project: Project };
      setProject(payload.project);
      const themeResponse = await fetch(`${apiUrl}/api/v1/projects/${payload.project.id}/theme`, { headers: devHeaders, cache: "no-store" });
      if (themeResponse.ok) {
        const themePayload = await themeResponse.json() as { theme: { preset: string } };
        setTheme(themePayload.theme.preset);
        setIsThemeOverride(false);
      }
      await loadAssets(payload.project.id);
      await loadMemory(payload.project.id);
    } catch (bootError) {
      setError(bootError instanceof Error ? bootError.message : "初始化失败");
    } finally {
      setIsBooting(false);
    }
  }, [loadAssets, loadMemory]);

  useEffect(() => { void bootstrap(); }, [bootstrap]);

  useEffect(() => {
    if (!job?.id || !isJobActive) return;
    let cancelled = false;
    const poll = async () => {
      const response = await fetch(`${apiUrl}/api/v1/generation-jobs/${job.id}`, { headers: devHeaders, cache: "no-store" });
      if (!response.ok || cancelled) return;
      const payload = await response.json() as { job: GenerationJob; revision: GenerationJob["revision"] };
      if (!cancelled) setJob({ ...payload.job, revision: payload.revision });
    };
    const interval = window.setInterval(() => { void poll(); }, 900);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [job?.id, isJobActive]);

  useEffect(() => {
    if (!project?.id || job?.status !== "succeeded") return;
    void loadChartArtifacts(project.id).catch((loadError) => setChartNotice(loadError instanceof Error ? loadError.message : "无法读取图表产物"));
  }, [project?.id, job?.status, job?.revision?.id, loadChartArtifacts]);

  useEffect(() => {
    if (!project?.id) return;
    void loadMemory(project.id).catch((loadError) => setMemoryNotice(loadError instanceof Error ? loadError.message : "无法读取项目记忆"));
  }, [project?.id, job?.status, loadMemory]);

  useEffect(() => {
    if (!project?.id || !selectedArtifact?.id) return;
    void loadChartDetails(project.id, selectedArtifact.id).catch((loadError) => setChartNotice(loadError instanceof Error ? loadError.message : "无法读取图表版本"));
  }, [project?.id, selectedArtifact?.id, loadChartDetails]);

  useEffect(() => {
    if (!selectedRevision?.id) return;
    setRevisionTitle(selectedRevision.flintSpec.chartSpec.title);
    void loadComments(selectedRevision.id);
  }, [selectedRevision?.id, loadComments]);

  async function uploadFile(file: File) {
    if (!project) return;
    setError(null); setIsUploading(true);
    try {
      const formData = new FormData(); formData.append("file", file);
      const response = await fetch(`${apiUrl}/api/v1/projects/${project.id}/data-assets/upload`, { method: "POST", headers: devHeaders, body: formData });
      const payload = await response.json() as { asset?: Asset; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "文件上传失败");
      await loadAssets(project.id); if (payload.asset) setSelectedId(payload.asset.id);
    } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : "文件上传失败"); }
    finally { setIsUploading(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  }

  async function submitPaste() {
    if (!project || !pasteContent.trim()) return;
    setError(null); setIsUploading(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/projects/${project.id}/data-assets/paste`, { method: "POST", headers: { ...devHeaders, "content-type": "application/json" }, body: JSON.stringify({ name: pasteName, content: pasteContent }) });
      const payload = await response.json() as { asset?: Asset; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "粘贴数据失败");
      await loadAssets(project.id); if (payload.asset) setSelectedId(payload.asset.id); setPasteContent("");
    } catch (pasteError) { setError(pasteError instanceof Error ? pasteError.message : "粘贴数据失败"); }
    finally { setIsUploading(false); }
  }

  async function generateChart() {
    if (!project || !selectedAsset?.latestSnapshot || selectedAsset.status !== "ready" || !prompt.trim()) return;
    setError(null); setIsGenerating(true); setJob(null);
    try {
      const response = await fetch(`${apiUrl}/api/v1/projects/${project.id}/generation-jobs`, { method: "POST", headers: { ...devHeaders, "content-type": "application/json" }, body: JSON.stringify({ dataAssetId: selectedAsset.id, prompt, ...(isThemeOverride ? { theme } : {}) }) });
      const payload = await response.json() as { job?: GenerationJob; error?: string };
      if (!response.ok || !payload.job) throw new Error(payload.error ?? "无法创建生成任务");
      setJob({ ...payload.job, revision: null });
    } catch (generationError) { setError(generationError instanceof Error ? generationError.message : "无法创建生成任务"); }
    finally { setIsGenerating(false); }
  }

  async function editSelectedRevision() {
    if (!selectedArtifact || !selectedRevision || !revisionTitle.trim()) return;
    setChartNotice(null); setIsChartActionPending(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/chart-artifacts/${selectedArtifact.id}/revisions`, {
        method: "POST",
        headers: { ...devHeaders, "content-type": "application/json" },
        body: JSON.stringify({ operation: "edit", baseRevisionId: selectedRevision.id, patch: { title: revisionTitle.trim() } })
      });
      const payload = await response.json() as { job?: GenerationJob; error?: string };
      if (!response.ok || !payload.job) throw new Error(payload.error ?? "无法创建编辑任务");
      setJob({ ...payload.job, revision: null });
      setChartNotice("编辑任务已排队，完成后会生成新的 Draft Revision。");
    } catch (editError) { setChartNotice(editError instanceof Error ? editError.message : "无法编辑图表"); }
    finally { setIsChartActionPending(false); }
  }

  async function transitionSelectedRevision(path: "submit" | "approve" | "request-changes" | "reopen" | "archive") {
    if (!selectedRevision) return;
    setChartNotice(null); setIsChartActionPending(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/chart-revisions/${selectedRevision.id}/${path}`, {
        method: "POST",
        headers: { ...devHeaders, "content-type": "application/json" },
        body: JSON.stringify({ expectedStatus: selectedRevision.status, note: path === "request-changes" ? "请补充图表说明或调整视觉层级" : undefined })
      });
      const payload = await response.json() as { revision?: ChartRevision; error?: string };
      if (!response.ok || !payload.revision) throw new Error(payload.error ?? "无法更新版本状态");
      setChartNotice(`Revision R${payload.revision.revision} 已更新为 ${revisionStatusLabels[payload.revision.status]}`);
      setSelectedRevisionId(payload.revision.id);
      if (project && selectedArtifact) await loadChartDetails(project.id, selectedArtifact.id);
    } catch (transitionError) { setChartNotice(transitionError instanceof Error ? transitionError.message : "无法更新版本状态"); }
    finally { setIsChartActionPending(false); }
  }

  async function rollbackSelectedRevision() {
    if (!selectedArtifact || !selectedRevision) return;
    setChartNotice(null); setIsChartActionPending(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/chart-artifacts/${selectedArtifact.id}/revisions`, {
        method: "POST",
        headers: { ...devHeaders, "content-type": "application/json" },
        body: JSON.stringify({ operation: "rollback", targetRevisionId: selectedRevision.id })
      });
      const payload = await response.json() as { revision?: ChartRevision; error?: string };
      if (!response.ok || !payload.revision) throw new Error(payload.error ?? "无法创建回滚版本");
      setSelectedRevisionId(payload.revision.id);
      setChartNotice(`已创建 R${payload.revision.revision} 回滚草稿，仍需重新审核。`);
      if (project) await loadChartDetails(project.id, selectedArtifact.id);
    } catch (rollbackError) { setChartNotice(rollbackError instanceof Error ? rollbackError.message : "无法创建回滚版本"); }
    finally { setIsChartActionPending(false); }
  }

  async function copySelectedRevision() {
    if (!selectedArtifact || !selectedRevision) return;
    setChartNotice(null); setIsChartActionPending(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/chart-artifacts/${selectedArtifact.id}/revisions`, {
        method: "POST",
        headers: { ...devHeaders, "content-type": "application/json" },
        body: JSON.stringify({ operation: "copy", sourceRevisionId: selectedRevision.id, name: `${selectedArtifact.name} 副本` })
      });
      const payload = await response.json() as { artifact?: ChartArtifact; error?: string };
      if (!response.ok || !payload.artifact) throw new Error(payload.error ?? "无法复制图表产物");
      setChartNotice(`已复制为“${payload.artifact.name}”。`);
      if (project) await loadChartArtifacts(project.id);
    } catch (copyError) { setChartNotice(copyError instanceof Error ? copyError.message : "无法复制图表产物"); }
    finally { setIsChartActionPending(false); }
  }

  async function compareSelectedRevision() {
    if (!selectedRevision?.parentRevisionId || !project) return;
    setChartNotice(null); setIsChartActionPending(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/chart-revisions/${selectedRevision.id}/compare/${selectedRevision.parentRevisionId}`, { headers: devHeaders, cache: "no-store" });
      const payload = await response.json() as { comparison?: { sections: Record<string, { changed: boolean }> }; error?: string };
      if (!response.ok || !payload.comparison) throw new Error(payload.error ?? "无法比较版本");
      const changed = Object.entries(payload.comparison.sections).filter(([, section]) => section.changed).map(([name]) => name);
      setChartNotice(changed.length > 0 ? `与父版本相比有变化：${changed.join("、")}` : "与父版本相比没有结构变化。");
    } catch (compareError) { setChartNotice(compareError instanceof Error ? compareError.message : "无法比较版本"); }
    finally { setIsChartActionPending(false); }
  }

  async function addChartComment() {
    if (!selectedRevision || !commentBody.trim()) return;
    setChartNotice(null); setIsChartActionPending(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/chart-revisions/${selectedRevision.id}/comments`, {
        method: "POST",
        headers: { ...devHeaders, "content-type": "application/json" },
        body: JSON.stringify({ body: commentBody.trim() })
      });
      const payload = await response.json() as { comment?: ChartComment; error?: string };
      if (!response.ok || !payload.comment) throw new Error(payload.error ?? "无法添加评论");
      setComments((current) => [...current, payload.comment as ChartComment]);
      setCommentBody("");
    } catch (commentError) { setChartNotice(commentError instanceof Error ? commentError.message : "无法添加评论"); }
    finally { setIsChartActionPending(false); }
  }

  async function createRevisionShare() {
    if (!selectedRevision || selectedRevision.status !== "approved") return;
    setChartNotice(null); setIsChartActionPending(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/chart-revisions/${selectedRevision.id}/shares`, {
        method: "POST",
        headers: { ...devHeaders, "content-type": "application/json" },
        body: "{}"
      });
      const payload = await response.json() as { shareUrl?: string; error?: string };
      if (!response.ok || !payload.shareUrl) throw new Error(payload.error ?? "无法创建分享");
      setShareUrl(`${apiUrl}${payload.shareUrl}`);
      setChartNotice("已创建固定 Revision 的 Workspace 只读分享。");
    } catch (shareError) { setChartNotice(shareError instanceof Error ? shareError.message : "无法创建分享"); }
    finally { setIsChartActionPending(false); }
  }

  async function acceptCandidate(candidate: MemoryCandidate) {
    if (!project) return;
    setMemoryNotice(null); setMemoryPendingId(candidate.id);
    try {
      const targetScope = candidateScopes[candidate.id] ?? candidate.scopeHint;
      const response = await fetch(`${apiUrl}/api/v1/memory-candidates/${candidate.id}/accept`, {
        method: "POST",
        headers: { ...devHeaders, "content-type": "application/json" },
        body: JSON.stringify({ targetScope, resolution: candidateResolutions[candidate.id], expectedVersion: candidate.version, idempotencyKey: `accept-${candidate.id}-${targetScope}` })
      });
      const payload = await response.json() as { result?: unknown; error?: string; details?: unknown };
      if (!response.ok) throw new Error(payload.error ?? "无法确认记忆");
      setMemoryNotice("记忆已确认，后续生成会按作用域使用它。");
      await loadMemory(project.id);
    } catch (acceptError) { setMemoryNotice(acceptError instanceof Error ? acceptError.message : "无法确认记忆"); }
    finally { setMemoryPendingId(null); }
  }

  async function rejectCandidate(candidate: MemoryCandidate) {
    if (!project) return;
    setMemoryNotice(null); setMemoryPendingId(candidate.id);
    try {
      const response = await fetch(`${apiUrl}/api/v1/memory-candidates/${candidate.id}/reject`, {
        method: "POST",
        headers: { ...devHeaders, "content-type": "application/json" },
        body: JSON.stringify({ reason: "用户拒绝候选", idempotencyKey: `reject-${candidate.id}` })
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "无法拒绝记忆");
      setMemoryNotice("候选已拒绝。");
      await loadMemory(project.id);
    } catch (rejectError) { setMemoryNotice(rejectError instanceof Error ? rejectError.message : "无法拒绝记忆"); }
    finally { setMemoryPendingId(null); }
  }

  const previewSpec = job?.flintSpec;
  const previewRows = job?.previewData?.rows ?? [];

  return <div className="workspace-shell">
    <aside className="sidebar">
      <div className="brand-lockup"><span className="brand-mark">L/</span><span>LangReport</span></div>
      <div className="workspace-switcher"><span className="switcher-label">WORKSPACE</span><strong>LangReport Local</strong><span className="switcher-chevron">⌄</span></div>
      <nav className="side-nav" aria-label="项目导航">
        <button className="nav-item active" type="button"><span>◈</span>数据资产</button>
         <button className="nav-item" type="button" onClick={() => document.getElementById("chart-artifacts")?.scrollIntoView({ behavior: "smooth" })}><span>✦</span>图表产物 <em>Phase 3</em></button>
         <button className="nav-item" type="button" onClick={() => document.getElementById("project-memory")?.scrollIntoView({ behavior: "smooth" })}><span>⌁</span>项目记忆 <em>Phase 4</em></button>
        <button className="nav-item" type="button" disabled><span>◇</span>项目设置 <em>Soon</em></button>
      </nav>
       <div className="sidebar-footer"><div className="user-line"><span className="avatar">LD</span><span>Local Developer</span></div><span className="version-label">MVP / PHASE 3</span></div>
    </aside>

    <main className="workspace-main">
      <header className="topbar"><div className="breadcrumbs"><span>Projects</span><b>/</b><strong>{project?.name ?? "销售分析 Demo"}</strong></div><div className="topbar-actions"><span className="connection-status"><i /> API ready</span><button type="button" className="icon-button" aria-label="帮助">?</button></div></header>
      <div className="content-frame">
        <section className="page-intro"><div><p className="section-kicker">PROJECT / GENERATION WORKSPACE</p><h1>从数据到<br /><span>图表。</span></h1><p className="intro-copy">描述你想看到的趋势，系统会保留快照、计划、字段血缘和 Flint Spec，让每次结果都可以复现。</p></div><div className="intro-meta"><span>02</span><span className="meta-line" /><span>GENERATE</span></div></section>
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
            {selectedAsset?.latestSnapshot ? <><div className="snapshot-summary"><div><span>ROWS</span><strong>{selectedAsset.latestSnapshot.rowCount.toLocaleString()}</strong></div><div><span>COLUMNS</span><strong>{selectedAsset.latestSnapshot.columnCount.toString().padStart(2, "0")}</strong></div><div><span>SNAPSHOT</span><strong>v{selectedAsset.latestSnapshot.version}</strong></div></div><div className="schema-list">{selectedAsset.latestSnapshot.schema.map((column) => <div className="schema-row" key={column.name}><span>{column.name}</span><small>{column.inferredType} · {column.distinctCount} unique</small></div>)}</div><div className="table-wrap"><table><thead><tr>{selectedAsset.latestSnapshot.schema.map((column) => <th key={column.name}>{column.name}</th>)}</tr></thead><tbody>{selectedAsset.latestSnapshot.preview.slice(0, 8).map((row, index) => <tr key={`${selectedAsset.id}-${index}`}>{selectedAsset.latestSnapshot?.schema.map((column) => <td key={column.name}>{formatValue(row[column.name])}</td>)}</tr>)}</tbody></table></div></> : <div className="empty-state preview-empty"><span>⌁</span><strong>选择一个数据资产</strong><small>这里会显示字段画像和前 25 行预览</small></div>}
          </div>
        </section>

        <section className="generation-block">
          <div className="generation-copy"><div className="panel-heading"><div><p className="section-kicker">NATURAL LANGUAGE INTENT</p><h2>生成图表</h2></div><span className="panel-index">D</span></div><p>告诉系统要比较什么、按什么维度展开，阶段 2 会把意图固定为可检查的 TransformPlan。</p><textarea className="prompt-input" value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={isGenerating || isJobActive} aria-label="图表生成描述" /><div className="generation-controls"><label htmlFor="theme-select"><span>THEME {isThemeOverride ? "/ TEMPORARY OVERRIDE" : "/ PROJECT DEFAULT"}</span><select id="theme-select" value={theme} onChange={(event) => { setTheme(event.target.value); setIsThemeOverride(true); }} disabled={isGenerating || isJobActive}><option value="economist">Economist · editorial</option><option value="swiss">Swiss · contrast</option><option value="nature">Nature · calm</option><option value="nyt">NYT · newsroom</option><option value="mckinsey">McKinsey · report</option></select></label><button className="primary-button generate-button" type="button" onClick={() => void generateChart()} disabled={!selectedAsset?.latestSnapshot || selectedAsset.status !== "ready" || !prompt.trim() || isGenerating || isJobActive}>{isGenerating ? "创建任务…" : isJobActive ? `${statusLabels[job?.status ?? "queued"] ?? "处理中"}…` : "生成可编辑图表"}<span>↗</span></button></div></div>
          <div className="generation-status" aria-live="polite">{!job ? <div className="generation-empty"><span>✦</span><strong>等待一条图表意图</strong><small>结果会绑定当前 Data Snapshot</small></div> : <><div className="job-status-line"><span className={`job-dot ${job.status}`} /><strong>{statusLabels[job.status] ?? job.status}</strong><span className="job-id">JOB {job.id.slice(0, 8).toUpperCase()}</span></div>{job.errorMessage && <p className="job-error">{job.errorMessage}</p>}{job.flintSpec && job.previewData && job.status === "succeeded" ? <InteractiveChart rows={previewRows} spec={job.flintSpec} /> : <div className="pipeline-list">{["profiling", "planning", "transforming", "compiling", "rendering", "validating"].map((stage) => <div className={job.status === stage ? "current" : ["succeeded"].includes(job.status) ? "done" : ""} key={stage}><i />{statusLabels[stage]}</div>)}</div>}</>}
          </div>
        </section>

        {project && <section className="memory-block" id="project-memory"><div className="memory-heading"><div><p className="section-kicker">CONFIRMED LAYERED MEMORY</p><h2>项目记忆 <span>{memoryCandidates.length.toString().padStart(2, "0")} candidates</span></h2><p>候选必须经过确认，项目规则优先于工作区规则；冲突会保留双方来源。</p></div><span className="panel-index">F</span></div>{memoryNotice && <div className="memory-notice" role="status">{memoryNotice}</div>}<div className="memory-layout"><div className="memory-candidates"><div className="memory-subheading"><span>待确认候选</span><small>{memoryCandidates.length} pending</small></div>{memoryCandidates.length === 0 ? <div className="memory-empty"><span>⌁</span><strong>暂无待确认候选</strong><small>在对话中明确说明口径或偏好后，候选会出现在这里。</small></div> : memoryCandidates.map((candidate) => <article className="memory-candidate" key={candidate.id}><div className="memory-candidate-copy"><span className="memory-key">{candidate.memoryKey}</span><strong>{candidate.statement}</strong><small>建议作用域：{candidate.scopeHint === "project" ? "当前项目" : "整个工作区"} · 置信度 {Math.round(candidate.confidence * 100)}%</small></div><div className="memory-candidate-controls"><label><span>保存到</span><select value={candidateScopes[candidate.id] ?? candidate.scopeHint} onChange={(event) => setCandidateScopes((current) => ({ ...current, [candidate.id]: event.target.value as "project" | "workspace" }))}><option value="project">当前项目</option><option value="workspace">整个工作区</option></select></label><label><span>冲突时</span><select value={candidateResolutions[candidate.id] ?? ""} onChange={(event) => { const value = event.target.value; if (value) setCandidateResolutions((current) => ({ ...current, [candidate.id]: value as "adopt_candidate" | "keep_both" })); }}><option value="">需要冲突时选择</option><option value="adopt_candidate">采用候选并替代旧值</option><option value="keep_both">并列保留</option></select></label><div><button className="primary-button compact-button" type="button" onClick={() => void acceptCandidate(candidate)} disabled={memoryPendingId === candidate.id}>确认记忆</button><button className="secondary-button compact-button" type="button" onClick={() => void rejectCandidate(candidate)} disabled={memoryPendingId === candidate.id}>拒绝</button></div></div></article>)}</div><div className="memory-effective"><div className="memory-subheading"><span>当前有效记忆</span><small>{memoryContext.project.length + memoryContext.workspace.length} active</small></div>{memoryContext.conflicts.length > 0 && <div className="memory-conflict" role="alert"><strong>存在 {memoryContext.conflicts.length} 个冲突</strong><span>项目与工作区的不同口径都会展示来源，不会自动覆盖。</span></div>}<div className="memory-record-list">{[...memoryContext.project, ...memoryContext.workspace].length === 0 ? <div className="memory-empty"><span>◌</span><strong>还没有长期记忆</strong><small>确认候选后，记忆会按作用域出现在这里。</small></div> : [...memoryContext.project, ...memoryContext.workspace].map((record) => <div className="memory-record" key={record.id}><div><span className={`memory-scope ${record.scope}`}>{record.scope === "project" ? "PROJECT" : "WORKSPACE"}</span><strong>{record.statement}</strong><small>{record.memoryKey} · v{record.version}</small></div><span className="memory-source">active</span></div>)}</div></div></div></section>}

         {job?.status === "succeeded" && job.validation && job.flintSpec && <section className="result-block"><div className="result-heading"><div><p className="section-kicker">TRACEABLE CHART REVISION</p><h2>结果已就绪 <span>· Snapshot {job.snapshotId.slice(0, 8)}</span></h2></div><div className="export-actions"><a className="secondary-button" href={`${apiUrl}/api/v1/generation-jobs/${job.id}/outputs/svg`}>导出 SVG</a><a className="secondary-button" href={`${apiUrl}/api/v1/generation-jobs/${job.id}/outputs/png`}>导出 PNG</a></div></div><div className="trace-grid"><div><span>TRANSFORM PLAN</span><strong>{job.transformPlan?.steps?.length ?? 0} steps</strong><small>{job.transformPlan?.rationale}</small></div><div><span>VALIDATION</span><strong>{job.validation.valid ? "4 / 4 passed" : "failed"}</strong><small>{job.repairCount} automatic repairs · schema / semantics / fields / visual</small></div><div><span>FIELD LINEAGE</span><strong>{job.fieldLineage?.length ?? 0} outputs</strong><small>{job.fieldLineage?.map((line) => `${line.outputColumn} ← ${line.sourceColumns.join(" + ")}`).join(" · ")}</small></div><div><span>MEMORY CONTEXT</span><strong>{(job.memoryContext?.project.length ?? 0) + (job.memoryContext?.workspace.length ?? 0)} confirmed</strong><small>{job.memoryContext?.conflicts.length ? `${job.memoryContext.conflicts.length} conflicts preserved` : "Project / Workspace scope captured"}</small></div><div><span>VEGA-LITE</span><strong>editable spec</strong><a href={`${apiUrl}/api/v1/generation-jobs/${job.id}/outputs/vegaLite`}>下载 JSON ↗</a></div></div></section>}

         {project && selectedArtifact && <section className="artifact-block" id="chart-artifacts"><div className="artifact-heading"><div><p className="section-kicker">CHART ARTIFACT / ASYNC COLLABORATION</p><h2>图表产物 <span>{chartArtifacts.length.toString().padStart(2, "0")}</span></h2><p>每次编辑都会创建新的 Revision；已批准版本对 Viewer 保持只读。</p></div><span className="panel-index">E</span></div>{chartNotice && <div className="artifact-notice" role="status">{chartNotice}</div>}<div className="artifact-layout"><div className="artifact-library"><div className="artifact-library-heading"><span>ARTIFACTS</span><small>{chartArtifacts.length} charts</small></div>{chartArtifacts.map((artifact) => <button type="button" key={artifact.id} className={`artifact-row ${artifact.id === selectedArtifact.id ? "selected" : ""}`} onClick={() => { setSelectedArtifactId(artifact.id); setSelectedRevisionId(artifact.headRevisionId ?? artifact.publishedRevisionId); }}><span className="artifact-glyph">✦</span><span><strong>{artifact.name}</strong><small>{artifact.headRevision ? `R${artifact.headRevision.revision} · ${revisionStatusLabels[artifact.headRevision.status]}` : "尚未发布"}</small></span></button>)}</div><div className="artifact-inspector"><div className="artifact-inspector-heading"><div><span className="artifact-kicker">CURRENT WORKSPACE</span><h3>{selectedArtifact.name}</h3></div><span className={`revision-status ${selectedRevision?.status ?? "draft"}`}>{selectedRevision ? revisionStatusLabels[selectedRevision.status] : "没有版本"}</span></div>{selectedArtifact.revisions && selectedArtifact.revisions.length > 0 ? <><div className="revision-timeline" aria-label="Revision 时间线">{selectedArtifact.revisions.map((revision) => <button type="button" key={revision.id} className={`revision-chip ${revision.id === selectedRevision?.id ? "selected" : ""}`} onClick={() => setSelectedRevisionId(revision.id)}><strong>R{revision.revision}</strong><small>{revisionStatusLabels[revision.status]}</small></button>)}</div>{selectedRevision && <><div className="revision-editor"><label htmlFor="revision-title"><span>REVISION TITLE</span><input id="revision-title" value={revisionTitle} onChange={(event) => setRevisionTitle(event.target.value)} disabled={isChartActionPending || selectedRevision.status === "archived"} /></label><button className="primary-button compact-button" type="button" onClick={() => void editSelectedRevision()} disabled={isChartActionPending || selectedRevision.status === "archived" || !revisionTitle.trim()}>创建新 Revision <span>↗</span></button></div><div className="artifact-trace-grid"><div><span>SNAPSHOT</span><strong>{selectedRevision.snapshotId.slice(0, 8)}</strong><small>历史数据固定，不随资产更新</small></div><div><span>PARENT</span><strong>{selectedRevision.parentRevisionId ? selectedRevision.parentRevisionId.slice(0, 8) : "—"}</strong><small>{selectedRevision.changeReason ?? "initial generation"}</small></div><div><span>CREATED BY</span><strong>{selectedRevision.createdBy}</strong><small>{formatDate(selectedRevision.createdAt)}</small></div><div><span>CHART SPEC</span><strong>{selectedRevision.flintSpec.chartSpec.chartType}</strong><small>{selectedRevision.flintSpec.theme} · {selectedRevision.flintSpec.themeVersion} · {selectedRevision.memorySnapshot?.length ?? 0} memories</small></div></div><div className="artifact-actions"><div className="export-actions"><a className="secondary-button" href={`${apiUrl}/api/v1/chart-revisions/${selectedRevision.id}/outputs/svg`}>导出 SVG</a><a className="secondary-button" href={`${apiUrl}/api/v1/chart-revisions/${selectedRevision.id}/outputs/png`}>导出 PNG</a>{selectedRevision.status === "approved" && <button className="secondary-button" type="button" onClick={() => void createRevisionShare()} disabled={isChartActionPending}>创建只读分享</button>}</div><div className="revision-command-actions">{selectedRevision.status === "draft" && <button className="secondary-button" type="button" onClick={() => void transitionSelectedRevision("submit")} disabled={isChartActionPending}>提交审核</button>}{selectedRevision.status === "in_review" && <><button className="primary-button compact-button" type="button" onClick={() => void transitionSelectedRevision("approve")} disabled={isChartActionPending}>批准 Revision <span>↗</span></button><button className="secondary-button" type="button" onClick={() => void transitionSelectedRevision("request-changes")} disabled={isChartActionPending}>要求修改</button></>}{selectedRevision.status === "changes_requested" && <button className="secondary-button" type="button" onClick={() => void transitionSelectedRevision("reopen")} disabled={isChartActionPending}>重新打开草稿</button>}{selectedRevision.parentRevisionId && <button className="secondary-button" type="button" onClick={() => void compareSelectedRevision()} disabled={isChartActionPending}>对比父版本</button>}<button className="secondary-button" type="button" onClick={() => void rollbackSelectedRevision()} disabled={isChartActionPending || selectedRevision.status === "archived"}>创建回滚草稿</button><button className="secondary-button" type="button" onClick={() => void copySelectedRevision()} disabled={isChartActionPending}>复制产物</button></div></div>{shareUrl && <div className="share-result"><span>WORKSPACE SHARE</span><a href={shareUrl}>{shareUrl}</a></div>}<div className="comment-panel"><div className="artifact-library-heading"><span>COMMENTS / REVISION R{selectedRevision.revision}</span><small>{comments.length} notes</small></div><div className="comment-list">{comments.length === 0 ? <small>还没有评论，审核者可以从这里留下反馈。</small> : comments.map((comment) => <div className={`comment-row ${comment.resolvedAt ? "resolved" : ""}`} key={comment.id}><strong>{comment.authorId}</strong><span>{comment.body}</span><small>{formatDate(comment.createdAt)}{comment.resolvedAt ? " · resolved" : ""}</small></div>)}</div><div className="comment-compose"><input value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="针对这个 Revision 留下一条评论" disabled={isChartActionPending} /><button className="secondary-button" type="button" onClick={() => void addChartComment()} disabled={isChartActionPending || !commentBody.trim()}>添加评论</button></div></div></>}</> : <div className="artifact-empty"><span>✦</span><strong>等待首个图表产物</strong><small>阶段 2 生成成功后，Revision 会出现在这里。</small></div>}</div></div></section>}
      </div>
    </main>
  </div>;
}
