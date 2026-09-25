"use client";

type DrawerResizeHandleProps = {
  width: number;
  ariaLabel: string;
  onStartResize: (startX: number) => void;
  onAdjustWidth: (delta: number) => void;
};

export function DrawerResizeHandle({ width, ariaLabel, onStartResize, onAdjustWidth }: DrawerResizeHandleProps) {
  return (
    <div
      className="context-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuemin={300}
      aria-valuemax={560}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(event) => {
        event.preventDefault();
        onStartResize(event.clientX);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onAdjustWidth(16);
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          onAdjustWidth(-16);
        }
      }}
    />
  );
}
