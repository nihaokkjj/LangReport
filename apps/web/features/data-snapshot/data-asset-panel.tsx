"use client";

import type { RefObject } from "react";

type Asset = { id: string; status: string; latestSnapshot: { version: number } | null };

type DataAssetRailProps = {
  selectedAsset: Asset | null;
  isUploading: boolean;
  isBooting: boolean;
  onPrepareUpload: () => void;
  onUploadFile: (file: File) => void | Promise<void>;
  onOpenFilePicker: (assetId: string) => void;
  onUseSample: () => void | Promise<void>;
};

export function DataAssetRail({ selectedAsset, isUploading, isBooting, onPrepareUpload, onUploadFile, onOpenFilePicker, onUseSample }: DataAssetRailProps) {
  return <><div className="rail-divider" /><div className="rail-source"><div className="eyebrow">数据</div><div className="result-actions"><label className="secondary-button upload-button" onClick={onPrepareUpload}><input type="file" accept=".csv,.xlsx,.xls,.json" disabled={isUploading || isBooting} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void onUploadFile(file); }} />{isUploading ? "处理中" : "导入文件"}</label>{selectedAsset?.status === "ready" && <button type="button" className="secondary-button" onClick={() => onOpenFilePicker(selectedAsset.id)} disabled={isUploading || isBooting}>更新当前数据</button>}<button type="button" className="text-button" onClick={() => void onUseSample()} disabled={isUploading || isBooting}>使用示例</button></div></div></>;
}

type DataAssetFileInputProps = {
  fileInputRef: RefObject<HTMLInputElement | null>;
  isUploading: boolean;
  isBooting: boolean;
  onUploadFile: (file: File) => void | Promise<void>;
};

export function DataAssetFileInput({ fileInputRef, isUploading, isBooting, onUploadFile }: DataAssetFileInputProps) {
  return <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.json" disabled={isUploading || isBooting} aria-label="选择数据文件" style={{ position: "fixed", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void onUploadFile(file); }} />;
}
