import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { Reader } from "../components/reader/reader";
import type { ReaderClient } from "../lib/client/reader-client";
import {
  commandSchemas,
  parseCommandInput,
  parseCommandResult,
  type CommandName,
  type CommandInput,
  type CommandResults,
} from "../lib/domain/commands";
import type { DocumentId, Question } from "../lib/domain/model";
import { createHostAnswer } from "./ui-host-answer";
import "../app/globals.css";
import appHtml from "../.app-build/reader.html?raw";
import { observeReaderPerformance } from "./ui-performance";
import { QaPerformancePanel } from "./qa-performance-panel";
observeReaderPerformance();

function isCommandName(name: string): name is CommandName {
  return Object.hasOwn(commandSchemas, name);
}

const client: ReaderClient = {
  mode: "website",
  async invoke<K extends CommandName>(
    name: K,
    args: CommandInput<K>,
  ): Promise<CommandResults[K]> {
    const res = await fetch("/__qa-api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, args }),
    });
    const data: unknown = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));
    return parseCommandResult(name, data);
  },
};

function ReaderQaSurface({
  surface,
  showPerformancePanel = true,
}: {
  surface: string;
  showPerformancePanel?: boolean;
}) {
  return (
    <>
      {showPerformancePanel && <QaPerformancePanel surface={surface} />}
      <Reader client={client} />
    </>
  );
}

const qaViewportOptions = [
  { value: "auto", label: "Auto" },
  { value: "390", label: "390" },
  { value: "768", label: "768" },
  { value: "1024", label: "1024" },
  { value: "1440", label: "1440" },
] as const;
type QaViewport = (typeof qaViewportOptions)[number]["value"];

const fixedQaFrameHeight = 800;

function qaFrameStyle(viewport: QaViewport): React.CSSProperties {
  if (viewport === "auto")
    return { width: "100%", height: "100%", border: 0 };
  const width = `${viewport}px`;
  return {
    width,
    minWidth: width,
    height: `${fixedQaFrameHeight}px`,
    minHeight: `${fixedQaFrameHeight}px`,
    border: 0,
    display: "block",
  };
}

function Harness() {
  const [mode, setMode] = useState<"website" | "app">("website");
  const [viewport, setViewport] = useState<QaViewport>("auto");
  const [showFramePerformance, setShowFramePerformance] = useState(false);
  const [message, setMessage] = useState("");
  const [question, setQuestion] = useState<Question | null>(null);
  const [answerDocumentId, setAnswerDocumentId] = useState<DocumentId | null>(
    null,
  );
  const [hostStatus, setHostStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<AppBridge | null>(null);

  const switchMode = (nextMode: "website" | "app") => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setMessage("");
    setQuestion(null);
    setAnswerDocumentId(null);
    setHostStatus("");
  };

  useEffect(() => {
    if (mode !== "app" || !iframeRef.current) return;
    const iframe = iframeRef.current;
    const bridge = new AppBridge(
      null,
      { name: "Local QA host", version: "2.0.0" },
      { serverTools: {}, message: { text: {} } },
    );
    bridgeRef.current = bridge;
    bridge.oncalltool = async ({ name, arguments: args }) => {
      try {
        if (!isCommandName(name)) throw new Error("Unknown command");
        const data = await client.invoke(name, parseCommandInput(name, args));
        if (name === "ask")
          setQuestion(parseCommandResult("ask", data).question);
        return {
          content: [{ type: "text", text: "ok" }],
          structuredContent: { ...data },
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: String(error) }],
        };
      }
    };
    bridge.onmessage = async ({ content }) => {
      setMessage(
        content.map((item) => (item.type === "text" ? item.text : "")).join(""),
      );
      return {};
    };
    bridge.oninitialized = async () => {
      try {
        await bridge.sendToolInput({ arguments: {} });
        await bridge.sendToolResult({
          content: [{ type: "text", text: "Opened" }],
          structuredContent: { ...(await client.invoke("open_document", {})) },
        });
        setHostStatus("App connected");
      } catch (error) {
        setHostStatus(String(error));
      }
    };
    const frameWindow = iframe.contentWindow;
    if (!frameWindow) throw new Error("Missing QA iframe window");
    const transport = new PostMessageTransport(frameWindow, frameWindow);
    void bridge
      .connect(transport)
      .catch((error) => setHostStatus(String(error)));
    iframe.srcdoc = appHtml;
    return () => {
      bridgeRef.current = null;
      void bridge.close();
    };
  }, [mode, viewport]);

  async function respond() {
    if (!question || !bridgeRef.current) return;
    setBusy(true);
    try {
      const result = await createHostAnswer(client, question);
      await bridgeRef.current.sendToolInput({
        arguments:
          result.status === "ready"
            ? { documentId: result.view.document.id, answerFor: question.id }
            : {},
      });
      await bridgeRef.current.sendToolResult({
        content: [
          {
            type: "text",
            text: "Answer written, associated and linked; arrival announced.",
          },
        ],
        structuredContent: { ...result },
      });
      if (result.status === "ready")
        setAnswerDocumentId(result.view.document.id);
      setHostStatus("Host answer announced");
    } catch (error) {
      setHostStatus(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function locateAnswer() {
    if (!answerDocumentId || !bridgeRef.current) return;
    setBusy(true);
    try {
      const result = await client.invoke("open_document", {
        documentId: answerDocumentId,
      });
      await bridgeRef.current.sendToolInput({
        arguments: { documentId: answerDocumentId },
      });
      await bridgeRef.current.sendToolResult({
        content: [{ type: "text", text: "Navigate to this document." }],
        structuredContent: { ...result },
      });
      setHostStatus("Host explicit navigation sent");
    } catch (error) {
      setHostStatus(String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <style>{".qa-reader-container > .reader-shell { height: 100%; }"}</style>
      <div
        style={{
          minHeight: 40,
          padding: "6px 18px",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 16,
          background: "#fff",
          color: "#222",
          fontSize: 12,
        }}
      >
        <strong>LOCAL QA</strong>
        <button onClick={() => switchMode("website")}>Website</button>
        <button onClick={() => switchMode("app")}>MCP App bridge</button>
        <label>
          Viewport{" "}
          <select
            aria-label="Viewport"
            value={viewport}
            onChange={(event) =>
              setViewport(event.target.value as QaViewport)
            }
          >
            {qaViewportOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {mode === "website" && viewport === "auto" && (
          <QaPerformancePanel surface="reader document" placement="toolbar" />
        )}
        {mode === "app" && (
          <QaPerformancePanel
            surface="QA host shell (MCP app iframe not instrumented)"
            placement="toolbar"
          />
        )}
        {mode === "website" && viewport !== "auto" && (
          <button
            type="button"
            aria-pressed={showFramePerformance}
            onClick={() => setShowFramePerformance((shown) => !shown)}
          >
            {showFramePerformance ? "Hide frame performance" : "Show frame performance"}
          </button>
        )}
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const response = await fetch("/__qa-api", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "__benchmark" }),
              });
              if (!response.ok) throw new Error(await response.text());
              window.location.reload();
            } catch (error) {
              setHostStatus(String(error));
              setBusy(false);
            }
          }}
        >
          Load stress fixture
        </button>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const response = await fetch("/__qa-api", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "__reading_fixture" }),
              });
              if (!response.ok) throw new Error(await response.text());
              window.location.reload();
            } catch (error) {
              setHostStatus(String(error));
              setBusy(false);
            }
          }}
        >
          Load reading fixture
        </button>
        <button
          onClick={() =>
            document.dispatchEvent(new Event("qa-reset-performance"))
          }
        >
          Reset performance
        </button>
        {message && <span role="status">Host received question</span>}
        {question && mode === "app" && (
          <button disabled={busy} onClick={() => void respond()}>
            Respond as QA host
          </button>
        )}
        {answerDocumentId && mode === "app" && (
          <button disabled={busy} onClick={() => void locateAnswer()}>
            Locate answer as host
          </button>
        )}
        {hostStatus && <span>{hostStatus}</span>}
      </div>
      <div
        className="qa-reader-container"
        style={{
          width: "100%",
          margin: "0 auto",
          height: "calc(100vh - 40px)",
          overflow: "auto",
        }}
      >
        {mode === "website" ? (
          viewport === "auto" ? (
            <ReaderQaSurface
              surface="reader document"
              showPerformancePanel={false}
            />
          ) : (
            <iframe
              key={`website-${viewport}`}
              title={`Website ${viewport}px test`}
              src={`/__qa?frame=1&qa-performance=${showFramePerformance ? "on" : "off"}`}
              style={qaFrameStyle(viewport)}
            />
          )
        ) : (
          <iframe
            key={`mcp-app-${viewport}`}
            title={`MCP App ${viewport === "auto" ? "auto" : `${viewport}px`} test`}
            ref={iframeRef}
            style={qaFrameStyle(viewport)}
          />
        )}
      </div>
      {message && (
        <details
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            background: "white",
            color: "#222",
            zIndex: 100,
            maxWidth: 800,
          }}
        >
          <summary>Received user message</summary>
          <pre style={{ whiteSpace: "pre-wrap" }}>{message}</pre>
        </details>
      )}
    </>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing QA root");
createRoot(root).render(
  new URLSearchParams(location.search).has("frame") ? (
    <ReaderQaSurface
      surface="reader document (iframe)"
      showPerformancePanel={
        new URLSearchParams(location.search).get("qa-performance") !== "off"
      }
    />
  ) : (
    <Harness />
  ),
);
