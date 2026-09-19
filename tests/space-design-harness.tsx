import React, {
  useCallback,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  SpatialScene,
  type ReadingSurface,
  type SpatialSceneController,
} from "../components/reader/spatial-scene";
import { DocumentPassage } from "../components/reader/document-passage";
import {
  attentionReducer,
  emptyAttention,
  readingPosition,
  returnHistoryIndex,
  type CameraPose,
  type SurfaceRole,
} from "../lib/reader/attention";
import {
  AnchorId,
  ConnectionId,
  DocumentId,
  Path,
  RevisionId,
  type AnchorInput,
  type Connection,
  type DocumentRevision,
} from "../lib/domain/model";
import type { NeighborhoodNode } from "../lib/domain/space";
import type { DocumentTarget } from "../lib/reader/space-index";
import { observeReaderPerformance } from "./ui-performance";
import { QaPerformancePanel } from "./qa-performance-panel";
import "../app/globals.css";
import "../components/reader/reader.css";

observeReaderPerformance();
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const opening =
  "阅读并不总是沿着一条直线向前。我们停在一句话上，想起另一篇文章，转身寻找一个反例，再回来重读这句话。\n\n## 让两处文字同时可见\n\n文档具有稳定的身份。连接指向某个版本中的具体文字。把另一篇文章放到身边，便能同时看见论述与回应。\n\n一篇回答仍然是独立的文档。它可以回应眼前的问题，也可以与更远处的文字建立新的关系。\n\n## 从这里继续\n\n旁读不会替换正在读的这一页。等你决定继续读另一篇，当前的纸页便退到周边，保留返回原处的线索。";
const documents: DocumentRevision[] = Array.from({ length: 120 }, (_, i) => ({
  id: DocumentId.parse(uuid(i + 1)),
  revisionId: RevisionId.parse(uuid(i + 1001)),
  path: Path.parse(`/papers/${String(i).padStart(3, "0")}.md`),
  title:
    i === 0
      ? "纸页之间，思想的形状"
      : i === 1
        ? "连接不是回答的附属物"
        : i === 2
          ? "一个尚未连接的念头"
          : i % 11 === 0
            ? `文档 ${i}：一段足够长、需要在折页中完整读出的标题 Reading between documents without losing where you came from`
            : `纸场札记 ${i}`,
  content:
    i === 0
      ? opening
      : `一篇文档的意义，常常在另一篇文档旁边变得清楚。\n\n## 第 ${i} 个侧面\n\n${opening}`,
  sequence: 1,
  format: "markdown",
  parentId: null,
  isCurrent: true,
  createdAt: "2026-09-18T00:00:00.000Z",
  updatedAt: "2026-09-18T00:00:00.000Z",
  assetId: null,
  archived: i > 115,
}));
const quote = "文档具有稳定的身份。";
const anchor = (document: DocumentRevision, n: number) => {
  const start = document.content.indexOf(quote);
  return {
    id: AnchorId.parse(uuid(3000 + n)),
    documentId: document.id,
    revisionId: document.revisionId,
    start,
    end: start + quote.length,
    quote,
  };
};
const connections: Connection[] = documents
  .slice(3, 103)
  .concat(documents[1])
  .map((document, i) => ({
    id: ConnectionId.parse(uuid(4000 + i)),
    from: anchor(documents[0], i * 2),
    to: anchor(document, i * 2 + 1),
    relation: i % 2 ? "explanation" : "reference",
    label: `阅读 ${document.title}`,
    createdAt: "2026-09-18T00:00:00.000Z",
  }));

function SpaceDesignHarness() {
  const framed = new URLSearchParams(location.search).has("frame");
  const [narrowFrame, setNarrowFrame] = useState(false);
  const [shortFrame, setShortFrame] = useState(false);
  const [inputOnlyControl, setInputOnlyControl] = useState(false);
  const controllerRef = useRef<SpatialSceneController>(null);
  const [selectedText, setSelectedText] = useState("");
  const [state, dispatch] = useReducer(attentionReducer, undefined, () =>
    attentionReducer(emptyAttention(), {
      type: "navigate",
      position: readingPosition(documents[0]),
    }),
  );
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);
  const revisions = useMemo(
    () => new Map(documents.map((document) => [document.revisionId, document])),
    [],
  );
  const revisionRef = useRef(revisions);
  const resolve = (position: ReadingSurface["position"]): ReadingSurface => ({
    position,
    document: revisions.get(position.revisionId)!,
  });
  const current =
    state.attention.kind === "reading"
      ? resolve(state.attention.current)
      : null;
  const companion =
    state.attention.kind === "reading" && state.attention.companion
      ? resolve(state.attention.companion.position)
      : null;
  const previousIndex = returnHistoryIndex(state);
  const previous = previousIndex === null ? null : state.history[previousIndex];
  const previousPosition =
    previous?.attention.kind === "reading" ? previous.attention.current : null;
  const nodes: NeighborhoodNode[] = connections.flatMap((connection) => {
    if (!current) return [];
    const endpoint =
      connection.from.revisionId === current.position.revisionId
        ? connection.to
        : connection.to.revisionId === current.position.revisionId
          ? connection.from
          : null;
    if (!endpoint) return [];
    return [
      {
        document: revisions.get(endpoint.revisionId)!,
        revisionId: endpoint.revisionId,
        sequence: 1,
        distance: 1 as const,
        viaRevisionId: null,
        connectionId: connection.id,
      },
    ];
  });
  const onReadBeside = useCallback(
    (target: DocumentTarget) =>
      dispatch({
        type: "compare",
        position: { ...target, scrollTop: 0 },
        reason: { kind: "document" },
      }),
    [],
  );
  const onFollow = useCallback((id: ConnectionId) => {
    const attention = stateRef.current.attention;
    const connection = connections.find((item) => item.id === id);
    if (!connection || attention.kind !== "reading") return;
    const endpoint =
      connection.from.revisionId === attention.current.revisionId
        ? connection.to
        : connection.from;
    const document = revisionRef.current.get(endpoint.revisionId)!;
    const start = document.content.indexOf(quote);
    dispatch({
      type: "compare",
      position: readingPosition(document, {
        revisionId: document.revisionId,
        start,
        end: start + quote.length,
        quote,
      }),
      reason: { kind: "connection", connectionId: id },
    });
  }, []);
  const onSelect = useCallback(
    (selection: AnchorInput) => setSelectedText(selection.quote),
    [],
  );
  const onGeometryChange = useCallback(
    () => controllerRef.current?.measure(),
    [],
  );
  const onPromote = useCallback(() => dispatch({ type: "promote" }), []);
  const onReturnToCurrent = useCallback(
    () => dispatch({ type: "return-to-current" }),
    [],
  );
  const onHistory = useCallback(
    (index: number) => dispatch({ type: "history", index }),
    [],
  );
  const onScroll = useCallback(
    (role: SurfaceRole, scrollTop: number) =>
      dispatch({ type: "scroll", role, scrollTop }),
    [],
  );
  const onCameraCheckpoint = useCallback(
    (pose: CameraPose) => dispatch({ type: "camera", pose }),
    [],
  );
  const renderedConnections = connections;
  const renderDocument = useCallback(
    (surface: ReadingSurface) => (
      <article className="space-fixture-article">
        <header>
          <h1>{surface.document.title}</h1>
          <p>
            {surface.document.path} · v{surface.document.sequence}
          </p>
        </header>
        <DocumentPassage
          document={surface.document}
          focus={surface.position.focus}
          connections={renderedConnections}
          onSelectText={onSelect}
          onActivateConnection={onFollow}
          onGeometryChange={onGeometryChange}
        />
      </article>
    ),
    [onFollow, onSelect, onGeometryChange, renderedConnections],
  );
  return (
    <main className="space-fixture">
      <QaPerformancePanel
        surface={framed ? "space document (iframe)" : "space harness"}
      />
      <style>{`.space-fixture{height:100dvh;background:var(--space-stage);color:var(--space-paper);display:flex;flex-direction:column}.space-fixture-tools{display:flex;gap:20px;align-items:center;padding:10px 18px;font:13px var(--reading-sans)}.space-fixture-tools button{color:inherit;background:transparent;border:1px solid #59616c;padding:5px 10px}.space-fixture-stage{display:flex;flex:1;min-height:0}.space-fixture-article{padding:30px 36px;font:17px/1.78 var(--reading-serif)}.space-fixture-article h1{font:500 27px/1.4 var(--reading-serif)}.space-fixture-article header p{font:12px var(--reading-sans);color:var(--space-muted)}.space-fixture-selection{position:fixed;bottom:8px;left:8px;z-index:200;max-width:440px;background:#1b222b;color:#fff;padding:8px;font-size:12px}`}</style>
      {!framed && (
        <div className="space-fixture-tools">
          <strong>空间交互样机</strong>
          <span>120 份文档 / 101 个近邻</span>
          <button
            onClick={() =>
              document.dispatchEvent(new Event("qa-reset-performance"))
            }
          >
            Reset performance
          </button>
          <button onClick={() => setNarrowFrame(!narrowFrame)}>
            {narrowFrame ? "Desktop width" : "390px frame"}
          </button>
          <button onClick={() => setShortFrame(!shortFrame)}>
            {shortFrame ? "Full height" : "360px height"}
          </button>
          <button onClick={() => setInputOnlyControl(!inputOnlyControl)}>
            {inputOnlyControl ? "Enable camera" : "Input-only control"}
          </button>
        </div>
      )}
      <div
        className="space-fixture-stage"
        style={{
          position: "relative",
          ...(shortFrame ? { flex: "none", height: 360 } : {}),
        }}
      >
        {narrowFrame ? (
          <iframe
            title="Narrow paper space"
            src="/__space?frame=1"
            style={{
              width: 390,
              maxWidth: "100%",
              height: "100%",
              border: 0,
              margin: "0 auto",
            }}
          />
        ) : (
          <SpatialScene
            controllerRef={controllerRef}
            current={current}
            companion={companion}
            previous={
              previousPosition && previousIndex !== null
                ? {
                    position: previousPosition,
                    document: revisions.get(previousPosition.revisionId)!,
                    historyIndex: previousIndex,
                  }
                : null
            }
            camera={state.camera}
            documents={documents}
            catalogue={{
              activeComplete: true,
              archivedComplete: true,
              loading: false,
            }}
            neighborhood={
              current
                ? {
                    kind: "complete",
                    centerRevisionId: current.position.revisionId,
                    nodes,
                  }
                : { kind: "idle" }
            }
            connections={renderedConnections}
            selectedConnectionId={
              state.attention.kind === "reading" &&
              state.attention.companion?.reason.kind === "connection"
                ? state.attention.companion.reason.connectionId
                : null
            }
            pending={null}
            onReadBeside={onReadBeside}
            onPromote={onPromote}
            onReturnToCurrent={onReturnToCurrent}
            onFollow={onFollow}
            onHistory={onHistory}
            onScroll={onScroll}
            onCameraCheckpoint={onCameraCheckpoint}
            renderDocument={renderDocument}
          />
        )}
        {inputOnlyControl && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 1000,
              touchAction: "none",
              userSelect: "none",
            }}
          />
        )}
      </div>
      {selectedText && (
        <output className="space-fixture-selection">{selectedText}</output>
      )}
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing space fixture root");
createRoot(root).render(<SpaceDesignHarness />);
