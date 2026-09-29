import type { Metadata } from "next";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import "./globals.css";
import { QueryProvider } from "./query-provider";
import { UiProvider } from "./ui-provider";

export const metadata: Metadata = {
  title: "LangReport",
  description: "从数据和自然语言生成可复现的图表",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <AppRouterCacheProvider options={{ enableCssLayer: true }}>
          <UiProvider>
            <QueryProvider>{children}</QueryProvider>
          </UiProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
