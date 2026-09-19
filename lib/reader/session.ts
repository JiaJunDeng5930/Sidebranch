import type {
  AnchorInput,
  Connection,
  DocumentId,
  DocumentRevision,
  DocumentSummary,
  Question,
  QuestionId,
  RevisionId,
} from "../domain/model";
import type {
  AttentionAction,
  AttentionState,
  CameraPose,
  ReadingPosition,
} from "./attention";
import {
  attentionReducer,
  emptyAttention,
  findOccurrence,
  focusedPosition,
  primarySurfaceId,
  readingPosition,
} from "./attention";
import type { SurfaceInstanceId } from "./spatial-contract";
import type { DocumentTarget, NeighborhoodKnowledge } from "./space-index";

/** A revision payload kept separately from attention so unmounted leaves stay readable. */
export interface CachedRevision {
  readonly document: DocumentRevision;
  readonly cachedAt: number;
}

export interface SelectionRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export type SelectionState =
  | { readonly kind: "none" }
  | {
      readonly kind: "selected";
      readonly surfaceId: SurfaceInstanceId;
      readonly document: DocumentRevision;
      readonly anchor: AnchorInput;
      /** Browser text is display-only; the anchor quote remains source text. */
      readonly preview: string;
      readonly rect: SelectionRect | null;
    };

interface QuestionDraftBase {
  readonly draftId: QuestionDraftId;
  readonly document: DocumentRevision;
  readonly anchor: AnchorInput;
  readonly body: string;
}

declare const questionDraftIdBrand: unique symbol;
declare const questionPersistenceAttemptIdBrand: unique symbol;
declare const questionDeliveryAttemptIdBrand: unique symbol;

/** Identity of the visible composer instance, independent from its text. */
export type QuestionDraftId = number & {
  readonly [questionDraftIdBrand]: "QuestionDraftId";
};

/** Identity of one asynchronous question persistence operation. */
export type QuestionPersistenceAttemptId = number & {
  readonly [questionPersistenceAttemptIdBrand]: "QuestionPersistenceAttemptId";
};

/** Identity of one asynchronous question delivery operation. */
export type QuestionDeliveryAttemptId = number & {
  readonly [questionDeliveryAttemptIdBrand]: "QuestionDeliveryAttemptId";
};

export function questionDraftId(value: number): QuestionDraftId {
  return value as QuestionDraftId;
}

export function questionPersistenceAttemptId(
  value: number,
): QuestionPersistenceAttemptId {
  return value as QuestionPersistenceAttemptId;
}

export function questionDeliveryAttemptId(
  value: number,
): QuestionDeliveryAttemptId {
  return value as QuestionDeliveryAttemptId;
}

interface UnsavedQuestionDraft extends QuestionDraftBase {
  readonly error: string | null;
}

interface SavedQuestionDraft extends QuestionDraftBase {
  readonly question: Question;
}

/** A question's lifecycle keeps persisted identity separate from unsaved text. */
export type QuestionDraft =
  | { readonly kind: "closed" }
  | (UnsavedQuestionDraft & { readonly kind: "draft" })
  | (UnsavedQuestionDraft & {
      readonly kind: "saving";
      readonly error: null;
      readonly persistenceAttemptId: QuestionPersistenceAttemptId;
      readonly submittedBody: string;
    })
  | (SavedQuestionDraft & { readonly kind: "saved"; readonly error: null })
  | (SavedQuestionDraft & {
      readonly kind: "sending";
      readonly error: null;
      readonly deliveryAttemptId: QuestionDeliveryAttemptId;
    })
  | (SavedQuestionDraft & {
      readonly kind: "awaiting";
      readonly sentBody: string;
      readonly deliveryAttemptId: QuestionDeliveryAttemptId;
      readonly error: null;
    })
  | (SavedQuestionDraft & {
      readonly kind: "answered";
      readonly sentBody: string;
      readonly deliveryAttemptId: QuestionDeliveryAttemptId | null;
      readonly error: null;
    })
  | (SavedQuestionDraft & {
      readonly kind: "send_failed";
      readonly sentBody: string | null;
      readonly deliveryAttemptId: QuestionDeliveryAttemptId;
      readonly error: string;
    });

export interface QuestionTask {
  readonly question: Question;
  readonly document: DocumentSummary | null;
  readonly status:
    "saved" | "sending" | "awaiting" | "send_failed" | "answered";
  readonly error: string | null;
  readonly deliveryAttemptId: QuestionDeliveryAttemptId | null;
}

export interface ConnectionEndpoint {
  readonly document: DocumentRevision;
  readonly anchor: AnchorInput;
}

export type ConnectionDraft =
  | { readonly kind: "closed" }
  | {
      readonly kind: "first";
      readonly first: ConnectionEndpoint;
      readonly relation: Connection["relation"];
      readonly label: string;
      readonly error: null;
    }
  | {
      readonly kind: "second";
      readonly first: ConnectionEndpoint;
      readonly second: ConnectionEndpoint;
      readonly relation: Connection["relation"];
      readonly label: string;
      readonly error: null;
    }
  | {
      readonly kind: "saving";
      readonly first: ConnectionEndpoint;
      readonly second: ConnectionEndpoint;
      readonly relation: Connection["relation"];
      readonly label: string;
      readonly saveRequestId: number;
      readonly error: null;
    }
  | {
      readonly kind: "failed";
      readonly first: ConnectionEndpoint;
      readonly second: ConnectionEndpoint;
      readonly relation: Connection["relation"];
      readonly label: string;
      readonly error: string;
    };

interface EditorDraftFields {
  readonly owner: ReadingPosition | null;
  readonly path: string;
  readonly title: string;
  readonly content: string;
  readonly initialPath: string;
  readonly initialTitle: string;
  readonly initialContent: string;
  readonly error: string | null;
  readonly saving: boolean;
  readonly saveRequestId: number | null;
}

export type EditorDraft =
  | { readonly kind: "closed" }
  | (EditorDraftFields & { readonly kind: "create"; readonly document: null })
  | (EditorDraftFields & {
      readonly kind: "edit";
      readonly document: DocumentRevision;
      readonly expectedRevisionId: RevisionId;
    })
  | (EditorDraftFields & {
      readonly kind: "rename";
      readonly document: DocumentRevision;
      readonly expectedRevisionId: RevisionId;
    });

export interface SearchMatch {
  readonly document: DocumentSummary;
  readonly excerpt: string;
  readonly start: number;
  readonly end: number;
  readonly revisionId: RevisionId;
}

export type SearchState =
  | { readonly kind: "idle"; readonly query: string }
  | {
      readonly kind: "querying";
      readonly query: string;
      readonly requestId: number;
      readonly matches: readonly SearchMatch[];
    }
  | {
      readonly kind: "results";
      readonly query: string;
      readonly matches: readonly SearchMatch[];
    }
  | {
      readonly kind: "failed";
      readonly query: string;
      readonly matches: readonly SearchMatch[];
      readonly error: string;
    };

export type ReaderDialog =
  | { readonly kind: "closed" }
  | { readonly kind: "search" }
  | {
      readonly kind: "history";
      readonly document: DocumentRevision;
      readonly owner: ReadingPosition | null;
    }
  | { readonly kind: "settings" }
  | { readonly kind: "activities" };

export interface CatalogueState {
  readonly activeComplete: boolean;
  readonly archivedComplete: boolean;
  /** Each catalogue request has its own completion state. */
  readonly activeLoading: boolean;
  readonly archivedLoading: boolean;
  readonly loading: boolean;
  readonly activeError: string | null;
  readonly archivedError: string | null;
}

declare const navigationIntentIdBrand: unique symbol;
declare const navigationAttemptIdBrand: unique symbol;

/** Identity of the latest deferred destination. */
export type NavigationIntentId = number & {
  readonly [navigationIntentIdBrand]: "NavigationIntentId";
};

/** Identity of one fetch attempt for a deferred destination. */
export type NavigationAttemptId = number & {
  readonly [navigationAttemptIdBrand]: "NavigationAttemptId";
};

export function navigationIntentId(value: number): NavigationIntentId {
  return value as NavigationIntentId;
}

export function navigationAttemptId(value: number): NavigationAttemptId {
  return value as NavigationAttemptId;
}

export type PendingNavigationTarget =
  | {
      readonly kind: "resolved";
      readonly surfaceId: SurfaceInstanceId;
      readonly target: DocumentTarget;
      readonly title: string;
      readonly revision: DocumentRevision | null;
      readonly message: string;
    }
  | {
      readonly kind: "unresolved";
      readonly documentId: DocumentId;
      readonly revisionId?: RevisionId;
      readonly focus: AnchorInput | null;
      readonly title: string;
      readonly message: string;
    };

export type PendingNavigation =
  | {
      readonly lifecycle: "blocked";
      readonly intentId: NavigationIntentId;
      readonly target: PendingNavigationTarget;
    }
  | {
      readonly lifecycle: "opening";
      readonly intentId: NavigationIntentId;
      readonly attemptId: NavigationAttemptId;
      readonly target: PendingNavigationTarget;
    }
  | {
      readonly lifecycle: "failed";
      readonly intentId: NavigationIntentId;
      readonly target: PendingNavigationTarget;
      readonly error: string;
    };

export interface AnswerNotification {
  readonly questionId: QuestionId;
  readonly answerDocumentId: DocumentId;
  readonly answerRevisionId: RevisionId;
  readonly title: string;
  readonly status: "unseen" | "seen" | "reading";
}

export function answerNotificationKey(
  notification: Pick<
    AnswerNotification,
    "questionId" | "answerDocumentId" | "answerRevisionId"
  >,
): string {
  return `${notification.questionId}:${notification.answerDocumentId}:${notification.answerRevisionId}`;
}

export interface ImportTask {
  readonly id: string;
  readonly name: string;
  readonly status: "queued" | "importing" | "imported" | "failed";
  readonly message: string | null;
}

export interface ReaderSession {
  readonly attention: AttentionState;
  readonly documents: readonly DocumentSummary[];
  readonly catalogue: CatalogueState;
  readonly payloadSizes: ReadonlyMap<RevisionId, number>;
  readonly hydration: ReadonlyMap<
    RevisionId,
    { readonly status: "loading" | "error"; readonly error: string | null }
  >;
  readonly desiredSurfaces: readonly SurfaceInstanceId[];
  readonly revisionCache: ReadonlyMap<RevisionId, CachedRevision>;
  readonly neighborhood: NeighborhoodKnowledge;
  readonly connections: readonly Connection[];
  readonly questions: readonly Question[];
  readonly selection: SelectionState;
  readonly question: QuestionDraft;
  /** Monotonic source for visible composer identities. */
  readonly questionDraftSequence: number;
  readonly questionTasks: readonly QuestionTask[];
  readonly connection: ConnectionDraft;
  readonly editor: EditorDraft;
  readonly dialog: ReaderDialog;
  readonly search: SearchState;
  readonly answers: readonly AnswerNotification[];
  readonly imports: readonly ImportTask[];
  readonly pendingNavigation: PendingNavigation | null;
  readonly status: string | null;
  readonly error: string | null;
  readonly loading: boolean;
}

export const REVISION_CACHE_MAX_ENTRIES = 24;
export const REVISION_CACHE_MAX_CHARS = 8 * 1024 * 1024;

export const emptyQuestionDraft = (): QuestionDraft => ({ kind: "closed" });
export const emptyConnectionDraft = (): ConnectionDraft => ({ kind: "closed" });
export const emptyEditorDraft = (): EditorDraft => ({ kind: "closed" });

const emptyCatalogue = (): CatalogueState => ({
  activeComplete: false,
  archivedComplete: false,
  activeLoading: false,
  archivedLoading: false,
  loading: false,
  activeError: null,
  archivedError: null,
});

export const emptySession = (): ReaderSession => ({
  attention: emptyAttention(),
  documents: [],
  catalogue: emptyCatalogue(),
  payloadSizes: new Map(),
  hydration: new Map(),
  desiredSurfaces: [],
  revisionCache: new Map(),
  neighborhood: { kind: "idle" },
  connections: [],
  questions: [],
  selection: { kind: "none" },
  question: emptyQuestionDraft(),
  questionDraftSequence: 0,
  questionTasks: [],
  connection: emptyConnectionDraft(),
  editor: emptyEditorDraft(),
  dialog: { kind: "closed" },
  search: { kind: "idle", query: "" },
  answers: [],
  imports: [],
  pendingNavigation: null,
  status: null,
  error: null,
  loading: false,
});

export type ReaderSessionAction =
  | { readonly type: "attention"; readonly action: AttentionAction }
  | {
      readonly type: "catalogue/load-start";
      readonly scope: "active" | "archived";
    }
  | {
      readonly type: "catalogue/page";
      readonly scope: "active" | "archived";
      readonly documents: readonly DocumentSummary[];
      readonly complete: boolean;
    }
  | {
      readonly type: "catalogue/merge";
      readonly scope: "active" | "archived";
      readonly documents: readonly DocumentSummary[];
    }
  | {
      readonly type: "catalogue/error";
      readonly scope: "active" | "archived";
      readonly message: string;
    }
  | {
      readonly type: "relations/loading";
      readonly centerRevisionId: RevisionId;
    }
  | {
      readonly type: "relations/set";
      readonly knowledge: NeighborhoodKnowledge;
    }
  | {
      readonly type: "payload/demand";
      readonly surfaces: readonly SurfaceInstanceId[];
    }
  | { readonly type: "payload/loading"; readonly revisionId: RevisionId }
  | {
      readonly type: "payload/error";
      readonly revisionId: RevisionId;
      readonly message: string;
    }
  | { readonly type: "cache/revision"; readonly revision: DocumentRevision }
  | {
      readonly type: "data/merge";
      readonly connections: readonly Connection[];
      readonly questions: readonly Question[];
    }
  | { readonly type: "selection/set"; readonly selection: SelectionState }
  | { readonly type: "selection/clear" }
  | {
      readonly type: "question/open";
      readonly document: DocumentRevision;
      readonly anchor: AnchorInput;
    }
  | { readonly type: "question/body"; readonly body: string }
  | {
      readonly type: "question/saving";
      readonly draftId: QuestionDraftId;
      readonly attemptId: QuestionPersistenceAttemptId;
      readonly body: string;
    }
  | {
      readonly type: "question/saved";
      readonly question: Question;
      readonly body: string;
      readonly draftId: QuestionDraftId;
      readonly attemptId: QuestionPersistenceAttemptId;
    }
  | {
      readonly type: "question/sending";
      readonly questionId: QuestionId;
      readonly draftId: QuestionDraftId;
      readonly attemptId: QuestionDeliveryAttemptId;
      readonly body: string;
    }
  | {
      readonly type: "question/sent";
      readonly questionId: QuestionId;
      readonly draftId: QuestionDraftId;
      readonly attemptId: QuestionDeliveryAttemptId;
      readonly body: string;
    }
  | { readonly type: "question/answered"; readonly question: Question }
  | {
      readonly type: "question/failure";
      readonly stage: "saving";
      readonly draftId: QuestionDraftId;
      readonly attemptId: QuestionPersistenceAttemptId;
      readonly message: string;
    }
  | {
      readonly type: "question/failure";
      readonly stage: "sending";
      readonly questionId: QuestionId;
      readonly draftId: QuestionDraftId;
      readonly attemptId: QuestionDeliveryAttemptId;
      readonly body: string;
      readonly message: string;
    }
  | { readonly type: "question/close" }
  | {
      readonly type: "questions/merge";
      readonly questions: readonly Question[];
    }
  | {
      readonly type: "connection/open-first";
      readonly document: DocumentRevision;
      readonly anchor: AnchorInput;
    }
  | {
      readonly type: "connection/open-second";
      readonly document: DocumentRevision;
      readonly anchor: AnchorInput;
    }
  | {
      readonly type: "connection/relation";
      readonly relation: Connection["relation"];
    }
  | { readonly type: "connection/label"; readonly label: string }
  | { readonly type: "connection/saving"; readonly requestId: number }
  | {
      readonly type: "connection/failed";
      readonly requestId: number;
      readonly message: string;
    }
  | { readonly type: "connection/close" }
  | {
      readonly type: "connection/added";
      readonly requestId: number;
      readonly connection: Connection;
    }
  | {
      readonly type: "editor/open-create";
      readonly path: string;
      readonly owner?: ReadingPosition | null;
    }
  | {
      readonly type: "editor/open-edit";
      readonly document: DocumentRevision;
      readonly owner?: ReadingPosition | null;
    }
  | {
      readonly type: "editor/open-rename";
      readonly document: DocumentRevision;
      readonly owner?: ReadingPosition | null;
    }
  | { readonly type: "editor/path"; readonly path: string }
  | { readonly type: "editor/title"; readonly title: string }
  | { readonly type: "editor/content"; readonly content: string }
  | { readonly type: "editor/saving"; readonly requestId: number }
  | {
      readonly type: "editor/error";
      readonly requestId: number;
      readonly message: string;
    }
  | { readonly type: "editor/close" }
  | { readonly type: "dialog/open-search" }
  | {
      readonly type: "dialog/open-history";
      readonly document: DocumentRevision;
      readonly owner: ReadingPosition | null;
    }
  | { readonly type: "dialog/open-settings" }
  | { readonly type: "dialog/open-activities" }
  | { readonly type: "dialog/close" }
  | {
      readonly type: "search/querying";
      readonly query: string;
      readonly requestId: number;
    }
  | {
      readonly type: "search/results";
      readonly query: string;
      readonly requestId: number;
      readonly matches: readonly SearchMatch[];
    }
  | { readonly type: "search/clear" }
  | { readonly type: "search/failed"; readonly message: string }
  | {
      readonly type: "answer/arrived";
      readonly notification: AnswerNotification;
    }
  | {
      readonly type: "answer/status";
      readonly questionId: QuestionId;
      readonly answerDocumentId: DocumentId;
      readonly answerRevisionId: RevisionId;
      readonly status: AnswerNotification["status"];
    }
  | {
      readonly type: "navigation/defer";
      readonly navigation: PendingNavigation;
    }
  | {
      readonly type: "navigation/start";
      readonly intentId: NavigationIntentId;
      readonly attemptId: NavigationAttemptId;
    }
  | {
      readonly type: "navigation/cancel";
      readonly intentId: NavigationIntentId;
      readonly attemptId: NavigationAttemptId;
    }
  | {
      readonly type: "navigation/failure";
      readonly intentId: NavigationIntentId;
      readonly attemptId: NavigationAttemptId;
      readonly message: string;
    }
  | {
      readonly type: "navigation/clear";
      readonly intentId?: NavigationIntentId;
    }
  | { readonly type: "imports/set"; readonly imports: readonly ImportTask[] }
  | { readonly type: "status"; readonly message: string | null }
  | { readonly type: "error"; readonly message: string | null }
  | { readonly type: "loading"; readonly loading: boolean };

export function readerSessionReducer(
  state: ReaderSession,
  action: ReaderSessionAction,
): ReaderSession {
  switch (action.type) {
    case "attention": {
      const attention = attentionReducer(state.attention, action.action);
      if (attention === state.attention) return state;
      const navigation = [
        "navigate",
        "inspect-connection",
        "focus-surface",
        "history",
      ].includes(action.action.type);
      return {
        ...state,
        attention,
        selection:
          navigation && state.question.kind === "closed"
            ? { kind: "none" }
            : state.selection,
        loading: false,
      };
    }
    case "catalogue/load-start":
      return {
        ...state,
        catalogue: {
          ...state.catalogue,
          loading: true,
          ...(action.scope === "active"
            ? {
                activeComplete: false,
                activeLoading: true,
                activeError: null,
              }
            : {
                archivedComplete: false,
                archivedLoading: true,
                archivedError: null,
              }),
        },
      };
    case "catalogue/page": {
      const documents = mergeDocuments(state.documents, action.documents);
      const activeLoading =
        action.scope === "active"
          ? !action.complete
          : state.catalogue.activeLoading;
      const archivedLoading =
        action.scope === "archived"
          ? !action.complete
          : state.catalogue.archivedLoading;
      return {
        ...state,
        documents,
        attention: attentionReducer(state.attention, {
          type: "catalogue",
          documents: action.documents,
        }),
        catalogue: {
          ...state.catalogue,
          activeLoading,
          archivedLoading,
          loading: activeLoading || archivedLoading,
          ...(action.scope === "active"
            ? {
                activeComplete: action.complete,
                activeError: null,
              }
            : {
                archivedComplete: action.complete,
                archivedError: null,
              }),
        },
      };
    }
    case "catalogue/merge":
      return {
        ...state,
        documents: mergeDocuments(state.documents, action.documents),
        attention: attentionReducer(state.attention, {
          type: "catalogue",
          documents: action.documents,
        }),
      };
    case "catalogue/error":
      return {
        ...state,
        catalogue: {
          ...state.catalogue,
          activeLoading:
            action.scope === "active" ? false : state.catalogue.activeLoading,
          archivedLoading:
            action.scope === "archived"
              ? false
              : state.catalogue.archivedLoading,
          loading:
            (action.scope === "active"
              ? false
              : state.catalogue.activeLoading) ||
            (action.scope === "archived"
              ? false
              : state.catalogue.archivedLoading),
          ...(action.scope === "active"
            ? { activeError: action.message }
            : { archivedError: action.message }),
        },
      };
    case "relations/loading":
      return {
        ...state,
        neighborhood: {
          kind: "loading",
          centerRevisionId: action.centerRevisionId,
          nodes:
            state.neighborhood.kind !== "idle" &&
            state.neighborhood.centerRevisionId === action.centerRevisionId
              ? state.neighborhood.nodes
              : [],
        },
      };
    case "relations/set":
      return { ...state, neighborhood: action.knowledge };
    case "payload/demand":
      return action.surfaces.join() === state.desiredSurfaces.join()
        ? state
        : { ...state, desiredSurfaces: action.surfaces };
    case "payload/loading": {
      const hydration = new Map(state.hydration);
      hydration.set(action.revisionId, { status: "loading", error: null });
      return { ...state, hydration };
    }
    case "payload/error": {
      const hydration = new Map(state.hydration);
      hydration.set(action.revisionId, {
        status: "error",
        error: action.message,
      });
      return { ...state, hydration };
    }
    case "cache/revision": {
      const hydration = new Map(state.hydration);
      hydration.delete(action.revision.revisionId);
      const existing = findOccurrence(
        state.attention,
        action.revision.id,
        action.revision.revisionId,
      );
      let attention = attentionReducer(state.attention, {
        type: "admit",
        position:
          existing ??
          readingPosition(
            action.revision,
            primarySurfaceId(action.revision.id, action.revision.revisionId),
          ),
        metadata: action.revision,
      });
      // Every duplicate occurrence of this exact revision shares payload, never position.
      for (const surface of attention.space.surfaces.values())
        if (
          surface.documentId === action.revision.id &&
          surface.revisionId === action.revision.revisionId &&
          surface.surfaceId !== existing?.surfaceId
        )
          attention = attentionReducer(attention, {
            type: "admit",
            position: surface,
            metadata: action.revision,
          });
      return {
        ...state,
        attention,
        hydration,
        payloadSizes: new Map(state.payloadSizes).set(
          action.revision.revisionId,
          action.revision.content.length,
        ),
        revisionCache: cacheRevision(
          state.revisionCache,
          action.revision,
          attention,
        ),
      };
    }
    case "data/merge":
      return {
        ...state,
        attention: attentionReducer(state.attention, {
          type: "bind-connections",
          connections: action.connections,
        }),
        connections: mergeConnections(state.connections, action.connections),
        questions: mergeQuestions(state.questions, action.questions),
      };
    case "selection/set":
      return { ...state, selection: action.selection };
    case "selection/clear":
      return {
        ...state,
        selection: { kind: "none" },
        connection: emptyConnectionDraft(),
      };
    case "question/open": {
      const draftId = questionDraftId(state.questionDraftSequence + 1);
      return {
        ...state,
        questionDraftSequence: state.questionDraftSequence + 1,
        selection:
          state.selection.kind === "selected"
            ? state.selection
            : {
                kind: "selected",
                surfaceId:
                  findOccurrence(
                    state.attention,
                    action.document.id,
                    action.document.revisionId,
                  )?.surfaceId ??
                  primarySurfaceId(
                    action.document.id,
                    action.document.revisionId,
                  ),
                document: action.document,
                anchor: action.anchor,
                preview: action.anchor.quote,
                rect: null,
              },
        question: {
          kind: "draft",
          draftId,
          document: action.document,
          anchor: action.anchor,
          body: "",
          error: null,
        },
      };
    }
    case "question/body": {
      const question = state.question;
      if (question.kind === "closed") return state;
      if (action.body === question.body) return state;
      if (question.kind === "saving") {
        const draftId = questionDraftId(state.questionDraftSequence + 1);
        return {
          ...state,
          questionDraftSequence: state.questionDraftSequence + 1,
          question: {
            kind: "draft",
            draftId,
            document: question.document,
            anchor: question.anchor,
            body: action.body,
            error: null,
          },
        };
      }
      if (
        question.kind === "saved" ||
        question.kind === "sending" ||
        question.kind === "awaiting" ||
        question.kind === "send_failed" ||
        question.kind === "answered"
      ) {
        const draftId = questionDraftId(state.questionDraftSequence + 1);
        return {
          ...state,
          questionDraftSequence: state.questionDraftSequence + 1,
          question: {
            kind: "draft",
            draftId,
            document: question.document,
            anchor: question.anchor,
            body: action.body,
            error: null,
          },
        };
      }
      return {
        ...state,
        question: { ...question, body: action.body, error: null },
      };
    }
    case "question/saving":
      return state.question.kind === "draft" &&
        state.question.draftId === action.draftId
        ? {
            ...state,
            question: {
              ...state.question,
              kind: "saving",
              persistenceAttemptId: action.attemptId,
              submittedBody: action.body,
              error: null,
            },
          }
        : state;
    case "question/saved": {
      const current = state.question;
      const savedQuestions = mergeQuestions(state.questions, [action.question]);
      const existingTask = state.questionTasks.find(
        (task) => task.question.id === action.question.id,
      );
      const savedTask =
        existingTask && existingTask.status !== "saved"
          ? [...state.questionTasks]
          : upsertQuestionTask(state.questionTasks, {
              question: action.question,
              document: findSummary(
                state.documents,
                action.question.anchor.documentId,
              ),
              status: "saved",
              error: null,
              deliveryAttemptId: null,
            });
      if (
        current.kind !== "saving" ||
        current.draftId !== action.draftId ||
        current.persistenceAttemptId !== action.attemptId
      )
        return {
          ...state,
          questions: savedQuestions,
          questionTasks: savedTask,
        };
      return {
        ...state,
        question: {
          kind: "saved",
          draftId: current.draftId,
          document: current.document,
          anchor: current.anchor,
          body: current.body,
          question: action.question,
          error: null,
        },
        questions: savedQuestions,
        questionTasks: savedTask,
      };
    }
    case "question/sending": {
      const current = state.question;
      if (
        (current.kind !== "saved" && current.kind !== "send_failed") ||
        current.draftId !== action.draftId ||
        current.question.id !== action.questionId
      )
        return state;
      if (current.body.trim() !== action.body.trim()) return state;
      return {
        ...state,
        question: {
          ...current,
          kind: "sending",
          deliveryAttemptId: action.attemptId,
          error: null,
        },
        questionTasks: updateQuestionTask(
          state.questionTasks,
          current.question.id,
          {
            status: "sending",
            error: null,
            deliveryAttemptId: action.attemptId,
          },
        ),
      };
    }
    case "question/sent": {
      const current = state.question;
      const task = state.questionTasks.find(
        (item) =>
          item.question.id === action.questionId &&
          item.status === "sending" &&
          item.deliveryAttemptId === action.attemptId,
      );
      if (!task) return state;
      const visible =
        current.kind === "sending" &&
        current.draftId === action.draftId &&
        current.question.id === action.questionId &&
        current.deliveryAttemptId === action.attemptId &&
        current.body.trim() === action.body.trim();
      return {
        ...state,
        question: visible
          ? {
              kind: "awaiting",
              draftId: current.draftId,
              document: current.document,
              anchor: current.anchor,
              body: current.body,
              question: current.question,
              sentBody: action.body,
              deliveryAttemptId: action.attemptId,
              error: null,
            }
          : current,
        questionTasks: updateQuestionTask(
          state.questionTasks,
          action.questionId,
          { status: "awaiting", error: null },
        ),
      };
    }
    case "question/answered": {
      const question = action.question;
      const active = state.question;
      const questionMatches =
        active.kind !== "closed" &&
        "question" in active &&
        active.question.id === question.id;
      return {
        ...state,
        questions: mergeQuestions(state.questions, [question]),
        question: questionMatches
          ? {
              kind: "answered",
              draftId: active.draftId,
              document: active.document,
              anchor: active.anchor,
              body: active.body,
              question,
              sentBody:
                "sentBody" in active
                  ? (active.sentBody ?? active.body.trim())
                  : active.body.trim(),
              deliveryAttemptId:
                "deliveryAttemptId" in active ? active.deliveryAttemptId : null,
              error: null,
            }
          : active,
        questionTasks: upsertQuestionTask(state.questionTasks, {
          question,
          document: findSummary(state.documents, question.anchor.documentId),
          status: "answered",
          error: null,
          deliveryAttemptId:
            state.questionTasks.find((task) => task.question.id === question.id)
              ?.deliveryAttemptId ?? null,
        }),
      };
    }
    case "question/failure": {
      const current = state.question;
      if (action.stage === "saving") {
        if (
          current.kind !== "saving" ||
          current.draftId !== action.draftId ||
          current.persistenceAttemptId !== action.attemptId
        )
          return state;
        return {
          ...state,
          question: { ...current, kind: "draft", error: action.message },
        };
      }
      const task = state.questionTasks.find(
        (item) =>
          item.question.id === action.questionId &&
          item.status === "sending" &&
          item.deliveryAttemptId === action.attemptId,
      );
      if (!task) return state;
      const visible =
        current.kind === "sending" &&
        current.draftId === action.draftId &&
        current.question.id === action.questionId &&
        current.deliveryAttemptId === action.attemptId;
      return {
        ...state,
        question: visible
          ? {
              kind: "send_failed",
              draftId: current.draftId,
              document: current.document,
              anchor: current.anchor,
              body: current.body,
              question: current.question,
              sentBody: action.body,
              deliveryAttemptId: action.attemptId,
              error: action.message,
            }
          : current,
        questionTasks: updateQuestionTask(
          state.questionTasks,
          action.questionId,
          { status: "send_failed", error: action.message },
        ),
      };
    }
    case "question/close":
      return {
        ...state,
        selection: { kind: "none" },
        question: emptyQuestionDraft(),
      };
    case "questions/merge":
      return {
        ...state,
        questions: mergeQuestions(state.questions, action.questions),
      };
    case "connection/open-first":
      return {
        ...state,
        selection: { kind: "none" },
        connection: {
          kind: "first",
          first: { document: action.document, anchor: action.anchor },
          relation: "reference",
          label: "",
          error: null,
        },
      };
    case "connection/open-second":
      return state.connection.kind === "first"
        ? {
            ...state,
            connection: {
              ...state.connection,
              kind: "second",
              second: { document: action.document, anchor: action.anchor },
              error: null,
            },
          }
        : state;
    case "connection/relation": {
      const connection = state.connection;
      if (connection.kind === "closed") return state;
      if (connection.relation === action.relation && connection.error === null)
        return state;
      if (connection.kind === "saving")
        return {
          ...state,
          connection: {
            kind: "second",
            first: connection.first,
            second: connection.second,
            relation: action.relation,
            label: connection.label,
            error: null,
          },
        };
      if (connection.kind === "failed")
        return {
          ...state,
          connection: {
            kind: "second",
            first: connection.first,
            second: connection.second,
            relation: action.relation,
            label: connection.label,
            error: null,
          },
        };
      return {
        ...state,
        connection: { ...connection, relation: action.relation, error: null },
      };
    }
    case "connection/label": {
      const connection = state.connection;
      if (connection.kind === "closed") return state;
      if (connection.label === action.label && connection.error === null)
        return state;
      if (connection.kind === "saving")
        return {
          ...state,
          connection: {
            kind: "second",
            first: connection.first,
            second: connection.second,
            relation: connection.relation,
            label: action.label,
            error: null,
          },
        };
      if (connection.kind === "failed")
        return {
          ...state,
          connection: {
            kind: "second",
            first: connection.first,
            second: connection.second,
            relation: connection.relation,
            label: action.label,
            error: null,
          },
        };
      return {
        ...state,
        connection: { ...connection, label: action.label, error: null },
      };
    }
    case "connection/saving":
      return state.connection.kind === "second" ||
        state.connection.kind === "failed"
        ? {
            ...state,
            connection: {
              ...state.connection,
              kind: "saving",
              saveRequestId: action.requestId,
              error: null,
            },
          }
        : state;
    case "connection/failed":
      return state.connection.kind === "saving" &&
        state.connection.saveRequestId === action.requestId
        ? {
            ...state,
            connection: {
              kind: "failed",
              first: state.connection.first,
              second: state.connection.second,
              relation: state.connection.relation,
              label: state.connection.label,
              error: action.message,
            },
          }
        : state;
    case "connection/close":
      return { ...state, connection: emptyConnectionDraft() };
    case "connection/added": {
      const accepted =
        state.connection.kind === "saving" &&
        state.connection.saveRequestId === action.requestId;
      return {
        ...state,
        attention: attentionReducer(state.attention, {
          type: "bind-connections",
          connections: [action.connection],
        }),
        connection: accepted ? emptyConnectionDraft() : state.connection,
        connections: state.connections.some(
          (item) => item.id === action.connection.id,
        )
          ? state.connections
          : [...state.connections, action.connection],
      };
    }
    case "editor/open-create":
      return {
        ...state,
        editor: {
          kind: "create",
          document: null,
          owner: action.owner ?? null,
          path: action.path,
          title: "",
          content: "",
          initialPath: action.path,
          initialTitle: "",
          initialContent: "",
          error: null,
          saving: false,
          saveRequestId: null,
        },
      };
    case "editor/open-edit":
      return {
        ...state,
        editor: {
          kind: "edit",
          document: action.document,
          owner: action.owner ?? null,
          path: action.document.path,
          title: action.document.title,
          content: action.document.content,
          initialPath: action.document.path,
          initialTitle: action.document.title,
          initialContent: action.document.content,
          expectedRevisionId: action.document.revisionId,
          error: null,
          saving: false,
          saveRequestId: null,
        },
      };
    case "editor/open-rename":
      return {
        ...state,
        editor: {
          kind: "rename",
          document: action.document,
          owner: action.owner ?? null,
          path: action.document.path,
          title: action.document.title,
          content: "",
          initialPath: action.document.path,
          initialTitle: action.document.title,
          initialContent: "",
          expectedRevisionId: action.document.revisionId,
          error: null,
          saving: false,
          saveRequestId: null,
        },
      };
    case "editor/path": {
      const editor = state.editor;
      if (
        editor.kind === "closed" ||
        editor.kind === "edit" ||
        editor.path === action.path
      )
        return state;
      return {
        ...state,
        editor: {
          ...editor,
          path: action.path,
          error: null,
          saving: false,
          saveRequestId: null,
        },
      };
    }
    case "editor/title": {
      const editor = state.editor;
      // Existing document titles are changed through the explicit rename flow;
      // edit persists body text only.
      if (
        editor.kind === "closed" ||
        editor.kind !== "create" ||
        editor.title === action.title
      )
        return state;
      return {
        ...state,
        editor: {
          ...editor,
          title: action.title,
          error: null,
          saving: false,
          saveRequestId: null,
        },
      };
    }
    case "editor/content": {
      const editor = state.editor;
      if (
        editor.kind === "closed" ||
        editor.kind === "rename" ||
        editor.content === action.content
      )
        return state;
      return {
        ...state,
        editor: {
          ...editor,
          content: action.content,
          error: null,
          saving: false,
          saveRequestId: null,
        },
      };
    }
    case "editor/saving":
      return state.editor.kind === "closed" || state.editor.saving
        ? state
        : {
            ...state,
            editor: {
              ...state.editor,
              saving: true,
              saveRequestId: action.requestId,
              error: null,
            },
          };
    case "editor/error":
      return state.editor.kind === "closed" ||
        !state.editor.saving ||
        state.editor.saveRequestId !== action.requestId
        ? state
        : {
            ...state,
            editor: {
              ...state.editor,
              saving: false,
              saveRequestId: null,
              error: action.message,
            },
          };
    case "editor/close":
      return { ...state, editor: emptyEditorDraft() };
    case "dialog/open-search":
      return { ...state, dialog: { kind: "search" } };
    case "dialog/open-history":
      return {
        ...state,
        dialog: {
          kind: "history",
          document: action.document,
          owner: action.owner,
        },
      };
    case "dialog/open-settings":
      return { ...state, dialog: { kind: "settings" } };
    case "dialog/open-activities":
      return { ...state, dialog: { kind: "activities" } };
    case "dialog/close":
      return { ...state, dialog: { kind: "closed" } };
    case "search/querying":
      return {
        ...state,
        search: {
          kind: "querying",
          query: action.query,
          requestId: action.requestId,
          matches: [],
        },
      };
    case "search/results":
      if (
        state.search.kind !== "querying" ||
        state.search.requestId !== action.requestId
      )
        return state;
      return {
        ...state,
        search: {
          kind: "results",
          query: action.query,
          matches: action.matches,
        },
      };
    case "search/clear":
      return { ...state, search: { kind: "idle", query: "" } };
    case "search/failed":
      return {
        ...state,
        search: {
          kind: "failed",
          query: state.search.query,
          matches:
            state.search.kind === "querying" || state.search.kind === "results"
              ? state.search.matches
              : [],
          error: action.message,
        },
      };
    case "answer/arrived": {
      const previous = state.answers.findIndex(
        (answer) =>
          answerNotificationKey(answer) ===
          answerNotificationKey(action.notification),
      );
      const answers = [...state.answers];
      if (previous >= 0) answers[previous] = action.notification;
      else answers.push(action.notification);
      return { ...state, answers };
    }
    case "answer/status":
      return {
        ...state,
        answers: state.answers.map((answer) =>
          answer.questionId === action.questionId &&
          answer.answerDocumentId === action.answerDocumentId &&
          answer.answerRevisionId === action.answerRevisionId
            ? { ...answer, status: action.status }
            : answer,
        ),
      };
    case "navigation/defer":
      return { ...state, pendingNavigation: action.navigation };
    case "navigation/start": {
      const pending = state.pendingNavigation;
      if (
        !pending ||
        pending.intentId !== action.intentId ||
        (pending.lifecycle !== "blocked" && pending.lifecycle !== "failed")
      )
        return state;
      return {
        ...state,
        pendingNavigation: {
          lifecycle: "opening",
          intentId: pending.intentId,
          attemptId: action.attemptId,
          target: pending.target,
        },
      };
    }
    case "navigation/cancel": {
      const pending = state.pendingNavigation;
      if (
        !pending ||
        pending.lifecycle !== "opening" ||
        pending.intentId !== action.intentId ||
        pending.attemptId !== action.attemptId
      )
        return state;
      return {
        ...state,
        pendingNavigation: {
          lifecycle: "blocked",
          intentId: pending.intentId,
          target: pending.target,
        },
      };
    }
    case "navigation/failure": {
      const pending = state.pendingNavigation;
      if (
        !pending ||
        pending.lifecycle !== "opening" ||
        pending.intentId !== action.intentId ||
        pending.attemptId !== action.attemptId
      )
        return state;
      return {
        ...state,
        pendingNavigation: {
          lifecycle: "failed",
          intentId: pending.intentId,
          target: pending.target,
          error: action.message,
        },
      };
    }
    case "navigation/clear":
      return action.intentId !== undefined &&
        state.pendingNavigation?.intentId !== action.intentId
        ? state
        : { ...state, pendingNavigation: null };
    case "imports/set":
      return { ...state, imports: action.imports };
    case "status":
      return { ...state, status: action.message };
    case "error":
      return { ...state, error: action.message };
    case "loading":
      return { ...state, loading: action.loading };
    default:
      return state;
  }
}

export function isEditorDirty(editor: EditorDraft): boolean {
  if (editor.kind === "closed") return false;
  return (
    editor.path !== editor.initialPath ||
    editor.title !== editor.initialTitle ||
    editor.content !== editor.initialContent
  );
}

export function isQuestionDirty(question: QuestionDraft): boolean {
  if (question.kind === "closed") return false;
  // A persisted question, an in-flight send, and a received answer are safe
  // to navigate away from. Only text that still needs user confirmation is a
  // protected draft.
  return (
    (question.kind === "draft" ||
      question.kind === "saving" ||
      question.kind === "send_failed") &&
    question.body.trim().length > 0
  );
}

/** The single domain rule used by both the controller and the composer button. */
export function canSendQuestion(question: QuestionDraft): boolean {
  return (
    (question.kind === "draft" ||
      question.kind === "saved" ||
      question.kind === "send_failed") &&
    question.body.trim().length > 0
  );
}

export function hasProtectedDraft(state: ReaderSession): boolean {
  return (
    state.selection.kind === "selected" ||
    isEditorDirty(state.editor) ||
    isQuestionDirty(state.question)
  );
}

function mergeDocuments(
  current: readonly DocumentSummary[],
  next: readonly DocumentSummary[],
): DocumentSummary[] {
  const byId = new Map(current.map((document) => [document.id, document]));
  for (const document of next) byId.set(document.id, document);
  return [...byId.values()].sort(
    (a, b) =>
      a.title.localeCompare(b.title) ||
      a.path.localeCompare(b.path) ||
      String(a.id).localeCompare(String(b.id)),
  );
}

function mergeQuestions(
  current: readonly Question[],
  next: readonly Question[],
): Question[] {
  const byId = new Map(current.map((question) => [question.id, question]));
  for (const question of next) byId.set(question.id, question);
  return [...byId.values()];
}

function mergeConnections(
  current: readonly Connection[],
  next: readonly Connection[],
): Connection[] {
  const byId = new Map(
    current.map((connection) => [connection.id, connection]),
  );
  for (const connection of next) byId.set(connection.id, connection);
  return [...byId.values()];
}

function findSummary(
  documents: readonly DocumentSummary[],
  documentId: DocumentId,
): DocumentSummary | null {
  return documents.find((document) => document.id === documentId) ?? null;
}

function upsertQuestionTask(
  tasks: readonly QuestionTask[],
  task: QuestionTask,
): QuestionTask[] {
  const index = tasks.findIndex(
    (item) => item.question.id === task.question.id,
  );
  if (index < 0) return [...tasks, task];
  const next = [...tasks];
  next[index] = task;
  return next;
}

function updateQuestionTask(
  tasks: readonly QuestionTask[],
  questionId: QuestionId,
  update: Pick<QuestionTask, "status" | "error"> &
    Partial<Pick<QuestionTask, "deliveryAttemptId">>,
): QuestionTask[] {
  return tasks.map((task) =>
    task.question.id === questionId ? { ...task, ...update } : task,
  );
}

function attentionRevisionIds(attention: AttentionState): Set<RevisionId> {
  const focus = focusedPosition(attention);
  return new Set(focus ? [focus.revisionId] : []);
}

function cacheRevision(
  cache: ReadonlyMap<RevisionId, CachedRevision>,
  document: DocumentRevision,
  attention: AttentionState,
): ReadonlyMap<RevisionId, CachedRevision> {
  const next = new Map(cache);
  next.delete(document.revisionId);
  next.set(document.revisionId, { document, cachedAt: Date.now() });
  const protectedIds = attentionRevisionIds(attention);
  const characterCount = () =>
    [...next.values()].reduce(
      (total, entry) => total + entry.document.content.length,
      0,
    );
  while (
    next.size > REVISION_CACHE_MAX_ENTRIES ||
    characterCount() > REVISION_CACHE_MAX_CHARS
  ) {
    const oldest = [...next.keys()].find(
      (revisionId) => !protectedIds.has(revisionId),
    );
    if (!oldest) break;
    next.delete(oldest);
  }
  return next;
}

export type { AttentionAction, AttentionState, CameraPose, ReadingPosition };
