"use client";

import { Button, TextField } from "@mui/material";

import type { RefObject } from "react";

type Asset = { id: string; status: string; latestSnapshot: { version: number } | null };

type DataAssetRailProps = {
  tableHint: string;
  onTableHintChange: (value: string) => void;
  selectedAsset: Asset | null;
  isUploading: boolean;
  isBooting: boolean;
  onPrepareUpload: () => void;
  onUploadFile: (file: File) => void | Promise<void>;
  onOpenFilePicker: (assetId: string) => void;
  onUseSample: () => void | Promise<void>;
};

export function DataAssetRail({
  tableHint,
  onTableHintChange,
  selectedAsset,
  isUploading,
  isBooting,
  onPrepareUpload,
  onUploadFile,
  onOpenFilePicker,
  onUseSample,
}: DataAssetRailProps) {
  return (
    <>
      <div className="rail-divider" />
      <div className="rail-source">
        <div className="eyebrow">数据</div>
        <TextField
          label="表格说明（可选）"
          value={tableHint}
          onChange={(event) => onTableHintChange(event.target.value)}
          placeholder="例如：使用销售明细，第 3 行是列名"
          fullWidth
          size="small"
          slotProps={{ htmlInput: { maxLength: 2000 } }}
          disabled={isUploading || isBooting}
          helperText="可填写工作表、表头位置和数据范围"
        />
        <div className="result-actions">
          <Button component="label" variant="outlined" onClick={onPrepareUpload} disabled={isUploading || isBooting}>
            <input
              type="file"
              accept=".csv,.xlsx,.xls,.json"
              className="visually-hidden-file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (file) void onUploadFile(file);
              }}
            />
            {isUploading ? "处理中" : "导入文件"}
          </Button>
          {selectedAsset?.status === "ready" && (
            <Button
              variant="outlined"
              onClick={() => onOpenFilePicker(selectedAsset.id)}
              disabled={isUploading || isBooting}
            >
              更新当前数据
            </Button>
          )}
          <Button variant="text" onClick={() => void onUseSample()} disabled={isUploading || isBooting}>
            使用示例
          </Button>
        </div>
      </div>
    </>
  );
}

type DataAssetFileInputProps = {
  fileInputRef: RefObject<HTMLInputElement | null>;
  isUploading: boolean;
  isBooting: boolean;
  onUploadFile: (file: File) => void | Promise<void>;
};

export function DataAssetFileInput({ fileInputRef, isUploading, isBooting, onUploadFile }: DataAssetFileInputProps) {
  return (
    <input
      ref={fileInputRef}
      type="file"
      accept=".csv,.xlsx,.xls,.json"
      disabled={isUploading || isBooting}
      aria-label="选择数据文件"
      style={{ position: "fixed", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.currentTarget.value = "";
        if (file) void onUploadFile(file);
      }}
    />
  );
}
