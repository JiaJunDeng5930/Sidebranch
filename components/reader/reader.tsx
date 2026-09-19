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
  canSendQuestion,
  emptySession,
  hasProtectedDraft,
  isEditorDirty,
  isQuestionDirty,
  navigationAttemptId,
  navigationIntentId,
  questionDeliveryAttemptId,
  questionPersistenceAttemptId,
  readerSessionReducer,
  type AnswerNotification,
  type ImportTask,
  type NavigationAttemptId,
  type NavigationIntentId,
  type PendingNavigation,
  type ReaderSessionAction,
  type SearchMatch,
} from "../../lib/reader/session";
import { SpatialScene } from "./spatial-scene";
import { DocumentPassage } from "./document-passage";
import { firstVisibleSourceOffset } from "./passage";
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
  findOccurrence,
  focusedPosition,
  primarySurfaceId,
  createConnectionInspection,
  type AttentionAction,
  type ReadingPosition,
} from "../../lib/reader/attention";
import {
  changesReadingContext,
  isCurrentRequest,
  nextRequest,
  requestToken,
} from "../../lib/reader/navigation-requests";
import type { SpatialSceneController } from "./spatial-scene";
import type {
  ConnectionActivation,
  DocumentRenderContext,
  PresentationRequest,
  ReadingSurface,
  RelationNavigationState,
  SurfaceInstanceId,
} from "../../lib/reader/spatial-contract";
import {
  createSurfaceInstanceId,
  relationNavigationItems,
} from "../../lib/reader/spatial-contract";
import {
  answerArrival,
  errorMessage,
  isReady,
  makeAnchor,
} from "./reader-model";
import {
  AnswerArrivalEntry,
  EmptyWorkspace,
  PlaneMenu,
  SelectionComposer,
} from "./reader-overlays";
import { ReaderDialogs } from "./reader-dialogs";
import { readerPaletteStyle } from "../../lib/reader/semantic-palette";
import "./reader.css";
import "./reader-palette.css";

const NO_CONNECTIONS: readonly Connection[] = [];
const WAITING_FOR_ANSWER_STATUS = "问题已发送，等待回答。";

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
  const [importInputKey, setImportInputKey] = useState(0);
  const [composing, setComposing] = useState(false);
  const [pointerSelecting, setPointerSelecting] = useState(false);
  const [presentation, setPresentation] = useState<PresentationRequest>({
    id: 0,
    kind: "layout",
  });

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const presentationRef = useRef(presentation);
  presentationRef.current = presentation;
  const composingRef = useRef(false);
  const pointerSelectingRef = useRef(false);
  const interactionState = composing || pointerSelecting;
  const controllerRef = useRef<SpatialSceneController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialResultRef = useRef<OpenDocumentResult | null>(null);
  const initialOpenRef = useRef(false);
  const cataloguePromisesRef = useRef(
    new Map<"active" | "archived", Promise<void>>(),
  );
  const catalogueRequestRef = useRef({ active: 0, archived: 0 });
  const openRequestRef = useRef(0);
  const presentationSequenceRef = useRef(0);
  const navigationIntentRef = useRef(0);
  const navigationAttemptRef = useRef(0);
  const connectionRequestRef = useRef(0);
  const editorRequestRef = useRef(0);
  const attentionEpochRef = useRef(0);
  const relationRequestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const historyRequestRef = useRef(0);
  const questionPersistenceAttemptRef = useRef(0);
  const questionDeliveryAttemptRef = useRef(0);
  const waitingQuestionIdRef = useRef<Question["id"] | null>(null);
  const questionSubmissionRef = useRef<Promise<void> | null>(null);
  const revisionPromisesRef = useRef(
    new Map<string, Promise<DocumentRevision>>(),
  );

  const dispatch = useCallback((action: ReaderSessionAction) => {
    dispatchSession(action);
  }, []);

  const requestPresentation = useCallback(
    (
      kind: PresentationRequest["kind"],
      surfaces: readonly SurfaceInstanceId[] = [],
    ) => {
      const id = nextRequest(presentationSequenceRef.current);
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

  const retireCancelledNavigation = useCallback(() => {
    const pending = sessionRef.current.pendingNavigation;
    if (pending?.lifecycle !== "opening") return;
    dispatchSession({
      type: "navigation/cancel",
      intentId: pending.intentId,
      attemptId: pending.attemptId,
    });
  }, []);

  const hasInteractionProtection = useCallback(
    (): boolean =>
      hasProtectedDraft(sessionRef.current) ||
      composingRef.current ||
      pointerSelectingRef.current,
    [],
  );

  const dispatchAttention = useCallback(
    (action: AttentionAction) => {
      if (changesReadingContext(action)) controllerRef.current?.cancelInput();
      if (changesReadingContext(action)) {
        attentionEpochRef.current = nextRequest(attentionEpochRef.current);
        retireCancelledNavigation();
      }
      if (action.type === "history") requestPresentation("restore");
      else if (changesReadingContext(action)) {
        const surfaces =
          action.type === "inspect-connection"
            ? [
                action.inspection.current.surfaceId,
                action.inspection.companion.surfaceId,
              ]
            : "position" in action
              ? [action.position.surfaceId]
              : action.type === "focus-surface"
                ? [action.surfaceId]
                : [];
        requestPresentation("align-ranges", surfaces);
      }
      dispatchSession({ type: "attention", action });
    },
    [requestPresentation, retireCancelledNavigation],
  );

  const cancelLocalNavigation = useCallback(() => {
    openRequestRef.current = nextRequest(openRequestRef.current);
    attentionEpochRef.current = nextRequest(attentionEpochRef.current);
    retireCancelledNavigation();
  }, [retireCancelledNavigation]);

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
      if (requestedRevision)
        dispatch({ type: "payload/loading", revisionId: requestedRevision });
      const promise = client
        .invoke("cat", {
          documentId: target.id,
          revisionId: requestedRevision,
        })
        .then((result) => {
          if (
            result.document.id !== target.id ||
            (requestedRevision &&
              result.document.revisionId !== requestedRevision)
          )
            throw new Error("返回的文档版本与请求不符。");
          dispatch({ type: "cache/revision", revision: result.document });
          return result.document;
        })
        .catch((error) => {
          if (requestedRevision)
            dispatch({
              type: "payload/error",
              revisionId: requestedRevision,
              message: errorMessage(error),
            });
          throw error;
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
      focus: AnchorInput | null = null,
      surfaceId?: SurfaceInstanceId,
    ) => {
      dispatch({ type: "cache/revision", revision: view.document });
      const existing = surfaceId
        ? sessionRef.current.attention.space.surfaces.get(surfaceId)
        : findOccurrence(
            sessionRef.current.attention,
            view.document.id,
            view.document.revisionId,
          );
      const position = readingPosition(
        view.document,
        surfaceId ??
          existing?.surfaceId ??
          primarySurfaceId(view.document.id, view.document.revisionId),
        focus,
        existing?.scrollTop ?? 0,
      );
      dispatchAttention({ type: "navigate", position });
      dispatch({
        type: "data/merge",
        connections: view.connections,
        questions: view.questions,
      });
      void loadNeighborhood(view.document.revisionId);
    },
    [dispatch, dispatchAttention, loadNeighborhood],
  );

  const deferNavigation = useCallback(
    (
      view: ReadingView,
      message: string,
      focus: AnchorInput | null = null,
      existingIntentId?: NavigationIntentId,
    ) => {
      const pending: PendingNavigation = {
        lifecycle: "blocked",
        intentId:
          existingIntentId ??
          navigationIntentId(nextRequest(navigationIntentRef.current)),
        target: {
          kind: "resolved",
          surfaceId:
            findOccurrence(
              sessionRef.current.attention,
              view.document.id,
              view.document.revisionId,
            )?.surfaceId ??
            primarySurfaceId(view.document.id, view.document.revisionId),
          target: {
            documentId: view.document.id,
            revisionId: view.document.revisionId,
            focus,
          },
          title: view.document.title,
          revision: view.document,
          message,
        },
      };
      if (!existingIntentId)
        navigationIntentRef.current = pending.intentId as number;
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
      target: {
        id: DocumentId;
        revisionId?: RevisionId;
        surfaceId?: SurfaceInstanceId;
      },
      focus: AnchorInput | null = null,
      options: {
        force?: boolean;
        pending?: {
          intentId: NavigationIntentId;
          attemptId: NavigationAttemptId;
        };
      } = {},
    ): Promise<boolean> => {
      controllerRef.current?.cancelInput();
      if (!options.force && hasInteractionProtection()) {
        const cachedRevision = target.revisionId
          ? sessionRef.current.revisionCache.get(target.revisionId)?.document
          : undefined;
        const cachedSummary = sessionRef.current.documents.find(
          (item) => item.id === target.id,
        );
        const resolvedRevisionId =
          target.revisionId ??
          cachedRevision?.revisionId ??
          cachedSummary?.revisionId;
        const pending: PendingNavigation = {
          lifecycle: "blocked",
          intentId: navigationIntentId(
            nextRequest(navigationIntentRef.current),
          ),
          target: resolvedRevisionId
            ? {
                kind: "resolved",
                surfaceId:
                  target.surfaceId ??
                  findOccurrence(
                    sessionRef.current.attention,
                    target.id,
                    resolvedRevisionId,
                  )?.surfaceId ??
                  primarySurfaceId(target.id, resolvedRevisionId),
                target: {
                  documentId: target.id,
                  revisionId: resolvedRevisionId,
                  focus,
                },
                title:
                  cachedRevision?.title ?? cachedSummary?.title ?? "目标文档",
                revision: cachedRevision ?? null,
                message: "当前有未保存草稿。",
              }
            : {
                kind: "unresolved",
                documentId: target.id,
                revisionId: undefined,
                focus,
                title: cachedSummary?.title ?? "目标文档",
                message: "当前有未保存草稿。",
              },
        };
        navigationIntentRef.current = pending.intentId as number;
        dispatch({ type: "navigation/defer", navigation: pending });
        dispatch({
          type: "status",
          message: "当前草稿已保留；保存或关闭后再打开目标。",
        });
        return false;
      }
      const metadata = sessionRef.current.documents.find(
        (item) =>
          item.id === target.id &&
          (!target.revisionId || item.revisionId === target.revisionId),
      );
      const revisionId = target.revisionId ?? metadata?.revisionId;
      if (revisionId) {
        const existing = findOccurrence(
          sessionRef.current.attention,
          target.id,
          revisionId,
        );
        dispatch({
          type: "attention",
          action: {
            type: "admit",
            position:
              existing ??
              readingPosition(
                { id: target.id, revisionId },
                primarySurfaceId(target.id, revisionId),
              ),
            metadata,
          },
        });
      }
      attentionEpochRef.current = nextRequest(attentionEpochRef.current);
      const requestId = nextRequest(openRequestRef.current);
      openRequestRef.current = requestId;
      const request = requestToken(attentionEpochRef.current, requestId);
      dispatch({ type: "loading", loading: true });
      dispatch({ type: "error", message: null });
      try {
        const view = await readOpenResult({
          documentId: target.id,
          revisionId: target.revisionId,
        });
        if (
          !isCurrentRequest(
            request,
            attentionEpochRef.current,
            openRequestRef.current,
          )
        )
          return false;
        if (!view) {
          const message = "目标文档当前不可用。";
          if (options.pending)
            dispatch({
              type: "navigation/failure",
              intentId: options.pending.intentId,
              attemptId: options.pending.attemptId,
              message,
            });
          dispatch({ type: "loading", loading: false });
          if (!options.pending) dispatch({ type: "error", message });
          return false;
        }
        if (hasInteractionProtection()) {
          deferNavigation(
            view,
            "当前有未完成的阅读操作。",
            focus,
            options.pending?.intentId,
          );
          dispatch({ type: "loading", loading: false });
          return false;
        }
        commitView(view, focus, target.surfaceId);
        dispatch({
          type: "navigation/clear",
          intentId: options.pending?.intentId,
        });
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
        if (
          isCurrentRequest(
            request,
            attentionEpochRef.current,
            openRequestRef.current,
          )
        ) {
          const message = errorMessage(error);
          if (options.pending)
            dispatch({
              type: "navigation/failure",
              intentId: options.pending.intentId,
              attemptId: options.pending.attemptId,
              message,
            });
          dispatch({ type: "loading", loading: false });
          if (!options.pending) dispatch({ type: "error", message });
        }
        return false;
      }
    },
    [
      client,
      commitView,
      deferNavigation,
      dispatch,
      hasInteractionProtection,
      readOpenResult,
    ],
  );

  const acceptHostResult = useCallback(
    (result: OpenDocumentResult): void => {
      if (!isReady(result)) {
        cancelLocalNavigation();
        dispatch({ type: "loading", loading: false });
        dispatch({
          type: "status",
          message: "文档空间为空，可以新建或导入一份文档。",
        });
        return;
      }
      const answer = answerArrival(result);
      if (answer) {
        const waitingForThisAnswer =
          sessionRef.current.status === WAITING_FOR_ANSWER_STATUS &&
          waitingQuestionIdRef.current === answer.id &&
          sessionRef.current.questionTasks.some(
            (task) =>
              task.question.id === answer.id && task.status === "awaiting",
          );
        const notification: AnswerNotification = {
          questionId: answer.id,
          answerDocumentId: result.view.document.id,
          answerRevisionId: result.view.document.revisionId,
          title: result.view.document.title,
          status: "unseen",
        };
        dispatch({ type: "question/answered", question: answer });
        dispatch({ type: "answer/arrived", notification });
        if (waitingForThisAnswer) {
          waitingQuestionIdRef.current = null;
          dispatch({ type: "status", message: null });
        }
        dispatch({ type: "cache/revision", revision: result.view.document });
        dispatch({
          type: "data/merge",
          connections: result.view.connections,
          questions: result.view.questions,
        });
        return;
      }
      cancelLocalNavigation();
      if (hasInteractionProtection()) {
        deferNavigation(result.view, "当前有未完成的阅读操作。");
        return;
      }
      commitView(result.view);
      dispatch({ type: "navigation/clear" });
      dispatch({ type: "loading", loading: false });
      dispatch({ type: "status", message: null });
    },
    [
      cancelLocalNavigation,
      commitView,
      deferNavigation,
      dispatch,
      hasInteractionProtection,
    ],
  );

  const openLatest = useCallback(async (): Promise<void> => {
    attentionEpochRef.current = nextRequest(attentionEpochRef.current);
    const requestId = nextRequest(openRequestRef.current);
    openRequestRef.current = requestId;
    const request = requestToken(attentionEpochRef.current, requestId);
    try {
      const view = await readOpenResult({});
      if (
        !isCurrentRequest(
          request,
          attentionEpochRef.current,
          openRequestRef.current,
        )
      )
        return;
      if (!view) {
        dispatch({ type: "loading", loading: false });
        dispatch({
          type: "status",
          message: "文档空间为空，可以新建或导入一份文档。",
        });
        return;
      }
      if (hasInteractionProtection()) {
        deferNavigation(view, "当前有未完成的阅读操作。");
        dispatch({ type: "loading", loading: false });
        return;
      }
      commitView(view);
      dispatch({ type: "navigation/clear" });
      dispatch({ type: "loading", loading: false });
    } catch (error) {
      if (
        !isCurrentRequest(
          request,
          attentionEpochRef.current,
          openRequestRef.current,
        )
      )
        return;
      dispatch({ type: "loading", loading: false });
      dispatch({ type: "error", message: errorMessage(error) });
    }
  }, [
    commitView,
    deferNavigation,
    dispatch,
    hasInteractionProtection,
    readOpenResult,
  ]);

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

  const dismissComposer = useCallback(() => {
    const current = sessionRef.current;
    if (isQuestionDirty(current.question)) {
      dispatch({
        type: "status",
        message: "问题草稿仍保留；选择“放弃问题草稿”才会清除。",
      });
      return;
    }
    if (current.question.kind !== "closed")
      dispatch({ type: "question/close" });
    else if (
      current.selection.kind === "selected" ||
      current.connection.kind !== "closed"
    )
      dispatch({ type: "selection/clear" });
  }, [dispatch]);

  const discardQuestion = useCallback(() => {
    if (sessionRef.current.question.kind === "closed") return;
    dispatch({ type: "question/close" });
  }, [dispatch]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        dispatch({ type: "dialog/open-search" });
      }
      if (event.key === "Escape") {
        dismissComposer();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [dismissComposer, dispatch]);

  useEffect(() => {
    if (initialView !== undefined || initialOpenRef.current) return;
    if (
      !session.catalogue.activeComplete ||
      session.attention.view.focus !== null
    )
      return;
    initialOpenRef.current = true;
    void openLatest().catch(() => {
      initialOpenRef.current = false;
    });
  }, [
    initialView,
    openLatest,
    session.attention.view.focus,
    session.catalogue.activeComplete,
  ]);

  useEffect(() => {
    const ids = new Set(session.desiredSurfaces);
    if (session.attention.view.focus) ids.add(session.attention.view.focus);
    for (const id of ids) {
      const surface = session.attention.space.surfaces.get(id);
      if (
        !surface ||
        session.revisionCache.has(surface.revisionId) ||
        session.hydration.has(surface.revisionId)
      )
        continue;
      void fetchRevision({
        id: surface.documentId,
        revisionId: surface.revisionId,
      }).catch(() => {});
    }
  }, [
    fetchRevision,
    session.attention.space,
    session.attention.view.focus,
    session.desiredSurfaces,
    session.revisionCache,
    session.hydration,
  ]);

  const relationRevisionId =
    focusedPosition(session.attention)?.revisionId ?? null;
  useEffect(() => {
    const position = focusedPosition(sessionRef.current.attention);
    if (!position) return;
    let cancelled = false;
    void readOpenResult({
      documentId: position.documentId,
      revisionId: position.revisionId,
    })
      .then((view) => {
        if (!view || cancelled) return;
        dispatch({
          type: "data/merge",
          connections: view.connections,
          questions: view.questions,
        });
        void loadNeighborhood(position.revisionId);
      })
      .catch((error) => {
        if (!cancelled)
          dispatch({ type: "error", message: errorMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [dispatch, loadNeighborhood, readOpenResult, relationRevisionId]);

  const focusSurface = useCallback(
    (surfaceId: SurfaceInstanceId) => {
      if (hasInteractionProtection()) {
        const surface =
          sessionRef.current.attention.space.surfaces.get(surfaceId);
        if (surface)
          void openDocument(
            {
              id: surface.documentId,
              revisionId: surface.revisionId,
              surfaceId,
            },
            surface.focus,
          );
        return;
      }
      dispatchAttention({ type: "focus-surface", surfaceId });
    },
    [dispatchAttention, hasInteractionProtection, openDocument],
  );
  const demandSurfaces = useCallback(
    (surfaces: readonly SurfaceInstanceId[]) =>
      dispatch({ type: "payload/demand", surfaces }),
    [dispatch],
  );
  const retrySurface = useCallback(
    (surfaceId: SurfaceInstanceId) => {
      const surface =
        sessionRef.current.attention.space.surfaces.get(surfaceId);
      if (surface)
        void fetchRevision({
          id: surface.documentId,
          revisionId: surface.revisionId,
        }).catch(() => {});
    },
    [fetchRevision],
  );

  const onFollow = useCallback(
    (activation: ConnectionActivation): void => {
      if (hasInteractionProtection()) {
        dispatch({
          type: "status",
          message: "当前有未完成的阅读操作；保存或关闭后再定位关系。",
        });
        return;
      }
      const state = sessionRef.current.attention;
      const connection = sessionRef.current.connections.find(
        (item) => item.id === activation.connectionId,
      );
      if (!connection) return;
      const binding = state.bindings.get(connection.id);
      const endpoint =
        activation.origin.kind === "surface"
          ? activation.origin.endpoint
          : binding?.to === state.view.focus
            ? "to"
            : "from";
      const originId =
        activation.origin.kind === "surface"
          ? activation.origin.surfaceId
          : binding?.[endpoint];
      const origin = originId ? state.space.surfaces.get(originId) : undefined;
      // Surface-origin activation is authorized only against its exact immutable endpoint.
      if (
        !origin ||
        origin.documentId !== connection[endpoint].documentId ||
        origin.revisionId !== connection[endpoint].revisionId
      )
        return;
      const targetEndpoint = endpoint === "from" ? "to" : "from";
      const anchor = connection[targetEndpoint];
      const bound = binding
        ? state.space.surfaces.get(binding[targetEndpoint])
        : undefined;
      const target =
        bound && bound.surfaceId !== origin.surfaceId
          ? bound
          : (findOccurrence(
              state,
              anchor.documentId,
              anchor.revisionId,
              origin.surfaceId,
            ) ??
            readingPosition(
              { id: anchor.documentId, revisionId: anchor.revisionId },
              createSurfaceInstanceId("connection"),
            ));
      const inspection = createConnectionInspection(
        connection,
        origin,
        target,
        endpoint,
      );
      if (inspection)
        dispatchAttention({ type: "inspect-connection", inspection });
    },
    [dispatch, dispatchAttention, hasInteractionProtection],
  );

  const onHistory = useCallback(
    (index: number) => {
      dispatchAttention({ type: "history", index });
    },
    [dispatchAttention],
  );

  const onScroll = useCallback(
    (
      surfaceId: SurfaceInstanceId,
      scrollTop: number,
      presentationId: number,
    ) => {
      if (presentationId !== presentationRef.current.id) return;
      dispatchAttention({ type: "scroll", surfaceId, scrollTop });
    },
    [dispatchAttention],
  );

  const onViewCheckpoint = useCallback(
    ({
      generation,
      view,
    }: import("../../lib/reader/spatial-contract").ViewCheckpoint) => {
      if (generation !== presentationRef.current.id) return;
      dispatchAttention({ type: "view", view });
    },
    [dispatchAttention],
  );

  const selectText = useCallback(
    (
      anchor: AnchorInput,
      document: DocumentRevision,
      rect: DOMRect,
      surfaceId: SurfaceInstanceId,
    ): void => {
      // A fresh text selection is an explicit user reading context.  A late
      // local open must not replace the surface underneath it.
      cancelLocalNavigation();
      pointerSelectingRef.current = false;
      setPointerSelecting(false);
      const connection = sessionRef.current.connection;
      dispatch({
        type: "selection/set",
        selection: {
          kind: "selected",
          surfaceId,
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
    [cancelLocalNavigation, dispatch],
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
      if (!canSendQuestion(draft) || draft.kind === "closed") return;
      const body = draft.body.trim();
      const draftId = draft.draftId;
      let persistenceAttemptId:
        import("../../lib/reader/session").QuestionPersistenceAttemptId | null =
        null;
      let deliveryAttemptId:
        import("../../lib/reader/session").QuestionDeliveryAttemptId | null =
        null;
      let question: Question | null = null;
      try {
        if (draft.kind === "draft") {
          persistenceAttemptId = questionPersistenceAttemptId(
            nextRequest(questionPersistenceAttemptRef.current),
          );
          questionPersistenceAttemptRef.current =
            persistenceAttemptId as number;
          dispatch({
            type: "question/saving",
            draftId,
            attemptId: persistenceAttemptId,
            body,
          });
          question = (
            await client.invoke("ask", { anchor: draft.anchor, body })
          ).question;
          const latest = sessionRef.current.question;
          const accepted =
            latest.kind === "saving" &&
            latest.draftId === draftId &&
            latest.persistenceAttemptId === persistenceAttemptId;
          dispatch({
            type: "question/saved",
            question,
            body,
            draftId,
            attemptId: persistenceAttemptId,
          });
          if (!accepted) return;
          persistenceAttemptId = null;
        } else if (draft.kind === "saved" || draft.kind === "send_failed") {
          question = draft.question;
          deliveryAttemptId = questionDeliveryAttemptId(
            nextRequest(questionDeliveryAttemptRef.current),
          );
          questionDeliveryAttemptRef.current = deliveryAttemptId as number;
          dispatch({
            type: "question/sending",
            questionId: question.id,
            draftId,
            attemptId: deliveryAttemptId,
            body,
          });
        } else {
          return;
        }
        if (!deliveryAttemptId && question) {
          deliveryAttemptId = questionDeliveryAttemptId(
            nextRequest(questionDeliveryAttemptRef.current),
          );
          questionDeliveryAttemptRef.current = deliveryAttemptId as number;
          dispatch({
            type: "question/sending",
            questionId: question.id,
            draftId,
            attemptId: deliveryAttemptId,
            body,
          });
        }
        if (!question || !deliveryAttemptId) return;
        if (client.sendQuestion) {
          await client.sendQuestion(question);
          dispatch({
            type: "question/sent",
            questionId: question.id,
            draftId,
            attemptId: deliveryAttemptId,
            body,
          });
          waitingQuestionIdRef.current = question.id;
          dispatch({ type: "status", message: WAITING_FOR_ANSWER_STATUS });
        } else {
          await navigator.clipboard.writeText(questionPrompt(question));
          dispatch({
            type: "question/sent",
            questionId: question.id,
            draftId,
            attemptId: deliveryAttemptId,
            body,
          });
          waitingQuestionIdRef.current = null;
          dispatch({ type: "status", message: "问题已保存，提问内容已复制。" });
        }
      } catch (error) {
        const message = errorMessage(error);
        if (persistenceAttemptId) {
          dispatch({
            type: "question/failure",
            stage: "saving",
            draftId,
            attemptId: persistenceAttemptId,
            message,
          });
        } else if (deliveryAttemptId && question) {
          dispatch({
            type: "question/failure",
            stage: "sending",
            questionId: question.id,
            draftId,
            attemptId: deliveryAttemptId,
            body,
            message,
          });
        }
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
    const requestId = nextRequest(connectionRequestRef.current);
    connectionRequestRef.current = requestId;
    dispatch({ type: "connection/saving", requestId });
    try {
      const result = await client.invoke("link", {
        from: draft.first.anchor,
        to: draft.second.anchor,
        relation: draft.relation,
        label: draft.label,
      });
      const latest = sessionRef.current.connection;
      const accepted =
        latest.kind === "saving" && latest.saveRequestId === requestId;
      dispatch({
        type: "connection/added",
        requestId,
        connection: result.connection,
      });
      dispatch({
        type: "status",
        message: accepted ? "连接已建立。" : "连接已建立；当前连接草稿仍保留。",
      });
    } catch (error) {
      dispatch({
        type: "connection/failed",
        requestId,
        message: errorMessage(error),
      });
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

  const startPendingNavigation = useCallback(
    (allowRetry: boolean): void => {
      const pending = sessionRef.current.pendingNavigation;
      if (
        !pending ||
        (pending.lifecycle !== "blocked" &&
          !(allowRetry && pending.lifecycle === "failed")) ||
        hasInteractionProtection()
      )
        return;
      const target = pending.target;
      const requestTarget =
        target.kind === "resolved"
          ? {
              id: target.target.documentId,
              revisionId: target.target.revisionId,
              surfaceId: target.surfaceId,
            }
          : { id: target.documentId, revisionId: target.revisionId };
      const focus =
        target.kind === "resolved" ? target.target.focus : target.focus;
      const attemptId = navigationAttemptId(
        nextRequest(navigationAttemptRef.current),
      );
      navigationAttemptRef.current = attemptId as number;
      dispatch({
        type: "navigation/start",
        intentId: pending.intentId,
        attemptId,
      });
      // Keep the request in state until openDocument succeeds. A failed retry
      // becomes an explicit failed lifecycle and remains available to retry.
      void openDocument(requestTarget, focus, {
        force: true,
        pending: { intentId: pending.intentId, attemptId },
      });
    },
    [dispatch, hasInteractionProtection, openDocument],
  );

  const flushPendingNavigation = useCallback(() => {
    startPendingNavigation(false);
  }, [startPendingNavigation]);

  const retryPendingNavigation = useCallback(() => {
    startPendingNavigation(true);
  }, [startPendingNavigation]);

  useEffect(() => {
    const currentSession = sessionRef.current;
    if (!currentSession.pendingNavigation || hasInteractionProtection()) return;
    flushPendingNavigation();
  }, [
    flushPendingNavigation,
    hasInteractionProtection,
    interactionState,
    session.selection,
    session.editor,
    session.pendingNavigation,
    session.question,
  ]);

  const saveEditor = useCallback(async (): Promise<void> => {
    const draft = sessionRef.current.editor;
    if (draft.kind === "closed" || draft.saving) return;
    const requestId = nextRequest(editorRequestRef.current);
    editorRequestRef.current = requestId;
    dispatch({ type: "editor/saving", requestId });
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
      const latest = sessionRef.current.editor;
      const accepted =
        latest.kind !== "closed" &&
        latest.saving &&
        latest.saveRequestId === requestId;
      if (!accepted) {
        dispatch({
          type: "status",
          message: "服务器版本已保存；当前编辑草稿仍保留。",
        });
        return;
      }
      dispatch({ type: "editor/close" });
      dispatch({
        type: "status",
        message:
          draft.kind === "create"
            ? "文档已创建；可点击空间中的折页打开。"
            : draft.kind === "rename"
              ? "文档已移动。"
              : "已保存新版本。",
      });
      if (sessionRef.current.attention.view.focus === null)
        await openDocument(
          { id: document.id, revisionId: document.revisionId },
          null,
          {
            force: true,
          },
        );
      else if (draft.kind === "edit" && draft.owner) {
        const existing = findOccurrence(
          sessionRef.current.attention,
          document.id,
          document.revisionId,
        );
        dispatchAttention({
          type: "replace-revision",
          surfaceId: draft.owner.surfaceId,
          position: readingPosition(
            document,
            existing?.surfaceId ??
              primarySurfaceId(document.id, document.revisionId),
            null,
            draft.owner.scrollTop,
          ),
        });
      }
      flushPendingNavigation();
    } catch (error) {
      const latest = sessionRef.current.editor;
      if (
        latest.kind !== "closed" &&
        latest.saving &&
        latest.saveRequestId === requestId
      )
        dispatch({
          type: "editor/error",
          requestId,
          message: errorMessage(error),
        });
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
      const emptyAtStart = sessionRef.current.attention.view.focus === null;
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
      void openDocument({
        id: answer.answerDocumentId,
        revisionId: answer.answerRevisionId,
      }).then((opened) => {
        if (!opened) return;
        dispatch({
          type: "answer/status",
          questionId: answer.questionId,
          answerDocumentId: answer.answerDocumentId,
          answerRevisionId: answer.answerRevisionId,
          status: "reading",
        });
        if (typeof window === "undefined") return;
        window.requestAnimationFrame(() => {
          const documentId = String(answer.answerDocumentId);
          const revisionId = String(answer.answerRevisionId);
          const readingSurface = Array.from(
            window.document.querySelectorAll<HTMLElement>(
              ".spatial-paper [data-document-scroll]",
            ),
          ).find((node) => {
            const surface = node.closest<HTMLElement>(
              "[data-document-id][data-revision-id]",
            );
            return (
              surface?.dataset.documentId === documentId &&
              surface.dataset.revisionId === revisionId
            );
          });
          readingSurface?.focus({ preventScroll: true });
        });
      });
    },
    [dispatch, openDocument],
  );

  const renderDocument = useCallback(
    (
      surface: ReadingSurface,
      context: DocumentRenderContext,
    ): React.ReactNode => {
      const document = surface.document;
      return (
        <article className="document-plane-body detailed">
          <DocumentPassage
            document={document}
            surfaceId={surface.surfaceId}
            context={context}
            focus={surface.position.focus}
            connections={
              session.connections.length ? session.connections : NO_CONNECTIONS
            }
            onActivateConnection={onFollow}
            onSelectText={(anchor, document, rect) =>
              selectText(anchor, document, rect, surface.surfaceId)
            }
          />
        </article>
      );
    },
    [onFollow, selectText, session.connections],
  );

  const renderDocumentMenu = (surface: ReadingSurface): React.ReactNode => {
    const document = surface.document;
    const owner =
      sessionRef.current.attention.space.surfaces.get(surface.surfaceId) ??
      null;
    return (
      <PlaneMenu
        document={document}
        onEdit={() => dispatch({ type: "editor/open-edit", document, owner })}
        onHistory={() => void openHistory(document, owner)}
        onRename={() =>
          dispatch({ type: "editor/open-rename", document, owner })
        }
        onArchive={() => void archiveDocument(document)}
        onDownload={() => downloadDocument(document)}
        website={client.mode === "website"}
      />
    );
  };

  const surfaces = useMemo(
    () =>
      [...session.attention.space.surfaces.values()].map((position) => ({
        surfaceId: position.surfaceId,
        position,
        metadata: position.metadata,
        document:
          session.revisionCache.get(position.revisionId)?.document ?? null,
        payloadSize: session.payloadSizes.get(position.revisionId),
        payload: session.revisionCache.has(position.revisionId)
          ? ("ready" as const)
          : (session.hydration.get(position.revisionId)?.status ??
            ("unloaded" as const)),
        error: session.hydration.get(position.revisionId)?.error ?? null,
      })),
    [
      session.attention.space,
      session.revisionCache,
      session.hydration,
      session.payloadSizes,
    ],
  );
  const bindings = useMemo(
    () =>
      session.connections.flatMap((connection) => {
        const bound = session.attention.bindings.get(connection.id);
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
    [session.connections, session.attention.bindings],
  );

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
  const currentAttention = focusedPosition(session.attention);
  const selectedConnectionId = session.attention.selectedConnectionId;

  const relationNavigation = useMemo<RelationNavigationState>(() => {
    if (!currentAttention)
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
      session.connections,
      currentAttention.revisionId,
    );
    const binding = selectedConnectionId
      ? session.attention.bindings.get(selectedConnectionId)
      : null;
    const currentEndpoint =
      binding?.from === currentAttention.surfaceId
        ? "from"
        : binding?.to === currentAttention.surfaceId
          ? "to"
          : null;
    const itemIndex =
      selectedConnectionId && currentEndpoint
        ? items.findIndex(
            (item) =>
              item.connectionId === selectedConnectionId &&
              item.endpoint === currentEndpoint,
          )
        : -1;
    const error =
      session.neighborhood.kind === "failed"
        ? session.neighborhood.message
        : null;
    return {
      items,
      current: itemIndex >= 0 ? (items[itemIndex] ?? null) : null,
      ordinal: itemIndex >= 0 ? itemIndex + 1 : null,
      total: items.length,
      canPrevious: items.length > 0 && (itemIndex < 0 || itemIndex > 0),
      canNext:
        items.length > 0 && (itemIndex < 0 || itemIndex < items.length - 1),
      loading: session.neighborhood.kind === "loading",
      error,
    };
  }, [
    currentAttention,
    selectedConnectionId,
    session.connections,
    session.neighborhood,
    session.attention.bindings,
  ]);

  const onStepConnection = useCallback(
    (direction: -1 | 1): void => {
      const attention = sessionRef.current.attention;
      const basePosition = focusedPosition(attention);
      if (!basePosition) return;
      const items = relationNavigationItems(
        sessionRef.current.connections,
        basePosition.revisionId,
      );
      const binding = attention.selectedConnectionId
        ? attention.bindings.get(attention.selectedConnectionId)
        : null;
      const endpoint =
        binding?.from === basePosition.surfaceId
          ? "from"
          : binding?.to === basePosition.surfaceId
            ? "to"
            : null;
      const selected = items.findIndex(
        (item) =>
          item.connectionId === attention.selectedConnectionId &&
          item.endpoint === endpoint,
      );
      const visibleOffset =
        basePosition.focus?.start ??
        (() => {
          if (typeof document === "undefined") return null;
          const roots = document.querySelectorAll<HTMLElement>(
            "[data-surface-id][data-revision-id]",
          );
          for (const root of roots) {
            if (
              root.dataset.surfaceId === basePosition.surfaceId &&
              root.dataset.revisionId === basePosition.revisionId
            )
              return firstVisibleSourceOffset(root, basePosition.revisionId);
          }
          return null;
        })();
      const base =
        selected >= 0
          ? selected
          : direction > 0
            ? items.findIndex(
                (item) =>
                  visibleOffset === null || item.anchor.start >= visibleOffset,
              )
            : ([...items]
                .map((item, index) => ({ item, index }))
                .reverse()
                .find(
                  ({ item }) =>
                    visibleOffset === null ||
                    item.anchor.start <= visibleOffset,
                )?.index ?? -1);
      const targetIndex = selected >= 0 ? base + direction : base;
      const target = items[targetIndex];
      if (!target) {
        dispatch({
          type: "status",
          message: direction < 0 ? "已是第一条关系。" : "已是最后一条关系。",
        });
        return;
      }
      onFollow({
        connectionId: target.connectionId,
        origin: {
          kind: "surface",
          surfaceId: basePosition.surfaceId,
          endpoint: target.endpoint,
        },
      });
    },
    [dispatch, onFollow],
  );

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

  const pendingNavigationFailure =
    session.pendingNavigation?.lifecycle === "failed"
      ? session.pendingNavigation
      : null;

  return (
    <main className="reader-shell reader-palette" style={readerPaletteStyle}>
      <header className="reader-topbar">
        <div className="brand-lockup">
          <div className="brand-button">
            Xanadu<span>Sidebranch</span>
          </div>
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
          <AnswerArrivalEntry
            answers={session.answers}
            onOpen={() => dispatch({ type: "dialog/open-activities" })}
          />
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
              pointerSelectingRef.current = true;
              setPointerSelecting(true);
            }
          }}
          onPointerUp={() => {
            pointerSelectingRef.current = false;
            setPointerSelecting(false);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
            setComposing(true);
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
            setComposing(false);
            flushPendingNavigation();
          }}
        >
          {(session.error ||
            pendingNavigationFailure ||
            session.catalogue.activeError ||
            session.catalogue.archivedError) && (
            <div className="reader-alert error" role="alert">
              {pendingNavigationFailure
                ? `打开“${pendingNavigationFailure.target.title}”失败：${pendingNavigationFailure.error}`
                : (session.error ??
                  session.catalogue.activeError ??
                  session.catalogue.archivedError)}
              {pendingNavigationFailure && (
                <button
                  type="button"
                  onClick={retryPendingNavigation}
                  className="quiet-button"
                >
                  重试
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  pendingNavigationFailure
                    ? dispatch({
                        type: "navigation/clear",
                        intentId: pendingNavigationFailure.intentId,
                      })
                    : dispatch({ type: "error", message: null })
                }
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
          {surfaces.length > 0 ? (
            <SpatialScene
              surfaces={surfaces}
              bindings={bindings}
              onFocusSurface={focusSurface}
              onDemandSurfaces={demandSurfaces}
              onRetrySurface={retrySurface}
              view={session.attention.view}
              documents={session.documents}
              catalogue={session.catalogue}
              neighborhood={session.neighborhood}
              connections={session.connections}
              selectedConnectionId={selectedConnectionId}
              onFollow={onFollow}
              onStepConnection={onStepConnection}
              relationNavigation={relationNavigation}
              presentation={presentation}
              onHistory={onHistory}
              onScroll={onScroll}
              onViewCheckpoint={onViewCheckpoint}
              renderDocument={renderDocument}
              renderDocumentMenu={renderDocumentMenu}
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
        onDismiss={dismissComposer}
        onDiscardQuestion={discardQuestion}
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
        onFollow={(connectionId) =>
          onFollow({ connectionId, origin: { kind: "bridge" } })
        }
        onOpenDocument={openDocument}
      />
    </main>
  );
}
