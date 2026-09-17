import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { Reader } from "../components/reader/reader";
import type { ReaderClient } from "../lib/client/reader-client";
import type {
  CommandName,
  CommandInput,
  CommandResults,
} from "../lib/domain/commands";
import "../app/globals.css";
import appHtml from "../.app-build/reader.html?raw";
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
    const data = (await res.json()) as { error?: { message?: string } };
    if (!res.ok) throw new Error(data.error?.message ?? "QA request failed");
    return data as CommandResults[K];
  },
};
function Harness() {
  const [mode, setMode] = useState<"website" | "app">("website"),
    [mobile, setMobile] = useState(false),
    [message, setMessage] = useState("");
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (mode !== "app" || !ref.current) return;
    const iframe = ref.current;
    const bridge = new AppBridge(
      null,
      { name: "Local QA host", version: "1.0.0" },
      { serverTools: {}, message: { text: {} } },
    );
    bridge.oncalltool = async ({ name, arguments: args }) => {
      try {
        const data = await client.invoke(name as CommandName, args as never);
        return {
          content: [{ type: "text", text: "ok" }],
          structuredContent: data as unknown as Record<string, unknown>,
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: String(e) }] };
      }
    };
    bridge.onmessage = async ({ content }) => {
      setMessage(
        content.map((c) => (c.type === "text" ? c.text : "")).join(""),
      );
      return {};
    };
    bridge.oninitialized = async () => {
      await bridge.sendToolInput({ arguments: {} });
      await bridge.sendToolResult({
        content: [{ type: "text", text: "Opened" }],
        structuredContent: (await client.invoke(
          "open_document",
          {},
        )) as unknown as Record<string, unknown>,
      });
    };
    const transport = new PostMessageTransport(
      iframe.contentWindow!,
      iframe.contentWindow!,
    );
    void bridge.connect(transport);
    iframe.srcdoc = appHtml;
    return () => {
      void bridge.close();
    };
  }, [mode]);
  return (
    <>
      <div
        style={{
          height: 40,
          padding: "6px 18px",
          display: "flex",
          gap: 20,
          background: "#fff",
          fontSize: 14,
        }}
      >
        <strong>LOCAL QA</strong>
        <button onClick={() => setMode("website")}>Website</button>
        <button onClick={() => setMode("app")}>MCP App bridge</button>
        <button onClick={() => setMobile(!mobile)}>
          {mobile ? "Desktop" : "Mobile width"}
        </button>
        {message && <span role="status">Host received question</span>}
      </div>
      <div
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
            ref={ref}
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
createRoot(document.getElementById("root")!).render(
  new URLSearchParams(location.search).has("frame") ? (
    <Reader client={client} />
  ) : (
    <Harness />
  ),
);
