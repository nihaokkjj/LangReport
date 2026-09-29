import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";

export async function captureUiEvidence(page: Page, surface: string) {
  if (process.env.MUI_CAPTURE !== "1") return;
  const width = page.viewportSize()?.width ?? 0;
  const directory = resolve(process.cwd(), "../../docs/changes/2026-09-29-mui-web-ui/evidence");
  mkdirSync(directory, { recursive: true });
  await page.screenshot({
    path: resolve(directory, `${surface}-${width}.png`),
    fullPage: true,
    animations: "disabled",
    caret: "initial",
  });
}
