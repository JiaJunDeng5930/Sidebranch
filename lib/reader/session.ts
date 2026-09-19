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
  SurfaceRole,
} from "./attention";
import { attentionReducer, emptyAttention } from "./attention";
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
      readonly document: DocumentRevision;
      readonly anchor: AnchorInput;
      /** Browser text is display-only; the anchor quote remains source text. */
      readonly preview: string;
      readonly rect: SelectionRect | null;
    };

export type QuestionDraft =
  | { readonly kind: "closed" }
  | {
      readonly kind:
        | "draft"
        | "saving"
        | "saved"
        | "sending"
        | "awaiting"
        | "send_failed"
        | "answered";
      readonly document: DocumentRevision;
      readonly anchor: AnchorInput;
      readonly body: string;
      readonly saved: Question | null;
      readonly sentBody: string | null;
      readonly error: string | null;
    };

export interface QuestionTask {
  readonly question: Question;
  readonly document: DocumentSummary | null;
  readonly status:
    "saved" | "sending" | "awaiting" | "send_failed" | "answered";
  readonly error: string | null;
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
      readonly kind: "second" | "saving" | "failed";
      readonly first: ConnectionEndpoint;
      readonly second: ConnectionEndpoint;
      readonly relation: Connection["relation"];
      readonly label: string;
      readonly error: string | null;
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

export interface PendingNavigation {
  readonly target: DocumentTarget;
  readonly title: string;
  readonly revision: DocumentRevision | null;
  readonly message: string;
}

export interface AnswerNotification {
  readonly questionId: QuestionId;
  readonly answerDocumentId: DocumentId;
  readonly answerRevisionId: RevisionId;
  readonly title: string;
  readonly status: "unseen" | "seen" | "reading";
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
  readonly revisionCache: ReadonlyMap<RevisionId, CachedRevision>;
  readonly neighborhood: NeighborhoodKnowledge;
  readonly connections: readonly Connection[];
  readonly questions: readonly Question[];
  readonly selectedConnectionId: Connection["id"] | null;
  readonly selection: SelectionState;
  readonly question: QuestionDraft;
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
  revisionCache: new Map(),
  neighborhood: { kind: "idle" },
  connections: [],
  questions: [],
  selectedConnectionId: null,
  selection: { kind: "none" },
  question: emptyQuestionDraft(),
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
  | { readonly type: "question/saving" }
  | {
      readonly type: "question/saved";
      readonly question: Question;
      readonly body: string;
    }
  | { readonly type: "question/sending"; readonly body: string }
  | { readonly type: "question/sent"; readonly body: string }
  | { readonly type: "question/answered"; readonly question: Question }
  | { readonly type: "question/failure"; readonly message: string }
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
  | { readonly type: "connection/saving" }
  | { readonly type: "connection/failed"; readonly message: string }
  | { readonly type: "connection/close" }
  | { readonly type: "connection/added"; readonly connection: Connection }
  | {
      readonly type: "connection/select";
      readonly connectionId: Connection["id"] | null;
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
  | { readonly type: "editor/saving" }
  | { readonly type: "editor/error"; readonly message: string }
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
      readonly status: AnswerNotification["status"];
    }
  | {
      readonly type: "navigation/defer";
      readonly navigation: PendingNavigation;
    }
  | { readonly type: "navigation/clear" }
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
        "compare",
        "promote",
        "return-to-current",
        "history",
      ].includes(action.action.type);
      return {
        ...state,
        attention,
        selection:
          navigation && state.question.kind === "closed"
            ? { kind: "none" }
            : state.selection,
        connections:
          navigation && action.action.type === "navigate"
            ? []
            : state.connections,
        questions:
          navigation && action.action.type === "navigate"
            ? []
            : state.questions,
        selectedConnectionId:
          navigation && action.action.type === "navigate"
            ? null
            : state.selectedConnectionId,
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
    case "cache/revision":
      return {
        ...state,
        revisionCache: cacheRevision(
          state.revisionCache,
          action.revision,
          state.attention,
        ),
      };
    case "data/merge":
      return {
        ...state,
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
    case "question/open":
      return {
        ...state,
        selection:
          state.selection.kind === "selected"
            ? state.selection
            : {
                kind: "selected",
                document: action.document,
                anchor: action.anchor,
                preview: action.anchor.quote,
                rect: null,
              },
        question: {
          kind: "draft",
          document: action.document,
          anchor: action.anchor,
          body: "",
          saved: null,
          sentBody: null,
          error: null,
        },
      };
    case "question/body":
      if (state.question.kind === "closed") return state;
      return {
        ...state,
        question: {
          ...state.question,
          kind:
            action.body !== state.question.body && state.question.saved
              ? "draft"
              : state.question.kind === "saved" ||
                  state.question.kind === "awaiting" ||
                  state.question.kind === "answered"
                ? "draft"
                : state.question.kind,
          body: action.body,
          saved:
            action.body !== state.question.body ? null : state.question.saved,
          sentBody:
            action.body !== state.question.body
              ? null
              : state.question.sentBody,
          error: null,
        },
      };
    case "question/saving":
      return state.question.kind === "draft" ||
        state.question.kind === "send_failed"
        ? {
            ...state,
            question: { ...state.question, kind: "saving", error: null },
          }
        : state;
    case "question/saved":
      if (state.question.kind === "closed") return state;
      if (state.question.body.trim() !== action.body.trim())
        return {
          ...state,
          question: {
            ...state.question,
            kind: "draft",
            saved: null,
            sentBody: null,
            error: "问题内容在保存期间发生了变化，请确认后重新发送。",
          },
        };
      return {
        ...state,
        question: {
          ...state.question,
          kind: "saved",
          saved: action.question,
          sentBody: null,
          error: null,
        },
        questions: mergeQuestions(state.questions, [action.question]),
        questionTasks: upsertQuestionTask(state.questionTasks, {
          question: action.question,
          document: findSummary(
            state.documents,
            action.question.anchor.documentId,
          ),
          status: "saved",
          error: null,
        }),
      };
    case "question/sending":
      if (state.question.kind === "closed" || !state.question.saved)
        return state;
      if (state.question.body.trim() !== action.body.trim()) return state;
      return {
        ...state,
        question: { ...state.question, kind: "sending", error: null },
        questionTasks: updateQuestionTask(
          state.questionTasks,
          state.question.saved.id,
          { status: "sending", error: null },
        ),
      };
    case "question/sent": {
      const draft = state.question;
      if (draft.kind === "closed" || !draft.saved) return state;
      if (draft.body.trim() !== action.body.trim())
        return {
          ...state,
          question: {
            ...draft,
            kind: "draft",
            sentBody: null,
            error: "问题内容已变化，上一条问题没有发送当前草稿。",
          },
        };
      return {
        ...state,
        question: {
          ...draft,
          kind: "awaiting",
          sentBody: action.body,
          error: null,
        },
        questionTasks: updateQuestionTask(state.questionTasks, draft.saved.id, {
          status: "awaiting",
          error: null,
        }),
      };
    }
    case "question/answered": {
      const question = action.question;
      const active = state.question;
      const questionMatches =
        active.kind !== "closed" && active.saved?.id === question.id;
      return {
        ...state,
        questions: mergeQuestions(state.questions, [question]),
        question: questionMatches
          ? { ...active, kind: "answered", saved: question, error: null }
          : active,
        questionTasks: upsertQuestionTask(state.questionTasks, {
          question,
          document: findSummary(state.documents, question.anchor.documentId),
          status: "answered",
          error: null,
        }),
      };
    }
    case "question/failure":
      return state.question.kind === "closed"
        ? state
        : {
            ...state,
            question: {
              ...state.question,
              kind: state.question.saved ? "send_failed" : "draft",
              error: action.message,
            },
            questionTasks: state.question.saved
              ? updateQuestionTask(
                  state.questionTasks,
                  state.question.saved.id,
                  {
                    status: "send_failed",
                    error: action.message,
                  },
                )
              : state.questionTasks,
          };
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
    case "connection/relation":
      return state.connection.kind === "closed"
        ? state
        : {
            ...state,
            connection: {
              ...state.connection,
              relation: action.relation,
              error: null,
            },
          };
    case "connection/label":
      return state.connection.kind === "closed"
        ? state
        : {
            ...state,
            connection: {
              ...state.connection,
              label: action.label,
              error: null,
            },
          };
    case "connection/saving":
      return state.connection.kind === "second" ||
        state.connection.kind === "failed"
        ? {
            ...state,
            connection: { ...state.connection, kind: "saving", error: null },
          }
        : state;
    case "connection/failed":
      return state.connection.kind === "second" ||
        state.connection.kind === "saving"
        ? {
            ...state,
            connection: {
              ...state.connection,
              kind: "failed",
              error: action.message,
            },
          }
        : state;
    case "connection/close":
      return { ...state, connection: emptyConnectionDraft() };
    case "connection/added":
      return {
        ...state,
        connection: emptyConnectionDraft(),
        connections: state.connections.some(
          (item) => item.id === action.connection.id,
        )
          ? state.connections
          : [...state.connections, action.connection],
      };
    case "connection/select":
      return { ...state, selectedConnectionId: action.connectionId };
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
        },
      };
    case "editor/path":
      return state.editor.kind === "closed"
        ? state
        : {
            ...state,
            editor: { ...state.editor, path: action.path, error: null },
          };
    case "editor/title":
      return state.editor.kind === "closed"
        ? state
        : {
            ...state,
            editor: { ...state.editor, title: action.title, error: null },
          };
    case "editor/content":
      return state.editor.kind === "closed"
        ? state
        : {
            ...state,
            editor: { ...state.editor, content: action.content, error: null },
          };
    case "editor/saving":
      return state.editor.kind === "closed"
        ? state
        : { ...state, editor: { ...state.editor, saving: true, error: null } };
    case "editor/error":
      return state.editor.kind === "closed"
        ? state
        : {
            ...state,
            editor: { ...state.editor, saving: false, error: action.message },
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
        (answer) => answer.questionId === action.notification.questionId,
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
          answer.questionId === action.questionId
            ? { ...answer, status: action.status }
            : answer,
        ),
      };
    case "navigation/defer":
      return { ...state, pendingNavigation: action.navigation };
    case "navigation/clear":
      return { ...state, pendingNavigation: null };
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

export function hasProtectedDraft(state: ReaderSession): boolean {
  return isEditorDirty(state.editor) || isQuestionDirty(state.question);
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
  update: Pick<QuestionTask, "status" | "error">,
): QuestionTask[] {
  return tasks.map((task) =>
    task.question.id === questionId ? { ...task, ...update } : task,
  );
}

function attentionRevisionIds(attention: AttentionState): Set<RevisionId> {
  const ids = new Set<RevisionId>();
  if (attention.attention.kind !== "reading") return ids;
  ids.add(attention.attention.current.revisionId);
  if (attention.attention.companion)
    ids.add(attention.attention.companion.position.revisionId);
  return ids;
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

export type {
  AttentionAction,
  AttentionState,
  CameraPose,
  ReadingPosition,
  SurfaceRole,
};
