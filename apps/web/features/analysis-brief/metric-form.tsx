"use client";

import CloseIcon from "@mui/icons-material/Close";
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, TextField } from "@mui/material";

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
  isSaving: boolean;
  onChange: (patch: Partial<MetricFormValue>) => void;
  onClose: () => void;
  onSave: () => void;
};

export function MetricForm({ isOpen, value, isSaving, onChange, onClose, onSave }: MetricFormProps) {
  return (
    <Dialog
      open={isOpen}
      onClose={() => {
        if (!isSaving) onClose();
      }}
      maxWidth="sm"
      aria-labelledby="metric-modal-title"
    >
      <DialogTitle
        id="metric-modal-title"
        sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
      >
        确认指标口径
        <IconButton aria-label="关闭" onClick={onClose} disabled={isSaving}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 4 }}>
        <TextField label="名称" value={value.name} onChange={(event) => onChange({ name: event.target.value })} />
        <TextField
          label="含义"
          multiline
          minRows={3}
          value={value.meaning}
          onChange={(event) => onChange({ meaning: event.target.value })}
        />
        <TextField label="公式" value={value.formula} onChange={(event) => onChange({ formula: event.target.value })} />
        <Box className="form-row">
          <TextField label="单位" value={value.unit} onChange={(event) => onChange({ unit: event.target.value })} />
          <TextField
            label="时间规则"
            value={value.timeRule}
            onChange={(event) => onChange({ timeRule: event.target.value })}
          />
        </Box>
        <TextField
          label="筛选 / 限制"
          value={value.filterRule}
          onChange={(event) => onChange({ filterRule: event.target.value })}
          placeholder="可选"
        />
      </DialogContent>
      <DialogActions sx={{ p: 4, gap: 2 }}>
        <Button variant="outlined" onClick={onClose} disabled={isSaving}>
          取消
        </Button>
        <Button variant="contained" onClick={onSave} disabled={isSaving || !value.name.trim()}>
          {isSaving ? "保存中" : "确认并保存 ↗"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
