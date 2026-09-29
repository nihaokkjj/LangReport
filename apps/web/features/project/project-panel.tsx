"use client";

import { useRef } from "react";
import CloseIcon from "@mui/icons-material/Close";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Radio,
  TextField,
} from "@mui/material";
import ChevronDownIcon from "@mui/icons-material/ExpandMore";

type ProjectAudience = "internal_analysis" | "client_presentation" | "management";
type VisualTemplate = "consulting-neutral" | "consulting-insight" | "consulting-research";

type Project = { id: string; name: string; clientName?: string };

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
  management: "管理层",
};

const templateOptions: Array<{ value: VisualTemplate; label: string; description: string }> = [
  { value: "consulting-neutral", label: "Consulting Neutral", description: "正式、克制，适合客户报告" },
  { value: "consulting-insight", label: "Consulting Insight", description: "突出重点数字、异常和结论" },
  { value: "consulting-research", label: "Consulting Research", description: "强调来源、脚注和不确定性" },
];

export function ProjectSelector({
  project,
  projects,
  projectId,
  isBooting,
  menuOpen,
  onToggleMenu,
  onSelect,
  onOpenCreate,
}: ProjectSelectorProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="selector project-selector">
      <Button
        ref={anchorRef}
        type="button"
        className="selector-button"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        onClick={onToggleMenu}
      >
        <span className="selector-icon">P</span>
        <span className="selector-copy">
          <strong>{project?.name ?? (isBooting ? "连接中" : "选择项目")}</strong>
          <small>{project?.clientName || "我的项目"}</small>
        </span>
        <span className="selector-chevron">
          <ChevronDownIcon />
        </span>
      </Button>
      <Menu
        open={menuOpen}
        anchorEl={anchorRef.current}
        onClose={onToggleMenu}
        slotProps={{ paper: { sx: { width: 340, maxWidth: "calc(100vw - 32px)" } } }}
      >
        {projects.map((item) => (
          <MenuItem
            key={item.id}
            selected={item.id === projectId}
            onClick={() => onSelect(item.id)}
            sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 2, minHeight: 48 }}
          >
            <strong>{item.name}</strong>
            <small>{item.id === projectId ? "当前项目" : item.clientName || "项目"}</small>
          </MenuItem>
        ))}
        <MenuItem onClick={onOpenCreate}>＋ 新建项目</MenuItem>
      </Menu>
    </div>
  );
}

type ProjectCreateDialogProps = {
  isOpen: boolean;
  form: ProjectFormValue;
  isCreating: boolean;
  onChange: (patch: Partial<ProjectFormValue>) => void;
  onClose: () => void;
  onCreate: () => void;
};

export function ProjectCreateDialog({
  isOpen,
  form,
  isCreating,
  onChange,
  onClose,
  onCreate,
}: ProjectCreateDialogProps) {
  return (
    <Dialog
      open={isOpen}
      onClose={() => {
        if (!isCreating) onClose();
      }}
      maxWidth="md"
      aria-labelledby="project-modal-title"
    >
      <DialogTitle
        id="project-modal-title"
        sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
      >
        创建咨询项目
        <IconButton aria-label="关闭" onClick={onClose} disabled={isCreating}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 4 }}>
        <p className="modal-lead">先固定项目背景，后续生成的 Evidence Block 才能带着正确的客户语境进入审核。</p>
        <TextField
          label="项目名称"
          autoFocus
          value={form.name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder="例如：海岚消费洞察"
        />
        <Box className="form-row">
          <TextField
            label="客户代号或名称"
            value={form.clientName}
            onChange={(event) => onChange({ clientName: event.target.value })}
            placeholder="例如：海岚消费"
          />
          <TextField
            select
            label="默认受众"
            value={form.audience}
            onChange={(event) => onChange({ audience: event.target.value as ProjectAudience })}
          >
            {Object.entries(audienceLabels).map(([value, label]) => (
              <MenuItem value={value} key={value}>
                {label}
              </MenuItem>
            ))}
          </TextField>
        </Box>
        <TextField
          label="项目目标"
          multiline
          minRows={3}
          value={form.objective}
          onChange={(event) => onChange({ objective: event.target.value })}
          placeholder="例如：识别区域销售增长机会，形成客户汇报证据。"
        />
        <fieldset className="template-fieldset">
          <legend>Visual Template</legend>
          <p>固定本项目的输出表达规范；Theme token 可在后续项目设置中按允许范围调整。</p>
          <div className="template-options">
            {templateOptions.map((option) => (
              <label
                className={`template-option ${form.visualTemplate === option.value ? "selected" : ""}`}
                key={option.value}
              >
                <Radio
                  name="visual-template"
                  value={option.value}
                  checked={form.visualTemplate === option.value}
                  onChange={() => onChange({ visualTemplate: option.value })}
                />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </DialogContent>
      <DialogActions sx={{ p: 4, gap: 2 }}>
        <Button variant="outlined" onClick={onClose} disabled={isCreating}>
          取消
        </Button>
        <Button
          variant="contained"
          onClick={onCreate}
          disabled={isCreating || !form.name.trim() || !form.clientName.trim() || !form.objective.trim()}
        >
          {isCreating ? "创建中" : "创建项目 ↗"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
