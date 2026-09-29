"use client";

import CloseIcon from "@mui/icons-material/Close";
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, TextField } from "@mui/material";

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

export function AnalysisBriefForm({
  isOpen,
  hasExistingBrief,
  value,
  isSaving,
  onChange,
  onClose,
  onSave,
}: AnalysisBriefFormProps) {
  const canConfirm = Boolean(
    value.businessQuestion.trim() &&
    value.audience.trim() &&
    value.timeRange.trim() &&
    value.timeGrain.trim() &&
    value.outputFormat.trim(),
  );

  return (
    <Dialog
      open={isOpen}
      onClose={() => {
        if (!isSaving) onClose();
      }}
      maxWidth="sm"
      aria-labelledby="brief-modal-title"
    >
      <DialogTitle
        id="brief-modal-title"
        sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
      >
        {hasExistingBrief ? "编辑 Analysis Brief" : "填写 Analysis Brief"}
        <IconButton aria-label="关闭" onClick={onClose} disabled={isSaving}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 4 }}>
        <TextField
          label="业务问题"
          autoFocus
          multiline
          minRows={3}
          value={value.businessQuestion}
          onChange={(event) => onChange({ businessQuestion: event.target.value })}
          placeholder="例如：按月份展示各区域销售额与同比变化"
        />
        <Box className="form-row">
          <TextField
            label="受众"
            value={value.audience}
            onChange={(event) => onChange({ audience: event.target.value })}
            placeholder="例如：客户管理层"
          />
          <TextField
            label="时间范围"
            value={value.timeRange}
            onChange={(event) => onChange({ timeRange: event.target.value })}
            placeholder="例如：2025-01 至 2025-12"
          />
        </Box>
        <Box className="form-row">
          <TextField
            label="时间粒度"
            value={value.timeGrain}
            onChange={(event) => onChange({ timeGrain: event.target.value })}
            placeholder="例如：月"
          />
          <TextField
            label="交付形式"
            value={value.outputFormat}
            onChange={(event) => onChange({ outputFormat: event.target.value })}
            placeholder="例如：证据模块"
          />
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 4, gap: 2 }}>
        <Button variant="outlined" onClick={() => onSave(false)} disabled={isSaving}>
          保存草稿
        </Button>
        <Button variant="contained" onClick={() => onSave(true)} disabled={isSaving || !canConfirm}>
          {isSaving ? "保存中" : "确认简报 ↗"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
