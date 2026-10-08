"use client";

import { Alert, Button, Chip } from "@mui/material";

import type { ReactNode } from "react";
import { RevisionExport, type RevisionExportStatus } from "./revision-export";

export type EvidenceTrace = {
  transformStepCount: number;
  transformRationale: string;
  lineageCount: number;
  lineageText: string;
  validationValue: string;
  validationDetail: string;
  immutableValue: string;
  immutableDetail: string;
};

export type EvidenceCanvasProps = {
  title: string;
  status: RevisionExportStatus;
  statusLabel: string;
  integrityStatus?: "legacy_unverified" | "verified";
  revisionId: string;
  revisionNumber: number;
  finding: string;
  snapshotId: string;
  metricName: string | null;
  qualityWarnings: string[];
  chart: ReactNode;
  canEdit: boolean;
  onEdit: () => void;
  onCopy?: () => void;
  onRollback?: () => void;
  isRevisionPending?: boolean;
  showTrace: boolean;
  onToggleTrace: () => void;
  trace: EvidenceTrace;
  showSubmit: boolean;
  onSubmit: () => void;
};

export function EvidenceCanvas({
  title,
  status,
  statusLabel,
  integrityStatus,
  revisionId,
  revisionNumber,
  finding,
  snapshotId,
  metricName,
  qualityWarnings,
  chart,
  canEdit,
  onEdit,
  onCopy,
  onRollback,
  isRevisionPending,
  showTrace,
  onToggleTrace,
  trace,
  showSubmit,
  onSubmit,
}: EvidenceCanvasProps) {
  return (
    <div className="evidence-canvas">
      <div className="evidence-head">
        <div>
          <div className="eyebrow">图表产物</div>
          <h2>{title}</h2>
        </div>
        <Chip
          label={statusLabel}
          color={
            status === "approved"
              ? "success"
              : status === "changes_requested"
                ? "error"
                : status === "in_review"
                  ? "warning"
                  : "default"
          }
        />
      </div>
      {integrityStatus === "legacy_unverified" && (
        <Alert severity="warning" role="status">
          历史版本未验证：原审核状态保留。请确认输入并创建新的 Generation Cycle；此版本不能重新审核或派生。
        </Alert>
      )}
      <div className="chart-stage">{chart}</div>
      <div className="finding">
        <span className="eyebrow">发现</span>
        <p>{finding}</p>
      </div>
      <div className="evidence-proof">
        <div>
          <span>数据快照</span>
          <strong>{snapshotId.slice(0, 8)}</strong>
        </div>
        <div>
          <span>指标</span>
          <strong>{metricName ?? "—"}</strong>
        </div>
        <div>
          <span>版本</span>
          <strong>R{revisionNumber}</strong>
        </div>
      </div>
      {qualityWarnings.length > 0 && (
        <Alert severity="warning" role="status">
          质量：{qualityWarnings.slice(0, 3).join("；")}
        </Alert>
      )}
      <div className="result-actions">
        <Button variant="contained" type="button" onClick={onEdit} disabled={!canEdit || isRevisionPending}>
          编辑图表 <span>↗</span>
        </Button>
        {onCopy && (
          <Button
            variant="outlined"
            onClick={onCopy}
            disabled={isRevisionPending || integrityStatus === "legacy_unverified"}
          >
            复制为新图表
          </Button>
        )}
        {onRollback && (
          <Button
            variant="outlined"
            onClick={onRollback}
            disabled={isRevisionPending || integrityStatus === "legacy_unverified"}
          >
            从此版本创建草稿
          </Button>
        )}
        <Button variant="outlined" type="button" onClick={onToggleTrace}>
          {showTrace ? "收起依据" : "查看依据"}
        </Button>
        <RevisionExport revisionId={revisionId} revision={revisionNumber} status={status} />
        {showSubmit && (
          <Button variant="outlined" type="button" onClick={onSubmit}>
            提交审核
          </Button>
        )}
      </div>
      {showTrace && (
        <div className="trace-grid">
          <div>
            <span>变换计划</span>
            <strong>{trace.transformStepCount} 步</strong>
            <small>{trace.transformRationale}</small>
          </div>
          <div>
            <span>字段血缘</span>
            <strong>{trace.lineageCount} 个输出</strong>
            <small>{trace.lineageText}</small>
          </div>
          <div>
            <span>校验</span>
            <strong>{trace.validationValue}</strong>
            <small>{trace.validationDetail}</small>
          </div>
          <div>
            <span>不可变</span>
            <strong>{trace.immutableValue}</strong>
            <small>{trace.immutableDetail}</small>
          </div>
        </div>
      )}
    </div>
  );
}
