import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Xanadu Sidebranch",
  description: "文档、问题与思想之间的连接。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
