import React, { useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@modelcontextprotocol/ext-apps";
import { Reader } from "../components/reader/reader";
import { questionPrompt, type ReaderClient } from "../lib/client/reader-client";
import type {
  CommandName,
  CommandInput,
  CommandResults,
} from "../lib/domain/commands";
import type { ReadingView } from "../lib/domain/model";
import "../app/globals.css";
const app = new App(
  { name: "Xanadu Sidebranch", version: "1.0.0" },
  {},
  { autoResize: true },
);
let acceptView: ((view: ReadingView) => void) | null = null;
let pendingView: ReadingView | null = null;
app.ontoolresult = ({ structuredContent }) => {
  if (
    structuredContent &&
    typeof structuredContent === "object" &&
    "document" in structuredContent &&
    "connections" in structuredContent
  ) {
    const view = structuredContent as unknown as ReadingView;
    pendingView = view;
    acceptView?.(view);
  }
};
const client: ReaderClient = {
  mode: "app",
  async invoke<K extends CommandName>(
    name: K,
    args: CommandInput<K>,
  ): Promise<CommandResults[K]> {
    const result = await app.callServerTool({ name, arguments: args });
    if (result.isError) {
      throw new Error(
        result.content
          ?.filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n") || "操作未完成",
      );
    }
    return result.structuredContent as unknown as CommandResults[K];
  },
  async sendQuestion(question) {
    const result = await app.sendMessage({
      role: "user",
      content: [{ type: "text", text: questionPrompt(question) }],
    });
    if (result.isError)
      throw new Error("ChatGPT 没有接收问题。问题已保存，可以重试。");
  },
  async fullscreen() {
    await app.requestDisplayMode({ mode: "fullscreen" });
  },
};
function AppReader() {
  const ready = useCallback((open: (view: ReadingView) => void) => {
    acceptView = open;
    if (pendingView) open(pendingView);
  }, []);
  return <Reader client={client} initialView={pendingView} onReady={ready} />;
}
const root = createRoot(document.getElementById("root")!);
root.render(<div className="empty-space">正在连接文档空间…</div>);
app
  .connect()
  .then(() => root.render(<AppReader />))
  .catch(() =>
    root.render(
      <div className="empty-space">
        <h1>请在 ChatGPT 中打开阅读空间。</h1>
        <p>连接 Xanadu Sidebranch 后，调用 open_document。</p>
      </div>,
    ),
  );
