"use client";

import { Alert, AlertTitle } from "@mui/material";

export type AlertBannerTone = "error" | "notice";

export type AlertBannerProps = {
  tone: AlertBannerTone;
  message: string;
  title?: string;
  onDismiss: () => void;
};

export function AlertBanner({ tone, message, title, onDismiss }: AlertBannerProps) {
  return (
    <Alert
      severity={tone === "error" ? "error" : "info"}
      role={tone === "error" ? "alert" : "status"}
      onClose={onDismiss}
      sx={{ mb: 3 }}
    >
      {title && <AlertTitle>{title}</AlertTitle>}
      {message}
    </Alert>
  );
}
