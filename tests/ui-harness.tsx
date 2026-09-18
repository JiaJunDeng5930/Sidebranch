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
import type { Question } from "../lib/domain/model";
import { createHostAnswer } from "./ui-host-answer";
import "../app/globals.css";
import appHtml from "../.app-build/reader.html?raw";
import { observeReaderPerformance } from "./ui-performance";
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

function Harness() {
  const [mode, setMode] = useState<"website" | "app">("website");
  const [mobile, setMobile] = useState(false);
  const [message, setMessage] = useState("");
  const [question, setQuestion] = useState<Question | null>(null);
  const [hostStatus, setHostStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<AppBridge | null>(null);

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
  }, [mode]);

  async function respond() {
    if (!question || !bridgeRef.current) return;
    setBusy(true);
    try {
      const result = await createHostAnswer(client, question);
      await bridgeRef.current.sendToolInput({
        arguments:
          result.status === "ready"
            ? { documentId: result.view.document.id }
            : {},
      });
      await bridgeRef.current.sendToolResult({
        content: [
          {
            type: "text",
            text: "Answer written, associated and linked; document opened.",
          },
        ],
        structuredContent: { ...result },
      });
      setHostStatus("Host answer opened");
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
        <button onClick={() => setMode("website")}>Website</button>
        <button onClick={() => setMode("app")}>MCP App bridge</button>
        <button onClick={() => setMobile(!mobile)}>
          {mobile ? "Desktop" : "Mobile width"}
        </button>
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
        {hostStatus && <span>{hostStatus}</span>}
      </div>
      <div
        className="qa-reader-container"
        style={{
          width: mobile ? 390 : "100%",
          margin: "0 auto",
          height: "calc(100vh - 40px)",
        }}
      >
        {mode === "website" ? (
          mobile ? (
            <iframe
              title="Mobile website test"
              src="/__qa?frame=1"
              style={{ width: "100%", height: "100%", border: 0 }}
            />
          ) : (
            <Reader client={client} />
          )
        ) : (
          <iframe
            title="MCP App test"
            ref={iframeRef}
            style={{ width: "100%", height: "100%", border: 0 }}
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
    <Reader client={client} />
  ) : (
    <Harness />
  ),
);
