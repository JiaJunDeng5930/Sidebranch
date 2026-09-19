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
  ArrowLeft,
  ArrowRight,
  FilePlus2,
  History,
  Menu,
  Search,
  Settings2,
  Upload,
  X,
} from "lucide-react";
import {
  ReaderMenu,
  ReaderMenuItem,
  ReaderMenuLink,
  ReaderMenuSeparator,
} from "./workspace-controls";
import {
  emptySession,
  hasProtectedDraft,
  isEditorDirty,
  readerSessionReducer,
  type AnswerNotification,
  type ImportTask,
  type PendingNavigation,
  type ReaderSessionAction,
  type SearchMatch,
} from "../../lib/reader/session";
import { SpatialScene } from "./spatial-scene";
import { DocumentPassage } from "./document-passage";
import { registerReadingTools } from "../../lib/client/webmcp";
import {
  questionPrompt,
  type ReaderClient,
} from "../../lib/client/reader-client";
import type { CommandInput } from "../../lib/domain/commands";
import {
  AnchorInput,
  Path,
  RevisionId,
  type Connection,
  type DocumentId,
  type DocumentRevision,
  type OpenDocumentResult,
  type Question,
  type ReadingView,
} from "../../lib/domain/model";
import {
  readingPosition,
  returnHistoryIndex,
  type AttentionAction,
  type ReadingPosition,
  type SurfaceRole,
} from "../../lib/reader/attention";
import type { DocumentTarget } from "../../lib/reader/space-index";
import type {
  PendingSurface,
  ReadingSurface,
  ReturnLeaf,
  SpatialSceneController,
} from "./spatial-scene";
import {
  answerArrival,
  errorMessage,
  isReady,
  makeAnchor,
  summaryFor,
} from "./reader-model";
import {
  EmptyWorkspace,
  PlaneMenu,
  SelectionComposer,
} from "./reader-overlays";
import { ReaderDialogs } from "./reader-dialogs";
import "./reader.css";

const NO_CONNECTIONS: readonly Connection[] = [];

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
  const [historyItems, setHistoryItems] = useState<
    readonly Omit<DocumentRevision, "content">[]
  >([]);
  const [pendingSurface, setPendingSurface] = useState<PendingSurface | null>(
    null,
  );
  const [importInputKey, setImportInputKey] = useState(0);
  const [composing, setComposing] = useState(false);
  const [pointerSelecting, setPointerSelecting] = useState(false);

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const controllerRef = useRef<SpatialSceneController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialResultRef = useRef<OpenDocumentResult | null>(null);
  const initialOpenRef = useRef(false);
  const cataloguePromisesRef = useRef(
    new Map<"active" | "archived", Promise<void>>(),
  );
  const catalogueRequestRef = useRef({ active: 0, archived: 0 });
  const openRequestRef = useRef(0);
  const compareRequestRef = useRef(0);
  const relationRequestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const historyRequestRef = useRef(0);
  const questionSubmissionRef = useRef<Promise<void> | null>(null);
  const revisionPromisesRef = useRef(
    new Map<string, Promise<DocumentRevision>>(),
  );
  const ensuredRevisionRef = useRef(new Set<RevisionId>());

  const dispatch = useCallback((action: ReaderSessionAction) => {
    dispatchSession(action);
  }, []);

  const dispatchAttention = useCallback((action: AttentionAction) => {
    dispatchSession({ type: "attention", action });
  }, []);

  const loadCatalogue = useCallback(
    async (scope: "active" | "archived", force = false): Promise<void> => {
      const existing = cataloguePromisesRef.current.get(scope);
      if (existing && !force) return existing;
      const requestId = catalogueRequestRef.current[scope] + 1;
      catalogueRequestRef.current[scope] = requestId;
      const run = (async () => {
        dispatch({ type: "catalogue/load-start", scope });
        let cursor: string | undefined;
        let offset = 0;
        const seen = new Set<string>();
        try {
          for (;;) {
            const args: CommandInput<"ls"> & { cursor?: string } = {
              limit: 200,
              offset,
              archived: scope === "archived",
            };
            if (cursor) args.cursor = cursor;
            const result = await client.invoke("ls", args);
            if (catalogueRequestRef.current[scope] !== requestId) return;
            dispatch({
              type: "catalogue/page",
              scope,
              documents: result.documents,
              complete: false,
            });
            const nextCursor = result.nextCursor;
            const nextOffset = result.nextOffset;
            if (nextCursor) {
              if (seen.has(`cursor:${nextCursor}`)) break;
              seen.add(`cursor:${nextCursor}`);
              cursor = nextCursor;
              offset = 0;
              continue;
            }
            if (nextOffset !== null) {
              if (seen.has(`offset:${nextOffset}`)) break;
              seen.add(`offset:${nextOffset}`);
              offset = nextOffset;
              continue;
            }
            break;
          }
          if (catalogueRequestRef.current[scope] === requestId)
            dispatch({
              type: "catalogue/page",
              scope,
              documents: [],
              complete: true,
            });
        } catch (error) {
          if (catalogueRequestRef.current[scope] === requestId)
            dispatch({
              type: "catalogue/error",
              scope,
              message: errorMessage(error),
            });
        } finally {
          if (catalogueRequestRef.current[scope] === requestId)
            cataloguePromisesRef.current.delete(scope);
        }
      })();
      cataloguePromisesRef.current.set(scope, run);
      return run;
    },
    [client, dispatch],
  );

  const readOpenResult = useCallback(
    async (
      args: CommandInput<"open_document">,
    ): Promise<ReadingView | null> => {
      type PagedArgs = CommandInput<"open_document"> & {
        connectionsCursor?: string;
        questionsCursor?: string;
        connectionsLimit?: number;
        questionsLimit?: number;
      };
      let connectionsCursor: string | undefined;
      let questionsCursor: string | undefined;
      let connectionsDone = false;
      let questionsDone = false;
      const seen = new Set<string>();
      let merged: ReadingView | null = null;
      for (;;) {
        const request: PagedArgs = {
          ...args,
          connectionsLimit: 200,
          questionsLimit: 100,
        };
        if (connectionsCursor) request.connectionsCursor = connectionsCursor;
        if (questionsCursor) request.questionsCursor = questionsCursor;
        const raw = await client.invoke("open_document", request);
        if (!isReady(raw)) return merged;
        if (!merged) {
          merged = {
            ...raw.view,
            connections: [...raw.view.connections],
            questions: [...raw.view.questions],
          };
        } else {
          const previous: ReadingView = merged;
          const connectionMap: Map<Connection["id"], Connection> = new Map(
            previous.connections.map((connection) => [
              connection.id,
              connection,
            ]),
          );
          const questionMap: Map<Question["id"], Question> = new Map(
            previous.questions.map((question) => [question.id, question]),
          );
          raw.view.connections.forEach((connection) =>
            connectionMap.set(connection.id, connection),
          );
          raw.view.questions.forEach((question) =>
            questionMap.set(question.id, question),
          );
          merged = {
            ...previous,
            document: raw.view.document,
            connections: [...connectionMap.values()],
            questions: [...questionMap.values()],
          };
        }
        const nextConnections: string | null = connectionsDone
          ? null
          : raw.view.connectionsNextCursor;
        const nextQuestions: string | null = questionsDone
          ? null
          : raw.view.questionsNextCursor;
        connectionsDone ||= nextConnections === null;
        questionsDone ||= nextQuestions === null;
        if (connectionsDone && questionsDone) {
          const complete = merged;
          if (!complete) return null;
          return {
            ...complete,
            connectionsNextCursor: null,
            questionsNextCursor: null,
          };
        }
        const key = `${nextConnections ?? ""}|${nextQuestions ?? ""}`;
        if (seen.has(key)) return merged;
        seen.add(key);
        if (nextConnections) connectionsCursor = nextConnections;
        if (nextQuestions) questionsCursor = nextQuestions;
      }
    },
    [client],
  );

  const fetchRevision = useCallback(
    async (target: { id: DocumentId; revisionId?: RevisionId }) => {
      const requestedRevision =
        target.revisionId ??
        sessionRef.current.documents.find((item) => item.id === target.id)
          ?.revisionId;
      const cached = requestedRevision
        ? sessionRef.current.revisionCache.get(requestedRevision)
        : [...sessionRef.current.revisionCache.values()].find(
            (entry) => entry.document.id === target.id,
          );
      if (cached) return cached.document;
      const key = String(requestedRevision ?? target.id);
      const existing = revisionPromisesRef.current.get(key);
      if (existing) return existing;
      const promise = client
        .invoke("cat", {
          documentId: target.id,
          revisionId: requestedRevision,
        })
        .then((result) => {
          dispatch({ type: "cache/revision", revision: result.document });
          return result.document;
        })
        .finally(() => revisionPromisesRef.current.delete(key));
      revisionPromisesRef.current.set(key, promise);
      return promise;
    },
    [client, dispatch],
  );

  const loadNeighborhood = useCallback(
    async (revisionId: RevisionId): Promise<void> => {
      const requestId = relationRequestRef.current + 1;
      relationRequestRef.current = requestId;
      dispatch({ type: "relations/loading", centerRevisionId: revisionId });
      try {
        let cursor: string | undefined;
        let nodes: import("../../lib/domain/space").NeighborhoodNode[] = [];
        for (;;) {
          const result = await client.invoke("neighborhood", {
            revisionId,
            cursor,
            limit: 100,
          });
          if (requestId !== relationRequestRef.current) return;
          if (result.centerRevisionId !== revisionId) return;
          nodes = [...nodes, ...result.nodes];
          if (!result.nextCursor) {
            dispatch({
              type: "relations/set",
              knowledge: {
                kind: "complete",
                centerRevisionId: revisionId,
                nodes,
              },
            });
            return;
          }
          cursor = result.nextCursor;
        }
      } catch (error) {
        if (requestId !== relationRequestRef.current) return;
        const existing = sessionRef.current.neighborhood;
        dispatch({
          type: "relations/set",
          knowledge: {
            kind: "failed",
            centerRevisionId: revisionId,
            nodes:
              existing.kind !== "idle" &&
              existing.centerRevisionId === revisionId
                ? existing.nodes
                : [],
            message: errorMessage(error),
          },
        });
      }
    },
    [client, dispatch],
  );

  const commitView = useCallback(
    (
      view: ReadingView,
      mode: "navigate" | "compare",
      focus: AnchorInput | null = null,
      reason: Extract<
        import("../../lib/reader/attention").ComparisonReason,
        { kind: "connection" | "document" | "revision" | "answer" }
      > = { kind: "document" },
    ) => {
      dispatch({ type: "cache/revision", revision: view.document });
      const position = readingPosition(view.document, focus);
      if (mode === "navigate")
        dispatchAttention({ type: "navigate", position });
      else dispatchAttention({ type: "compare", position, reason });
      dispatch({
        type: "data/merge",
        connections: view.connections,
        questions: view.questions,
      });
      // The neighborhood is centered on the current surface.  Comparing a
      // companion enriches its cache and relations without moving that
      // center; promotion or navigation will trigger the current revision's
      // relation refresh through the attention effect below.
      if (mode === "navigate") void loadNeighborhood(view.document.revisionId);
    },
    [dispatch, dispatchAttention, loadNeighborhood],
  );

  const deferNavigation = useCallback(
    (view: ReadingView, message: string) => {
      const pending: PendingNavigation = {
        target: {
          documentId: view.document.id,
          revisionId: view.document.revisionId,
          focus: null,
        },
        title: view.document.title,
        revision: view.document,
        message,
      };
      dispatch({ type: "navigation/defer", navigation: pending });
      dispatch({
        type: "status",
        message: `已收到“${view.document.title}”的定位；当前草稿保存或关闭后继续。`,
      });
    },
    [dispatch],
  );

  const openDocument = useCallback(
    async (
      target: { id: DocumentId; revisionId?: RevisionId },
      focus: AnchorInput | null = null,
      options: { force?: boolean } = {},
    ): Promise<boolean> => {
      if (!options.force && hasProtectedDraft(sessionRef.current)) {
        const cachedRevision = target.revisionId
          ? sessionRef.current.revisionCache.get(target.revisionId)?.document
          : undefined;
        const cachedSummary = sessionRef.current.documents.find(
          (item) => item.id === target.id,
        );
        dispatch({
          type: "navigation/defer",
          navigation: {
            target: {
              documentId: target.id,
              revisionId:
                target.revisionId ??
                cachedRevision?.revisionId ??
                cachedSummary?.revisionId ??
                ("" as RevisionId),
              focus,
            },
            title: cachedRevision?.title ?? cachedSummary?.title ?? "目标文档",
            revision: cachedRevision ?? null,
            message: "当前有未保存草稿。",
          },
        });
        dispatch({
          type: "status",
          message: "当前草稿已保留；保存或关闭后再打开目标。",
        });
        return false;
      }
      const requestId = openRequestRef.current + 1;
      openRequestRef.current = requestId;
      dispatch({ type: "loading", loading: true });
      dispatch({ type: "error", message: null });
      try {
        const view = await readOpenResult({
          documentId: target.id,
          revisionId: target.revisionId,
        });
        if (requestId !== openRequestRef.current || !view) return false;
        commitView(view, "navigate", focus);
        dispatch({ type: "navigation/clear" });
        dispatch({ type: "loading", loading: false });
        dispatch({ type: "status", message: null });
        if (client.mode === "website" && typeof window !== "undefined") {
          const url = new URL(window.location.href);
          url.searchParams.set("document", view.document.id);
          url.searchParams.set("revision", view.document.revisionId);
          window.history.replaceState(null, "", url);
          window.localStorage.setItem(
            "xanadu-current-document",
            view.document.id,
          );
        }
        return true;
      } catch (error) {
        if (requestId === openRequestRef.current) {
          dispatch({ type: "loading", loading: false });
          dispatch({ type: "error", message: errorMessage(error) });
        }
        return false;
      }
    },
    [client, commitView, dispatch, readOpenResult],
  );

  const acceptHostResult = useCallback(
    (result: OpenDocumentResult): void => {
      if (!isReady(result)) {
        dispatch({ type: "loading", loading: false });
        dispatch({
          type: "status",
          message: "文档空间为空，可以新建或导入一份文档。",
        });
        return;
      }
      const answer = answerArrival(result);
      if (answer) {
        const notification: AnswerNotification = {
          questionId: answer.id,
          answerDocumentId: result.view.document.id,
          answerRevisionId: result.view.document.revisionId,
          title: result.view.document.title,
          status: "unseen",
        };
        dispatch({ type: "question/answered", question: answer });
        dispatch({ type: "answer/arrived", notification });
        dispatch({
          type: "status",
          message: `问题“${answer.body.slice(0, 40)}”已有回答。`,
        });
        dispatch({ type: "cache/revision", revision: result.view.document });
        dispatch({
          type: "data/merge",
          connections: result.view.connections,
          questions: result.view.questions,
        });
        return;
      }
      if (
        hasProtectedDraft(sessionRef.current) ||
        composing ||
        pointerSelecting
      ) {
        deferNavigation(result.view, "当前有未完成的阅读操作。");
        return;
      }
      commitView(result.view, "navigate");
      dispatch({ type: "loading", loading: false });
      dispatch({ type: "status", message: null });
    },
    [commitView, composing, deferNavigation, dispatch, pointerSelecting],
  );

  const openLatest = useCallback(async (): Promise<void> => {
    try {
      const view = await readOpenResult({});
      if (!view) {
        dispatch({ type: "loading", loading: false });
        dispatch({
          type: "status",
          message: "文档空间为空，可以新建或导入一份文档。",
        });
        return;
      }
      commitView(view, "navigate");
      dispatch({ type: "loading", loading: false });
    } catch (error) {
      dispatch({ type: "loading", loading: false });
      dispatch({ type: "error", message: errorMessage(error) });
    }
  }, [commitView, dispatch, readOpenResult]);

  useEffect(() => {
    void loadCatalogue("active");
    void loadCatalogue("archived");
  }, [loadCatalogue]);

  useEffect(() => {
    if (!onReady) return;
    onReady(acceptHostResult);
  }, [acceptHostResult, onReady]);

  useEffect(() => {
    if (
      initialView === undefined ||
      initialView === null ||
      initialResultRef.current === initialView
    )
      return;
    initialResultRef.current = initialView;
    acceptHostResult(initialView);
  }, [acceptHostResult, initialView]);

  useEffect(() => {
    if (client.mode !== "website") return;
    return registerReadingTools(client, acceptHostResult);
  }, [acceptHostResult, client]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        dispatch({ type: "dialog/open-search" });
      }
      if (event.key === "Escape") {
        const current = sessionRef.current;
        if (
          current.question.kind !== "closed" ||
          current.connection.kind !== "closed"
        )
          dispatch({ type: "selection/clear" });
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [dispatch]);

  useEffect(() => {
    if (initialView !== undefined || initialOpenRef.current) return;
    if (
      !session.catalogue.activeComplete ||
      session.attention.attention.kind !== "empty"
    )
      return;
    initialOpenRef.current = true;
    void openLatest().catch(() => {
      initialOpenRef.current = false;
    });
  }, [
    initialView,
    openLatest,
    session.attention.attention.kind,
    session.catalogue.activeComplete,
  ]);

  useEffect(() => {
    const attention = session.attention.attention;
    if (attention.kind !== "reading") return;
    const positions = [attention.current, attention.companion?.position].filter(
      (position): position is ReadingPosition => Boolean(position),
    );
    for (const position of positions) {
      if (
        session.revisionCache.has(position.revisionId) ||
        ensuredRevisionRef.current.has(position.revisionId)
      )
        continue;
      ensuredRevisionRef.current.add(position.revisionId);
      void fetchRevision({
        id: position.documentId,
        revisionId: position.revisionId,
      }).catch(() => {
        ensuredRevisionRef.current.delete(position.revisionId);
      });
    }
  }, [fetchRevision, session.attention, session.revisionCache]);

  const relationRevisionId =
    session.attention.attention.kind === "reading"
      ? session.attention.attention.current.revisionId
      : null;
  useEffect(() => {
    if (!relationRevisionId) return;
    const attention = sessionRef.current.attention.attention;
    if (attention.kind !== "reading") return;
    const requestRevision = relationRevisionId;
    let cancelled = false;
    void readOpenResult({
      documentId: attention.current.documentId,
      revisionId: requestRevision,
    })
      .then((view) => {
        if (
          cancelled ||
          !view ||
          sessionRef.current.attention.attention.kind !== "reading" ||
          sessionRef.current.attention.attention.current.revisionId !==
            requestRevision
        )
          return;
        dispatch({
          type: "data/merge",
          connections: view.connections,
          questions: view.questions,
        });
        void loadNeighborhood(requestRevision);
      })
      .catch((error) => {
        if (!cancelled)
          dispatch({ type: "error", message: errorMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [dispatch, loadNeighborhood, readOpenResult, relationRevisionId]);

  const readBeside = useCallback(
    async (
      target: DocumentTarget,
      reason: Extract<
        import("../../lib/reader/attention").ComparisonReason,
        { kind: "connection" | "document" | "revision" | "answer" }
      > = { kind: "document" },
    ): Promise<void> => {
      const attention = sessionRef.current.attention.attention;
      if (attention.kind !== "reading") return;
      const requestId = compareRequestRef.current + 1;
      compareRequestRef.current = requestId;
      const summary = sessionRef.current.documents.find(
        (document) => document.id === target.documentId,
      );
      setPendingSurface({
        target,
        title: summary?.title ?? "正在读取…",
        error: null,
      });
      try {
        const view = await readOpenResult({
          documentId: target.documentId,
          revisionId: target.revisionId,
        });
        const latest = sessionRef.current.attention.attention;
        if (
          requestId !== compareRequestRef.current ||
          latest.kind !== "reading" ||
          latest.current.revisionId !== attention.current.revisionId ||
          !view
        )
          return;
        commitView(view, "compare", target.focus, reason);
        setPendingSurface(null);
        dispatch({ type: "status", message: null });
      } catch (error) {
        if (requestId === compareRequestRef.current)
          setPendingSurface((pending: PendingSurface | null) =>
            pending ? { ...pending, error: errorMessage(error) } : pending,
          );
      }
    },
    [commitView, dispatch, readOpenResult],
  );

  const onFollow = useCallback(
    (connectionId: Connection["id"]): void => {
      const attention = sessionRef.current.attention.attention;
      if (attention.kind !== "reading") return;
      const connection = sessionRef.current.connections.find(
        (item) => item.id === connectionId,
      );
      if (!connection) return;
      const currentRevision = attention.current.revisionId;
      const endpoint =
        connection.from.revisionId === currentRevision
          ? connection.to
          : connection.to.revisionId === currentRevision
            ? connection.from
            : null;
      if (!endpoint) return;
      dispatch({ type: "connection/select", connectionId });
      void readBeside(
        {
          documentId: endpoint.documentId,
          revisionId: endpoint.revisionId,
          focus: endpoint,
        },
        { kind: "connection", connectionId },
      );
    },
    [dispatch, readBeside],
  );

  const onPromote = useCallback(() => {
    if (sessionRef.current.attention.attention.kind !== "reading") return;
    if (!sessionRef.current.attention.attention.companion) return;
    dispatchAttention({ type: "promote" });
    dispatch({ type: "status", message: null });
  }, [dispatch, dispatchAttention]);

  const onReturnToCurrent = useCallback(() => {
    dispatchAttention({ type: "return-to-current" });
    setPendingSurface(null);
  }, [dispatchAttention]);

  const onHistory = useCallback(
    (index: number) => {
      dispatchAttention({ type: "history", index });
      setPendingSurface(null);
    },
    [dispatchAttention],
  );

  const onScroll = useCallback(
    (role: SurfaceRole, scrollTop: number) => {
      dispatchAttention({ type: "scroll", role, scrollTop });
    },
    [dispatchAttention],
  );

  const onCameraCheckpoint = useCallback(
    (pose: import("../../lib/reader/attention").CameraPose) => {
      dispatchAttention({ type: "camera", pose });
    },
    [dispatchAttention],
  );

  const selectText = useCallback(
    (anchor: AnchorInput, document: DocumentRevision, rect: DOMRect): void => {
      setPointerSelecting(false);
      const connection = sessionRef.current.connection;
      dispatch({
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
      if (connection.kind === "first")
        dispatch({ type: "connection/open-second", document, anchor });
    },
    [dispatch],
  );

  const openQuestion = useCallback(() => {
    const selection = sessionRef.current.selection;
    if (selection.kind !== "selected") return;
    dispatch({
      type: "question/open",
      document: selection.document,
      anchor: selection.anchor,
    });
  }, [dispatch]);

  const selectSearchMatch = useCallback(
    async (match: SearchMatch): Promise<void> => {
      const document = await fetchRevision({
        id: match.document.id,
        revisionId: match.revisionId,
      });
      const anchor = makeAnchor(document, match.start, match.end);
      const opened = await openDocument(
        { id: document.id, revisionId: document.revisionId },
        anchor,
      );
      if (opened) dispatch({ type: "dialog/close" });
    },
    [dispatch, fetchRevision, openDocument],
  );

  const sendQuestion = useCallback(async (): Promise<void> => {
    if (questionSubmissionRef.current) return questionSubmissionRef.current;
    const run = (async () => {
      const draft = sessionRef.current.question;
      if (
        draft.kind !== "draft" &&
        draft.kind !== "send_failed" &&
        draft.kind !== "saved"
      )
        return;
      const body = draft.body.trim();
      if (!body) return;
      if (draft.saved && draft.sentBody === body) return;
      dispatch({ type: "question/saving" });
      try {
        const question =
          draft.saved && draft.sentBody === null
            ? draft.saved
            : (await client.invoke("ask", { anchor: draft.anchor, body }))
                .question;
        const latest = sessionRef.current.question;
        if (
          latest.kind === "closed" ||
          latest.body.trim() !== body ||
          latest.anchor.revisionId !== draft.anchor.revisionId
        ) {
          dispatch({
            type: "question/failure",
            message: "问题内容在保存期间发生了变化，请确认后重新发送。",
          });
          return;
        }
        dispatch({ type: "question/saved", question, body });
        if (client.sendQuestion) {
          dispatch({ type: "question/sending", body });
          await client.sendQuestion(question);
          dispatch({ type: "question/sent", body });
          dispatch({ type: "status", message: "问题已发送，等待回答。" });
        } else {
          await navigator.clipboard.writeText(questionPrompt(question));
          dispatch({ type: "question/sent", body });
          dispatch({ type: "status", message: "问题已保存，提问内容已复制。" });
        }
      } catch (error) {
        dispatch({ type: "question/failure", message: errorMessage(error) });
      }
    })();
    questionSubmissionRef.current = run;
    try {
      await run;
    } finally {
      if (questionSubmissionRef.current === run)
        questionSubmissionRef.current = null;
    }
  }, [client, dispatch]);

  const startConnection = useCallback(() => {
    const selection = sessionRef.current.selection;
    if (selection.kind !== "selected") return;
    dispatch({
      type: "connection/open-first",
      document: selection.document,
      anchor: selection.anchor,
    });
  }, [dispatch]);

  const saveConnection = useCallback(async (): Promise<void> => {
    const draft = sessionRef.current.connection;
    if (draft.kind !== "second" && draft.kind !== "failed") return;
    dispatch({ type: "connection/saving" });
    try {
      const result = await client.invoke("link", {
        from: draft.first.anchor,
        to: draft.second.anchor,
        relation: draft.relation,
        label: draft.label,
      });
      dispatch({ type: "connection/added", connection: result.connection });
      dispatch({ type: "status", message: "连接已建立。" });
    } catch (error) {
      dispatch({ type: "connection/failed", message: errorMessage(error) });
    }
  }, [client, dispatch]);

  const openHistory = useCallback(
    async (
      document: DocumentRevision,
      owner: ReadingPosition | null,
    ): Promise<void> => {
      const requestId = historyRequestRef.current + 1;
      historyRequestRef.current = requestId;
      try {
        const revisions: Omit<DocumentRevision, "content">[] = [];
        let cursor: string | undefined;
        do {
          const result = await client.invoke("history", {
            documentId: document.id,
            limit: 100,
            cursor,
          });
          if (historyRequestRef.current !== requestId) return;
          revisions.push(...result.revisions);
          cursor = result.nextCursor ?? undefined;
        } while (cursor);
        setHistoryItems(revisions);
        dispatch({ type: "dialog/open-history", document, owner });
      } catch (error) {
        dispatch({ type: "error", message: errorMessage(error) });
      }
    },
    [client, dispatch],
  );

  const openHistoryRevision = useCallback(
    async (item: Omit<DocumentRevision, "content">): Promise<void> => {
      dispatch({ type: "dialog/close" });
      await openDocument({ id: item.id, revisionId: item.revisionId }, null);
    },
    [dispatch, openDocument],
  );

  const flushPendingNavigation = useCallback(() => {
    const pending = sessionRef.current.pendingNavigation;
    if (
      !pending ||
      hasProtectedDraft(sessionRef.current) ||
      composing ||
      pointerSelecting
    )
      return;
    dispatch({ type: "navigation/clear" });
    void openDocument(
      {
        id: pending.target.documentId,
        revisionId: pending.target.revisionId || undefined,
      },
      pending.target.focus,
      { force: true },
    );
  }, [composing, openDocument, pointerSelecting, dispatch]);

  useEffect(() => {
    const currentSession = sessionRef.current;
    if (
      !currentSession.pendingNavigation ||
      hasProtectedDraft(currentSession) ||
      composing ||
      pointerSelecting
    )
      return;
    flushPendingNavigation();
  }, [
    composing,
    flushPendingNavigation,
    pointerSelecting,
    session.editor,
    session.pendingNavigation,
    session.question,
  ]);

  const saveEditor = useCallback(async (): Promise<void> => {
    const draft = sessionRef.current.editor;
    if (draft.kind === "closed") return;
    dispatch({ type: "editor/saving" });
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
        document = (
          await client.invoke("mv", {
            documentId: draft.document.id,
            newPath: Path.parse(draft.path),
          })
        ).document;
      } else {
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
      dispatch({ type: "cache/revision", revision: document });
      dispatch({
        type: "catalogue/merge",
        scope: "active",
        documents: [document],
      });
      dispatch({ type: "editor/close" });
      dispatch({
        type: "status",
        message:
          draft.kind === "create"
            ? "文档已创建；可从空间边缘旁读它。"
            : draft.kind === "rename"
              ? "文档已移动。"
              : "已保存新版本。",
      });
      if (sessionRef.current.attention.attention.kind === "empty")
        await openDocument(
          { id: document.id, revisionId: document.revisionId },
          null,
          {
            force: true,
          },
        );
      else if (draft.kind === "edit" && draft.owner) {
        const role: SurfaceRole =
          sessionRef.current.attention.attention.kind === "reading" &&
          sessionRef.current.attention.attention.current.revisionId ===
            draft.owner.revisionId
            ? "current"
            : "companion";
        dispatchAttention({
          type: "replace-revision",
          role,
          position: readingPosition(document),
        });
      }
      flushPendingNavigation();
    } catch (error) {
      dispatch({ type: "editor/error", message: errorMessage(error) });
    }
  }, [
    client,
    dispatch,
    dispatchAttention,
    flushPendingNavigation,
    openDocument,
  ]);

  const closeEditor = useCallback(() => {
    const draft = sessionRef.current.editor;
    if (isEditorDirty(draft)) {
      dispatch({
        type: "status",
        message: "编辑草稿仍保留；选择“放弃草稿”才会清除。",
      });
      return;
    }
    dispatch({ type: "editor/close" });
    flushPendingNavigation();
  }, [dispatch, flushPendingNavigation]);

  const importFiles = useCallback(
    async (files: FileList | null): Promise<void> => {
      if (!files?.length) return;
      const incoming: ImportTask[] = Array.from(files).map((file, index) => ({
        id: `${Date.now()}-${index}-${file.name}`,
        name: file.name,
        status: "queued",
        message: null,
      }));
      dispatch({ type: "imports/set", imports: incoming });
      let firstImported: DocumentRevision | null = null;
      const emptyAtStart =
        sessionRef.current.attention.attention.kind === "empty";
      for (const [index, file] of Array.from(files).entries()) {
        const task = incoming[index];
        incoming[index] = { ...task, status: "importing" };
        dispatch({ type: "imports/set", imports: [...incoming] });
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
            binary += String.fromCharCode(
              ...bytes.subarray(offset, offset + 8192),
            );
          const document = (
            await client.invoke("import_file", {
              path: Path.parse(
                `/imports/${file.name.replace(/[\\/\x00-\x1f]/g, "_")}`,
              ),
              title: file.name.replace(/\.[^.]+$/, ""),
              mime,
              base64: btoa(binary),
            })
          ).document;
          incoming[index] = {
            ...incoming[index],
            status: "imported",
            message: "已导入",
          };
          dispatch({ type: "cache/revision", revision: document });
          dispatch({
            type: "catalogue/merge",
            scope: "active",
            documents: [document],
          });
          if (emptyAtStart && !firstImported) firstImported = document;
        } catch (error) {
          incoming[index] = {
            ...incoming[index],
            status: "failed",
            message: errorMessage(error),
          };
        }
        dispatch({ type: "imports/set", imports: [...incoming] });
      }
      await loadCatalogue("active", true);
      if (firstImported)
        await openDocument(
          { id: firstImported.id, revisionId: firstImported.revisionId },
          null,
          { force: true },
        );
      setImportInputKey((value) => value + 1);
    },
    [client, dispatch, loadCatalogue, openDocument],
  );

  const runSearch = useCallback(
    async (query: string): Promise<void> => {
      const requestId = searchRequestRef.current + 1;
      searchRequestRef.current = requestId;
      if (!query.trim()) {
        dispatch({ type: "search/clear" });
        return;
      }
      dispatch({ type: "search/querying", query, requestId });
      try {
        let cursor: string | undefined;
        const seen = new Set<string>();
        const matches: SearchMatch[] = [];
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
          if (!result.nextCursor || seen.has(result.nextCursor)) break;
          seen.add(result.nextCursor);
          cursor = result.nextCursor;
        }
        dispatch({ type: "search/results", query, requestId, matches });
      } catch (error) {
        if (searchRequestRef.current === requestId)
          dispatch({ type: "search/failed", message: errorMessage(error) });
      }
    },
    [client, dispatch],
  );

  const archiveDocument = useCallback(
    async (document: DocumentRevision): Promise<void> => {
      try {
        const updated = (
          await client.invoke("archive", {
            documentId: document.id,
            archived: !document.archived,
          })
        ).document;
        dispatch({ type: "cache/revision", revision: updated });
        dispatch({
          type: "catalogue/merge",
          scope: updated.archived ? "archived" : "active",
          documents: [updated],
        });
        dispatch({
          type: "status",
          message: updated.archived ? "文档已归档。" : "文档已恢复。",
        });
        await loadCatalogue("active", true);
        await loadCatalogue("archived", true);
      } catch (error) {
        dispatch({ type: "error", message: errorMessage(error) });
      }
    },
    [client, dispatch, loadCatalogue],
  );

  const openAnswer = useCallback(
    (answer: AnswerNotification): void => {
      dispatch({
        type: "answer/status",
        questionId: answer.questionId,
        status: "reading",
      });
      void readBeside(
        {
          documentId: answer.answerDocumentId,
          revisionId: answer.answerRevisionId,
          focus: null,
        },
        { kind: "answer", questionId: answer.questionId },
      );
    },
    [dispatch, readBeside],
  );

  const renderDocument = useCallback(
    (surface: ReadingSurface, role: SurfaceRole): React.ReactNode => {
      const document = surface.document;
      return (
        <article
          className={`document-plane-body ${role === "current" ? "detailed" : "detailed companion-body"}`}
        >
          <header className="plane-heading" data-view-handle>
            <div className="plane-identity">
              <h1>{document.title}</h1>
              <p>
                {document.path} · v{document.sequence}
                {!document.isCurrent ? " · 历史版本" : ""}
                {document.archived ? " · 已归档" : ""}
              </p>
            </div>
            <PlaneMenu
              document={document}
              onEdit={() =>
                dispatch({
                  type: "editor/open-edit",
                  document,
                  owner:
                    sessionRef.current.attention.attention.kind === "reading"
                      ? role === "current"
                        ? sessionRef.current.attention.attention.current
                        : (sessionRef.current.attention.attention.companion
                            ?.position ?? null)
                      : null,
                })
              }
              onHistory={() =>
                void openHistory(
                  document,
                  sessionRef.current.attention.attention.kind === "reading"
                    ? role === "current"
                      ? sessionRef.current.attention.attention.current
                      : (sessionRef.current.attention.attention.companion
                          ?.position ?? null)
                    : null,
                )
              }
              onRename={() =>
                dispatch({
                  type: "editor/open-rename",
                  document,
                  owner:
                    sessionRef.current.attention.attention.kind === "reading"
                      ? role === "current"
                        ? sessionRef.current.attention.attention.current
                        : (sessionRef.current.attention.attention.companion
                            ?.position ?? null)
                      : null,
                })
              }
              onArchive={() => void archiveDocument(document)}
              onDownload={() => downloadDocument(document)}
              website={client.mode === "website"}
            />
          </header>
          <DocumentPassage
            document={document}
            focus={surface.position.focus}
            connections={
              session.connections.length ? session.connections : NO_CONNECTIONS
            }
            onActivateConnection={onFollow}
            onGeometryChange={() => controllerRef.current?.measure()}
            onSelectText={selectText}
          />
        </article>
      );
    },
    [
      archiveDocument,
      client.mode,
      dispatch,
      onFollow,
      openHistory,
      selectText,
      session.connections,
    ],
  );

  const currentSurface = useMemo<ReadingSurface | null>(() => {
    const attention = session.attention.attention;
    if (attention.kind !== "reading") return null;
    const cached = session.revisionCache.get(attention.current.revisionId);
    return cached
      ? { position: attention.current, document: cached.document }
      : null;
  }, [session.attention.attention, session.revisionCache]);

  const companionSurface = useMemo<ReadingSurface | null>(() => {
    const attention = session.attention.attention;
    if (attention.kind !== "reading" || !attention.companion) return null;
    const cached = session.revisionCache.get(
      attention.companion.position.revisionId,
    );
    return cached
      ? { position: attention.companion.position, document: cached.document }
      : null;
  }, [session.attention.attention, session.revisionCache]);

  const previousLeaf = useMemo<ReturnLeaf | null>(() => {
    const index = returnHistoryIndex(session.attention);
    if (index === null) return null;
    const snapshot = session.attention.history[index];
    if (!snapshot || snapshot.attention.kind !== "reading") return null;
    const position = snapshot.attention.current;
    const document = summaryFor(
      session.documents,
      position,
      session.revisionCache,
    );
    if (!document) return null;
    return {
      position,
      document,
      historyIndex: index,
    };
  }, [session.attention, session.documents, session.revisionCache]);

  const historyBackIndex =
    session.attention.historyIndex > 0
      ? session.attention.historyIndex - 1
      : null;
  const historyForwardIndex =
    session.attention.historyIndex < session.attention.history.length - 1
      ? session.attention.historyIndex + 1
      : null;
  const searchDialog = session.dialog.kind === "search";
  const historyDialog =
    session.dialog.kind === "history" ? session.dialog : null;
  const editorOpen = session.editor.kind !== "closed";
  const activitiesOpen = session.dialog.kind === "activities";
  const currentAttention =
    session.attention.attention.kind === "reading"
      ? session.attention.attention.current
      : null;

  function downloadDocument(document: DocumentRevision): void {
    const blob = new Blob([document.content], {
      type:
        document.format === "markdown"
          ? "text/markdown;charset=utf-8"
          : "text/plain;charset=utf-8",
    });
    const link = window.document.createElement("a");
    link.href = URL.createObjectURL(blob);
    const filename = document.path.split("/").pop() ?? "document";
    link.download = /\.(md|markdown|txt)$/i.test(filename)
      ? filename
      : `${filename.replace(/\.[^.]+$/, "")}.${document.format === "markdown" ? "md" : "txt"}`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  return (
    <main className="reader-shell">
      <header className="reader-topbar">
        <div className="brand-lockup">
          <button
            type="button"
            className="brand-button"
            onClick={() => controllerRef.current?.resetCamera()}
          >
            Xanadu<span>Sidebranch</span>
          </button>
          <span className="space-state">
            {session.catalogue.activeComplete ? "阅读空间" : "正在载入空间"}
          </span>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className="quiet-icon topbar-history"
            aria-label="返回上一个阅读上下文"
            title="返回"
            disabled={historyBackIndex === null}
            onClick={() =>
              historyBackIndex !== null && onHistory(historyBackIndex)
            }
          >
            <ArrowLeft size={16} />
          </button>
          <button
            type="button"
            className="quiet-icon topbar-history"
            aria-label="前进到下一个阅读上下文"
            title="前进"
            disabled={historyForwardIndex === null}
            onClick={() =>
              historyForwardIndex !== null && onHistory(historyForwardIndex)
            }
          >
            <ArrowRight size={16} />
          </button>
          <button
            type="button"
            className="topbar-button"
            aria-label="搜索文档"
            onClick={() => dispatch({ type: "dialog/open-search" })}
          >
            <Search size={16} /> <span>搜索</span> <kbd>⌘ K</kbd>
          </button>
          <ReaderMenu
            trigger={(toggle, open) => (
              <button
                type="button"
                className="account-button"
                aria-label="空间命令"
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
                dispatch({
                  type: "editor/open-create",
                  path: "/notes/untitled.md",
                  owner: currentAttention,
                })
              }
            >
              <FilePlus2 size={15} /> 新建文档
            </ReaderMenuItem>
            <ReaderMenuItem onSelect={() => fileInputRef.current?.click()}>
              <Upload size={15} /> 导入文件
            </ReaderMenuItem>
            <ReaderMenuItem
              onSelect={() => dispatch({ type: "dialog/open-activities" })}
            >
              <History size={15} /> 连接与问题
            </ReaderMenuItem>
            <ReaderMenuSeparator />
            <ReaderMenuItem
              onSelect={() => dispatch({ type: "dialog/open-settings" })}
            >
              <Settings2 size={15} /> 连接 ChatGPT
            </ReaderMenuItem>
            {client.mode === "website" && (
              <ReaderMenuLink
                href="/signout-with-chatgpt?return_to=/"
                target="_top"
              >
                退出登录
              </ReaderMenuLink>
            )}
          </ReaderMenu>
        </div>
      </header>

      <section className="reader-main">
        <input
          key={importInputKey}
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.markdown,.pdf"
          multiple
          hidden
          onChange={(event) => void importFiles(event.target.files)}
        />
        <div
          className="workspace-stage"
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest("[data-document-text]")) {
              setPointerSelecting(true);
            }
          }}
          onPointerUp={() => setPointerSelecting(false)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => {
            setComposing(false);
            flushPendingNavigation();
          }}
        >
          {(session.error ||
            session.catalogue.activeError ||
            session.catalogue.archivedError) && (
            <div className="reader-alert error" role="alert">
              {session.error ??
                session.catalogue.activeError ??
                session.catalogue.archivedError}
              <button
                type="button"
                onClick={() => dispatch({ type: "error", message: null })}
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
                type="button"
                onClick={() => dispatch({ type: "status", message: null })}
                aria-label="关闭提示"
              >
                <X size={15} />
              </button>
            </div>
          )}
          {session.answers.some((answer) => answer.status === "unseen") && (
            <div className="answer-notice" aria-live="polite">
              {session.answers
                .filter((answer) => answer.status === "unseen")
                .map((answer) => (
                  <div className="answer-notice-item" key={answer.questionId}>
                    <span>已有回答：{answer.title}</span>
                    <button type="button" onClick={() => openAnswer(answer)}>
                      旁读答案
                    </button>
                    <button
                      type="button"
                      className="quiet-button"
                      onClick={() =>
                        dispatch({
                          type: "answer/status",
                          questionId: answer.questionId,
                          status: "seen",
                        })
                      }
                    >
                      稍后阅读
                    </button>
                  </div>
                ))}
            </div>
          )}
          {session.imports.length > 0 && (
            <div className="import-progress" role="status">
              {session.imports.map((task) => (
                <p key={task.id}>
                  <span>{task.name}</span>
                  <small>
                    {task.message ??
                      (task.status === "importing" ? "正在导入…" : task.status)}
                  </small>
                </p>
              ))}
            </div>
          )}
          {currentSurface || session.attention.attention.kind === "reading" ? (
            <SpatialScene
              current={currentSurface}
              companion={companionSurface}
              previous={previousLeaf}
              camera={session.attention.camera}
              documents={session.documents}
              catalogue={session.catalogue}
              neighborhood={session.neighborhood}
              connections={session.connections}
              selectedConnectionId={session.selectedConnectionId}
              pending={pendingSurface}
              onReadBeside={(target: DocumentTarget) => void readBeside(target)}
              onPromote={onPromote}
              onReturnToCurrent={onReturnToCurrent}
              onFollow={onFollow}
              onHistory={onHistory}
              onScroll={onScroll}
              onCameraCheckpoint={onCameraCheckpoint}
              renderDocument={renderDocument}
              controllerRef={controllerRef}
            />
          ) : (
            <EmptyWorkspace
              loading={session.loading || session.catalogue.loading}
              onCreate={() =>
                dispatch({
                  type: "editor/open-create",
                  path: "/notes/untitled.md",
                  owner: null,
                })
              }
              onImport={() => fileInputRef.current?.click()}
            />
          )}
        </div>
      </section>

      <SelectionComposer
        session={session}
        dispatch={dispatch}
        onOpenQuestion={openQuestion}
        onSendQuestion={() => void sendQuestion()}
        onStartConnection={startConnection}
        onSaveConnection={() => void saveConnection()}
      />

      <ReaderDialogs
        session={session}
        dispatch={dispatch}
        searchOpen={searchDialog}
        historyOpen={historyDialog !== null}
        editorOpen={editorOpen}
        activitiesOpen={activitiesOpen}
        historyItems={historyItems}
        onSearch={(query) => void runSearch(query)}
        onSelectSearchMatch={selectSearchMatch}
        onOpenHistoryRevision={openHistoryRevision}
        onCloseEditor={closeEditor}
        onFlushPendingNavigation={flushPendingNavigation}
        onSaveEditor={saveEditor}
        onOpenAnswer={openAnswer}
        onFollow={onFollow}
        onOpenDocument={openDocument}
      />
    </main>
  );
}
