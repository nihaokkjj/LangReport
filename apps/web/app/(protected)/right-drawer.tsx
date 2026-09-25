"use client";

import { useCallback, useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import { DrawerResizeHandle } from "./drawer-resize-handle";

export type RightDrawerView = "context" | "snapshot";

type RightDrawerProps = {
  activeView: RightDrawerView | null;
  width: number;
  onWidthChange: (width: number) => void;
  onResizeStateChange: (isResizing: boolean) => void;
  children: ReactNode;
};

const MIN_DRAWER_WIDTH = 300;
const MAX_DRAWER_WIDTH = 560;

function clampDrawerWidth(width: number): number {
  return Math.min(MAX_DRAWER_WIDTH, Math.max(MIN_DRAWER_WIDTH, width));
}

export function RightDrawer({
  activeView,
  width,
  onWidthChange,
  onResizeStateChange,
  children,
}: RightDrawerProps) {
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const resize = useCallback(
    (event: PointerEvent) => {
      const currentResize = resizeRef.current;
      if (!currentResize) return;
      onWidthChange(clampDrawerWidth(currentResize.startWidth + currentResize.startX - event.clientX));
    },
    [onWidthChange],
  );
  const stopResize = useCallback(() => {
    resizeRef.current = null;
    onResizeStateChange(false);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    window.removeEventListener("pointermove", resize);
    window.removeEventListener("pointerup", stopResize);
  }, [onResizeStateChange, resize]);
  const startResize = useCallback(
    (startX: number) => {
      resizeRef.current = { startX, startWidth: width };
      onResizeStateChange(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", resize);
      window.addEventListener("pointerup", stopResize, { once: true });
    },
    [onResizeStateChange, resize, stopResize, width],
  );
  const adjustWidth = useCallback(
    (delta: number) => onWidthChange(clampDrawerWidth(width + delta)),
    [onWidthChange, width],
  );

  useEffect(() => () => stopResize(), [stopResize]);

  const isSnapshot = activeView === "snapshot";
  return (
    <aside
      className={`right-drawer ${isSnapshot ? "is-snapshot" : "is-context"}`}
      aria-label={isSnapshot ? "查看数据" : "证据上下文"}
      aria-hidden={activeView === null}
      style={{ "--right-drawer-width": `${width}px` } as CSSProperties}
    >
      {activeView && (
        <DrawerResizeHandle
          width={width}
          ariaLabel="调整右侧抽屉宽度"
          onStartResize={startResize}
          onAdjustWidth={adjustWidth}
        />
      )}
      {children}
    </aside>
  );
}
