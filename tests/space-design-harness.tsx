import React, {
  useCallback,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  SpatialScene,
  type SpatialSceneController,
} from "../components/reader/spatial-scene";
import { DocumentPassage } from "../components/reader/document-passage";
import {
  attentionReducer,
  createConnectionInspection,
  emptyAttention,
  focusedPosition,
  primarySurfaceId,
  type AttentionAction,
} from "../lib/reader/attention";
import {
  AnchorId,
  ConnectionId,
  DocumentId,
  Path,
  RevisionId,
  type Connection,
  type DocumentRevision,
} from "../lib/domain/model";
import {
  relationNavigationItems,
  type ReadingSurface,
  type ConnectionActivation,
  type DocumentRenderContext,
  type PresentationRequest,
  type RelationNavigationState,
} from "../lib/reader/spatial-contract";
import { observeReaderPerformance } from "./ui-performance";
import { QaPerformancePanel } from "./qa-performance-panel";
import { readerPaletteStyle } from "../lib/reader/semantic-palette";
import "../app/globals.css";
import "../components/reader/reader.css";
import "../components/reader/reader-palette.css";
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
  const [narrowFrame, setNarrowFrame] = useState(false),
    [shortFrame, setShortFrame] = useState(false),
    [inputOnlyControl, setInputOnlyControl] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const controllerRef = useRef<SpatialSceneController>(null);
  const [state, dispatch] = useReducer(attentionReducer, undefined, () => {
    let initial = attentionReducer(emptyAttention(), {
      type: "catalogue",
      documents,
    });
    initial = attentionReducer(initial, {
      type: "bind-connections",
      connections,
    });
    return attentionReducer(initial, {
      type: "focus-surface",
      surfaceId: primarySurfaceId(documents[0].id, documents[0].revisionId),
    });
  });
  const [presentation, setPresentation] = useState<PresentationRequest>({
    id: 0,
    kind: "layout",
  });
  const navigate = useCallback((action: AttentionAction) => {
    controllerRef.current?.cancelInput();
    setPresentation((previous) =>
      action.type === "history"
        ? { id: previous.id + 1, kind: "restore" }
        : {
            id: previous.id + 1,
            kind: "align-ranges",
            surfaces:
              action.type === "inspect-connection"
                ? [
                    action.inspection.current.surfaceId,
                    action.inspection.companion.surfaceId,
                  ]
                : action.type === "focus-surface"
                  ? [action.surfaceId]
                  : [],
          },
    );
    dispatch(action);
  }, []);
  const revisions = useMemo(
    () => new Map(documents.map((d) => [d.revisionId, d])),
    [],
  );
  const surfaces = useMemo(
    () =>
      [...state.space.surfaces.values()].map((position) => ({
        surfaceId: position.surfaceId,
        position,
        metadata: position.metadata,
        document: revisions.get(position.revisionId) ?? null,
        payload: "ready" as const,
        error: null,
      })),
    [state.space, revisions],
  );
  const bindings = useMemo(
    () =>
      connections.flatMap((connection) => {
        const bound = state.bindings.get(connection.id);
        return bound
          ? [
              {
                connectionId: connection.id,
                from: { surfaceId: bound.from, anchor: connection.from },
                to: { surfaceId: bound.to, anchor: connection.to },
              },
            ]
          : [];
      }),
    [state.bindings],
  );
  const onFollow = useCallback(
    (activation: ConnectionActivation) => {
      const connection = connections.find(
          (c) => c.id === activation.connectionId,
        ),
        bound = state.bindings.get(activation.connectionId);
      if (!connection || !bound) return;
      const endpoint =
        activation.origin.kind === "surface"
          ? activation.origin.endpoint
          : state.view.focus === bound.to
            ? "to"
            : "from";
      const source = state.space.surfaces.get(
        activation.origin.kind === "surface"
          ? activation.origin.surfaceId
          : bound[endpoint],
      );
      const target = state.space.surfaces.get(
        bound[endpoint === "from" ? "to" : "from"],
      );
      if (!source || !target) return;
      const inspection = createConnectionInspection(
        connection,
        source,
        target,
        endpoint,
      );
      if (inspection) navigate({ type: "inspect-connection", inspection });
    },
    [state, navigate],
  );
  const current = focusedPosition(state);
  const items = current
    ? relationNavigationItems(connections, current.revisionId)
    : [];
  const relationNavigation: RelationNavigationState = {
    items,
    current: null,
    ordinal: null,
    total: items.length,
    canPrevious: false,
    canNext: items.length > 0,
    loading: false,
    error: null,
  };
  const renderDocument = useCallback(
    (surface: ReadingSurface, context: DocumentRenderContext) => (
      <article className="space-fixture-article">
        <DocumentPassage
          document={surface.document}
          surfaceId={surface.surfaceId}
          context={context}
          focus={surface.position.focus}
          connections={connections}
          onSelectText={(anchor) => setSelectedText(anchor.quote)}
          onActivateConnection={onFollow}
        />
      </article>
    ),
    [onFollow],
  );
  return (
    <main className="space-fixture reader-palette" style={readerPaletteStyle}>
      <QaPerformancePanel
        surface={framed ? "space document (iframe)" : "space harness"}
      />
      <style>{`.space-fixture{height:100dvh;background:var(--sb-canvas);color:var(--sb-text);display:flex;flex-direction:column}.space-fixture-tools{display:flex;gap:20px;align-items:center;padding:10px 18px;font:13px var(--reading-sans)}.space-fixture-tools button{color:inherit;background:transparent;border:1px solid var(--sb-control-border);padding:5px 10px}.space-fixture-stage{display:flex;flex:1;min-height:0}.space-fixture-article{padding:30px 36px;font:17px/1.78 var(--reading-serif)}.space-fixture-article h1{font:500 27px/1.4 var(--reading-serif)}.space-fixture-article header p{font:12px var(--reading-sans);color:var(--sb-muted)}.space-fixture-selection{position:fixed;bottom:8px;left:8px;z-index:200;max-width:440px;background:var(--sb-chrome-panel);color:var(--sb-chrome-text);padding:8px;font-size:12px}`}</style>
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
            surfaces={surfaces}
            bindings={bindings}
            view={state.view}
            documents={documents}
            catalogue={{
              activeComplete: true,
              archivedComplete: true,
              loading: false,
            }}
            neighborhood={{ kind: "idle" }}
            connections={connections}
            selectedConnectionId={state.selectedConnectionId}
            onFocusSurface={(surfaceId) =>
              navigate({ type: "focus-surface", surfaceId })
            }
            onDemandSurfaces={() => {}}
            onRetrySurface={() => {}}
            onFollow={onFollow}
            onStepConnection={() => {}}
            relationNavigation={relationNavigation}
            presentation={presentation}
            onHistory={(index) => navigate({ type: "history", index })}
            onScroll={(surfaceId, scrollTop, generation) => {
              if (generation === presentation.id)
                dispatch({ type: "scroll", surfaceId, scrollTop });
            }}
            onViewCheckpoint={({ view, generation }) => {
              if (generation === presentation.id)
                dispatch({ type: "view", view });
            }}
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
