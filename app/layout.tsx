import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Xanadu Sidebranch",
  description:
    "让原文、解释与反例同时留在眼前。一个受 Project Xanadu 启发的私人文档空间。",
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
