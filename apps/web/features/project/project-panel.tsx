"use client";

type ProjectAudience = "internal_analysis" | "client_presentation" | "management";
type VisualTemplate = "consulting-neutral" | "consulting-insight" | "consulting-research";

type Project = {
  id: string;
  name: string;
  clientName?: string;
};

export type ProjectFormValue = {
  name: string;
  clientName: string;
  objective: string;
  audience: ProjectAudience;
  visualTemplate: VisualTemplate;
};

type ProjectSelectorProps = {
  project: Project | null;
  projects: Project[];
  projectId: string | null;
  isBooting: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onSelect: (projectId: string) => void;
  onOpenCreate: () => void;
};

const audienceLabels: Record<ProjectAudience, string> = {
  internal_analysis: "内部分析",
  client_presentation: "客户汇报",
  management: "管理层"
};

const templateOptions: Array<{ value: VisualTemplate; label: string; description: string }> = [
  { value: "consulting-neutral", label: "Consulting Neutral", description: "正式、克制，适合客户报告" },
  { value: "consulting-insight", label: "Consulting Insight", description: "突出重点数字、异常和结论" },
  { value: "consulting-research", label: "Consulting Research", description: "强调来源、脚注和不确定性" }
];

export function ProjectSelector({ project, projects, projectId, isBooting, menuOpen, onToggleMenu, onSelect, onOpenCreate }: ProjectSelectorProps) {
  return <div className="selector project-selector"><button type="button" className="selector-button" aria-expanded={menuOpen} onClick={onToggleMenu}><span className="selector-icon">P</span><span className="selector-copy"><strong>{project?.name ?? (isBooting ? "连接中" : "选择项目")}</strong><small>{project?.clientName || "我的项目"}</small></span><span className="selector-chevron">⌄</span></button>{menuOpen && <div className="selector-menu"><span className="menu-kicker">项目列表</span>{projects.map((item) => <button type="button" key={item.id} className={`menu-item ${item.id === projectId ? "current" : ""}`} onClick={() => onSelect(item.id)}><strong>{item.name}</strong><small>{item.id === projectId ? "当前项目" : item.clientName || "项目"}</small></button>)}<button type="button" className="menu-create" onClick={onOpenCreate}>＋ 新建项目</button></div>}</div>;
}

type ProjectCreateDialogProps = {
  isOpen: boolean;
  form: ProjectFormValue;
  isCreating: boolean;
  onChange: (patch: Partial<ProjectFormValue>) => void;
  onClose: () => void;
  onCreate: () => void;
};

export function ProjectCreateDialog({ isOpen, form, isCreating, onChange, onClose, onCreate }: ProjectCreateDialogProps) {
  if (!isOpen) return null;
  return <div className="modal-backdrop" role="presentation" onClick={onClose}><section className="modal-dialog onboarding-modal" role="dialog" aria-modal="true" aria-labelledby="project-modal-title" onClick={(event) => event.stopPropagation()}><div className="modal-head cream-head"><div><div className="eyebrow">PROJECT ONBOARDING</div><h2 id="project-modal-title">创建咨询项目</h2><p className="modal-lead">先固定项目背景，后续生成的 Evidence Block 才能带着正确的客户语境进入审核。</p></div><button type="button" className="icon-button" aria-label="关闭" onClick={onClose}>×</button></div><div className="modal-body form-grid"><label className="field-label"><span>项目名称</span><input autoFocus value={form.name} onChange={(event) => onChange({ name: event.target.value })} placeholder="例如：海岚消费洞察" /></label><div className="form-row"><label className="field-label"><span>客户代号或名称</span><input value={form.clientName} onChange={(event) => onChange({ clientName: event.target.value })} placeholder="例如：海岚消费" /></label><label className="field-label"><span>默认受众</span><select value={form.audience} onChange={(event) => onChange({ audience: event.target.value as ProjectAudience })}>{Object.entries(audienceLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div><label className="field-label"><span>项目目标</span><textarea value={form.objective} onChange={(event) => onChange({ objective: event.target.value })} placeholder="例如：识别区域销售增长机会，形成客户汇报证据。" /></label><fieldset className="template-fieldset"><legend>Visual Template</legend><p>固定本项目的输出表达规范；Theme token 可在后续项目设置中按允许范围调整。</p><div className="template-options">{templateOptions.map((option) => <label className={`template-option ${form.visualTemplate === option.value ? "selected" : ""}`} key={option.value}><input type="radio" name="visual-template" value={option.value} checked={form.visualTemplate === option.value} onChange={() => onChange({ visualTemplate: option.value })} /><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}</div></fieldset></div><div className="modal-footer"><p>客户、目标、受众和模板会随 Project 一起保存</p><div><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="button" className="primary-button" onClick={onCreate} disabled={isCreating || !form.name.trim() || !form.clientName.trim() || !form.objective.trim()}>{isCreating ? "创建中" : "创建项目 ↗"}</button></div></div></section></div>;
}
