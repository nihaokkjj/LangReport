"use client";

import CloseIcon from "@mui/icons-material/Close";
import { Button, IconButton } from "@mui/material";

import ChevronDownIcon from "@mui/icons-material/ExpandMore";
import type { PluginTraceState } from "../../features/evidence/plugin-trace";
import type { Snapshot } from "../../features/data-snapshot/use-snapshot-preview";

type EvidenceContextRailProps = {
  selectedAsset: { name: string; latestSnapshot: Snapshot | null } | null;
  qualityWarningCount: number;
  brief: { businessQuestion: string } | null;
  metric: { name: string; version: number; formula: string; unit: string; timeRule: string } | null;
  memory: {
    project: Array<{ id: string; statement: string }>;
    workspace: Array<{ id: string; statement: string }>;
    conflicts: unknown[];
  };
  activeRevision: {
    flintSpec: { theme: string; themeVersion: string };
    revision: number;
    status: string;
    parentRevisionId: string | null;
  } | null;
  pluginTraceState: PluginTraceState;
  project: { visualTemplate?: string } | null;
  theme: string;
  visualTemplateOptions: ReadonlyArray<{ value: string; label: string }>;
  revisionLabels: Readonly<Record<string, string>>;
  onClose: () => void;
  onOpenData: () => void;
  onOpenMetric: () => void;
  onImportData: () => void;
};

export function EvidenceContextRail({
  selectedAsset,
  qualityWarningCount,
  brief,
  metric,
  memory,
  activeRevision,
  pluginTraceState,
  project,
  theme,
  visualTemplateOptions,
  revisionLabels,
  onClose,
  onOpenData,
  onOpenMetric,
  onImportData,
}: EvidenceContextRailProps) {
  return (
    <section className="right-drawer-view context-drawer-view" aria-labelledby="context-drawer-title">
      <div className="context-header">
        <div>
          <div className="eyebrow">依据</div>
          <h2 id="context-drawer-title">证据上下文</h2>
        </div>
        <IconButton className="context-close drawer-close" aria-label="关闭依据面板" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </div>
      <details>
        <summary>
          <span className="context-summary-copy">
            <strong>数据快照</strong>
            {selectedAsset?.latestSnapshot && (
              <small>
                {selectedAsset.name} · v{selectedAsset.latestSnapshot.version} ·{" "}
                {selectedAsset.latestSnapshot.rowCount.toLocaleString()} 行
              </small>
            )}
          </span>
          <span className="context-chevron">
            <ChevronDownIcon />
          </span>
        </summary>
        <div className="context-content">
          {selectedAsset?.latestSnapshot ? (
            <>
              <div className="context-row">
                <span>数据文件</span>
                <strong>{selectedAsset.name}</strong>
              </div>
              <div className="context-row">
                <span>快照</span>
                <strong>
                  v{selectedAsset.latestSnapshot.version} · {selectedAsset.latestSnapshot.rowCount.toLocaleString()} 行
                </strong>
              </div>
              <div className="context-row">
                <span>字段</span>
                <strong>{selectedAsset.latestSnapshot.columnCount}</strong>
              </div>
              <div className="context-quality">
                {qualityWarningCount ? `${qualityWarningCount} 个字段存在缺失值` : "数据完整"}
              </div>
              <Button type="button" className="context-cta snapshot-preview-trigger" onClick={onOpenData}>
                查看数据 <span>↗</span>
              </Button>
              <div className="context-detail-label">字段画像</div>
              <div className="context-data-list">
                {selectedAsset.latestSnapshot.schema.slice(0, 6).map((column) => (
                  <div key={column.name}>
                    <span>{column.name}</span>
                    <small>
                      {column.inferredType} · {column.distinctCount} 个唯一值
                    </small>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="context-empty">
              <strong>未导入数据</strong>
              <Button type="button" onClick={onImportData}>
                导入数据
              </Button>
            </div>
          )}
        </div>
      </details>
      <details>
        <summary>
          <strong>分析简报与指标</strong>
          <span className="context-chevron">
            <ChevronDownIcon />
          </span>
        </summary>
        <div className="context-content">
          {brief && <div className="context-note">{brief.businessQuestion}</div>}
          {metric ? (
            <>
              <div className="context-row">
                <span>指标</span>
                <strong>
                  {metric.name} · v{metric.version}
                </strong>
              </div>
              <div className="context-note">
                {metric.formula} · {metric.unit} · {metric.timeRule}
              </div>
            </>
          ) : (
            <Button type="button" className="context-cta" onClick={onOpenMetric}>
              确认指标口径 <span>↗</span>
            </Button>
          )}
        </div>
      </details>
      <details>
        <summary>
          <strong>项目记忆</strong>
          <span className="context-chevron">
            <ChevronDownIcon />
          </span>
        </summary>
        <div className="context-content">
          {memory.project.length + memory.workspace.length === 0 ? (
            <div className="context-empty">—</div>
          ) : (
            [...memory.project, ...memory.workspace].slice(0, 5).map((record) => (
              <div className="memory-line" key={record.id}>
                <i />
                {record.statement}
              </div>
            ))
          )}
          {memory.conflicts.length > 0 && <div className="context-warning">{memory.conflicts.length} 个冲突</div>}
        </div>
      </details>
      <details>
        <summary>
          <strong>主题与版本</strong>
          <span className="context-chevron">
            <ChevronDownIcon />
          </span>
        </summary>
        <div className="context-content">
          {activeRevision ? (
            <>
              <div className="context-row">
                <span>主题</span>
                <strong>
                  {activeRevision.flintSpec.theme} · {activeRevision.flintSpec.themeVersion}
                </strong>
              </div>
              <div className="context-row">
                <span>版本</span>
                <strong>
                  R{activeRevision.revision} · {revisionLabels[activeRevision.status]}
                </strong>
              </div>
              <div className="context-row">
                <span>父版本</span>
                <strong>
                  {activeRevision.parentRevisionId ? activeRevision.parentRevisionId.slice(0, 8) : "初始"}
                </strong>
              </div>
              <div className="context-row">
                <span>插件</span>
                <strong>
                  {pluginTraceState.status === "ready"
                    ? pluginTraceState.snapshot.plugins.length
                      ? `${pluginTraceState.snapshot.plugins.length} 个插件`
                      : pluginTraceState.snapshot.themeRef
                        ? "显式主题"
                        : "未参与"
                    : pluginTraceState.status === "empty"
                      ? "未参与"
                      : pluginTraceState.status === "loading"
                        ? "读取中"
                        : "需检查"}
                </strong>
              </div>
            </>
          ) : (
            <>
              <div className="context-row">
                <span>项目模板</span>
                <strong>
                  {project?.visualTemplate
                    ? (visualTemplateOptions.find((option) => option.value === project.visualTemplate)?.label ??
                      project.visualTemplate)
                    : "—"}
                </strong>
              </div>
              <div className="context-row">
                <span>当前主题</span>
                <strong>{theme}</strong>
              </div>
            </>
          )}
        </div>
      </details>
    </section>
  );
}
