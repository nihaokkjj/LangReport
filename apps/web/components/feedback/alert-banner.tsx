"use client";

export type AlertBannerTone = "error" | "notice";

export type AlertBannerProps = {
  tone: AlertBannerTone;
  message: string;
  title?: string;
  onDismiss: () => void;
};

export function AlertBanner({ tone, message, title, onDismiss }: AlertBannerProps) {
  return <div className={`alert ${tone}-alert`} role={tone === "error" ? "alert" : "status"}>
    {title && <strong>{title}</strong>}
    <span>{message}</span>
    <button type="button" onClick={onDismiss}>×</button>
  </div>;
}
