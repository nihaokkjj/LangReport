"use client";

export type AnalysisBriefFormValue = {
  businessQuestion: string;
  audience: string;
  timeRange: string;
  timeGrain: string;
  outputFormat: string;
};

type AnalysisBriefFormProps = {
  isOpen: boolean;
  hasExistingBrief: boolean;
  value: AnalysisBriefFormValue;
  isSaving: boolean;
  onChange: (patch: Partial<AnalysisBriefFormValue>) => void;
  onClose: () => void;
  onSave: (confirm: boolean) => void;
};

export function AnalysisBriefForm({ isOpen, hasExistingBrief, value, isSaving, onChange, onClose, onSave }: AnalysisBriefFormProps) {
  if (!isOpen) return null;
  const canConfirm = Boolean(value.businessQuestion.trim() && value.audience.trim() && value.timeRange.trim() && value.timeGrain.trim() && value.outputFormat.trim());
  return <div className="modal-backdrop" role="presentation" onClick={onClose}><section className="modal-dialog small-modal" role="dialog" aria-modal="true" aria-labelledby="brief-modal-title" onClick={(event) => event.stopPropagation()}><div className="modal-head cream-head"><div><div className="eyebrow">分析简报</div><h2 id="brief-modal-title">{hasExistingBrief ? "编辑 Analysis Brief" : "填写 Analysis Brief"}</h2></div><button type="button" className="icon-button" aria-label="关闭" onClick={onClose}>×</button></div><div className="modal-body form-grid"><label className="field-label"><span>业务问题</span><textarea autoFocus value={value.businessQuestion} onChange={(event) => onChange({ businessQuestion: event.target.value })} placeholder="例如：按月份展示各区域销售额与同比变化" /></label><div className="form-row"><label className="field-label"><span>受众</span><input value={value.audience} onChange={(event) => onChange({ audience: event.target.value })} placeholder="例如：客户管理层" /></label><label className="field-label"><span>时间范围</span><input value={value.timeRange} onChange={(event) => onChange({ timeRange: event.target.value })} placeholder="例如：2025-01 至 2025-12" /></label></div><div className="form-row"><label className="field-label"><span>时间粒度</span><input value={value.timeGrain} onChange={(event) => onChange({ timeGrain: event.target.value })} placeholder="例如：月" /></label><label className="field-label"><span>交付形式</span><input value={value.outputFormat} onChange={(event) => onChange({ outputFormat: event.target.value })} placeholder="例如：证据模块" /></label></div></div><div className="modal-footer"><button type="button" className="secondary-button" onClick={() => onSave(false)} disabled={isSaving}>保存草稿</button><button type="button" className="primary-button" onClick={() => onSave(true)} disabled={isSaving || !canConfirm}>{isSaving ? "保存中" : "确认简报 ↗"}</button></div></section></div>;
}
