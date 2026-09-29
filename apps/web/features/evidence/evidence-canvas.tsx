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
  revisionId: string;
  revisionNumber: number;
  finding: string;
  snapshotId: string;
  metricName: string | null;
  qualityWarnings: string[];
  chart: ReactNode;
  canEdit: boolean;
  onEdit: () => void;
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
  revisionId,
  revisionNumber,
  finding,
  snapshotId,
  metricName,
  qualityWarnings,
  chart,
  canEdit,
  onEdit,
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
        <Button variant="contained" type="button" onClick={onEdit} disabled={!canEdit}>
          编辑图表 <span>↗</span>
        </Button>
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
