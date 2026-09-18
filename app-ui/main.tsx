import React, { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@modelcontextprotocol/ext-apps";
import { Reader } from "../components/reader/reader";
import {
  commandError,
  friendlyErrorMessage,
  questionPrompt,
  type ReaderClient,
} from "../lib/client/reader-client";
import {
  parseCommandResult,
  type CommandInput,
  type CommandName,
  type CommandResults,
} from "../lib/domain/commands";
import type { OpenDocumentResult } from "../lib/domain/model";
import "../app/globals.css";

const app = new App(
  { name: "Xanadu Sidebranch", version: "1.0.0" },
  {},
  { autoResize: true },
);

interface HostSnapshot {
  readonly result: OpenDocumentResult | null;
  readonly error: string;
}
let hostSnapshot: HostSnapshot = { result: null, error: "" };
const hostListeners = new Set<() => void>();
const subscribeHost = (listener: () => void) => {
  hostListeners.add(listener);
  return () => {
    hostListeners.delete(listener);
  };
};
const readHostSnapshot = () => hostSnapshot;
function updateHostSnapshot(next: HostSnapshot) {
  hostSnapshot = next;
  hostListeners.forEach((listener) => listener());
}
let awaitingInitialOpen = true;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function contentText(result: unknown): string {
  const content = record(result)?.content;
  if (!Array.isArray(content)) return "操作未完成，请稍后重试。";
  return (
    content
      .filter(
        (part): part is { type: string; text?: string } =>
          typeof part === "object" &&
          part !== null &&
          (part as { type?: unknown }).type === "text" &&
          typeof (part as { text?: unknown }).text === "string",
      )
      .map((part) => part.text ?? "")
      .join("\n") || "操作未完成，请稍后重试。"
  );
}

function hostToolName(): string | undefined {
  const tool = app.getHostContext()?.toolInfo?.tool;
  return tool && typeof tool.name === "string" ? tool.name : undefined;
}

function isOpenDocumentResult(structuredContent: unknown): boolean {
  const value = record(structuredContent);
  // Data-only host tool results must not reset or error the reading App.  The
  // initial and subsequent open_document calls carry the discriminant; when
  // the host exposes toolInfo, it also lets us reject a malformed open result.
  return (
    value?.status !== undefined ||
    hostToolName() === "open_document" ||
    awaitingInitialOpen
  );
}

function deliverResult(result: OpenDocumentResult): void {
  updateHostSnapshot({ result, error: "" });
}

function reportHostError(error: unknown): void {
  const message =
    error instanceof Error
      ? friendlyErrorMessage(
          "APP_ERROR",
          error.message,
          "ChatGPT App 连接失败，请重试。",
        )
      : "ChatGPT App 连接失败，请重试。";
  console.error("Xanadu App integration error", error);
  updateHostSnapshot({ ...hostSnapshot, error: message });
}

app.ontoolresult = ({ structuredContent, isError, content }) => {
  if (isError) {
    const name = hostToolName();
    if (name && name !== "open_document") return;
    awaitingInitialOpen = false;
    reportHostError(new Error(contentText({ content })));
    return;
  }
  if (!isOpenDocumentResult(structuredContent)) return;
  try {
    const result = parseCommandResult("open_document", structuredContent);
    awaitingInitialOpen = false;
    deliverResult(result);
  } catch (error) {
    reportHostError(error);
  }
};

const client: ReaderClient = {
  mode: "app",
  async invoke<K extends CommandName>(
    name: K,
    args: CommandInput<K>,
  ): Promise<CommandResults[K]> {
    let result;
    try {
      result = await app.callServerTool({ name, arguments: args });
    } catch (error) {
      throw commandError(
        undefined,
        undefined,
        error instanceof Error
          ? friendlyErrorMessage(
              "APP_ERROR",
              error.message,
              "ChatGPT 没有完成这次操作，请重试。",
            )
          : "ChatGPT 没有完成这次操作，请重试。",
      );
    }
    if (result.isError) {
      const message = contentText(result);
      const match = /^([A-Z][A-Z0-9_]*):\s*([\s\S]*)$/.exec(message);
      throw commandError(
        {
          error: {
            code: match?.[1] ?? "TOOL_ERROR",
            message: match?.[2] || message,
          },
        },
        500,
      );
    }
    try {
      return parseCommandResult(name, result.structuredContent);
    } catch {
      throw commandError(
        undefined,
        undefined,
        "工具返回了无法识别的结果，请刷新阅读空间后重试。",
      );
    }
  },
  async sendQuestion(question) {
    if (typeof app.sendMessage !== "function")
      throw commandError(
        undefined,
        undefined,
        "当前 ChatGPT 宿主不支持发送消息。问题已保存，可复制后发送。",
      );
    let result;
    try {
      result = await app.sendMessage({
        role: "user",
        content: [{ type: "text", text: questionPrompt(question) }],
      });
    } catch (error) {
      throw commandError(
        undefined,
        502,
        error instanceof Error
          ? `问题已保存，但 ChatGPT 没有接收消息：${friendlyErrorMessage(
              "APP_ERROR",
              error.message,
              "请重试。",
            )}`
          : "问题已保存，但 ChatGPT 没有接收消息。可以重试。",
      );
    }
    if (result.isError)
      throw commandError(
        { error: { code: "MESSAGE_NOT_SENT", message: contentText(result) } },
        502,
        "ChatGPT 没有接收问题。问题已保存，可以重试。",
      );
  },
  async fullscreen() {
    if (typeof app.requestDisplayMode !== "function") return;
    await app.requestDisplayMode({ mode: "fullscreen" });
  },
};

function AppReader() {
  const { result, error } = useSyncExternalStore(
    subscribeHost,
    readHostSnapshot,
  );
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    try {
      deliverResult(await client.invoke("open_document", {}));
    } catch (failure) {
      reportHostError(failure);
    } finally {
      setRetrying(false);
    }
  }

  return (
    <>
      {error && (
        <aside className="app-connection-error" role="alert">
          <span>{error}</span>
          <button disabled={retrying} onClick={() => void retry()}>
            {retrying ? "连接中…" : "重试"}
          </button>
          <button
            aria-label="关闭连接提示"
            onClick={() => updateHostSnapshot({ ...hostSnapshot, error: "" })}
          >
            ×
          </button>
        </aside>
      )}
      {result ? (
        <Reader client={client} initialView={result} />
      ) : (
        <main className="empty-space" aria-busy="true">
          <p>正在等待文档…</p>
        </main>
      )}
    </>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(
  <main className="empty-space">
    <p>正在连接文档空间…</p>
  </main>,
);
app
  .connect()
  .then(() => root.render(<AppReader />))
  .catch((error: unknown) => {
    console.error("Xanadu App handshake failed", error);
    root.render(
      <main className="empty-space">
        <h1>请在 ChatGPT 中打开阅读空间。</h1>
        <p>
          {error instanceof Error
            ? friendlyErrorMessage(
                "APP_ERROR",
                error.message,
                "连接 Xanadu Sidebranch 后，再调用 open_document。",
              )
            : "连接 Xanadu Sidebranch 后，再调用 open_document。"}
        </p>
      </main>,
    );
  });
