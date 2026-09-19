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
  createConnectionInspection,
  emptyAttention,
  readingPosition,
  returnHistoryIndex,
  type AttentionAction,
  type CameraPose,
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
import type {
  ConnectionActivation,
  DocumentRenderContext,
  PresentationRequest,
  RelationNavigationState,
  SurfaceInstanceId,
} from "../lib/reader/spatial-contract";
import {
  createSurfaceInstanceId,
  relationNavigationItems,
  surfaceInstanceId,
} from "../lib/reader/spatial-contract";
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
const FIXTURE_CURRENT_SURFACE_ID = surfaceInstanceId("space-current");

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
      position: readingPosition(documents[0], FIXTURE_CURRENT_SURFACE_ID),
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
  const [presentation, setPresentation] = useState<PresentationRequest>({
    id: 0,
    kind: "layout",
  });
  const presentationRef = useRef(presentation);
  const presentationSequenceRef = useRef(0);
  const requestPresentation = useCallback(
    (
      kind: PresentationRequest["kind"],
      surfaces: readonly SurfaceInstanceId[] = [],
    ) => {
      const id = presentationSequenceRef.current + 1;
      presentationSequenceRef.current = id;
      const next: PresentationRequest =
        kind === "align-ranges"
          ? { id, kind, surfaces: [...new Set(surfaces)] }
          : { id, kind };
      presentationRef.current = next;
      setPresentation(next);
    },
    [],
  );
  const resolve = (position: ReadingSurface["position"]): ReadingSurface => ({
    surfaceId: position.surfaceId,
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
  const dispatchAttention = useCallback(
    (action: AttentionAction) => {
      const attention = stateRef.current.attention;
      if (action.type === "history") {
        requestPresentation("restore");
      } else if (
        action.type === "navigate" ||
        action.type === "compare" ||
        action.type === "inspect-connection" ||
        action.type === "promote" ||
        action.type === "return-to-current" ||
        action.type === "replace-revision"
      ) {
        const surfaces: SurfaceInstanceId[] = [];
        if (action.type === "navigate") surfaces.push(action.position.surfaceId);
        else if (action.type === "compare") {
          if (attention.kind === "reading")
            surfaces.push(attention.current.surfaceId);
          surfaces.push(action.position.surfaceId);
        } else if (action.type === "inspect-connection") {
          const inspection = "inspection" in action ? action.inspection : action;
          surfaces.push(
            inspection.current.surfaceId,
            inspection.companion.surfaceId,
          );
        } else if (attention.kind === "reading") {
          surfaces.push(attention.current.surfaceId);
          if (attention.companion)
            surfaces.push(attention.companion.position.surfaceId);
        }
        requestPresentation("align-ranges", surfaces);
      }
      dispatch(action);
    },
    [requestPresentation],
  );
  const onReadBeside = useCallback(
    (target: DocumentTarget) => {
      const document = revisionRef.current.get(target.revisionId);
      if (!document) return;
      dispatchAttention({
        type: "compare",
        position: readingPosition(
          document,
          createSurfaceInstanceId("companion"),
          target.focus,
          0,
        ),
        reason: { kind: "document" },
      });
    },
    [dispatchAttention],
  );
  const onFollow = useCallback(
    (activation: ConnectionActivation) => {
      const attention = stateRef.current.attention;
      const connection = connections.find(
        (item) => item.id === activation.connectionId,
      );
      if (!connection || attention.kind !== "reading") return;

      const endpointMatches = (
        position: ReadingSurface["position"],
        endpoint: "from" | "to",
      ) => {
        const anchor = connection[endpoint];
        return (
          position.documentId === anchor.documentId &&
          position.revisionId === anchor.revisionId
        );
      };
      let origin: ReadingSurface["position"] | null = null;
      let endpoint: "from" | "to" | null = null;
      if (activation.origin.kind === "surface") {
        const surfaceId = activation.origin.surfaceId;
        if (attention.current.surfaceId === surfaceId)
          origin = attention.current;
        else if (attention.companion?.position.surfaceId === surfaceId)
          origin = attention.companion.position;
        endpoint = activation.origin.endpoint;
        if (!origin || !endpointMatches(origin, endpoint)) return;
      } else {
        for (const position of [
          attention.current,
          attention.companion?.position,
        ]) {
          if (!position) continue;
          const matching = (["from", "to"] as const).find((candidate) =>
            endpointMatches(position, candidate),
          );
          if (matching) {
            origin = position;
            endpoint = matching;
            break;
          }
        }
        if (!origin || !endpoint) return;
      }

      const targetEndpoint = endpoint === "from" ? "to" : "from";
      const existing = [
        attention.current,
        attention.companion?.position,
      ].find(
        (position) =>
          position &&
          position.surfaceId !== origin?.surfaceId &&
          endpointMatches(position, targetEndpoint),
      );
      const companion = existing
        ? { ...existing, focus: { ...connection[targetEndpoint] } }
        : (() => {
            const document = revisionRef.current.get(
              connection[targetEndpoint].revisionId,
            );
            if (!document) return null;
            return readingPosition(
              document,
              createSurfaceInstanceId("connection"),
              connection[targetEndpoint],
              0,
            );
          })();
      if (!companion || !origin || !endpoint) return;
      const inspection = createConnectionInspection(
        connection,
        { ...origin, focus: { ...connection[endpoint] } },
        companion,
        endpoint,
      );
      if (!inspection) return;
      dispatchAttention({ type: "inspect-connection", inspection });
    },
    [dispatchAttention],
  );
  const onSelect = useCallback(
    (selection: AnchorInput) => setSelectedText(selection.quote),
    [],
  );
  const onGeometryChange = useCallback(
    () => controllerRef.current?.measure(),
    [],
  );
  const onPromote = useCallback(
    () => dispatchAttention({ type: "promote" }),
    [dispatchAttention],
  );
  const onReturnToCurrent = useCallback(
    () => dispatchAttention({ type: "return-to-current" }),
    [dispatchAttention],
  );
  const onHistory = useCallback(
    (index: number) => dispatchAttention({ type: "history", index }),
    [dispatchAttention],
  );
  const onScroll = useCallback(
    (surfaceId: SurfaceInstanceId, scrollTop: number, presentationId: number) => {
      if (presentationId !== presentationRef.current.id) return;
      dispatchAttention({ type: "scroll", surfaceId, scrollTop });
    },
    [dispatchAttention],
  );
  const onCameraCheckpoint = useCallback(
    (pose: CameraPose) => dispatchAttention({ type: "camera", pose }),
    [dispatchAttention],
  );
  const onStepConnection = useCallback(
    (direction: -1 | 1) => {
      const attention = stateRef.current.attention;
      if (attention.kind !== "reading") return;
      const items = relationNavigationItems(
        connections,
        attention.current.revisionId,
      );
      if (!items.length) return;
      let selected = -1;
      if (attention.companion?.reason.kind === "connection") {
        const reason = attention.companion.reason;
        selected = items.findIndex(
          (item) =>
            item.connectionId === reason.connectionId &&
            item.endpoint === reason.currentEndpoint,
        );
      }
      const base =
        selected >= 0
          ? selected + direction
          : direction > 0
            ? items.findIndex(
                (item) =>
                  !attention.current.focus ||
                  item.anchor.start >= attention.current.focus.start,
              )
            : [...items]
                .map((item, index) => ({ item, index }))
                .reverse()
                .find(
                  ({ item }) =>
                    !attention.current.focus ||
                    item.anchor.start <= attention.current.focus.start,
                )?.index ?? -1;
      const target = items[base];
      if (!target) return;
      onFollow({
        connectionId: target.connectionId,
        origin: {
          kind: "surface",
          surfaceId: attention.current.surfaceId,
          endpoint: target.endpoint,
        },
      });
    },
    [onFollow],
  );
  const relationNavigation: RelationNavigationState = (() => {
    if (state.attention.kind !== "reading")
      return {
        items: [],
        current: null,
        ordinal: null,
        total: 0,
        canPrevious: false,
        canNext: false,
        loading: false,
        error: null,
      };
    const items = relationNavigationItems(
      connections,
      state.attention.current.revisionId,
    );
    const reason = state.attention.companion?.reason;
    const itemIndex =
      reason?.kind === "connection"
        ? items.findIndex(
            (item) =>
              item.connectionId === reason.connectionId &&
              item.endpoint === reason.currentEndpoint,
          )
        : -1;
    return {
      items,
      current: itemIndex >= 0 ? items[itemIndex] ?? null : null,
      ordinal: itemIndex >= 0 ? itemIndex + 1 : null,
      total: items.length,
      canPrevious: itemIndex > 0,
      canNext: itemIndex >= 0 && itemIndex < items.length - 1,
      loading: false,
      error: null,
    };
  })();
  const renderedConnections = connections;
  const renderDocument = useCallback(
    (
      surface: ReadingSurface,
      _role: "current" | "companion",
      context: DocumentRenderContext,
    ) => (
      <article className="space-fixture-article">
        <DocumentPassage
          document={surface.document}
          surfaceId={surface.surfaceId}
          context={context}
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
  const loadPreview = useCallback(
    async (target: DocumentTarget): Promise<DocumentRevision | null> =>
      revisionRef.current.get(target.revisionId) ?? null,
    [],
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
            onStepConnection={onStepConnection}
            relationNavigation={relationNavigation}
            presentation={presentation}
            onHistory={onHistory}
            onScroll={onScroll}
            onCameraCheckpoint={onCameraCheckpoint}
            renderDocument={renderDocument}
            loadPreview={loadPreview}
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
