import React, { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { Passage } from "../components/reader/passage";
import {
  DocumentId,
  RevisionId,
  Path,
  type AnchorInput,
  type DocumentRevision,
} from "../lib/domain/model";
import { longMarkdown } from "./benchmark-fixture";
import { observeReaderPerformance } from "./ui-performance";
import { QaPerformancePanel } from "./qa-performance-panel";
import "../app/globals.css";
import "../components/reader/reader.css";
observeReaderPerformance();
const content = longMarkdown();
const documentRevision: DocumentRevision = {
  id: DocumentId.parse("11111111-1111-4111-8111-111111111111"),
  path: Path.parse("/benchmark/long.md"),
  title: "长文档性能基线",
  revisionId: RevisionId.parse("22222222-2222-4222-8222-222222222222"),
  sequence: 1,
  format: "markdown",
  content,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  assetId: null,
  archived: false,
  parentId: null,
  isCurrent: true,
};
const quote = "文档具有稳定的身份。";
function anchorAt(section: number): AnchorInput {
  const header = content.indexOf(`## 第 ${section} 节：`);
  const start = content.indexOf(quote, header);
  return {
    revisionId: documentRevision.revisionId,
    start,
    end: start + quote.length,
    quote,
  };
}
const marks = [
  { id: "first", anchor: anchorAt(1), color: "#c7926366" },
  { id: "last", anchor: anchorAt(990), color: "#709fbb66" },
];
function RendererHarness() {
  const [selection, setSelection] = useState<AnchorInput | null>(null);
  const [focus, setFocus] = useState<AnchorInput | null>(null);
  const [transformed, setTransformed] = useState(false);
  const onSelect = useCallback(
    (anchor: AnchorInput) => setSelection(anchor),
    [],
  );
  return (
    <main
      style={{
        height: "100vh",
        background: "#171c23",
        color: "#eee",
        padding: 20,
      }}
    >
      <QaPerformancePanel surface="renderer document" />
      <div style={{ display: "flex", gap: 20, marginBottom: 15 }}>
        <strong>Renderer QA</strong>
        <button onClick={() => setFocus(anchorAt(1))}>Focus first</button>
        <button onClick={() => setFocus(anchorAt(990))}>
          Focus far passage
        </button>
        <button onClick={() => setFocus(null)}>Clear focus</button>
        <button onClick={() => setTransformed(!transformed)}>
          Toggle 3D transform
        </button>
        <button
          onClick={() =>
            document.dispatchEvent(new Event("qa-reset-performance"))
          }
        >
          Reset performance
        </button>
      </div>
      <div
        style={{
          perspective: 1200,
          display: "flex",
          gap: 24,
          height: "calc(100vh - 85px)",
        }}
      >
        <div
          data-document-scroll
          style={{
            overflowY: "auto",
            width: 660,
            height: "100%",
            padding: "24px 38px",
            background: "#f1ede4",
            color: "#2d2d2b",
            transform: transformed ? "rotateY(16deg) scale(.86)" : "none",
            transformOrigin: "left center",
          }}
        >
          <Passage
            doc={documentRevision}
            onSelect={onSelect}
            focus={focus}
            marks={marks}
          />
        </div>
        <aside style={{ width: 400 }}>
          <label>
            Question draft
            <textarea
              aria-label="Question draft"
              style={{
                display: "block",
                width: "100%",
                height: 120,
                background: "white",
                color: "#222",
              }}
            />
          </label>
          <output aria-label="Selected source">
            {selection ? JSON.stringify(selection, null, 2) : "Select text"}
          </output>
        </aside>
      </div>
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing root");
createRoot(root).render(<RendererHarness />);
