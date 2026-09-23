"use client";

export type MetricFormValue = {
  name: string;
  meaning: string;
  formula: string;
  unit: string;
  timeRule: string;
  filterRule: string;
};

type MetricFormProps = {
  isOpen: boolean;
  value: MetricFormValue;
  onChange: (patch: Partial<MetricFormValue>) => void;
  onClose: () => void;
  onSave: () => void;
};

export function MetricForm({ isOpen, value, onChange, onClose, onSave }: MetricFormProps) {
  if (!isOpen) return null;
  return <div className="modal-backdrop" role="presentation" onClick={onClose}><section className="modal-dialog small-modal" role="dialog" aria-modal="true" aria-labelledby="metric-modal-title" onClick={(event) => event.stopPropagation()}><div className="modal-head pink-head"><div><div className="eyebrow">指标口径</div><h2 id="metric-modal-title">确认指标口径</h2></div><button type="button" className="icon-button" aria-label="关闭" onClick={onClose}>×</button></div><div className="modal-body form-grid"><label className="field-label"><span>名称</span><input value={value.name} onChange={(event) => onChange({ name: event.target.value })} /></label><label className="field-label"><span>含义</span><textarea value={value.meaning} onChange={(event) => onChange({ meaning: event.target.value })} /></label><label className="field-label"><span>公式</span><input value={value.formula} onChange={(event) => onChange({ formula: event.target.value })} /></label><div className="form-row"><label className="field-label"><span>单位</span><input value={value.unit} onChange={(event) => onChange({ unit: event.target.value })} /></label><label className="field-label"><span>时间规则</span><input value={value.timeRule} onChange={(event) => onChange({ timeRule: event.target.value })} /></label></div><label className="field-label"><span>筛选 / 限制</span><input value={value.filterRule} onChange={(event) => onChange({ filterRule: event.target.value })} placeholder="可选" /></label></div><div className="modal-footer"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="button" className="primary-button" onClick={onSave} disabled={!value.name.trim()}>确认并保存 ↗</button></div></section></div>;
}
