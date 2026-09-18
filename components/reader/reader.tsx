"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FolderOpen,
  History,
  Link2,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  PenLine,
  Plus,
  Search,
  Send,
  Settings2,
  Upload,
  X,
} from "lucide-react";
import {
  ReaderDialog,
  ReaderDialogContent,
  ReaderDialogDescription,
  ReaderDialogTitle,
  ReaderMenu,
  ReaderMenuItem,
  ReaderMenuLink,
  ReaderMenuSeparator,
} from "./workspace-controls";
import {
  readerSessionReducer,
  createContextFromView,
  emptySession,
  type ConnectionDraft,
  type ReaderSession,
  type ReaderViewTarget,
} from "../../lib/reader/session";
import { SpatialScene } from "./spatial-scene";
import type {
  RelatedProjection,
  SpatialSceneController,
} from "./spatial-scene";
import {
  createViewId,
  emptyScene,
  sceneReducer,
  type DocumentView,
  type SceneAction,
  type SceneState,
  type ViewId,
} from "../../lib/reader/scene";
import { DocumentPassage } from "./document-passage";
import { relationNames, relationColors } from "../../lib/reader/relations";
import { registerReadingTools } from "../../lib/client/webmcp";
import type { ReaderClient } from "../../lib/client/reader-client";
import { questionPrompt } from "../../lib/client/reader-client";
import type { CommandInput } from "../../lib/domain/commands";
import {
  AnchorInput,
  Path,
  RevisionId,
  validateAnchor,
  type Connection,
  type DocumentId,
  type DocumentRevision,
  type DocumentSummary,
  type OpenDocumentResult,
  type Question,
  type ReadingView,
} from "../../lib/domain/model";
import "./reader.css";

type Relation = Connection["relation"];
const NO_CONNECTIONS: readonly Connection[] = [];

type Match = {
  document: DocumentSummary;
  excerpt: string;
  start: number;
  end: number;
  revisionId?: RevisionId;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}

function isReady(
  result: OpenDocumentResult,
): result is Extract<OpenDocumentResult, { status: "ready" }> {
  return result.status === "ready";
}

function makeAnchor(
  document: DocumentRevision,
  start: number,
  end: number,
): AnchorInput | null {
  if (start < 0 || end <= start || end > document.content.length) return null;
  const quote = document.content.slice(start, end);
  try {
    validateAnchor(document.content, {
      revisionId: document.revisionId,
      start,
      end,
      quote,
    });
    return { revisionId: document.revisionId, start, end, quote };
  } catch {
    return null;
  }
}

function folderName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join(" / ") : "根目录";
}

function targetFromScene(
  view: DocumentView,
  role: "current" | "companion",
): ReaderViewTarget {
  return {
    viewId: view.id,
    document: view.document,
    role,
    focus: view.focus,
    scrollTop: view.scrollTop,
  };
}

export function Reader({
  client,
  initialView,
  onReady,
}: {
  client: ReaderClient;
  initialView?: OpenDocumentResult | null;
  onReady?: (accept: (value: OpenDocumentResult) => void) => void;
}) {
  const [session, dispatchSession] = useReducer(
    readerSessionReducer,
    undefined,
    emptySession,
  );
  const [scene, setScene] = useState<SceneState>(emptyScene);
  const [searchMatches, setSearchMatches] = useState<readonly Match[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [historyItems, setHistoryItems] = useState<
    readonly Omit<DocumentRevision, "content">[]
  >([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [importReport, setImportReport] = useState<readonly string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const sceneControllerRef = useRef<SpatialSceneController | null>(null);
  const cataloguePromiseRef = useRef<{ archived: boolean; promise: Promise<void> } | null>(null);
  const catalogueRequestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const openRequestRef = useRef(0);
  const questionSubmissionRef = useRef<Promise<void> | null>(null);
  const historyRequestRef = useRef(0);
  const relatedRequestRef = useRef(0);
  const revisionPromisesRef = useRef(
    new Map<string, Promise<DocumentRevision>>(),
  );
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const initialResultRef = useRef<OpenDocumentResult | null>(null);
  const navigationEpochRef = useRef(0);
  const relationRequestRef = useRef(0);
  const loadedRelationsRef = useRef<RevisionId | null>(null);
  const historyRevisionRequestRef = useRef(0);
  const dispatchScene = useCallback((action: SceneAction) => {
    const next = sceneReducer(sceneRef.current, action);
    if (next === sceneRef.current) return;
    sceneRef.current = next;
    setScene(next);
  }, []);
  const firstDocumentOpenedRef = useRef(false);
  const dispatchSceneAction = useCallback((action: SceneAction) => {
    const navigation = ["history-back", "history-forward", "promote-view", "close-view"].includes(action.type);
    if (navigation) {
      navigationEpochRef.current++;
      openRequestRef.current++;
      relatedRequestRef.current++;
    }
    dispatchScene(action);
    if (navigation) syncSessionToScene(sceneRef.current);
  }, [dispatchScene]);

  function syncSessionToScene(next: SceneState) {
    if (!next.currentViewId) {
      dispatchSession({
        type: "context/sync-scene",
        current: null,
        companion: null,
      });
      return;
    }
    const current = next.views.find((view) => view.id === next.currentViewId);
    if (!current) return;
    const companion = next.companionViewId
      ? next.views.find((view) => view.id === next.companionViewId) ?? null
      : null;
    dispatchSession({
      type: "context/sync-scene",
      current: targetFromScene(current, "current"),
      companion: companion ? targetFromScene(companion, "companion") : null,
    });
  }

  const commitViewToSession = useCallback(
    (
      view: ReadingView,
      viewId?: ViewId,
      focus?: AnchorInput | null,
    ) => {
      loadedRelationsRef.current = view.connectionsNextCursor || view.questionsNextCursor ? null : view.document.revisionId;
      const previous = sessionRef.current.active;
      const nextViewId =
        viewId ??
        sceneRef.current.views.find(
          (item) => item.document.revisionId === view.document.revisionId,
        )?.id ??
        createViewId(
          view.document.id + ":" + view.document.revisionId + ":current",
        );
      const previousCurrent =
        previous &&
        previous.current.document.revisionId !== view.document.revisionId
          ? { ...previous.current, role: "companion" as const }
          : null;
      const preservedCompanion =
        previous?.companion &&
        previous.companion.document.revisionId !== view.document.revisionId
          ? { ...previous.companion, role: "companion" as const }
          : null;
      const catalogue = sessionRef.current.documents;
      const base = createContextFromView(
        view,
        catalogue,
        nextViewId,
      );
      const previousTarget =
        previous?.current.document.revisionId === view.document.revisionId
          ? previous.current
          : sceneRef.current.views.find(
              (item) => item.document.revisionId === view.document.revisionId,
            );
      const context = {
        ...base,
        current: {
          ...base.current,
          focus: focus === undefined ? previousTarget?.focus ?? null : focus,
          scrollTop: previousTarget?.scrollTop ?? 0,
        },
        companion: previousCurrent ?? preservedCompanion,
        mode: previous?.mode ?? base.mode,
      };
      dispatchSession({ type: "cache/revision", revision: view.document });
      dispatchSession({
        type: "context/open",
        context,
      });
    },
    [],
  );

  const acceptHostResult = useCallback(
    (result: OpenDocumentResult) => {
      navigationEpochRef.current++;
      openRequestRef.current++;
      relatedRequestRef.current++;
      if (!isReady(result)) {
        dispatchSession({ type: "loading", loading: false });
        dispatchSession({
          type: "status",
          message: "文档空间还是空的，可以从目录新建或导入一份文档。",
        });
        return;
      }
      const document = result.view.document;
      const id =
        sceneRef.current.views.find(
          (view) => view.document.revisionId === document.revisionId,
        )?.id ??
        createViewId(document.id + ":" + document.revisionId + ":host");
      dispatchScene({
        type: "open-document",
        document,
        viewId: id,
        role: "current",
      });
      commitViewToSession(result.view, id);
      dispatchSession({ type: "status", message: null });
    },
    [commitViewToSession],
  );

  useEffect(() => {
    if (!onReady) return;
    onReady(acceptHostResult);
  }, [acceptHostResult, onReady]);

  useEffect(() => {
    if (initialView === undefined || initialView === null) return;
    if (initialResultRef.current === initialView) return;
    initialResultRef.current = initialView;
    acceptHostResult(initialView);
  }, [acceptHostResult, initialView]);

  useEffect(() => {
    if (client.mode !== "website") return;
    return registerReadingTools(client, acceptHostResult);
  }, [acceptHostResult, client]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        dispatchSession({ type: "dialog/open-search" });
        return;
      }
      if (event.key === "Escape") {
        const current = sessionRef.current;
        if (
          current.selection.kind === "selected" ||
          current.question.kind !== "closed" ||
          current.connection.kind !== "closed"
        ) {
          dispatchSession({ type: "selection/clear" });
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const loadCatalogue = useCallback(
    async (archived = sessionRef.current.archived, force = false) => {
      if (!force && cataloguePromiseRef.current?.archived === archived) return cataloguePromiseRef.current.promise;
      const requestId = catalogueRequestRef.current + 1;
      catalogueRequestRef.current = requestId;
      const run = (async () => {
        dispatchSession({ type: "catalogue/load-start", archived });
        let cursor: string | undefined;
        let offset = 0;
        const seen = new Set<string>();
        try {
          for (;;) {
            const args: CommandInput<"ls"> & {
              cursor?: string;
            } = { limit: 200, offset, archived };
            if (cursor) args.cursor = cursor;
            const result = await client.invoke("ls", args);
            if (catalogueRequestRef.current !== requestId) return;
            dispatchSession({
              type: "catalogue/page",
              documents: result.documents,
              complete: false,
            });
            const nextCursor = (() => {
              if (
                typeof result === "object" &&
                result !== null &&
                "nextCursor" in result
              ) {
                const value = result.nextCursor;
                return typeof value === "string" && value ? value : null;
              }
              return null;
            })();
            const nextOffset =
              typeof result.nextOffset === "number"
                ? result.nextOffset
                : null;
            if (nextCursor !== null) {
              if (seen.has("cursor:" + nextCursor)) break;
              seen.add("cursor:" + nextCursor);
              cursor = nextCursor;
              offset = 0;
              continue;
            }
            if (nextOffset !== null) {
              if (seen.has("offset:" + nextOffset)) break;
              seen.add("offset:" + nextOffset);
              offset = nextOffset;
              continue;
            }
            break;
          }
          if (catalogueRequestRef.current === requestId)
            dispatchSession({
              type: "catalogue/page",
              documents: [],
              complete: true,
            });
        } catch (error) {
          if (catalogueRequestRef.current === requestId)
            dispatchSession({
              type: "catalogue/error",
              message: errorMessage(error),
            });
        } finally {
          if (catalogueRequestRef.current === requestId)
            cataloguePromiseRef.current = null;
        }
      })();
      cataloguePromiseRef.current = { archived, promise: run };
      return run;
    },
    [client],
  );

  useEffect(() => {
    void loadCatalogue();
  }, [loadCatalogue]);

  const readOpenResult = useCallback(
    async (
      args: CommandInput<"open_document">,
    ): Promise<ReadingView | null> => {
      type PagedOpenArgs = CommandInput<"open_document"> & {
        connectionsCursor?: string;
        questionsCursor?: string;
        connectionsLimit?: number;
        questionsLimit?: number;
      };
      let connectionsCursor: string | undefined;
      let questionsCursor: string | undefined;
      let connectionsDone = false, questionsDone = false;
      const seen = new Set<string>();
      let merged: ReadingView | null = null;
      for (;;) {
        const request: PagedOpenArgs = {
          ...args,
          connectionsLimit: 200,
          questionsLimit: 100,
        };
        if (connectionsCursor) request.connectionsCursor = connectionsCursor;
        if (questionsCursor) request.questionsCursor = questionsCursor;
        const raw = await client.invoke("open_document", request);
        const result = raw;
        if (!isReady(result)) return merged;
        const view = result.view;
        if (!merged) {
          merged = {
            ...view,
            connections: [...view.connections],
            questions: [...view.questions],
          };
        } else {
          const previous: ReadingView = merged;
          const connections = new Map<Connection["id"], Connection>(
            previous.connections.map((connection: Connection) => [connection.id, connection]),
          );
          for (const connection of view.connections)
            connections.set(connection.id, connection);
          const questions = new Map<Question["id"], Question>(
            previous.questions.map((question: Question) => [question.id, question]),
          );
          for (const question of view.questions) questions.set(question.id, question);
          merged = {
            ...previous,
            document: view.document,
            connections: [...connections.values()],
            questions: [...questions.values()],
          };
        }
        const nextConnections: string | null = connectionsDone ? null : view.connectionsNextCursor;
        const nextQuestions: string | null = questionsDone ? null : view.questionsNextCursor;
        connectionsDone ||= nextConnections === null;
        questionsDone ||= nextQuestions === null;
        if (connectionsDone && questionsDone) return { ...merged, connectionsNextCursor: null, questionsNextCursor: null };
        const pair = `${nextConnections ?? ""}|${nextQuestions ?? ""}`;
        if (seen.has(pair)) return merged;
        seen.add(pair);
        if (nextConnections) connectionsCursor = nextConnections;
        if (nextQuestions) questionsCursor = nextQuestions;
      }
    },
    [client],
  );

  const fetchRevision = useCallback(
    async (document: { id: DocumentId; revisionId?: RevisionId }) => {
      const requestedRevision =
        document.revisionId ??
        sessionRef.current.documents.find((item) => item.id === document.id)
          ?.revisionId;
      const cached = [...sessionRef.current.revisionCache.values()].find(
        (item) =>
          item.document.id === document.id &&
          (!requestedRevision || item.document.revisionId === requestedRevision),
      );
      if (cached) return cached.document;
      const key = String(requestedRevision ?? document.id);
      const existing = revisionPromisesRef.current.get(key);
      if (existing) return existing;
      const promise = client
        .invoke("cat", {
          documentId: document.id,
          revisionId: requestedRevision,
        })
        .then((result) => {
          dispatchSession({ type: "cache/revision", revision: result.document });
          return result.document;
        })
        .finally(() => revisionPromisesRef.current.delete(key));
      revisionPromisesRef.current.set(key, promise);
      return promise;
    },
    [client],
  );

  const openDocument = useCallback(
    async (
      target: { id: DocumentId; revisionId?: RevisionId },
      focus?: AnchorInput | null,
    ) => {
      navigationEpochRef.current++;
      relatedRequestRef.current++;
      const requestId = openRequestRef.current + 1;
      openRequestRef.current = requestId;
      dispatchSession({ type: "loading", loading: true });
      dispatchSession({ type: "error", message: null });
      try {
        const view = await readOpenResult({
          documentId: target.id,
          revisionId: target.revisionId,
        });
        if (requestId !== openRequestRef.current) return;
        if (!view) {
          dispatchSession({
            type: "status",
            message: "没有找到可打开的文档版本。",
          });
          dispatchSession({ type: "loading", loading: false });
          return;
        }
        const id =
          sceneRef.current.views.find(
            (item) => item.document.revisionId === view.document.revisionId,
          )?.id ??
          createViewId(target.id + ":" + view.document.revisionId + ":open");
        dispatchScene({
          type: "open-document",
          document: view.document,
          viewId: id,
          ...(focus === undefined ? {} : { focus }),
          role: "current",
        });
        if (focus) {
          dispatchScene({ type: "focus-view", viewId: id, focus });
        }
        commitViewToSession(view, id, focus);
        dispatchSession({ type: "loading", loading: false });
        dispatchSession({ type: "status", message: null });
        if (client.mode === "website") {
          const url = new URL(window.location.href);
          url.searchParams.set("document", view.document.id);
          url.searchParams.set("revision", view.document.revisionId);
          window.history.replaceState(null, "", url);
          window.localStorage.setItem(
            "xanadu-current-document",
            view.document.id,
          );
        }
        if (window.innerWidth < 760) setSidebarOpen(false);
      } catch (error) {
        if (requestId === openRequestRef.current) {
          dispatchSession({ type: "loading", loading: false });
          dispatchSession({ type: "error", message: errorMessage(error) });
        }
      }
    },
    [client, commitViewToSession, readOpenResult],
  );

  const openHistoryRevision = useCallback(
    async (item: Omit<DocumentRevision, "content">, ownerViewId: ViewId) => {
      const requestId = ++historyRevisionRequestRef.current;
      const originalOwner = sceneRef.current.views.find(view => view.id === ownerViewId);
      const navigationEpoch = navigationEpochRef.current;
      try {
        const view = await readOpenResult({
          documentId: item.id,
          revisionId: item.revisionId,
        });
        if (!view) throw new Error("没有找到可打开的历史版本。");
        const owner = sceneRef.current.views.find(
          (candidate) => candidate.id === ownerViewId,
        );
        if (requestId !== historyRevisionRequestRef.current || navigationEpoch !== navigationEpochRef.current || !owner || owner.document.revisionId !== originalOwner?.document.revisionId) return;
        dispatchScene({
          type: "replace-document",
          viewId: owner.id,
          document: view.document,
          focus: null,
        });
        dispatchSession({ type: "cache/revision", revision: view.document });
        dispatchSession({
          type: "context/replace-revision",
          viewId: owner.id,
          document: view.document,
        });
        if (owner.id === sceneRef.current.currentViewId)
          dispatchSession({ type: "context/merge-view", view });
      } catch (error) {
        dispatchSession({ type: "error", message: errorMessage(error) });
      }
    },
    [readOpenResult, dispatchScene],
  );

  useEffect(() => {
    if (
      initialView !== undefined ||
      firstDocumentOpenedRef.current ||
      scene.views.length > 0 ||
      session.catalogueLoading ||
      !session.catalogueComplete ||
      !session.documents.length
    )
      return;
    firstDocumentOpenedRef.current = true;
    const params =
      typeof window === "undefined" ? null : new URL(window.location.href).searchParams;
    const requestedId = params?.get("document");
    const requestedRevision = params?.get("revision");
    const requested = requestedId
      ? session.documents.find(
          (document) =>
            document.id === requestedId &&
            (!requestedRevision || document.revisionId === requestedRevision),
        )
      : undefined;
    const document = requested ?? session.documents[0];
    void openDocument(
      { id: document.id, revisionId: requested?.revisionId ?? document.revisionId },
      null,
    );
  }, [initialView, openDocument, scene.views.length, session.catalogueComplete, session.catalogueLoading, session.documents]);

  const openRelated = useCallback(
    async (connectionId: Connection["id"]) => {
      const requestId = relatedRequestRef.current + 1;
      relatedRequestRef.current = requestId;
      const active = sessionRef.current.active;
      const current = sceneRef.current.currentViewId
        ? sceneRef.current.views.find(
            (view) => view.id === sceneRef.current.currentViewId,
          )
        : undefined;
      if (!active || !current) return;
      const connection = active.connections.find((item) => item.id === connectionId);
      if (!connection) return;
      const source = connection.from.revisionId === current.document.revisionId
        ? connection.from
        : connection.to.revisionId === current.document.revisionId
          ? connection.to
          : connection.from.documentId === current.document.id
            ? connection.from
            : connection.to.documentId === current.document.id ? connection.to : null;
      if (!source) return;
      const endpoint = source === connection.from ? connection.to : connection.from;
      const navigationEpoch = navigationEpochRef.current;
      const [sourceDocument, document] = await Promise.all([
        source.revisionId === current.document.revisionId ? Promise.resolve(current.document) : fetchRevision({ id: source.documentId, revisionId: source.revisionId }),
        fetchRevision({ id: endpoint.documentId, revisionId: endpoint.revisionId }),
      ]);
      if (relatedRequestRef.current !== requestId || navigationEpoch !== navigationEpochRef.current || sceneRef.current.currentViewId !== current.id) return;
      if (sourceDocument.revisionId !== current.document.revisionId) {
        const sourceViewId = sceneRef.current.views.find(view => view.document.revisionId === sourceDocument.revisionId)?.id ?? createViewId();
        dispatchScene({ type: "open-document", document: sourceDocument, viewId: sourceViewId, focus: source });
        commitViewToSession({ document: sourceDocument, connections: [...active.connections], questions: [...active.questions], connectionsNextCursor: null, questionsNextCursor: null }, sourceViewId, source);
      } else {
        dispatchScene({ type: "update-view", viewId: current.id, patch: { focus: source } });
      }
      const targetViewId = createViewId(
        endpoint.documentId + ":" + endpoint.revisionId + ":companion",
      );
      const existingView = sceneRef.current.views.find(
        (view) => view.document.revisionId === document.revisionId,
      );
      if (existingView) {
        dispatchScene({
          type: "follow",
          viewId: existingView.id,
          focus: endpoint,
          connectionId,
        });
      } else {
        dispatchScene({
          type: "open-new-view",
          document,
          viewId: targetViewId,
          role: "companion",
          focus: endpoint,
        });
      }
      dispatchSession({ type: "cache/revision", revision: document });
      dispatchSession({
        type: "context/set-companion",
        target: {
          viewId: existingView?.id ?? targetViewId,
          document,
          role: "companion",
          focus: endpoint,
          scrollTop: 0,
        },
      });
      dispatchSession({
        type: "context/select-connection",
        connectionId,
      });
    },
    [fetchRevision, dispatchScene, commitViewToSession],
  );

  const onSceneActivateConnection = useCallback(
    (connectionId: Connection["id"]) => {
      void openRelated(connectionId).catch(error => dispatchSession({ type: "error", message: errorMessage(error) }));
    },
    [openRelated],
  );

  const onSceneModeChange = useCallback(
    (mode: "read" | "overview") => {
      dispatchSession({ type: "context/mode", mode });
    },
    [],
  );

  useEffect(() => {
    if (!session.active || !scene.currentViewId) return;
    const current = scene.views.find((view) => view.id === scene.currentViewId);
    if (!current) return;
    const companion = scene.companionViewId
      ? scene.views.find((view) => view.id === scene.companionViewId)
      : null;
    const sameAnchor = (left: AnchorInput | null, right: AnchorInput | null) =>
      left?.revisionId === right?.revisionId &&
      left?.start === right?.start &&
      left?.end === right?.end;
    const sameTarget = (
      left: ReaderViewTarget | null,
      right: ReaderViewTarget | null,
    ) =>
      left?.viewId === right?.viewId &&
      left?.document.revisionId === right?.document.revisionId &&
      left?.scrollTop === right?.scrollTop &&
      sameAnchor(left?.focus ?? null, right?.focus ?? null);
    const nextCurrent = targetFromScene(current, "current");
    const nextCompanion = companion
      ? targetFromScene(companion, "companion")
      : null;
    if (
      sameTarget(session.active.current, nextCurrent) &&
      sameTarget(session.active.companion, nextCompanion)
    )
      return;
    dispatchSession({
      type: "context/sync-scene",
      current: nextCurrent,
      companion: nextCompanion,
    });
  }, [scene, session.active]);

  const currentRevisionId = scene.views.find(view => view.id === scene.currentViewId)?.document.revisionId;
  useEffect(() => {
    const current = sceneRef.current.views.find(view => view.id === sceneRef.current.currentViewId);
    if (!current || loadedRelationsRef.current === current.document.revisionId) return;
    const requestId = ++relationRequestRef.current;
    void readOpenResult({ documentId: current.document.id, revisionId: current.document.revisionId }).then(view => {
      if (!view || requestId !== relationRequestRef.current || sceneRef.current.currentViewId !== current.id) return;
      loadedRelationsRef.current = current.document.revisionId;
      dispatchSession({ type: "context/merge-view", view });
    }).catch(error => {
      if (requestId === relationRequestRef.current) dispatchSession({ type: "error", message: errorMessage(error) });
    });
    return () => { relationRequestRef.current++; };
  }, [currentRevisionId, scene.currentViewId, readOpenResult]);

  const selectText = useCallback(
    (
      anchor: AnchorInput,
      document: DocumentRevision,
      rect: DOMRect,
    ) => {
      const connection = sessionRef.current.connection;
      if (connection.kind === "first" && connection.first) {
        // A second selection completes the independent connection draft.  Keep
        // the selection visible so the confirmation sheet can show both exact
        // UTF-16 endpoints; it must not become an implicit question/link.
        dispatchSession({
          type: "selection/set",
          selection: {
            kind: "selected",
            anchor,
            document,
            preview:
              typeof window === "undefined"
                ? anchor.quote
                : window.getSelection()?.toString() || anchor.quote,
            rect: {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            },
          },
        });
        dispatchSession({
          type: "connection/open-second",
          document,
          anchor,
        });
        return;
      }
      dispatchSession({
        type: "selection/set",
        selection: {
          kind: "selected",
          anchor,
          document,
          preview:
            typeof window === "undefined"
              ? anchor.quote
              : window.getSelection()?.toString() || anchor.quote,
          rect: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          },
        },
      });
    },
    [],
  );

  const selectSearchMatch = useCallback(
    async (match: Match) => {
      const document = await fetchRevision({
        id: match.document.id,
        revisionId: match.revisionId ?? match.document.revisionId,
      });
      const anchor = makeAnchor(document, match.start, match.end);
      await openDocument(
        { id: document.id, revisionId: document.revisionId },
        anchor,
      );
      dispatchSession({ type: "dialog/close" });
    },
    [fetchRevision, openDocument],
  );

  function currentQuestionDraft(): ReaderSession["question"] {
    return sessionRef.current.question;
  }

  const sendQuestion = useCallback(async () => {
    if (questionSubmissionRef.current) return questionSubmissionRef.current;
    const run = (async () => {
      const draft = sessionRef.current.question;
      if ((draft.kind !== "editing" && draft.kind !== "failed") || !draft.body.trim())
        return;
      const body = draft.body.trim();
      const questionDocumentId = draft.document.id;
      if (draft.saved && draft.sentBody === body) return;
      dispatchSession({ type: "question/saving" });
      try {
        const question =
          draft.saved && draft.sentBody === null
            ? draft.saved
            : (
                await client.invoke("ask", {
                  anchor: draft.anchor,
                  body,
                })
              ).question;
      if (
        sessionRef.current.question.kind === "closed" ||
        sessionRef.current.question.body.trim() !== body
      ) {
        dispatchSession({
          type: "question/failure",
          message: "问题内容在保存期间发生了变化，请确认后重新发送。",
        });
        return;
      }
      dispatchSession({ type: "context/add-question", question });
      if (!draft.saved || draft.sentBody !== null)
        dispatchSession({ type: "question/saved", question, body });
      if (client.sendQuestion) {
        await client.sendQuestion(question);
        const latestQuestion = currentQuestionDraft();
        if (
          latestQuestion.kind === "closed" ||
          latestQuestion.body.trim() !== body
        ) {
          dispatchSession({
            type: "question/failure",
            message: "问题内容已变化，上一条问题没有发送当前草稿。",
          });
          return;
        }
        dispatchSession({ type: "question/sent", body });
        dispatchSession({
          type: "status",
          message: "问题已发送到当前对话。",
        });
      } else {
        await navigator.clipboard.writeText(questionPrompt(question));
        dispatchSession({ type: "question/sent", body });
        dispatchSession({
          type: "status",
          message: "问题已保存，提问内容已复制。",
        });
      }
      try {
        const active = sessionRef.current.active;
        if (active?.current.document.id === questionDocumentId) {
          const view = await readOpenResult({ documentId: questionDocumentId, revisionId: active.current.document.revisionId });
          if (view) dispatchSession({ type: "context/merge-view", view });
        }
      } catch {
        // A successful host send remains final even if the refresh fails.
      }
    } catch (error) {
      dispatchSession({ type: "question/failure", message: errorMessage(error) });
    }
    })();
    questionSubmissionRef.current = run;
    try {
      await run;
    } finally {
      if (questionSubmissionRef.current === run)
        questionSubmissionRef.current = null;
    }
    return run;
  }, [client, readOpenResult]);

  const startConnection = useCallback(() => {
    const selection = sessionRef.current.selection;
    if (
      selection.kind !== "selected" ||
      !selection.document ||
      !selection.anchor
    )
      return;
    dispatchSession({ type: "selection/clear" });
    dispatchSession({
      type: "connection/open-first",
      document: selection.document,
      anchor: selection.anchor,
    });
  }, []);

  const saveConnection = useCallback(async () => {
    const draft = sessionRef.current.connection;
    if (
      draft.kind !== "second" &&
      draft.kind !== "failed"
    )
      return;
    if (!draft.first || !draft.second) return;
    dispatchSession({ type: "connection/saving" });
    try {
      const result = await client.invoke("link", {
        from: draft.first.anchor,
        to: draft.second.anchor,
        relation: draft.relation,
        label: draft.label,
      });
      dispatchSession({ type: "connection/close" });
      dispatchSession({ type: "context/add-connection", connection: result.connection });
      dispatchSession({ type: "status", message: "连接已建立。" });
      const current = sceneRef.current.currentViewId
        ? sceneRef.current.views.find(
            (view) => view.id === sceneRef.current.currentViewId,
          )
        : undefined;
      if (current) {
        try {
          const view = await readOpenResult({
            documentId: current.document.id,
            revisionId: current.document.revisionId,
          });
          if (view) {
            dispatchSession({ type: "context/merge-view", view });
          }
        } catch {
          // The link write is final; a relation refresh is only a convenience.
          dispatchSession({
            type: "status",
            message: "连接已建立，关系列表稍后刷新。",
          });
        }
      }
    } catch (error) {
      dispatchSession({ type: "connection/failed", message: errorMessage(error) });
    }
  }, [client, readOpenResult]);

  const openHistory = useCallback(
    async (document: DocumentRevision, ownerViewId?: ViewId) => {
      const requestId = historyRequestRef.current + 1;
      historyRequestRef.current = requestId;
      try {
        const result = await client.invoke("history", {
          documentId: document.id,
          limit: 100,
        });
        if (historyRequestRef.current !== requestId) return;
        const owner = ownerViewId ?? sceneRef.current.currentViewId ?? createViewId("history-owner");
        setHistoryItems(result.revisions);
        dispatchSession({
          type: "dialog/open-history",
          document,
          ownerViewId: owner,
        });
      } catch (error) {
        dispatchSession({ type: "error", message: errorMessage(error) });
      }
    },
    [client],
  );

  const saveEditor = useCallback(async () => {
    const draft = sessionRef.current.editor;
    if (draft.kind === "closed") return;
    dispatchSession({ type: "editor/saving" });
    try {
      let document: DocumentRevision;
      if (draft.kind === "create") {
        document = (
          await client.invoke("write", {
            path: Path.parse(draft.path),
            title: draft.title,
            content: draft.content,
            format: "markdown",
          })
        ).document;
      } else if (draft.kind === "rename") {
        if (!draft.document) throw new Error("没有可移动的文档。");
        document = (
          await client.invoke("mv", {
            documentId: draft.document.id,
            newPath: Path.parse(draft.path),
          })
        ).document;
      } else {
        if (!draft.document || !draft.expectedRevisionId)
          throw new Error("编辑目标已失效，请重新打开文档。");
        document = (
          await client.invoke("edit", {
            documentId: draft.document.id,
            expectedRevisionId: draft.expectedRevisionId,
            start: 0,
            end: draft.document.content.length,
            expectedText: draft.document.content,
            replacement: draft.content,
          })
        ).document;
      }
      dispatchSession({ type: "cache/revision", revision: document });
      dispatchSession({ type: "editor/close" });
      await loadCatalogue(sessionRef.current.archived, true);
      const owner = draft.ownerViewId
        ? sceneRef.current.views.find((view) => view.id === draft.ownerViewId && view.document.revisionId === draft.document?.revisionId)
        : undefined;
      if (owner) {
        dispatchScene({
          type: "replace-document",
          viewId: owner.id,
          document,
          focus: owner.focus?.revisionId === document.revisionId ? owner.focus : null,
        });
        dispatchSession({
          type: "context/replace-revision",
          viewId: owner.id,
          document,
        });
      } else if (draft.kind === "create" || sceneRef.current.views.length === 0) {
        await openDocument({ id: document.id, revisionId: document.revisionId });
      }
      dispatchSession({ type: "status", message: "已保存新版本。" });
    } catch (error) {
      dispatchSession({ type: "editor/error", message: errorMessage(error) });
    }
  }, [client, loadCatalogue, openDocument]);

  const importFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      const results: string[] = [];
      const openImported = sceneRef.current.views.length === 0;
      let firstImported: DocumentRevision | null = null;
      for (const file of Array.from(files)) {
        try {
          if (file.size > 10 * 1024 * 1024)
            throw new Error("单个文件超过 10 MiB。");
          const ext = file.name.split(".").pop()?.toLowerCase();
          const mime =
            ext === "pdf"
              ? "application/pdf"
              : ext === "md" || ext === "markdown"
                ? "text/markdown"
                : ext === "txt"
                  ? "text/plain"
                  : null;
          if (!mime) throw new Error("只支持 TXT、Markdown 和 PDF。");
          const bytes = new Uint8Array(await file.arrayBuffer());
          let binary = "";
          for (let offset = 0; offset < bytes.length; offset += 8192)
            binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
          const document = (
            await client.invoke("import_file", {
              path: Path.parse(
                "/imports/" + file.name.replace(/[\\/\x00-\x1f]/g, "_"),
              ),
              title: file.name.replace(/\.[^.]+$/, ""),
              mime,
              base64: btoa(binary),
            })
          ).document;
          results.push(file.name + "：已导入");
          dispatchSession({ type: "cache/revision", revision: document });
          if (openImported && !firstImported) firstImported = document;
        } catch (error) {
          results.push(file.name + "：" + errorMessage(error));
        }
      }
      setImportReport(results);
      await loadCatalogue(sessionRef.current.archived, true);
      if (firstImported && sceneRef.current.views.length === 0) {
        await openDocument({
          id: firstImported.id,
          revisionId: firstImported.revisionId,
        });
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [client, loadCatalogue, openDocument],
  );

  const runSearch = useCallback(
    async (query: string) => {
      const requestId = searchRequestRef.current + 1;
      searchRequestRef.current = requestId;
      if (!query.trim()) {
        setSearchMatches([]);
        setSearchLoading(false);
        return;
      }
      setSearchLoading(true);
      try {
        let cursor: string | undefined;
        const seen = new Set<string>();
        const matches: Match[] = [];
        for (;;) {
          const args: CommandInput<"grep"> & { cursor?: string } = {
            query,
            prefix: "/",
            limit: 100,
          };
          if (cursor) args.cursor = cursor;
          const result = await client.invoke("grep", args);
          if (searchRequestRef.current !== requestId) return;
          matches.push(
            ...result.matches.map((match) => ({
              document: match.document,
              excerpt: match.excerpt,
              start: match.start,
              end: match.end,
              revisionId: match.document.revisionId,
            })),
          );
          const nextCursor =
            typeof result === "object" &&
            result !== null &&
            "nextCursor" in result &&
            typeof result.nextCursor === "string" &&
            result.nextCursor.length > 0
              ? result.nextCursor
              : null;
          if (!nextCursor || seen.has(nextCursor)) break;
          seen.add(nextCursor);
          cursor = nextCursor;
        }
        setSearchMatches(
          matches,
        );
      } catch (error) {
        if (searchRequestRef.current === requestId)
          dispatchSession({ type: "error", message: errorMessage(error) });
      } finally {
        if (searchRequestRef.current === requestId) setSearchLoading(false);
      }
    },
    [client],
  );

  const related = useMemo<readonly RelatedProjection[]>(() => {
    const active = session.active;
    const current = scene.views.find((view) => view.id === scene.currentViewId);
    if (!active || !current) return [];
    const items: RelatedProjection[] = [];
    for (const connection of active.connections) {
      const endpoint =
        connection.from.revisionId === current.document.revisionId
          ? connection.to
          : connection.to.revisionId === current.document.revisionId
            ? connection.from
            : null;
      if (!endpoint) continue;
      const summary = session.documents.find((doc) => doc.id === endpoint.documentId);
      if (!summary) continue;
      items.push({
        document: summary,
        anchor: endpoint,
        connectionId: connection.id,
        color: relationColors[connection.relation],
      });
    }
    return items.sort((a,b) => Number(b.connectionId === active.selectedConnectionId) - Number(a.connectionId === active.selectedConnectionId)).slice(0,12);
  }, [scene, session.active, session.documents]);

  const archiveDocument = useCallback(
    async (document: DocumentRevision): Promise<void> => {
      try {
        const updated = (await client.invoke("archive", {
          documentId: document.id,
          archived: !document.archived,
        })).document;
        for (const view of sceneRef.current.views) {
          if (view.document.id !== document.id) continue;
          const changed = { ...view.document, archived: updated.archived };
          dispatchScene({ type: "replace-document", viewId: view.id, document: changed });
          dispatchSession({ type: "context/replace-revision", viewId: view.id, document: changed });
        }
        await loadCatalogue(sessionRef.current.archived, true);
        dispatchSession({
          type: "status",
          message: document.archived ? "文档已恢复。" : "文档已归档。",
        });
      } catch (error) {
        dispatchSession({ type: "error", message: errorMessage(error) });
      }
    },
    [client, loadCatalogue],
  );

  const measureScene = useCallback(() => sceneControllerRef.current?.measure(), []);
  const renderDocument = useCallback(
    (view: DocumentView, detailed: boolean) => {
      return (
        <article className={detailed ? "document-plane-body detailed" : "document-plane-body"}>
          <header className="plane-heading" data-view-handle>
            <div>
              <h1>{view.document.title}</h1>
              <p>
                {view.document.path} · v{view.document.sequence}
                {!view.document.isCurrent ? " · 历史版本" : ""}
              </p>
            </div>
            <PlaneMenu
              document={view.document}
              onEdit={() =>
                dispatchSession({
                  type: "editor/open-edit",
                  document: view.document,
                  ownerViewId: view.id,
                })
              }
              onHistory={() => void openHistory(view.document, view.id)}
              onRename={() =>
                dispatchSession({
                  type: "editor/open-rename",
                  document: view.document,
                  ownerViewId: view.id,
                })
              }
              onArchive={() => void archiveDocument(view.document)}
              onDownload={() => downloadDocument(view.document)}
              website={client.mode === "website"}
            />
          </header>
          {detailed ? <DocumentPassage
            document={view.document}
            focus={view.focus}
            connections={session.active?.connections ?? NO_CONNECTIONS}
            onActivateConnection={onSceneActivateConnection}
            onGeometryChange={measureScene}
            onSelectText={selectText}
          /> : <p className="peripheral-excerpt">{view.document.content.slice(0, 360)}</p>}
        </article>
      );
    },
    [
      archiveDocument,
      client.mode,
      onSceneActivateConnection,
      openHistory,
      measureScene,
      selectText,
      session.active?.connections,
    ],
  );

  function downloadDocument(document: DocumentRevision): void {
    const blob = new Blob([document.content], {
      type: "text/plain;charset=utf-8",
    });
    const link = window.document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = document.path.split("/").pop() ?? "document.txt";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  const currentDocument =
    scene.views.find((view) => view.id === scene.currentViewId)?.document ??
    session.active?.current.document ??
    null;
  const editorOpen = session.editor.kind !== "closed";
  const searchDialog =
    session.dialog.kind === "search" ? session.dialog : null;

  return (
    <main className={"reader-shell " + (sidebarOpen ? "has-sidebar" : "")}>
      <header className="reader-topbar">
        <div className="brand-lockup">
          <button className="brand-button" onClick={() => sceneControllerRef.current?.resetCamera()}>
            Xanadu<span>Sidebranch</span>
          </button>
          <span className="workspace-count">
            {session.documents.length} 份文档
          </span>
        </div>
        <div className="topbar-actions">
          <button
            className="quiet-icon topbar-history"
            aria-label="返回上一个阅读上下文"
            title="返回"
            disabled={!scene.currentViewId || scene.historyIndex <= 0}
            onClick={() => dispatchSceneAction({ type: "history-back" })}
          >
            <ArrowLeft size={15} />
          </button>
          <button
            className="quiet-icon topbar-history"
            aria-label="前进到下一个阅读上下文"
            title="前进"
            disabled={!scene.currentViewId || scene.historyIndex >= scene.history.length - 1}
            onClick={() => dispatchSceneAction({ type: "history-forward" })}
          >
            <ArrowRight size={15} />
          </button>
          <button
            className="topbar-button"
            onClick={() => dispatchSession({ type: "dialog/open-search" })}
          >
            <Search size={16} />
            <span>搜索</span>
            <kbd>⌘ K</kbd>
          </button>
          <ReaderMenu
            trigger={(toggle, open) => (
              <button
                className="account-button"
                aria-label="空间菜单"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={toggle}
              >
                <Menu size={17} />
              </button>
            )}
          >
              <ReaderMenuItem
                onSelect={() =>
                  dispatchSession({ type: "editor/open-create", path: "/notes/" })
                }
              >
                <FilePlus2 size={15} /> 新建文档
              </ReaderMenuItem>
              <ReaderMenuItem onSelect={() => fileInputRef.current?.click()}>
                <Upload size={15} /> 导入文件
              </ReaderMenuItem>
              <ReaderMenuSeparator />
              <ReaderMenuItem
                onSelect={() => {
                  const next = !archiveOpen;
                  setArchiveOpen(next);
                  dispatchSession({ type: "catalogue/toggle-archived", archived: next });
                  void loadCatalogue(next);
                }}
              >
                <Archive size={15} /> {archiveOpen ? "查看当前文档" : "查看归档"}
              </ReaderMenuItem>
              <ReaderMenuItem onSelect={() => dispatchSession({ type: "dialog/open-settings" })}>
                <Settings2 size={15} /> 连接 ChatGPT
              </ReaderMenuItem>
              {client.mode === "website" && (
                <ReaderMenuLink href="/signout-with-chatgpt?return_to=/" target="_top">
                  退出登录
                </ReaderMenuLink>
              )}
          </ReaderMenu>
        </div>
      </header>

      <div className="reader-main">
        <aside className="catalogue" aria-label="文档目录">
          <div className="catalogue-head">
            <div>
              <span className="catalogue-kicker">{archiveOpen ? "ARCHIVE" : "LIBRARY"}</span>
              <strong>{archiveOpen ? "已归档" : "文档"}</strong>
            </div>
            <div className="catalogue-actions">
              <button
                className="quiet-icon"
                onClick={() => fileInputRef.current?.click()}
                aria-label="导入文件"
              >
                <Upload size={15} />
              </button>
              <button
                className="quiet-icon"
                onClick={() =>
                  dispatchSession({
                    type: "editor/open-create",
                    path: "/notes/",
                  })
                }
                aria-label="新建文档"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
          <nav className="catalogue-list">
            {groupDocuments(session.documents).map((group) => (
              <div className="catalogue-group" key={group.name}>
                <div className="catalogue-folder">
                  <ChevronDown size={13} />
                  <span>{group.name}</span>
                  <small>{group.documents.length}</small>
                </div>
                {group.documents.map((document) => (
                  <button
                    className={
                      "catalogue-document " +
                      (currentDocument?.id === document.id ? "active" : "")
                    }
                    key={document.id}
                    onClick={() => void openDocument({ id: document.id })}
                  >
                    <span className="catalogue-dot" />
                    <span>
                      <strong>{document.title}</strong>
                      <small>{document.path}</small>
                    </span>
                  </button>
                ))}
              </div>
            ))}
            {!session.documents.length && !session.catalogueLoading && (
              <div className="catalogue-empty">
                <FolderOpen size={18} />
                <p>还没有文档。</p>
                <button
                  onClick={() =>
                    dispatchSession({
                      type: "editor/open-create",
                      path: "/notes/",
                    })
                  }
                >
                  写第一份
                </button>
              </div>
            )}
            {session.catalogueLoading && (
              <p className="catalogue-loading">
                <LoaderCircle size={15} className="spin" /> 正在读取目录…
              </p>
            )}
          </nav>
          <div className="catalogue-footer">
            <button onClick={() => setSidebarOpen(false)} aria-label="收起目录">
              <PanelLeft size={15} /> 收起目录
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.markdown,.pdf"
              multiple
              hidden
              onChange={(event) => void importFiles(event.target.files)}
            />
          </div>
        </aside>

        <section className="workspace-stage">
          {!sidebarOpen && (
            <button
              className="catalogue-reopen"
              onClick={() => setSidebarOpen(true)}
              aria-label="展开目录"
            >
              <PanelRight size={17} />
            </button>
          )}
          {(session.error || session.catalogueError) && (
            <div className="reader-alert error" role="alert">
              {session.error ?? session.catalogueError}
              <button
                onClick={() => dispatchSession({ type: "error", message: null })}
                aria-label="关闭错误"
              >
                <X size={15} />
              </button>
            </div>
          )}
          {session.status && (
            <div className="reader-alert status" role="status">
              {session.status}
              <button
                onClick={() => dispatchSession({ type: "status", message: null })}
                aria-label="关闭提示"
              >
                <X size={15} />
              </button>
            </div>
          )}
          {importReport.length > 0 && (
            <div className="import-report" role="status">
              <div>
                <strong>导入结果</strong>
                <button onClick={() => setImportReport([])} aria-label="关闭导入结果">
                  <X size={15} />
                </button>
              </div>
              {importReport.map((item) => <p key={item}>{item}</p>)}
            </div>
          )}
          {scene.views.length > 0 ? (
            <SpatialScene
              state={scene}
              dispatch={dispatchSceneAction}
              connections={session.active?.connections ?? []}
              mode={session.active?.mode ?? "read"}
              onModeChange={onSceneModeChange}
              renderDocument={renderDocument}
              onActivateConnection={onSceneActivateConnection}
              related={related}
              onOpenRelated={onSceneActivateConnection}
              controllerRef={sceneControllerRef}
            />
          ) : (
            <EmptyWorkspace
              loading={session.loading || session.catalogueLoading}
              onCreate={() =>
                dispatchSession({
                  type: "editor/open-create",
                  path: "/notes/",
                })
              }
              onImport={() => fileInputRef.current?.click()}
            />
          )}
          <details className="context-tray" aria-label="当前连接和问题" hidden={!session.active}>
            {session.active && (
              <>
                <summary className="tray-heading">
                  <span>连接与提问</span>
                  <small>
                    {session.active.connections.length} 条连接 ·{" "}
                    {session.active.questions.length} 个问题
                  </small>
                </summary>
                <div className="tray-items">
                  {session.active.connections.map((connection) => (
                    <button
                      className={
                        "tray-item " +
                        (session.active?.selectedConnectionId === connection.id ? "selected" : "")
                      }
                      key={connection.id}
                      onClick={() => void onSceneActivateConnection(connection.id)}
                    >
                      <span
                        className="relation-swatch"
                        style={{ background: relationColors[connection.relation] }}
                      />
                      <span>
                        <strong>{connection.label || relationNames[connection.relation]}</strong>
                        <small>{connection.from.quote.slice(0, 90)}</small>
                      </span>
                      <ChevronRight size={15} />
                    </button>
                  ))}
                  {session.active.questions.map((question) => (
                    <QuestionTrayItem
                      key={question.id}
                      question={question}
                      answers={question.answers
                        .map((id) => session.documents.find((document) => document.id === id))
                        .filter((document): document is DocumentSummary => Boolean(document))}
                      onOpen={() =>
                        void openDocument(
                          {
                            id: question.anchor.documentId,
                            revisionId: question.anchor.revisionId,
                          },
                          {
                            revisionId: question.anchor.revisionId,
                            start: question.anchor.start,
                            end: question.anchor.end,
                            quote: question.anchor.quote,
                          },
                        )
                      }
                      onOpenAnswer={(document) =>
                        void openDocument({
                          id: document.id,
                          revisionId: document.revisionId,
                        })
                      }
                    />
                  ))}
                  {!session.active.connections.length &&
                    !session.active.questions.length && (
                      <p className="tray-empty">
                        选择文字提问，或连接到另一段文字。
                      </p>
                    )}
                </div>
              </>
            )}
          </details>
        </section>
      </div>

      <SelectionComposer
        session={session}
        dispatch={dispatchSession}
        onSendQuestion={() => void sendQuestion()}
        onStartConnection={startConnection}
        onSaveConnection={() => void saveConnection()}
      />

      <ReaderDialog
        open={searchDialog !== null}
        onOpenChange={(open: boolean) => {
          if (!open) dispatchSession({ type: "dialog/close" });
        }}
      >
        <ReaderDialogContent className="reader-dialog search-dialog">
          <ReaderDialogTitle>搜索文档</ReaderDialogTitle>
          <ReaderDialogDescription>
            按路径、标题和全文搜索；选择结果会打开并聚焦命中范围。
          </ReaderDialogDescription>
          <input
            className="workspace-input search-field"
            autoFocus
            value={searchDialog?.query ?? ""}
            placeholder="搜索文字…"
            onChange={(event) => {
              const query = event.target.value;
              dispatchSession({ type: "dialog/search-query", query });
              void runSearch(query);
            }}
          />
          {searchLoading && <p className="search-hint">正在搜索…</p>}
          <div className="search-results">
            {searchMatches.map((match) => (
              <button
                key={match.document.id + ":" + match.start + ":" + match.end}
                onClick={() => void selectSearchMatch(match)}
              >
                <strong>{match.document.title}</strong>
                <small>{match.document.path}</small>
                {match.excerpt && <p>{match.excerpt}</p>}
              </button>
            ))}
            {!searchLoading && searchDialog?.query && !searchMatches.length && (
              <p className="search-hint">没有找到匹配的文档。</p>
            )}
          </div>
        </ReaderDialogContent>
      </ReaderDialog>

      <ReaderDialog
        open={session.dialog.kind === "history"}
        onOpenChange={(open: boolean) => !open && dispatchSession({ type: "dialog/close" })}
      >
        <ReaderDialogContent className="reader-dialog">
          <ReaderDialogTitle>版本历史</ReaderDialogTitle>
          <ReaderDialogDescription>
            旧版本可读，连接仍指向它的 exact passage。
          </ReaderDialogDescription>
          <div className="history-list">
            {historyItems.map((item) => (
              <button
                key={item.revisionId}
                onClick={() => {
                  const ownerViewId =
                    session.dialog.kind === "history"
                      ? session.dialog.ownerViewId
                      : scene.currentViewId;
                  dispatchSession({ type: "dialog/close" });
                  void (ownerViewId
                    ? openHistoryRevision(item, ownerViewId)
                    : openDocument(
                        { id: item.id, revisionId: item.revisionId },
                        null,
                      ));
                }}
              >
                <span>v{item.sequence}{item.isCurrent ? " · 当前" : ""}</span>
                <small>{new Date(item.updatedAt).toLocaleString("zh-CN")}</small>
                <ChevronRight size={15} />
              </button>
            ))}
          </div>
        </ReaderDialogContent>
      </ReaderDialog>

      <ReaderDialog
        open={editorOpen}
        onOpenChange={(open: boolean) => !open && dispatchSession({ type: "editor/close" })}
      >
        <ReaderDialogContent className="reader-dialog editor-dialog">
          <ReaderDialogTitle>
            {session.editor.kind === "create"
              ? "新建文档"
              : session.editor.kind === "rename"
                ? "移动文档"
                : "编辑文档"}
          </ReaderDialogTitle>
          <ReaderDialogDescription>
            {session.editor.kind === "edit"
              ? "保存为新版本，原有连接继续指向当时的文字。"
              : "用路径整理文档；移动文档不会改变已有连接。"}
          </ReaderDialogDescription>
          <label className="workspace-label">
            路径
            <input
              className="workspace-input"
              value={session.editor.kind === "closed" ? "" : session.editor.path}
              onChange={(event) =>
                dispatchSession({ type: "editor/path", path: event.target.value })
              }
            />
          </label>
          {session.editor.kind !== "rename" && (
            <label className="workspace-label">
              标题
              <input
                className="workspace-input"
                value={session.editor.kind === "closed" ? "" : session.editor.title}
                onChange={(event) =>
                  dispatchSession({ type: "editor/title", title: event.target.value })
                }
              />
            </label>
          )}
          {session.editor.kind !== "rename" && (
            <textarea
              className="workspace-editor"
              value={session.editor.kind === "closed" ? "" : session.editor.content}
              onChange={(event) =>
                dispatchSession({
                  type: "editor/content",
                  content: event.target.value,
                })
              }
            />
          )}
          {session.editor.kind !== "closed" && session.editor.error && (
            <p className="dialog-error" role="alert">{session.editor.error}</p>
          )}
          <div className="dialog-actions">
            <button
              className="solid-button"
              disabled={
                session.editor.kind === "closed" || session.editor.saving === true
              }
              onClick={() => void saveEditor()}
            >
              <Check size={15} /> {session.editor.kind !== "closed" && session.editor.saving ? "保存中…" : "保存"}
            </button>
          </div>
        </ReaderDialogContent>
      </ReaderDialog>

      <ReaderDialog
        open={session.dialog.kind === "settings"}
        onOpenChange={(open: boolean) => !open && dispatchSession({ type: "dialog/close" })}
      >
        <ReaderDialogContent className="reader-dialog">
          <ReaderDialogTitle>连接 ChatGPT</ReaderDialogTitle>
          <ReaderDialogDescription>
            网站可以独立阅读；在 ChatGPT App 中，选中文字后可把已保存问题发送到当前对话。
          </ReaderDialogDescription>
          <div className="settings-copy">
            <p>在 ChatGPT 设置中添加自定义 MCP：</p>
            <code>{typeof window !== "undefined" ? window.location.origin : ""}/api/mcp</code>
            <p>回答文档会独立保存；需要显式选择段落并建立连接。</p>
          </div>
        </ReaderDialogContent>
      </ReaderDialog>
    </main>
  );
}

function groupDocuments(documents: readonly DocumentSummary[]) {
  const groups = new Map<string, DocumentSummary[]>();
  for (const document of documents) {
    const name = folderName(document.path);
    const list = groups.get(name) ?? [];
    list.push(document);
    groups.set(name, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, items]) => ({ name, documents: items }));
}

function PlaneMenu({
  document,
  onEdit,
  onHistory,
  onRename,
  onArchive,
  onDownload,
  website,
}: {
  document: DocumentRevision;
  onEdit: () => void;
  onHistory: () => void;
  onRename: () => void;
  onArchive: () => void;
  onDownload: () => void;
  website: boolean;
}) {
  return (
    <ReaderMenu
      trigger={(toggle, open) => (
        <button
          className="plane-menu"
          aria-label="文档操作"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={toggle}
        >
          <MoreHorizontal size={17} />
        </button>
      )}
    >
        <ReaderMenuItem onSelect={onEdit} disabled={!document.isCurrent}>
          <PenLine size={15} /> 编辑原文
        </ReaderMenuItem>
        <ReaderMenuItem onSelect={onHistory}>
          <History size={15} /> 版本历史
        </ReaderMenuItem>
        <ReaderMenuItem onSelect={onRename}>移动 / 重命名</ReaderMenuItem>
        <ReaderMenuItem onSelect={onDownload}>下载当前文本</ReaderMenuItem>
        {website && document.assetId && (
          <ReaderMenuLink href={"/api/assets/" + document.assetId}>
            下载导入文件
          </ReaderMenuLink>
        )}
        <ReaderMenuSeparator />
        <ReaderMenuItem onSelect={onArchive}>
          <Archive size={15} /> {document.archived ? "恢复文档" : "归档文档"}
        </ReaderMenuItem>
    </ReaderMenu>
  );
}

function EmptyWorkspace({
  loading,
  onCreate,
  onImport,
}: {
  loading: boolean;
  onCreate: () => void;
  onImport: () => void;
}) {
  if (loading)
    return (
      <div className="workspace-empty loading">
        <LoaderCircle size={22} className="spin" />
        <p>正在打开阅读空间…</p>
      </div>
    );
  return (
    <div className="workspace-empty">
      <div className="empty-mark">X / S</div>
      <p className="empty-kicker">A PRIVATE DOCUMENT SPACE</p>
      <h1>让阅读从一份文档开始。</h1>
      <p>文字可以并行、连接，也可以沿着问题继续生长。</p>
      <div className="empty-actions">
        <button className="solid-button" onClick={onImport}>
          <Upload size={16} /> 导入文档
        </button>
        <button className="quiet-button" onClick={onCreate}>
          <Plus size={16} /> 写一份新文档
        </button>
      </div>
    </div>
  );
}

function QuestionTrayItem({
  question,
  onOpen,
  answers,
  onOpenAnswer,
}: {
  question: Question;
  onOpen: () => void;
  answers: readonly DocumentSummary[];
  onOpenAnswer: (document: DocumentSummary) => void;
}) {
  return (
    <div className="tray-question">
      <button className="tray-item question-tray-item" onClick={onOpen}>
      <span className="question-status">
        {question.answers.length ? "已答" : "待答"}
      </span>
      <span>
        <strong>{question.body}</strong>
        <small>{question.anchor.quote.slice(0, 90)}</small>
      </span>
      <ChevronRight size={15} />
      </button>
      {answers.length > 0 && (
        <div className="question-answers" aria-label="问题回答文档">
          {answers.map((document) => (
            <button
              type="button"
              className="answer-link"
              key={document.id}
              onClick={() => onOpenAnswer(document)}
            >
              <span>回答文档</span> {document.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SelectionComposer({
  session,
  dispatch,
  onSendQuestion,
  onStartConnection,
  onSaveConnection,
}: {
  session: ReaderSession;
  dispatch: React.Dispatch<Parameters<typeof readerSessionReducer>[1]>;
  onSendQuestion: () => void;
  onStartConnection: () => void;
  onSaveConnection: () => void;
}) {
  const selection = session.selection;
  const question = session.question;
  const connection: ConnectionDraft = session.connection;
  const first = connection.kind === "closed" ? null : connection.first;
  const second =
    connection.kind === "second" ||
    connection.kind === "saving" ||
    connection.kind === "failed"
      ? connection.second
      : null;
  const connectionOpen = connection.kind !== "closed";
  const displayDocument =
    selection.kind === "selected" ? selection.document : first?.document ?? null;
  const displayAnchor =
    selection.kind === "selected" ? selection.anchor : first?.anchor ?? null;
  const visible =
    selection.kind === "selected" ||
    question.kind !== "closed" ||
    connectionOpen;
  if (!visible || !displayDocument || !displayAnchor) return null;
  const left = Math.max(
    14,
    Math.min(
      (selection.kind === "selected" ? selection.rect?.left : null) ?? 24,
      (typeof window === "undefined" ? 420 : window.innerWidth) - 382,
    ),
  );
  const top = Math.max(
    14,
    Math.min(
      ((selection.kind === "selected" ? selection.rect?.top : null) ?? 90) +
        ((selection.kind === "selected" ? selection.rect?.height : null) ?? 0) +
        12,
      (typeof window === "undefined" ? 560 : window.innerHeight) - 260,
    ),
  );
  const inConnection = connectionOpen;
  return (
    <aside
      className="selection-composer"
      style={{ left, top }}
      role="dialog"
      aria-label={inConnection ? "选择连接的第二段文字" : "对选中文字提问"}
    >
      <div className="composer-heading">
        <div>
          <span>SELECTED PASSAGE</span>
        <p>
          {((selection.kind === "selected" ? selection.preview : null) ||
            displayAnchor.quote).slice(0, 180)}
        </p>
        </div>
        <button
          className="quiet-icon"
          aria-label="关闭"
          onClick={() => dispatch({ type: "selection/clear" })}
        >
          <X size={15} />
        </button>
      </div>
      {inConnection ? (
        <div className="connection-draft">
          {first && (
            <div className="connection-endpoints">
              <p>
                <strong>第一端</strong> {first.document.title} · v
                {first.document.sequence}
                <span>{first.anchor.quote.slice(0, 120)}</span>
              </p>
              {second && (
                <p>
                  <strong>第二端</strong> {second.document.title} · v
                  {second.document.sequence}
                  <span>{second.anchor.quote.slice(0, 120)}</span>
                </p>
              )}
            </div>
          )}
          <p>
            {second
              ? "确认两个 exact passage 后建立连接。"
              : "再选择另一份文档中的文字，建立" +
                relationNames[connection.relation] +
                "连接。"}
          </p>
          <label className="workspace-label">
            关系
            <select
              className="workspace-input"
              value={connection.relation}
              onChange={(event) =>
                dispatch({
                  type: "connection/relation",
                  relation: event.target.value as Relation,
                })
              }
            >
              {Object.entries(relationNames).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="workspace-label">
            标签（可选）
            <input
              className="workspace-input"
              value={connection.label}
              onChange={(event) =>
                dispatch({ type: "connection/label", label: event.target.value })
              }
            />
          </label>
          {second && (
            <p className="composer-confirm">
              已选第二段：{second.anchor.quote.slice(0, 100)}
            </p>
          )}
          <button
            className="solid-button full-button"
            disabled={connection.kind !== "second"}
            onClick={onSaveConnection}
          >
            <Link2 size={15} /> 建立连接
          </button>
        </div>
      ) : (
        <>
          <textarea
            className="question-input"
            value={question.kind === "closed" ? "" : question.body}
            autoFocus
            placeholder="这段文字，让你想到了什么？"
            onChange={(event) =>
              dispatch({ type: "question/body", body: event.target.value })
            }
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter")
                onSendQuestion();
            }}
          />
          {question.kind !== "closed" && question.error && (
            <p className="dialog-error">{question.error}</p>
          )}
          <div className="composer-actions">
            <button className="quiet-button" onClick={onStartConnection}>
              <Link2 size={15} /> 连接文字
            </button>
            <button
              className="solid-button"
              disabled={
                question.kind === "closed" ||
                !question.body.trim() ||
                question.kind === "saving"
              }
              onClick={onSendQuestion}
            >
              <Send size={15} />{" "}
              {question.kind === "saved" ? "重新发送" : "问 ChatGPT"}
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
