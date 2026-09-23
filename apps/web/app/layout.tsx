import type { Metadata } from "next";
import "./globals.css";
import { QueryProvider } from "./query-provider";

export const metadata: Metadata = {
  title: "LangReport",
  description: "从数据和自然语言生成可复现的图表"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body><QueryProvider>{children}</QueryProvider></body>
    </html>
  );
}
