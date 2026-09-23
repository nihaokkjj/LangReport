"use client";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiRawRequest, devHeaders, jsonHeaders, formatApiError } from "../../lib/http-client";
import { useProjectContext } from "../../hooks/use-project-context";
import { useAuthActions } from "../../features/auth/use-auth-actions";
import { useAuthSession } from "../../features/auth/use-auth-session";
import { useGenerationJob } from "../../features/generation/use-generation-job";
import type { GenerationJobStatusSnapshot } from "../generation-job-status-watcher";
import { fetchProjectList, projectQueryKeys } from "../../features/project/project-queries";
import { useProjectServerState } from "../../features/project/use-project-server-state";
import { conversationQueryKeys, fetchConversationList, fetchConversationMessages } from "../../features/conversation/conversation-queries";
import { dataAssetQueryKeys } from "../../features/data-snapshot/data-asset-queries";
import { evidenceQueryKeys, fetchEvidenceList } from "../../features/evidence/evidence-queries";
import { projectResourceQueryKeys } from "../../features/project/project-resource-queries";
import { ProjectCreateDialog, ProjectSelector } from "../../features/project/project-panel";
import { ConversationComposer, ConversationHistoryRail, ConversationSelector } from "../../features/conversation/conversation-panel";
import { DataAssetFileInput, DataAssetRail } from "../../features/data-snapshot/data-asset-panel";
import { useSnapshotPreview } from "../../features/data-snapshot/use-snapshot-preview";
import type { Snapshot, SnapshotPreviewStatus, SnapshotSummary } from "../../features/data-snapshot/use-snapshot-preview";
import { AnalysisBriefForm } from "../../features/analysis-brief/analysis-brief-form";
import { MetricForm } from "../../features/analysis-brief/metric-form";
import { aggregateOperationLabels, aggregateOperations, buildEditorTransformPlan, chartEditorReducer, editorStateFromRevision, filterOperatorLabels, filterOperators, initialChartEditorState } from "../../features/chart-editor/chart-editor-state";
import type { AggregateOperation, Cell, FilterOperator, TransformPlan } from "../../features/chart-editor/chart-editor-state";
import { PluginTrace } from "../../features/evidence/plugin-trace";
import { usePluginTrace } from "../../features/evidence/use-plugin-trace";
import { EvidenceCanvas } from "../../features/evidence/evidence-canvas";
import { ReviewComposition } from "../../features/review/review-composition";
import { useReviewComments } from "../../features/review/use-review-comments";

type ChartAnnotation = { text: string; xField?: string; yField?: string };
type Asset = { id: string; projectId: string; sourceConversationId: string | null; name: string; sourceType: string; sizeBytes: number; status: string; errorMessage: string | null; createdAt: string; latestSnapshot: Snapshot | null };
type ProjectAudience = "internal_analysis" | "client_presentation" | "management";
type VisualTemplate = "consulting-neutral" | "consulting-insight" | "consulting-research";
type Project = { id: string; name: string; slug?: string; clientName?: string; objective?: string; audience?: ProjectAudience; visualTemplate?: VisualTemplate; createdAt?: string };
type Workspace = { id: string; name: string; role?: "owner" | "admin" | "member" };
type ModelCredentialStatus = { workspaceId: string; provider: "bailian"; configured: boolean; keySuffix: string | null; updatedAt: string | null };
type Conversation = { id: string; projectId: string; title: string; createdAt: string; updatedAt: string };
type ConversationMessage = { id: string; conversationId: string; role: "user" | "assistant" | "system"; content: string; createdAt: string };
type MetricDefinition = { id: string; projectId: string; sourceConversationId: string | null; name: string; meaning: string; formula: string; unit: string; timeRule: string; filterRule: string | null; status: "inferred" | "confirmed"; version: number; confirmedBy: string | null; confirmedAt: string | null };
type AnalysisBrief = { id: string; conversationId: string; businessQuestion: string; audience: string; timeRange: string | null; timeGrain: string | null; outputFormat: string; status: "draft" | "confirmed" };
type FlintSpec = { version: "v1"; data: { values: Array<Record<string, Cell>> }; semanticTypes: Record<string, string>; chartSpec: { chartType: "Line Chart" | "Bar Chart" | "Area Chart"; title: string; subtitle?: string; encodings: Record<string, { field: string; type?: "quantitative" | "temporal" | "nominal" | "ordinal" }>; annotations?: ChartAnnotation[]; showValues?: boolean; showLegend?: boolean; baseSize: { width: number; height: number } }; theme: string; themeVersion: string };
type ValidationIssue = { code: string; message: string; severity: "error" | "warning"; field?: string };
type ValidationReport = { valid: boolean; issues: ValidationIssue[]; checks: Record<string, boolean> };
type Revision = { id: string; artifactId: string; revision: number; status: "draft" | "in_review" | "approved" | "changes_requested" | "archived"; parentRevisionId: string | null; snapshotId: string; createdAt: string; changeReason: string | null; flintSpec: FlintSpec; validation: ValidationReport; transformPlan: TransformPlan; fieldLineage: Array<{ outputColumn: string; sourceColumns: string[]; operation: string }>; analysisBriefSnapshot?: AnalysisBrief | Record<string, unknown>; metricDefinitionSnapshot?: MetricDefinition | Record<string, unknown>; pluginSnapshot?: unknown };
type Artifact = { id: string; projectId: string; name: string; headRevisionId: string | null; status: "active" | "archived" };
type GenerationCandidate = { value: string; label: string; source: "transform_output" | "snapshot_requires_transform"; requiresTransformAdjustment: boolean; evidence: Array<{ label: string; value: string }> };
type GenerationProposal = { version: "v1"; diagnostic: { code: string; stage: string; severity: "blocking" | "warning"; message: string; field: string | null; evidence: Array<{ label: string; value: string }> }; code: string; target: "x_field" | "metric" | "memory" | null; stage: string; severity: "blocking" | "warning"; question: string; reason: string; field: string | null; candidates: GenerationCandidate[]; recommendedCandidate: GenerationCandidate | null; requiresUserDecision: true };
type GenerationJob = { id: string; conversationId: string; status: string; operation?: "generate" | "edit" | "rollback" | "copy"; prompt: string; snapshotId: string; repairCount: number; attemptCount?: number; errorCode: string | null; errorMessage: string | null; clarificationProposal: GenerationProposal | null; statusVersion?: number; statusChangedAt?: string; intent: { chartType?: string; title?: string; timeColumn?: string; dimensionColumns?: string[]; measureColumns?: string[] } | null; transformPlan: Revision["transformPlan"] | null; fieldLineage: Revision["fieldLineage"] | null; flintSpec: FlintSpec | null; validation: ValidationReport | null; previewData: { columns: string[]; rows: Array<Record<string, Cell>>; steps: Array<{ stepIndex: number; kind: string; inputRowCount: number; outputRowCount: number }> } | null; revision: { id: string; artifactId: string; revision: number; status: Revision["status"] } | null };
type GenerationDecisionPayload =
  | { action: "accept_recommendation" | "select_candidate"; parentJobId: string; questionCode: string; target: "x_field"; selectedValue: string }
  | { action: "adjust_direction"; parentJobId: string; questionCode?: string; text: string };
type EvidenceBlock = { id: string; projectId: string; conversationId: string; generationJobId: string; chartArtifactId: string; chartRevisionId: string; snapshotId: string; title: string; finding: string; analysisBriefSnapshot: AnalysisBrief | Record<string, unknown>; metricDefinitionSnapshot: MetricDefinition | Record<string, unknown>; qualityWarnings: ValidationIssue[]; status: Revision["status"]; updatedAt: string };
type EvidenceRecord = { block: EvidenceBlock; artifact: Artifact; revision: Revision; job: GenerationJob | null };
type MemoryRecord = { id: string; scope: "project" | "workspace"; statement: string; memoryKey: string; version: number };
type MemoryContext = { project: MemoryRecord[]; workspace: MemoryRecord[]; conflicts: Array<{ memoryKey: string }> };
const statusLabels: Record<string, string> = { queued: "排队中", profiling: "读取快照", planning: "理解意图", transforming: "执行变换", compiling: "生成规范", rendering: "渲染图表", validating: "最后校验", needs_clarification: "需要澄清", succeeded: "已完成", failed: "生成失败", cancelled: "已停止" };
const revisionLabels: Record<Revision["status"], string> = { draft: "草稿", in_review: "审核中", approved: "已批准", changes_requested: "需修改", archived: "已归档" };
const projectAudienceLabels: Record<ProjectAudience, string> = { internal_analysis: "内部分析", client_presentation: "客户汇报", management: "管理层" };
const visualTemplateOptions: Array<{ value: VisualTemplate; label: string; description: string }> = [
  { value: "consulting-neutral", label: "Consulting Neutral", description: "正式、克制，适合客户报告" },
  { value: "consulting-insight", label: "Consulting Insight", description: "突出重点数字、异常和结论" },
  { value: "consulting-research", label: "Consulting Research", description: "强调来源、脚注和不确定性" }
];
const pipelineStages = ["profiling", "planning", "transforming", "compiling", "rendering", "validating"];
const sampleCsv = `月份,区域,销售额
2026-01,华东,120000
2026-01,华南,98000
2026-01,西南,76000
2026-02,华东,138000
2026-02,华南,101000
2026-02,西南,79000
2026-03,华东,145000
2026-03,华南,106000
2026-03,西南,81000
2026-04,华东,152000
2026-04,华南,108000
2026-04,西南,83000
2026-05,华东,161000
2026-05,华南,114000
2026-05,西南,85000
2026-06,华东,172000
2026-06,华南,119000
2026-06,西南,87000`;

function formatDate(value?: string | null): string { if (!value) return "—"; return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function formatValue(value: Cell): string { if (value === null || value === undefined) return "—"; if (typeof value === "number") return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value); return String(value); }
function formatBytes(value?: number | null): string { if (value === null || value === undefined) return "不可用"; if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value / 1024)} KB`; return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value / (1024 * 1024))} MB`; }
function snapshotSourceTypeLabel(value?: string | null): string { return value === "csv" ? "CSV" : value === "xlsx" ? "XLSX" : value === "json" ? "JSON" : value === "pasted" ? "粘贴表格" : "不可用"; }
function snapshotAssetStatusLabel(value?: string): string { return value === "processing" ? "处理中" : value === "failed" ? "处理失败" : value === "archived" ? "已归档" : value === "deleted" ? "已删除" : value ?? "不可用"; }
function chartTypeName(type: FlintSpec["chartSpec"]["chartType"]): string { return type === "Bar Chart" ? "柱状图" : type === "Area Chart" ? "面积图" : "折线图"; }
function rowsForEvidence(evidence: EvidenceRecord | null): Array<Record<string, Cell>> { if (evidence?.job?.previewData?.rows) return evidence.job.previewData.rows; return evidence?.revision.flintSpec.data.values ?? []; }
function InteractiveChart({ rows, spec }: { rows: Array<Record<string, Cell>>; spec: FlintSpec }) {
  const [activePoint, setActivePoint] = useState<{ key: string; readout: string } | null>(null);
  const xField = spec.chartSpec.encodings.x?.field;
  const yField = spec.chartSpec.encodings.y?.field;
  const colorField = spec.chartSpec.encodings.color?.field;
  const chartRows = useMemo(() => rows.filter((row) => xField && yField && typeof row[yField] === "number"), [rows, xField, yField]);
  const xValues = useMemo(() => [...new Set(chartRows.map((row) => String(xField ? row[xField] ?? "" : "")))], [chartRows, xField]);
  const seriesValues = useMemo(() => colorField ? [...new Set(chartRows.map((row) => String(row[colorField] ?? "")))] : [""], [chartRows, colorField]);
  const values = chartRows.map((row) => Number(yField ? row[yField] : 0));
  if (!xField || !yField || chartRows.length === 0) return <div className="chart-empty">无可绘制数据</div>;
  const focusPoint = (key: string, row: Record<string, Cell>) => setActivePoint({ key, readout: `${String(row[xField] ?? "")} · ${colorField ? `${String(row[colorField] ?? "")} · ` : ""}${formatValue(row[yField])}` });
  const width = 900; const height = 360; const left = 70; const top = 28; const right = 22; const bottom = 56; const plotWidth = width - left - right; const plotHeight = height - top - bottom; const min = Math.min(...values, 0); const max = Math.max(...values, 0); const range = max - min || 1; const colors = ["#2457C5", "#5B6875", "#18794E"]; const xPosition = (value: string) => xValues.length <= 1 ? plotWidth / 2 : xValues.indexOf(value) * plotWidth / (xValues.length - 1); const yPosition = (value: number) => plotHeight - ((value - min) / range) * plotHeight; const baseline = top + yPosition(Math.min(0, max));
  return <div className="chart-visual" aria-label={`${spec.chartSpec.title}图表预览`}><svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img"><line x1={left} y1={top + plotHeight} x2={left + plotWidth} y2={top + plotHeight} className="chart-axis" /><line x1={left} y1={top} x2={left} y2={top + plotHeight} className="chart-axis" />{[0, 0.33, 0.66, 1].map((step) => <g key={step}><line x1={left} y1={top + plotHeight * step} x2={left + plotWidth} y2={top + plotHeight * step} className="chart-grid" /><text x={left - 10} y={top + plotHeight * step + 4} textAnchor="end">{formatValue(max - (max - min) * step)}</text></g>)}{xValues.map((value) => <text key={value} x={left + xPosition(value)} y={top + plotHeight + 25} textAnchor="middle">{value}</text>)}{seriesValues.map((seriesValue, seriesIndex) => { const points = chartRows.filter((row) => !colorField || String(row[colorField] ?? "") === seriesValue).sort((a, b) => xValues.indexOf(String(a[xField] ?? "")) - xValues.indexOf(String(b[xField] ?? ""))); const path = points.map((row, index) => `${index === 0 ? "M" : "L"}${left + xPosition(String(row[xField] ?? ""))},${top + yPosition(Number(row[yField]))}`).join(" "); const areaPath = `${path} L ${left + xPosition(String(points[points.length - 1]?.[xField] ?? ""))},${baseline} L ${left + xPosition(String(points[0]?.[xField] ?? ""))},${baseline} Z`; return <g key={seriesValue || "default"}>{spec.chartSpec.chartType === "Area Chart" && <path d={areaPath} fill={colors[seriesIndex % colors.length]} opacity="0.12" />}{spec.chartSpec.chartType === "Bar Chart" ? points.map((row, index) => { const value = Number(row[yField]); const slot = plotWidth / Math.max(xValues.length * seriesValues.length, 1); const barWidth = Math.max(8, slot * 0.68); const x = left + xPosition(String(row[xField] ?? "")) - ((seriesValues.length - 1) * barWidth) / 2 + seriesIndex * barWidth; const y = top + yPosition(Math.max(value, 0)); const key = `${seriesValue}-${index}`; return <rect key={key} tabIndex={0} role="button" aria-label={`${String(row[xField] ?? "")}: ${formatValue(row[yField])}`} x={x - barWidth / 2} y={Math.min(y, baseline)} width={Math.max(3, barWidth - 2)} height={Math.max(2, Math.abs(baseline - y))} fill={colors[seriesIndex % colors.length]} opacity={activePoint?.key === key ? 1 : 0.78} onMouseEnter={() => focusPoint(key, row)} onFocus={() => focusPoint(key, row)} />; }) : <><path d={path} fill="none" stroke={colors[seriesIndex % colors.length]} strokeWidth="3" />{points.map((row, index) => { const key = `${seriesValue}-${index}`; return <circle key={key} tabIndex={0} role="button" aria-label={`${String(row[xField] ?? "")}: ${formatValue(row[yField])}`} cx={left + xPosition(String(row[xField] ?? ""))} cy={top + yPosition(Number(row[yField]))} r={activePoint?.key === key ? 7 : 4.5} fill={colors[seriesIndex % colors.length]} onMouseEnter={() => focusPoint(key, row)} onFocus={() => focusPoint(key, row)} />; })}</>}</g>; })}</svg><div className="chart-readout" aria-live="polite">{activePoint?.readout ?? "选择数据点查看数值"}</div></div>;
}

function Pipeline({ job }: { job: GenerationJob }) { const currentIndex = pipelineStages.indexOf(job.status); return <div className="pipeline" aria-label="生成周期状态">{pipelineStages.map((stage, index) => <div className={`${index < currentIndex || job.status === "succeeded" ? "done" : ""} ${stage === job.status ? "current" : ""}`} key={stage}><span>{index + 1}</span><strong>{statusLabels[stage]}</strong></div>)}</div>; }
function SnapshotPreviewTable({ snapshot }: { snapshot: Snapshot }) {
  const columns = snapshot.schema;
  const rows = snapshot.preview.slice(0, 25);
  if (columns.length === 0) return <div className="snapshot-preview-empty">当前 Snapshot 没有可展示的字段。</div>;
  return <div className="snapshot-table-shell"><table className="snapshot-table"><caption>前 {rows.length} 行 / 共 {snapshot.rowCount.toLocaleString()} 行 · 只读预览</caption><thead><tr>{columns.map((column, columnIndex) => <th className={columnIndex === 0 ? "snapshot-table-first" : undefined} key={column.name} scope="col" title={column.name}>{column.name}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={`${snapshot.id}-${rowIndex}`}>{columns.map((column, columnIndex) => { const text = formatValue(row[column.name]); const isLong = text.length > 32; return <td className={columnIndex === 0 ? "snapshot-table-first" : undefined} key={`${column.name}-${rowIndex}`}><span className={`snapshot-cell-value ${isLong ? "is-long" : ""}`} title={isLong ? text : undefined} aria-label={`${column.name}：${text}`} tabIndex={isLong ? 0 : undefined}>{text}</span></td>; })}</tr>)}</tbody></table></div>;
}

function SnapshotPreviewModal({ assetName, assetStatus, isOpen, summaries, selectedSnapshotId, snapshot, status, error, onClose, onSelect, onRetry }: { assetName: string; assetStatus: string; isOpen: boolean; summaries: SnapshotSummary[]; selectedSnapshotId: string | null; snapshot: Snapshot | null; status: SnapshotPreviewStatus; error: string | null; onClose: () => void; onSelect: (snapshotId: string) => void; onRetry: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (isOpen) closeButtonRef.current?.focus();
  }, [isOpen]);
  if (!isOpen) return null;
  const selectedSummary = summaries.find((summary) => summary.id === selectedSnapshotId) ?? null;
  return <div className="modal-backdrop snapshot-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal-dialog snapshot-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="snapshot-preview-title" aria-describedby="snapshot-preview-description" onClick={(event) => event.stopPropagation()}><div className="modal-head snapshot-preview-head"><div><div className="eyebrow">DATA SNAPSHOT / READ ONLY</div><h2 id="snapshot-preview-title">查看数据</h2><p id="snapshot-preview-description" className="modal-lead">{assetName} · 仅展示有限行，不会改变生成输入。</p></div><button ref={closeButtonRef} type="button" className="icon-button" aria-label="关闭数据预览" onClick={onClose}>×</button></div><div className="snapshot-preview-layout"><aside className="snapshot-version-panel" aria-label="Snapshot 版本列表"><div className="snapshot-version-heading"><strong>版本</strong><span>{summaries.length} 个</span></div>{status === "loading-list" ? <div className="snapshot-version-state" role="status">读取中…</div> : summaries.length === 0 ? <div className="snapshot-version-state">暂无可用 Snapshot</div> : <div className="snapshot-version-list">{summaries.map((summary) => <button type="button" className={`snapshot-version-item ${summary.id === selectedSnapshotId ? "selected" : ""}`} aria-pressed={summary.id === selectedSnapshotId} key={summary.id} onClick={() => onSelect(summary.id)}><span><strong>v{summary.version}</strong><small>{summary.rowCount.toLocaleString()} 行 · {summary.columnCount} 列</small></span><time>{formatDate(summary.createdAt)}</time></button>)}</div>}</aside><div className="snapshot-preview-content">{status === "error" && <div className="snapshot-preview-error" role="alert"><strong>预览暂时无法读取</strong><span>{error ?? "请稍后重试。"}</span><button type="button" className="secondary-button" onClick={onRetry}>重新加载</button></div>}{status === "loading-detail" && <div className="snapshot-preview-state" role="status"><span className="state-mark pulse-mark" /><strong>正在读取 v{selectedSummary?.version ?? "—"}…</strong></div>}{status === "ready" && !snapshot && <div className="snapshot-preview-state"><strong>{assetStatus === "ready" ? "暂无可用 Snapshot" : `当前状态：${snapshotAssetStatusLabel(assetStatus)}`}</strong><span>处理完成后可重新打开查看数据。</span></div>}{status === "ready" && snapshot && <><div className="snapshot-detail-header"><div><div className="eyebrow">SNAPSHOT / V{snapshot.version}</div><h3>解析数据</h3></div><span className="snapshot-readonly-badge">只读</span></div><dl className="snapshot-metadata"><div><dt>来源文件</dt><dd title={snapshot.sourceName ?? undefined}>{snapshot.sourceName ?? "不可用"}</dd></div><div><dt>类型</dt><dd>{snapshotSourceTypeLabel(snapshot.sourceType)}</dd></div><div><dt>MIME</dt><dd>{snapshot.mimeType ?? "不可用"}</dd></div><div><dt>大小</dt><dd>{formatBytes(snapshot.sizeBytes)}</dd></div><div><dt>创建时间</dt><dd>{formatDate(snapshot.createdAt)}</dd></div></dl><div className="snapshot-table-note">字段顺序来自此 Snapshot 的 schema；空值显示为 `—`，长值可聚焦查看完整内容。</div><SnapshotPreviewTable snapshot={snapshot} /></>}</div></div><div className="modal-footer snapshot-preview-footer"><p>历史 Snapshot 仅用于核对；下一次生成仍使用最新版本。</p><div><button type="button" className="secondary-button" onClick={onClose}>关闭</button></div></div></section></div>;
}

function ProjectProfile({ project }: { project: Project | null }) {
  if (!project) return null;
  const visualTemplateLabel = visualTemplateOptions.find((option) => option.value === project.visualTemplate)?.label ?? "—";
  return <details className="project-profile-banner"><summary><span className="project-profile-summary"><span className="eyebrow">项目档案</span><strong>{project.clientName || "客户待补充"}</strong></span><span className="project-profile-toggle">查看背景 <span>⌄</span></span></summary><div className="project-profile-details"><p>{project.objective || "尚未填写项目目标。"}</p><div className="project-profile-facts"><span><small>受众</small><b>{project.audience ? projectAudienceLabels[project.audience] : "—"}</b></span><span><small>Visual Template</small><b>{visualTemplateLabel}</b></span></div></div></details>;
}

function generationDecisionForClarification(job: GenerationJob | null, content: string): GenerationDecisionPayload | undefined {
  if (!job || job.status !== "needs_clarification") return undefined;
  const proposal = job.clarificationProposal;
  const selectedCandidate = proposal?.candidates.find((candidate) => candidate.label === content);
  if (proposal?.target === "x_field" && selectedCandidate) {
    return {
      action: proposal.recommendedCandidate?.value === selectedCandidate.value ? "accept_recommendation" : "select_candidate",
      parentJobId: job.id,
      questionCode: proposal.code,
      target: "x_field",
      selectedValue: selectedCandidate.value
    };
  }
  return { action: "adjust_direction", parentJobId: job.id, questionCode: proposal?.code, text: content };
}

function ClarificationDecisionDetails({ job, onStop }: { job: GenerationJob; onStop: () => void }) {
  const proposal = job.clarificationProposal;
  return <section className="clarification-details" aria-label="澄清依据与操作">
    <div className="clarification-details-head"><div><div className="eyebrow">READINESS GATE / EVIDENCE</div><strong>候选字段只是建议，不代表系统已判定正确</strong></div><span>本次周期有效</span></div>
    {proposal && <div className="clarification-detail" key={proposal.code}>
      <div className="clarification-detail-title"><span>{proposal.stage} · {proposal.severity === "warning" ? "提示" : "需要确认"}</span>{proposal.recommendedCandidate && <strong>建议：{proposal.recommendedCandidate.label}</strong>}</div>
      <p>{proposal.question}</p>
      <div className="clarification-evidence">{proposal.diagnostic.evidence.map((item) => <span key={`${proposal.code}-${item.label}`}><b>{item.label}</b>{item.value}</span>)}{proposal.candidates.map((candidate) => <span key={`${proposal.code}-${candidate.value}`}><b>{candidate.source === "transform_output" ? "候选" : "候选 / 需变换"}</b>{candidate.label}</span>)}</div>
    </div>}
    <div className="clarification-details-actions"><span>可以直接在下方补充或修改分析方向；文本仍会重新经过字段、指标和权限校验。</span><button type="button" className="secondary-button clarification-stop" onClick={onStop}>停止生成</button></div>
  </section>;
}

function CancelledGenerationNotice() {
  return <section className="cancelled-stage" role="status" aria-label="生成已停止"><div className="eyebrow">GENERATION CYCLE / STOPPED</div><h2>本次生成已停止</h2><p>没有创建新的 Evidence Block，也没有把本次选择写入长期记忆或项目规范。</p></section>;
}

export default function Home() {
  const uploadTargetAssetRef = useRef<string | null>(null);
  const projectRoute = useProjectContext();
  const { logout } = useAuthActions();
  const queryClient = useQueryClient();
  const { data: session } = useAuthSession();
  const authUserId = session?.authenticated ? session.userId : null;
  const [isRetrying, setIsRetrying] = useState(false);
  async function cancelGeneration() { if (!job || job.status !== "needs_clarification") return; setError(null); try { const payload = await apiFetch<{ job: GenerationJob }>(`/api/v1/generation-jobs/${job.id}/cancel`, { method: "POST", headers: jsonHeaders }); setJob({ ...payload.job, revision: job.revision }); setNotice("本次 Generation Cycle 已停止；没有写入长期记忆或项目规范。"); } catch (cancelError) { setError(formatApiError(cancelError, "无法停止生成任务")); } }
  async function retryGeneration() { if (!job || job.status !== "failed" || isRetrying) return; setIsRetrying(true); setError(null); try { const payload = await apiFetch<{ job: GenerationJob; reused: boolean }>(`/api/v1/generation-jobs/${job.id}/retry`, { method: "POST", headers: jsonHeaders }); setJob({ ...payload.job, revision: job.revision }); setNotice(payload.reused ? "生成任务已在处理中。" : "已重新排队，正在再次生成。"); } catch (retryError) { setError(formatApiError(retryError, "无法重试生成任务")); } finally { setIsRetrying(false); } }
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [composer, setComposer] = useState("");
  const [projectForm, setProjectForm] = useState({ name: "", clientName: "", objective: "", audience: "client_presentation" as ProjectAudience, visualTemplate: "consulting-neutral" as VisualTemplate });
  const [metricForm, setMetricForm] = useState({ name: "销售额", meaning: "客户订单的销售金额总和。", formula: "sum(销售额)", unit: "人民币", timeRule: "按自然月聚合", filterRule: "" });
  const [briefForm, setBriefForm] = useState({ businessQuestion: "", audience: "", timeRange: "", timeGrain: "", outputFormat: "evidence_block" });
  const [editor, dispatchEditor] = useReducer(chartEditorReducer, initialChartEditorState);
  const [modelCredential, setModelCredential] = useState<ModelCredentialStatus | null>(null);
  const [modelApiKey, setModelApiKey] = useState("");
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [showMetricModal, setShowMetricModal] = useState(false);
  const [showBriefModal, setShowBriefModal] = useState(false);
  const [showModelCredentialModal, setShowModelCredentialModal] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const [leftRailOpen, setLeftRailOpen] = useState(true);
  const [rightRailOpen, setRightRailOpen] = useState(true);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [isBooting, setIsBooting] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingBrief, setIsSavingBrief] = useState(false);
  const [isSavingEditor, setIsSavingEditor] = useState(false);
  const [isSavingModelCredential, setIsSavingModelCredential] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const snapshotPreview = useSnapshotPreview();

  const projectServerState = useProjectServerState(authUserId, projectId, conversationId);
  const conversations = (projectServerState.conversations.data ?? []) as Conversation[];
  const messages = (projectServerState.messages.data ?? []) as ConversationMessage[];
  const assets = (projectServerState.assets.data ?? []) as Asset[];
  const metric = (projectServerState.metric.data ?? null) as MetricDefinition | null;
  const brief = (projectServerState.brief.data ?? null) as AnalysisBrief | null;
  const memory = (projectServerState.memory.data ?? { project: [], workspace: [], conflicts: [] }) as MemoryContext;
  const evidence = (projectServerState.evidence.data ?? []) as EvidenceRecord[];
  const theme = projectServerState.theme.data?.preset ?? "economist";
  const isLoadingProject = Boolean(projectId && projectServerState.isPending);
const project = useMemo(() => projects.find((item) => item.id === projectId) ?? null, [projects, projectId]); const selectedAsset = useMemo(() => assets.find((item) => item.id === selectedAssetId) ?? assets[0] ?? null, [assets, selectedAssetId]); const selectedConversation = useMemo(() => conversations.find((item) => item.id === conversationId) ?? null, [conversations, conversationId]); const [hideActiveEvidence, setHideActiveEvidence] = useState(false); const activeEvidence = useMemo(() => { if (hideActiveEvidence) return null; const scoped = evidence.filter((item) => item.block.conversationId === conversationId); if (projectRoute.revisionId) return scoped.find((item) => item.revision.id === projectRoute.revisionId) ?? scoped[0] ?? null; return scoped[0] ?? null; }, [evidence, conversationId, hideActiveEvidence, projectRoute.revisionId]); const activeRevision = activeEvidence?.revision ?? null; const activeSpec = activeEvidence?.revision.flintSpec ?? job?.flintSpec ?? null; const activeRows = rowsForEvidence(activeEvidence); const qualityWarnings = useMemo(() => selectedAsset?.latestSnapshot?.schema.filter((column) => column.nullCount > 0).map((column) => ({ code: "NULL_VALUES", message: `${column.name} 有 ${column.nullCount.toLocaleString()} 个缺失值，生成未将缺失月份静默补为 0。`, severity: "warning" as const, field: column.name })) ?? [], [selectedAsset]); const isJobActive = Boolean(job && !["succeeded", "failed", "needs_clarification", "cancelled"].includes(job.status)); const hasSnapshot = Boolean(selectedAsset?.latestSnapshot && selectedAsset.status === "ready"); const hasMetric = metric?.status === "confirmed"; const hasBrief = Boolean(brief?.status === "confirmed" && brief.businessQuestion && brief.audience && brief.timeRange && brief.timeGrain && brief.outputFormat); const canGenerate = Boolean(projectId && hasSnapshot && hasMetric && hasBrief && conversationId && !isJobActive); const canManageModelCredential = workspace?.role === "owner" || workspace?.role === "admin"; const availableFields = activeSpec ? Object.keys(activeSpec.data.values[0] ?? {}) : []; const sourceFields = selectedAsset?.latestSnapshot?.schema.map((column) => column.name) ?? availableFields;
  const reviewComments = useReviewComments(activeRevision?.id ?? null, { onClearError: () => setError(null), onError: setError, onNotice: setNotice });
  const pluginTraceState = usePluginTrace(activeRevision?.id ?? null);
  useEffect(() => {
    if (!projectRoute.ready || !activeRevision?.id || projectRoute.revisionId === activeRevision.id) return;
    projectRoute.setRevisionId(activeRevision.id);
  }, [activeRevision?.id, projectRoute.ready, projectRoute.revisionId, projectRoute.setRevisionId]);

  const selectProject = useCallback((nextProjectId: string | null) => {
    setProjectId(nextProjectId);
    projectRoute.setContext({ projectId: nextProjectId, conversationId: null, revisionId: null });
  }, [projectRoute.setContext]);
  const selectConversation = useCallback((nextConversationId: string | null) => {
    setConversationId(nextConversationId);
    projectRoute.setConversationId(nextConversationId);
  }, [projectRoute.setConversationId]);
  const loadProjects = useCallback(async () => { const payload = await queryClient.fetchQuery({ queryKey: projectQueryKeys.list(authUserId), queryFn: fetchProjectList }); setWorkspace(payload.workspace); setProjects(payload.projects as Project[]); return payload as { workspace: Workspace | null; projects: Project[] }; }, [authUserId, queryClient]);
  const loadEvidence = useCallback(async (nextProjectId: string, options: { signal?: AbortSignal; shouldApply?: () => boolean } = {}) => {
    const data = await fetchEvidenceList(nextProjectId, { signal: options.signal });
    if (!options.shouldApply || options.shouldApply()) queryClient.setQueryData(evidenceQueryKeys.list(authUserId, nextProjectId), data);
    return data;
  }, [authUserId, queryClient]);
  const loadConversations = useCallback(async (nextProjectId: string, options: { signal?: AbortSignal; shouldApply?: () => boolean } = {}) => {
    const data = await fetchConversationList(nextProjectId, { signal: options.signal });
    if (!options.shouldApply || options.shouldApply()) queryClient.setQueryData(conversationQueryKeys.list(authUserId, nextProjectId), data);
    return data;
  }, [authUserId, queryClient]);

  useEffect(() => { if (!workspace?.id || !canManageModelCredential) { setModelCredential(null); return; } let cancelled = false; void apiFetch<{ credential: ModelCredentialStatus }>(`/api/v1/workspaces/${workspace.id}/model-credential`, { headers: devHeaders }).then((payload) => { if (!cancelled) setModelCredential(payload.credential); }).catch((loadError) => { if (!cancelled) setError(formatApiError(loadError, "无法读取模型配置状态")); }); return () => { cancelled = true; }; }, [canManageModelCredential, workspace?.id]);
  useEffect(() => { if (!snapshotPreview.isOpen) return; const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") snapshotPreview.close(); }; window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); }, [snapshotPreview.close, snapshotPreview.isOpen]);

  useEffect(() => { let cancelled = false; async function boot() { if (!projectRoute.ready) return; try { setIsBooting(true); const bootstrap = process.env.NODE_ENV === "production" ? null : await apiFetch<{ workspace: Workspace; project: Project }>("/api/v1/dev/bootstrap", { method: "POST", headers: jsonHeaders, body: "{}" }); const payload = await loadProjects(); if (cancelled) return; const urlProject = projectRoute.projectId && payload.projects.some((item) => item.id === projectRoute.projectId) ? projectRoute.projectId : null; const remembered = window.localStorage.getItem("langreport-project-id"); const nextProjectId = urlProject ?? payload.projects.find((item) => item.id === remembered)?.id ?? bootstrap?.project.id ?? payload.projects[0]?.id ?? null; setProjectId(nextProjectId); if (projectRoute.projectId !== nextProjectId) projectRoute.setContext({ projectId: nextProjectId, conversationId: null, revisionId: null }); } catch (bootError) { if (!cancelled) setError(formatApiError(bootError, "无法连接 LangReport API")); } finally { if (!cancelled) setIsBooting(false); } } void boot(); return () => { cancelled = true; }; }, [loadProjects, projectRoute.projectId, projectRoute.ready, projectRoute.setContext]);
  useEffect(() => { if (!projectRoute.ready || !projectRoute.projectId || projectRoute.projectId === projectId || !projects.some((item) => item.id === projectRoute.projectId)) return; setProjectId(projectRoute.projectId); }, [projectId, projectRoute.projectId, projectRoute.ready, projects]);
  useEffect(() => {
    if (!projectId) {
      setSelectedAssetId(null);
      setJob(null);
      return;
    }
    window.localStorage.setItem("langreport-project-id", projectId);
    setJob(null);
  }, [projectId]);

  useEffect(() => {
    if (!projectId || projectServerState.assets.isPending) return;
    if (!selectedAssetId || !assets.some((asset) => asset.id === selectedAssetId)) setSelectedAssetId(assets[0]?.id ?? null);
  }, [assets, projectId, projectServerState.assets.isPending, selectedAssetId]);

  useEffect(() => {
    if (!projectId || projectServerState.conversations.isPending) return;
    const rememberedConversation = window.localStorage.getItem(`langreport-conversation-${projectId}`);
    const routeConversation = projectRoute.conversationId && conversations.some((item) => item.id === projectRoute.conversationId) ? projectRoute.conversationId : null;
    const nextConversationId = routeConversation ?? conversations.find((item) => item.id === rememberedConversation)?.id ?? conversations[0]?.id ?? null;
    if (conversationId !== nextConversationId) selectConversation(nextConversationId);
    const latest = evidence[0];
    if (latest?.job && !["succeeded", "failed", "cancelled"].includes(latest.job.status)) setJob(latest.job);
  }, [conversationId, conversations, evidence, projectId, projectRoute.conversationId, projectServerState.conversations.isPending, selectConversation]);
  useEffect(() => {
    setHideActiveEvidence(false);
    if (conversationId && projectId) window.localStorage.setItem(`langreport-conversation-${projectId}`, conversationId);
  }, [conversationId, projectId]);

  useEffect(() => {
    if (projectServerState.error) setError(formatApiError(projectServerState.error, "无法读取项目数据"));
  }, [projectServerState.error]);
  const handleGenerationTerminal = useCallback(async (snapshot: GenerationJobStatusSnapshot, isCurrent: () => boolean, signal: AbortSignal) => {
    const payload = await apiFetch<{ job: GenerationJob; revision: GenerationJob["revision"] }>(`/api/v1/generation-jobs/${snapshot.job.id}`, { headers: devHeaders, signal });
    if (!isCurrent()) return;
    if (payload.job.status === "succeeded" && projectId) {
      setHideActiveEvidence(false);
      await Promise.all([loadEvidence(projectId, { signal, shouldApply: isCurrent }), loadConversations(projectId, { signal, shouldApply: isCurrent })]);
      if (!isCurrent()) return;
      if (conversationId) {
        const messagePayload = await fetchConversationMessages(conversationId, { signal });
        if (!isCurrent()) return;
        queryClient.setQueryData(conversationQueryKeys.messages(authUserId, conversationId), messagePayload);
      }
      if (!isCurrent()) return;
      setJob({ ...payload.job, revision: payload.revision });
      setNotice(payload.job.operation === "edit" ? "新的草稿版本已保存。" : "证据模块已生成。");
    } else if (payload.job.status === "needs_clarification" && conversationId) {
      const messagePayload = await fetchConversationMessages(conversationId, { signal });
      if (!isCurrent()) return;
      queryClient.setQueryData(conversationQueryKeys.messages(authUserId, conversationId), messagePayload);
      setJob({ ...payload.job, revision: payload.revision });
      setNotice("生成需要澄清。请在下方回答问题，系统会创建新的 Generation Cycle。");
    } else {
      setJob({ ...payload.job, revision: payload.revision });
    }
  }, [authUserId, conversationId, loadConversations, loadEvidence, projectId, queryClient]);
  const generationRequest = useCallback((path: string, init: RequestInit) => apiRawRequest(path, init), []);
  const updateGenerationStatus = useCallback((snapshot: GenerationJobStatusSnapshot) => {
    setJob((current) => current ? {
      ...current,
      status: snapshot.job.status,
      operation: (snapshot.job.operation as GenerationJob["operation"]) ?? current.operation,
      attemptCount: snapshot.job.attemptCount,
      repairCount: snapshot.job.repairCount,
      errorCode: snapshot.job.errorCode,
      errorMessage: snapshot.job.errorMessage,
      clarificationProposal: snapshot.job.clarificationProposal as GenerationProposal | null,
      statusVersion: snapshot.job.statusVersion,
      statusChangedAt: snapshot.job.statusChangedAt,
      revision: snapshot.revision as GenerationJob["revision"] ?? current.revision
    } : current);
  }, []);
  const handleGenerationError = useCallback((watchError: unknown) => {
    setError(formatApiError(watchError, "无法读取生成状态"));
  }, []);
  const generationState = useGenerationJob({
    jobId: job?.id ?? null,
    enabled: isJobActive,
    afterVersion: job?.statusVersion,
    headers: devHeaders,
    request: generationRequest,
    onStatus: updateGenerationStatus,
    onTerminal: handleGenerationTerminal,
    onError: handleGenerationError
  });

  async function createConversation(): Promise<string | null> {
    if (!projectId) return null;
    try {
      const payload = await apiFetch<{ conversation: Conversation }>(`/api/v1/projects/${projectId}/conversations`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ title: "新的分析对话" }) });
      queryClient.setQueryData<Conversation[]>(conversationQueryKeys.list(authUserId, projectId), (current = []) => [payload.conversation, ...current]);
      selectConversation(payload.conversation.id);
      return payload.conversation.id;
    } catch (createError) {
      setError(formatApiError(createError, "无法创建对话"));
      return null;
    }
  }
  async function createProject() { if (!projectForm.name.trim() || !projectForm.clientName.trim() || !projectForm.objective.trim() || isCreatingProject) return; setIsCreatingProject(true); setError(null); try { const payload = await apiFetch<{ project: Project }>("/api/v1/projects", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ name: projectForm.name.trim(), clientName: projectForm.clientName.trim(), objective: projectForm.objective.trim(), audience: projectForm.audience, visualTemplate: projectForm.visualTemplate }) }); await queryClient.invalidateQueries({ queryKey: projectQueryKeys.all }); const nextProjects = await loadProjects(); setProjects(nextProjects.projects); selectProject(payload.project.id); setProjectForm({ name: "", clientName: "", objective: "", audience: "client_presentation", visualTemplate: "consulting-neutral" }); setShowProjectModal(false); setNotice(`已创建项目「${payload.project.name}」。`); } catch (createError) { setError(formatApiError(createError, "无法创建项目")); } finally { setIsCreatingProject(false); } }
  async function saveWorkspaceModelCredential() { if (!workspace?.id || !canManageModelCredential || !modelApiKey.trim() || isSavingModelCredential) return; setIsSavingModelCredential(true); setError(null); try { const payload = await apiFetch<{ credential: ModelCredentialStatus }>(`/api/v1/workspaces/${workspace.id}/model-credential`, { method: "PUT", headers: jsonHeaders, body: JSON.stringify({ apiKey: modelApiKey.trim() }) }); setModelCredential(payload.credential); setModelApiKey(""); setShowModelCredentialModal(false); setNotice("百炼 API Key 已加密保存；后续生成任务会由 Worker 安全使用。"); } catch (saveError) { setError(formatApiError(saveError, "无法保存百炼 API Key")); } finally { setIsSavingModelCredential(false); } }
  async function sendMessage() {
    const content = composer.trim();
    if (!content || !projectId || isSending || isJobActive) return;
    setIsSending(true);
    setError(null);
    setNotice(null);
    try {
      const nextConversationId = conversationId ?? await createConversation();
      if (!nextConversationId) return;
      const shouldGenerate = Boolean(hasSnapshot && hasMetric && hasBrief);
      const generationDecision = generationDecisionForClarification(job, content);
      const clientRequestId = crypto.randomUUID();
      const payload = await apiFetch<{ message?: ConversationMessage; messages?: ConversationMessage[]; job?: GenerationJob | null; nextAction?: GenerationNextAction }>(`/api/v1/conversations/${nextConversationId}/messages`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ content, generate: shouldGenerate, dataAssetId: selectedAsset?.id, metricDefinitionId: metric?.id, renderer: "vega-lite", clientRequestId, generationDecision }) });
      const incomingMessages = payload.messages ?? (payload.message ? [payload.message] : []);
      queryClient.setQueryData<ConversationMessage[]>(conversationQueryKeys.messages(authUserId, nextConversationId), (current = []) => {
        const next = current.filter((message) => Boolean(message?.id));
        const knownIds = new Set(next.map((message) => message.id));
        for (const message of incomingMessages) {
          if (!message?.id || knownIds.has(message.id)) continue;
          next.push(message);
          knownIds.add(message.id);
        }
        return next;
      });
      await loadConversations(projectId);
      setHideActiveEvidence(true);
      setComposer("");
      if (payload.job) {
        setJob({ ...payload.job, revision: null });
        setNotice(payload.nextAction?.message ?? "Generation Cycle 已排队。");
      } else {
        setJob(null);
        setNotice(shouldGenerate ? payload.nextAction?.message ?? "Generation Cycle 已提交。" : "问题已记录。补充 Brief、指标和数据后即可生成 Evidence Block。");
      }
    } catch (sendError) {
      setError(formatApiError(sendError, "提交问题失败"));
    } finally {
      setIsSending(false);
    }
  }
  async function confirmMetric() {
    if (!projectId || !metricForm.name.trim()) return;
    try {
      const payload = await apiFetch<{ definition: MetricDefinition }>(`/api/v1/projects/${projectId}/metric-definitions`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ ...metricForm, filterRule: metricForm.filterRule || undefined, conversationId: conversationId ?? undefined }) });
      queryClient.setQueryData(projectResourceQueryKeys.metric(authUserId, projectId), payload.definition);
      setShowMetricModal(false);
      setNotice(`已确认「${payload.definition.name}」口径 v${payload.definition.version}。`);
      if (conversationId) {
        const messagePayload = await apiFetch<{ messages: ConversationMessage[] }>(`/api/v1/conversations/${conversationId}/messages`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ content: `确认指标口径：${payload.definition.name} = ${payload.definition.formula}`, assistantContent: `已确认指标口径 v${payload.definition.version}。` }) });
        queryClient.setQueryData<ConversationMessage[]>(conversationQueryKeys.messages(authUserId, conversationId), (current = []) => [...current, ...messagePayload.messages]);
      }
    } catch (metricError) {
      setError(formatApiError(metricError, "无法保存指标口径"));
    }
  }
  function openBriefModal() { setBriefForm(brief ? { businessQuestion: brief.businessQuestion, audience: brief.audience, timeRange: brief.timeRange ?? "", timeGrain: brief.timeGrain ?? "", outputFormat: brief.outputFormat } : { businessQuestion: composer.trim(), audience: "", timeRange: "", timeGrain: "", outputFormat: "evidence_block" }); setShowBriefModal(true); }
  async function saveBrief(confirm: boolean) {
    if (!projectId || isSavingBrief) return;
    setIsSavingBrief(true);
    setError(null);
    try {
      const targetConversationId = conversationId ?? await createConversation();
      if (!targetConversationId) return;
      let nextBrief: AnalysisBrief;
      if (!brief) {
        const payload = await apiFetch<{ brief: AnalysisBrief }>(`/api/v1/projects/${projectId}/analysis-brief`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ ...briefForm, conversationId: targetConversationId, status: confirm ? "confirmed" : "draft" }) });
        nextBrief = payload.brief;
      } else {
        const draft = await apiFetch<{ brief: AnalysisBrief }>(`/api/v1/projects/${projectId}/analysis-brief`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ ...briefForm, status: "draft" }) });
        nextBrief = draft.brief;
        if (confirm) {
          const payload = await apiFetch<{ brief: AnalysisBrief }>(`/api/v1/projects/${projectId}/analysis-brief`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ status: "confirmed" }) });
          nextBrief = payload.brief;
        }
      }
      queryClient.setQueryData(projectResourceQueryKeys.brief(authUserId, projectId), nextBrief);
      setShowBriefModal(false);
      setNotice(nextBrief.status === "confirmed" ? "Analysis Brief 已确认，可作为生成依据。" : "Analysis Brief 已保存为草稿。");
    } catch (briefError) {
      setError(formatApiError(briefError, "无法保存 Analysis Brief"));
    } finally {
      setIsSavingBrief(false);
    }
  }
  function openSnapshotPreview() { if (!selectedAsset?.id || !selectedAsset.latestSnapshot) return; void snapshotPreview.open(selectedAsset.id); }
  function openFilePicker(targetAssetId: string | null = null) { uploadTargetAssetRef.current = targetAssetId; fileInputRef.current?.click(); }
  async function uploadFile(file: File) {
    if (!projectId) return;
    const targetAssetId = uploadTargetAssetRef.current;
    setIsUploading(true);
    setError(null);
    try {
      const targetConversationId = conversationId ?? await createConversation();
      if (!targetConversationId) return;
      const formData = new FormData();
      formData.append("conversationId", targetConversationId);
      formData.append("file", file);
      const path = targetAssetId
        ? `/api/v1/projects/${projectId}/data-assets/${targetAssetId}/snapshots/upload`
        : `/api/v1/projects/${projectId}/data-assets/upload`;
      const payload = await apiFetch<{ asset: Asset }>(path, { method: "POST", headers: devHeaders, body: formData });
      if (targetAssetId) {
        queryClient.setQueryData<Asset[]>(dataAssetQueryKeys.list(authUserId, projectId), (current = []) => current.map((item) => item.id === payload.asset.id ? payload.asset : item));
        setNotice(`已将「${payload.asset.name}」更新为数据快照 v${payload.asset.latestSnapshot?.version ?? "—"}。`);
      } else {
        queryClient.setQueryData<Asset[]>(dataAssetQueryKeys.list(authUserId, projectId), (current = []) => [payload.asset, ...current]);
        setNotice(`已将「${payload.asset.name}」创建为数据快照 v${payload.asset.latestSnapshot?.version ?? 1}。`);
      }
      setSelectedAssetId(payload.asset.id);
    } catch (uploadError) {
      setError(formatApiError(uploadError, "文件上传失败"));
    } finally {
      setIsUploading(false);
      uploadTargetAssetRef.current = null;
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }
  async function pasteData(content: string, name: string) { if (!projectId || !content.trim()) return; setIsUploading(true); setError(null); try { const targetConversationId = conversationId ?? await createConversation(); if (!targetConversationId) return; const payload = await apiFetch<{ asset: Asset }>(`/api/v1/projects/${projectId}/data-assets/paste`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ name, content, conversationId: targetConversationId }) }); queryClient.setQueryData<Asset[]>(dataAssetQueryKeys.list(authUserId, projectId), (current = []) => [payload.asset, ...current]); setSelectedAssetId(payload.asset.id); setNotice(`已将「${payload.asset.name}」归档到当前对话，并创建数据快照。`); } catch (pasteError) { setError(formatApiError(pasteError, "粘贴数据失败")); } finally { setIsUploading(false); } }
  function openEditor() { if (!activeEvidence || !activeRevision || activeRevision.status === "approved" || activeRevision.status === "archived") return; dispatchEditor({ type: "reset", value: editorStateFromRevision({ flintSpec: activeEvidence.revision.flintSpec, transformPlan: activeRevision.transformPlan }) }); setShowEditor(true); }
  async function saveEditor() { if (!activeEvidence || !activeRevision || !editor.title.trim() || isSavingEditor) return; setIsSavingEditor(true); setError(null); try { const transformPlan = buildEditorTransformPlan(activeRevision.transformPlan, selectedAsset?.latestSnapshot?.schema ?? [], editor); const aggregate = transformPlan.steps?.find((step) => step.kind === "aggregate"); const aggregateMeasure = aggregate?.measures?.[0]; const yField = aggregateMeasure?.column === editor.yField ? aggregateMeasure.outputColumn ?? editor.yField : editor.yField; const encodings: FlintSpec["chartSpec"]["encodings"] = { x: { field: editor.xField, type: activeEvidence.revision.flintSpec.chartSpec.encodings.x?.type ?? "nominal" }, y: { field: yField, type: "quantitative" } }; if (editor.seriesField) encodings.color = { field: editor.seriesField, type: "nominal" }; const annotations = editor.annotation.split(/\r?\n/).map((text) => text.trim()).filter(Boolean).map((text) => ({ text })); const payload = await apiFetch<{ job: GenerationJob }>(`/api/v1/chart-artifacts/${activeEvidence.artifact.id}/revisions`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ operation: "edit", baseRevisionId: activeRevision.id, patch: { title: editor.title.trim(), chartType: editor.chartType, encodings, transformPlan, annotations, showValues: editor.showValues, showLegend: editor.showLegend } }) }); setJob({ ...payload.job, revision: null }); setShowEditor(false); setNotice("编辑任务已排队；Worker 将基于同一 Data Snapshot 生成新的 Draft Revision。"); } catch (editError) { setError(formatApiError(editError, "无法创建新的版本")); } finally { setIsSavingEditor(false); } }
  async function transitionRevision(action: "submit" | "approve" | "request-changes") {
    if (!activeRevision) return;
    if (action === "request-changes" && !reviewComments.note.trim()) {
      setError("请先填写审核意见，再提交“要求修改”。");
      return;
    }
    try {
      const payload = await apiFetch<{ revision: Revision }>(`/api/v1/chart-revisions/${activeRevision.id}/${action}`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ expectedStatus: activeRevision.status, note: reviewComments.note.trim() || undefined }) });
      queryClient.setQueryData<EvidenceRecord[]>(evidenceQueryKeys.list(authUserId, projectId), (current = []) => current.map((item) => item.revision.id === payload.revision.id ? { ...item, revision: payload.revision, block: { ...item.block, status: payload.revision.status } } : item));
      reviewComments.clearNote();
      setNotice(`版本 R${payload.revision.revision} 已更新为 ${revisionLabels[payload.revision.status]}`);
    } catch (transitionError) {
      setError(formatApiError(transitionError, "无法更新审核状态"));
    }
  }

  return <div className={`app-shell ${leftRailOpen ? "left-open" : "left-collapsed"} ${rightRailOpen ? "right-open" : "right-collapsed"}`} data-generation-phase={generationState.phase} onClick={() => { setProjectMenuOpen(false); setConversationMenuOpen(false); }}>
    <header className="topbar" onClick={(event) => event.stopPropagation()}>
      <div className="brand-lockup"><span className="brand-mark">L/</span><span className="brand-name">LangReport</span></div>
      <div className="top-selectors">
        <ProjectSelector project={project} projects={projects} projectId={projectId} isBooting={isBooting} menuOpen={projectMenuOpen} onToggleMenu={() => { setProjectMenuOpen((open) => !open); setConversationMenuOpen(false); }} onSelect={(nextProjectId) => { selectProject(nextProjectId); setProjectMenuOpen(false); }} onOpenCreate={() => { setProjectForm({ name: "", clientName: "", objective: "", audience: "client_presentation", visualTemplate: "consulting-neutral" }); setShowProjectModal(true); setProjectMenuOpen(false); }} />
        <ConversationSelector conversation={selectedConversation} conversations={conversations} conversationId={conversationId} menuOpen={conversationMenuOpen} onToggleMenu={() => { setConversationMenuOpen((open) => !open); setProjectMenuOpen(false); }} onSelect={(nextConversationId) => { selectConversation(nextConversationId); setConversationMenuOpen(false); }} onCreate={() => { void createConversation(); setConversationMenuOpen(false); }} />
      </div>
      <div className="topbar-actions"><span className={`connection-dot ${error ? "attention" : ""}`} aria-label={error ? "有错误" : "接口正常"} />{canManageModelCredential && <button type="button" className="plugin-link" onClick={() => setShowModelCredentialModal(true)}>模型设置</button>}<a className="plugin-link" href="/plugins">插件</a><button type="button" className="plugin-link" onClick={() => void logout()}>退出</button><button type="button" className="rail-toggle desktop-only" aria-label={leftRailOpen ? "隐藏对话历史" : "显示对话历史"} onClick={() => setLeftRailOpen((open) => !open)}>{leftRailOpen ? "‹" : "›"}</button><button type="button" className="rail-toggle desktop-only" aria-label={rightRailOpen ? "隐藏依据面板" : "显示依据面板"} onClick={() => setRightRailOpen((open) => !open)}>{rightRailOpen ? "›" : "‹"}</button><button type="button" className="mobile-inspector-button" aria-label="打开项目依据" onClick={() => setMobileInspectorOpen(true)}>☷</button></div>
    </header>
    <PluginTrace state={pluginTraceState} revision={activeRevision?.revision} /><ProjectProfile project={project} />

    <div className="workspace-grid">
<aside className="history-rail" aria-label="对话历史"><ConversationHistoryRail conversations={conversations} evidence={evidence} conversationId={conversationId} isLoading={isLoadingProject} revisionLabels={revisionLabels} onSelect={selectConversation} onCreate={() => void createConversation()} /><DataAssetRail selectedAsset={selectedAsset} isUploading={isUploading} isBooting={isBooting} onPrepareUpload={() => { uploadTargetAssetRef.current = null; }} onUploadFile={uploadFile} onOpenFilePicker={openFilePicker} onUseSample={() => pasteData(sampleCsv, "sales-sample.csv")} /></aside><DataAssetFileInput fileInputRef={fileInputRef} isUploading={isUploading} isBooting={isBooting} onUploadFile={uploadFile} />

      <main className="workspace-main">
        {!isLoadingProject && job?.status === "needs_clarification" && <ClarificationDecisionDetails job={job} onStop={() => void cancelGeneration()} />}
        {!isLoadingProject && job?.status === "cancelled" && <CancelledGenerationNotice />}
        <div className="canvas-header"><div className="canvas-title"><div className="eyebrow">{activeEvidence ? `证据模块 / R${activeRevision?.revision}` : isJobActive ? "生成周期" : "分析"}</div><h1>{activeEvidence?.block.title ?? selectedConversation?.title ?? "新的分析"}</h1></div><div className="canvas-header-actions"><div className="stage-rail"><span className={`stage-step ${hasSnapshot ? "complete" : ""}`}><i />数据</span><span className={`stage-step ${hasMetric ? "complete" : ""}`}><i />指标</span><span className={`stage-step ${hasBrief ? "complete" : ""}`}><i />简报</span><span className={`stage-step ${activeEvidence ? "complete" : ""}`}><i />证据</span></div>{selectedAsset?.status === "ready" && <button type="button" className="secondary-button" onClick={() => openFilePicker(selectedAsset.id)} disabled={isUploading || isBooting}>更新当前数据</button>}<button type="button" className="inspector-trigger mobile-only" onClick={() => setMobileInspectorOpen(true)}>依据</button></div></div>{error && <div className="alert error-alert" role="alert"><strong>错误</strong><span>{error}</span><button type="button" onClick={() => setError(null)}>×</button></div>}{notice && <div className="alert notice-alert" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>×</button></div>}
        {!isLoadingProject && <div className="brief-gate" role="status"><span className={hasBrief ? "ready" : "pending"}>{hasBrief ? "✓" : "!"}</span><div><strong>{hasBrief ? "Analysis Brief 已确认" : "生成前需要确认 Analysis Brief"}</strong><small>{hasBrief ? `${brief?.audience} · ${brief?.timeRange} · ${brief?.timeGrain}` : "业务问题、受众、时间范围、时间粒度和交付形式均为必填。"}</small></div><button type="button" className="secondary-button" onClick={openBriefModal}>{brief ? "编辑简报" : "填写简报"}</button></div>}
        <AnalysisBriefForm isOpen={showBriefModal} hasExistingBrief={Boolean(brief)} value={briefForm} isSaving={isSavingBrief} onChange={(patch) => setBriefForm((current) => ({ ...current, ...patch }))} onClose={() => setShowBriefModal(false)} onSave={(confirm) => void saveBrief(confirm)} />
<section className={`workbench-canvas ${activeEvidence ? "has-evidence" : "no-evidence"}`} aria-label="证据画布">{isLoadingProject && <div className="canvas-state"><span className="state-mark pulse-mark" /><strong>载入中</strong></div>}{!isLoadingProject && job && isJobActive && <div className="job-stage"><div className="job-stage-head"><div><div className="eyebrow">生成周期</div><h2>{statusLabels[job.status] ?? job.status}</h2></div><span className="status-dot" /></div><Pipeline job={job} /></div>}{!isLoadingProject && job?.status === "needs_clarification" && <div className="clarification-stage" role="status"><div className="eyebrow">需要澄清</div><h2>请补充分析约束</h2><p>当前生成没有创建图表。回答以下问题后，将创建新的 Generation Cycle。</p><div className="clarification-list">{job.clarificationProposal && <div className="clarification-question" key={job.clarificationProposal.code}><strong>{job.clarificationProposal.question}</strong><span>{job.clarificationProposal.reason}</span>{job.clarificationProposal.candidates.length > 0 && <div className="clarification-options">{job.clarificationProposal.candidates.map((candidate) => <button type="button" className="clarification-option" key={candidate.value} onClick={() => { setComposer(candidate.label); composerRef.current?.focus(); }}>{candidate.label}</button>)}</div>}</div>}</div><button type="button" className="secondary-button" onClick={() => composerRef.current?.focus()}>在下方回答</button></div>}{!isLoadingProject && job?.status === "failed" && <div className="failure-stage"><div className="eyebrow">生成失败</div><strong>{job.errorCode ?? "生成失败"}</strong><p>{job.errorMessage ?? "生成失败"}</p><button type="button" className="secondary-button" onClick={() => { setJob(null); setError(null); }}>返回分析</button>{(job.errorCode === "GENERATION_FAILED" || job.errorCode === "RENDER_FAILED") && <button type="button" className="secondary-button" onClick={() => void retryGeneration()} disabled={isRetrying}>{isRetrying ? "重新排队中" : "再次尝试"}</button>}</div>}{!isLoadingProject && activeEvidence && <EvidenceCanvas title={activeEvidence.block.title} status={activeEvidence.revision.status} statusLabel={revisionLabels[activeEvidence.revision.status]} revisionId={activeEvidence.revision.id} revisionNumber={activeEvidence.revision.revision} finding={activeEvidence.block.finding} snapshotId={activeEvidence.block.snapshotId} metricName={metric?.name ?? null} qualityWarnings={[...qualityWarnings, ...activeEvidence.block.qualityWarnings].map((warning) => warning.message)} chart={<InteractiveChart rows={activeRows} spec={activeEvidence.revision.flintSpec} />} canEdit={activeEvidence.revision.status !== "approved" && activeEvidence.revision.status !== "archived"} onEdit={openEditor} showTrace={showTrace} onToggleTrace={() => setShowTrace((open) => !open)} trace={{ transformStepCount: activeEvidence.revision.transformPlan.steps?.length ?? 0, transformRationale: activeEvidence.revision.transformPlan.rationale ?? "—", lineageCount: activeEvidence.revision.fieldLineage.length, lineageText: activeEvidence.revision.fieldLineage.map((line) => line.outputColumn + " ← " + line.sourceColumns.join(" + ")).join(" · ") || "—", validationValue: activeEvidence.revision.validation.valid ? "4 / 4 通过" : "失败", validationDetail: activeEvidence.revision.validation.issues.length ? activeEvidence.revision.validation.issues.map((issue) => issue.message).join("；") : "结构 · 语义 · 字段 · 视觉", immutableValue: "快照固定", immutableDetail: "R" + activeEvidence.revision.revision + " 已锁定：" + (activeEvidence.revision.status === "approved" ? "是" : "否") }} showSubmit={activeEvidence.revision.status === "draft"} onSubmit={() => void transitionRevision("submit")} />}{!isLoadingProject && !activeEvidence && !isJobActive && <div className="canvas-empty"><div className="empty-copy"><div className="eyebrow">项目</div><h2>{hasSnapshot && hasMetric && hasBrief ? "准备生成" : hasSnapshot ? "需要指标或简报" : "需要数据"}</h2><div className="readiness-grid"><span className={hasSnapshot ? "ready" : "pending"}><i />数据快照</span><span className={hasMetric ? "ready" : "pending"}><i />指标口径</span><span className={hasBrief ? "ready" : "pending"}><i />分析简报</span><span className={conversationId ? "ready" : "pending"}><i />对话</span></div><div className="empty-actions">{!hasSnapshot && <button type="button" className="primary-button" onClick={() => fileInputRef.current?.click()}>导入数据 ↗</button>}{hasSnapshot && !hasMetric && <button type="button" className="primary-button" onClick={() => setShowMetricModal(true)}>确认指标 ↗</button>}{hasSnapshot && hasMetric && !hasBrief && <button type="button" className="primary-button" onClick={openBriefModal}>填写简报 ↗</button>}<span className="empty-hint">可以先提交问题；准备度满足后会创建 Generation Cycle。</span></div></div></div>}</section><ConversationComposer messages={messages} composer={composer} composerRef={composerRef} isSending={isSending} isJobActive={isJobActive} jobStatus={job?.status} statusLabels={statusLabels} hasSnapshot={hasSnapshot} hasMetric={hasMetric} hasBrief={hasBrief} snapshotVersion={selectedAsset?.latestSnapshot?.version ?? null} onComposerChange={setComposer} onSend={() => void sendMessage()} onPrompt={setComposer} /></main>

      <aside className={`context-rail ${mobileInspectorOpen ? "mobile-open" : ""}`} aria-label="项目证据上下文"><div className="context-header"><div><div className="eyebrow">依据</div><h2>证据上下文</h2></div><button type="button" className="context-close mobile-only" aria-label="关闭依据面板" onClick={() => setMobileInspectorOpen(false)}>×</button></div><details><summary><span className="context-summary-copy"><strong>数据快照</strong>{selectedAsset?.latestSnapshot && <small>{selectedAsset.name} · v{selectedAsset.latestSnapshot.version} · {selectedAsset.latestSnapshot.rowCount.toLocaleString()} 行</small>}</span><span>{hasSnapshot ? "✓" : "＋"}</span></summary><div className="context-content">{selectedAsset?.latestSnapshot ? <><div className="context-row"><span>数据文件</span><strong>{selectedAsset.name}</strong></div><div className="context-row"><span>快照</span><strong>v{selectedAsset.latestSnapshot.version} · {selectedAsset.latestSnapshot.rowCount.toLocaleString()} 行</strong></div><div className="context-row"><span>字段</span><strong>{selectedAsset.latestSnapshot.columnCount}</strong></div><div className="context-quality">{qualityWarnings.length ? `${qualityWarnings.length} 个字段存在缺失值` : "数据完整"}</div><button type="button" className="context-cta snapshot-preview-trigger" onClick={() => void openSnapshotPreview()} aria-haspopup="dialog">查看数据 <span>↗</span></button><div className="context-detail-label">字段画像</div><div className="context-data-list">{selectedAsset.latestSnapshot.schema.slice(0, 6).map((column) => <div key={column.name}><span>{column.name}</span><small>{column.inferredType} · {column.distinctCount} 个唯一值</small></div>)}</div></> : <div className="context-empty"><strong>未导入数据</strong><button type="button" onClick={() => fileInputRef.current?.click()}>导入数据</button></div>}</div></details><details><summary><strong>分析简报与指标</strong><span>{hasMetric ? "✓" : "＋"}</span></summary><div className="context-content">{brief && <div className="context-note">{brief.businessQuestion}</div>}{metric ? <><div className="context-row"><span>指标</span><strong>{metric.name} · v{metric.version}</strong></div><div className="context-note">{metric.formula} · {metric.unit} · {metric.timeRule}</div></> : <button type="button" className="context-cta" onClick={() => setShowMetricModal(true)}>确认指标口径 <span>↗</span></button>}</div></details><details><summary><strong>项目记忆</strong><span>{memory.project.length + memory.workspace.length ? "✓" : "—"}</span></summary><div className="context-content">{memory.project.length + memory.workspace.length === 0 ? <div className="context-empty">—</div> : [...memory.project, ...memory.workspace].slice(0, 5).map((record) => <div className="memory-line" key={record.id}><i />{record.statement}</div>)}{memory.conflicts.length > 0 && <div className="context-warning">{memory.conflicts.length} 个冲突</div>}</div></details><details><summary><strong>主题与版本</strong><span>{activeRevision ? "✓" : "—"}</span></summary><div className="context-content">{activeRevision ? <><div className="context-row"><span>主题</span><strong>{activeRevision.flintSpec.theme} · {activeRevision.flintSpec.themeVersion}</strong></div><div className="context-row"><span>版本</span><strong>R{activeRevision.revision} · {revisionLabels[activeRevision.status]}</strong></div><div className="context-row"><span>父版本</span><strong>{activeRevision.parentRevisionId ? activeRevision.parentRevisionId.slice(0, 8) : "初始"}</strong></div><div className="context-row"><span>插件</span><strong>{pluginTraceState.status === "ready" ? (pluginTraceState.snapshot.plugins.length ? `${pluginTraceState.snapshot.plugins.length} 个插件` : pluginTraceState.snapshot.themeRef ? "显式主题" : "未参与") : pluginTraceState.status === "empty" ? "未参与" : pluginTraceState.status === "loading" ? "读取中" : "需检查"}</strong></div></> : <><div className="context-row"><span>项目模板</span><strong>{project?.visualTemplate ? visualTemplateOptions.find((option) => option.value === project.visualTemplate)?.label ?? project.visualTemplate : "—"}</strong></div><div className="context-row"><span>当前主题</span><strong>{theme}</strong></div></>}</div></details></aside>
    </div>

    <SnapshotPreviewModal assetName={assets.find((asset) => asset.id === snapshotPreview.assetId)?.name ?? selectedAsset?.name ?? "数据资产"} assetStatus={assets.find((asset) => asset.id === snapshotPreview.assetId)?.status ?? selectedAsset?.status ?? "unknown"} isOpen={snapshotPreview.isOpen} summaries={snapshotPreview.summaries} selectedSnapshotId={snapshotPreview.selectedSnapshotId} snapshot={snapshotPreview.snapshot} status={snapshotPreview.status} error={snapshotPreview.error} onClose={snapshotPreview.close} onSelect={snapshotPreview.select} onRetry={snapshotPreview.retry} />
    <ProjectCreateDialog isOpen={showProjectModal} form={projectForm} isCreating={isCreatingProject} onChange={(patch) => setProjectForm((current) => ({ ...current, ...patch }))} onClose={() => setShowProjectModal(false)} onCreate={() => void createProject()} />
    <MetricForm isOpen={showMetricModal} value={metricForm} onChange={(patch) => setMetricForm((current) => ({ ...current, ...patch }))} onClose={() => setShowMetricModal(false)} onSave={() => void confirmMetric()} />
    {showModelCredentialModal && canManageModelCredential && <div className="modal-backdrop" role="presentation" onClick={() => { setShowModelCredentialModal(false); setModelApiKey(""); }}><section className="modal-dialog small-modal" role="dialog" aria-modal="true" aria-labelledby="model-credential-modal-title" onClick={(event) => event.stopPropagation()}><div className="modal-head cream-head"><div><div className="eyebrow">模型设置</div><h2 id="model-credential-modal-title">配置百炼 API Key</h2></div><button type="button" className="icon-button" aria-label="关闭" onClick={() => { setShowModelCredentialModal(false); setModelApiKey(""); }}>×</button></div><div className="modal-body form-grid"><div className={`credential-status ${modelCredential?.configured ? "configured" : ""}`}><strong>{modelCredential?.configured ? `已配置 · 尾号 ${modelCredential.keySuffix}` : "尚未配置"}</strong><span>{modelCredential?.configured ? `最近更新：${formatDate(modelCredential.updatedAt)}` : "保存后，下一次百炼生成会使用当前账号的凭据。"}</span></div><p className="credential-note">密钥仅经 TLS 提交，服务端会立即加密。浏览器不会持久化或再次展示它；Generation Job 与审计记录也不会保存密钥。</p><label className="field-label"><span>百炼 API Key</span><input autoFocus type="password" autoComplete="new-password" spellCheck={false} value={modelApiKey} onChange={(event) => setModelApiKey(event.target.value)} placeholder="sk-..." onKeyDown={(event) => { if (event.key === "Enter") void saveWorkspaceModelCredential(); }} /></label><p className="credential-note">模型 ID、端点和结构化输出方式仍由部署环境控制，避免已排队任务改变模型路由。</p></div><div className="modal-footer"><p>仅当前账号可修改</p><div><button type="button" className="secondary-button" onClick={() => { setShowModelCredentialModal(false); setModelApiKey(""); }}>取消</button><button type="button" className="primary-button" onClick={() => void saveWorkspaceModelCredential()} disabled={isSavingModelCredential || modelApiKey.trim().length < 8}>{isSavingModelCredential ? "加密保存中" : modelCredential?.configured ? "轮换密钥 ↗" : "加密保存 ↗"}</button></div></div></section></div>}
    {showEditor && activeEvidence && activeSpec && <div className="modal-backdrop" role="presentation" onClick={() => setShowEditor(false)}><section className="modal-dialog editor-modal" role="dialog" aria-modal="true" aria-labelledby="editor-modal-title" onClick={(event) => event.stopPropagation()}><div className="modal-head cream-head"><div><div className="eyebrow">图表产物 / R{activeRevision?.revision} / 新草稿</div><h2 id="editor-modal-title">编辑图表</h2><p className="modal-lead">逻辑变化会基于同一 Data Snapshot 重算，显示变化也会追加新的 Draft Revision。</p></div><button type="button" className="icon-button" aria-label="关闭" onClick={() => setShowEditor(false)}>×</button></div><div className="editor-body"><div className="editor-preview"><div className="editor-preview-head"><div><strong>{editor.title}</strong><small>{chartTypeName(editor.chartType)} · 草稿</small></div><span className="revision-chip">R{(activeRevision?.revision ?? 0) + 1} 草稿</span></div><InteractiveChart rows={activeRows} spec={{ ...activeSpec, chartSpec: { ...activeSpec.chartSpec, title: editor.title, chartType: editor.chartType, annotations: editor.annotation.split(/\r?\n/).map((text) => text.trim()).filter(Boolean).map((text) => ({ text })), showValues: editor.showValues, showLegend: editor.showLegend, encodings: { x: { field: editor.xField }, y: { field: editor.yField }, ...(editor.seriesField ? { color: { field: editor.seriesField } } : {}) } } }} /><div className="editor-preview-foot"><span>数据快照 v{selectedAsset?.latestSnapshot?.version ?? "—"}</span><span>保存后重算 · {activeRevision?.fieldLineage.length ?? 0} 条当前血缘</span></div></div><div className="editor-controls"><div className="control-group"><h3>图表结构</h3><label className="field-label"><span>图表类型</span><select value={editor.chartType} onChange={(event) => dispatchEditor({ type: "set-field", field: "chartType", value: event.target.value as FlintSpec["chartSpec"]["chartType"] })}><option value="Line Chart">折线图</option><option value="Bar Chart">柱状图</option><option value="Area Chart">面积图</option></select></label><label className="field-label"><span>横轴</span><select value={editor.xField} onChange={(event) => dispatchEditor({ type: "set-field", field: "xField", value: event.target.value })}>{availableFields.map((field) => <option value={field} key={field}>{field}</option>)}</select></label><label className="field-label"><span>纵轴</span><select value={editor.yField} onChange={(event) => dispatchEditor({ type: "set-field", field: "yField", value: event.target.value })}>{availableFields.map((field) => <option value={field} key={field}>{field}</option>)}</select></label><label className="field-label"><span>系列 / 颜色</span><select value={editor.seriesField} onChange={(event) => dispatchEditor({ type: "set-field", field: "seriesField", value: event.target.value })}><option value="">不分系列</option>{availableFields.filter((field) => field !== editor.yField).map((field) => <option value={field} key={field}>{field}</option>)}</select></label></div><div className="control-group"><h3>数据逻辑</h3><label className="field-label"><span>聚合度量</span><select value={editor.aggregateOperation} onChange={(event) => dispatchEditor({ type: "set-field", field: "aggregateOperation", value: event.target.value as AggregateOperation })}>{aggregateOperations.map((operation) => <option value={operation} key={operation}>{aggregateOperationLabels[operation]}</option>)}</select></label><div className="form-row"><label className="field-label"><span>筛选字段</span><select value={editor.filterField} onChange={(event) => dispatchEditor({ type: "set-field", field: "filterField", value: event.target.value })}><option value="">不筛选</option>{sourceFields.map((field) => <option value={field} key={field}>{field}</option>)}</select></label><label className="field-label"><span>条件</span><select value={editor.filterOperator} onChange={(event) => dispatchEditor({ type: "set-field", field: "filterOperator", value: event.target.value as FilterOperator })}>{filterOperators.map((operator) => <option value={operator} key={operator}>{filterOperatorLabels[operator]}</option>)}</select></label></div><label className="field-label"><span>筛选值</span><input value={editor.filterValue} disabled={!editor.filterField || editor.filterOperator === "is_not_null"} onChange={(event) => dispatchEditor({ type: "set-field", field: "filterValue", value: event.target.value })} placeholder={editor.filterOperator === "is_not_null" ? "无需填写" : "例如：华东"} /></label><div className="form-row"><label className="field-label"><span>排序字段</span><select value={editor.sortField} onChange={(event) => dispatchEditor({ type: "set-field", field: "sortField", value: event.target.value })}><option value="">不排序</option>{availableFields.map((field) => <option value={field} key={field}>{field}</option>)}</select></label><label className="field-label"><span>方向</span><select value={editor.sortDirection} onChange={(event) => dispatchEditor({ type: "set-field", field: "sortDirection", value: event.target.value as "asc" | "desc" })}><option value="asc">升序</option><option value="desc">降序</option></select></label></div><div className="logic-note"><strong>Worker 重算</strong><span>筛选、聚合、排序会写入新 Revision 的 TransformPlan 和字段血缘。</span></div></div><div className="control-group"><h3>表达与注释</h3><label className="field-label"><span>注释（每行一条）</span><textarea value={editor.annotation} onChange={(event) => dispatchEditor({ type: "set-field", field: "annotation", value: event.target.value })} placeholder="例如：华东是当前重点区域" /></label><label className="toggle-field"><input type="checkbox" checked={editor.showValues} onChange={(event) => dispatchEditor({ type: "set-field", field: "showValues", value: event.target.checked })} /><span><strong>显示数值标签</strong><small>在图表点或柱上显示已聚合数值</small></span></label><label className="toggle-field"><input type="checkbox" checked={editor.showLegend} disabled={!editor.seriesField} onChange={(event) => dispatchEditor({ type: "set-field", field: "showLegend", value: event.target.checked })} /><span><strong>显示图例</strong><small>保留系列字段的图例说明</small></span></label></div><div className="control-group"><h3>编辑状态</h3><div className="logic-note"><strong>仅追加</strong><span>来源 Revision 保持不变；已批准版本不能编辑。</span></div></div></div></div><div className="modal-footer"><p>仅追加 · 同一快照重算 · 已批准版本只读</p><div><button type="button" className="secondary-button" onClick={() => setShowEditor(false)}>取消</button><button type="button" className="primary-button" onClick={() => void saveEditor()} disabled={isSavingEditor || !editor.title.trim() || !editor.xField || !editor.yField || Boolean(editor.filterField && editor.filterOperator !== "is_not_null" && !editor.filterValue.trim())}>{isSavingEditor ? "保存中" : "保存为新版本 ↗"}</button></div></div></section></div>}
    <ReviewComposition revision={activeRevision} comments={reviewComments.comments} note={reviewComments.note} isLoading={reviewComments.isLoading} isSaving={reviewComments.isSaving} onNoteChange={reviewComments.setNote} onRefresh={() => void reviewComments.refresh()} onAddComment={() => void reviewComments.addComment()} onApprove={() => void transitionRevision("approve")} onRequestChanges={() => void transitionRevision("request-changes")} />
  </div>;
}
type GenerationNextAction = { type: "poll_generation_job" | "prepare_generation"; jobId?: string | null; code?: string | null; message: string };
