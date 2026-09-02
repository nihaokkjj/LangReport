import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LangReport",
  description: "从数据和自然语言生成可复现的图表"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
