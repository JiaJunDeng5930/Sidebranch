import type {
  AnchorInput,
  Connection,
  DocumentId,
  DocumentRevision,
  DocumentSummary,
  Question,
  RevisionId,
} from "../domain/model";
import type { ViewId } from "./scene";

export type ReaderContextId = string & {
  readonly __readerContextId: unique symbol;
};

export type ContextRole = "current" | "companion" | "related";

export interface CachedRevision {
  readonly document: DocumentRevision;
  readonly cachedAt: number;
}

export interface ReaderViewTarget {
  readonly viewId: ViewId;
  readonly document: DocumentRevision;
  readonly role: ContextRole;
  readonly focus: AnchorInput | null;
  readonly scrollTop: number;
}

export interface ReadingContext {
  readonly id: ReaderContextId;
  readonly current: ReaderViewTarget;
  readonly companion: ReaderViewTarget | null;
  readonly related: readonly DocumentSummary[];
  readonly connections: readonly Connection[];
  readonly questions: readonly Question[];
  readonly selectedConnectionId: Connection["id"] | null;
  readonly mode: "read" | "overview";
}

/** The small view payload used when refreshing relations in an existing context. */
export interface ReadingContextView {
  readonly document: DocumentRevision;
  readonly connections: readonly Connection[];
  readonly questions: readonly Question[];
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
      /** Rendered browser text for UI preview; the anchor quote remains source text. */
      readonly preview: string;
      readonly rect: SelectionRect | null;
    };

interface ActiveQuestionDraft {
  readonly document: DocumentRevision;
  readonly anchor: AnchorInput;
  readonly body: string;
  readonly saved: Question | null;
  readonly sentBody: string | null;
}

export type QuestionDraft =
  | { readonly kind: "closed" }
  | (ActiveQuestionDraft & {
      readonly kind: "editing";
      readonly error: string | null;
    })
  | (ActiveQuestionDraft & { readonly kind: "saving"; readonly error: null })
  | (ActiveQuestionDraft & {
      readonly kind: "saved";
      readonly saved: Question;
      readonly error: null;
    })
  | (ActiveQuestionDraft & { readonly kind: "failed"; readonly error: string });

export interface ConnectionEndpoint {
  readonly document: DocumentRevision;
  readonly anchor: AnchorInput;
}

interface OpenConnectionDraft {
  readonly relation: Connection["relation"];
  readonly label: string;
}

export type ConnectionDraft =
  | { readonly kind: "closed" }
  | (OpenConnectionDraft & {
      readonly kind: "first";
      readonly first: ConnectionEndpoint;
      readonly error: null;
    })
  | (OpenConnectionDraft & {
      readonly kind: "second";
      readonly first: ConnectionEndpoint;
      readonly second: ConnectionEndpoint;
      readonly error: null;
    })
  | (OpenConnectionDraft & {
      readonly kind: "saving";
      readonly first: ConnectionEndpoint;
      readonly second: ConnectionEndpoint;
      readonly error: null;
    })
  | (OpenConnectionDraft & {
      readonly kind: "failed";
      readonly first: ConnectionEndpoint;
      readonly second: ConnectionEndpoint;
      readonly error: string;
    });

interface EditorDraftFields {
  /** The slab that opened the editor, when the editor was contextual. */
  readonly ownerViewId: ViewId | null;
  readonly path: string;
  readonly title: string;
  readonly content: string;
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
    });

export type ReaderDialog =
  | { readonly kind: "closed" }
  | { readonly kind: "search"; readonly query: string }
  | {
      readonly kind: "history";
      readonly document: DocumentRevision;
      readonly ownerViewId: ViewId;
    }
  | { readonly kind: "settings" };

export interface ReaderSession {
  readonly documents: readonly DocumentSummary[];
  readonly archived: boolean;
  readonly catalogueLoading: boolean;
  readonly catalogueComplete: boolean;
  readonly catalogueError: string | null;
  readonly revisionCache: ReadonlyMap<RevisionId, CachedRevision>;
  readonly active: ReadingContext | null;
  readonly selection: SelectionState;
  readonly question: QuestionDraft;
  readonly connection: ConnectionDraft;
  readonly editor: EditorDraft;
  readonly dialog: ReaderDialog;
  readonly status: string | null;
  readonly error: string | null;
  readonly loading: boolean;
}

/** Limits for the revision payload cache. The active scene documents are always protected. */
export const REVISION_CACHE_MAX_ENTRIES = 24;
export const REVISION_CACHE_MAX_CHARS = 8 * 1024 * 1024;

export const emptyQuestionDraft = (): QuestionDraft => ({ kind: "closed" });

export const emptyConnectionDraft = (): ConnectionDraft => ({ kind: "closed" });

export const emptyEditorDraft = (): EditorDraft => ({ kind: "closed" });

export const emptySession = (): ReaderSession => ({
  documents: [],
  archived: false,
  catalogueLoading: false,
  catalogueComplete: false,
  catalogueError: null,
  revisionCache: new Map(),
  active: null,
  selection: { kind: "none" },
  question: emptyQuestionDraft(),
  connection: emptyConnectionDraft(),
  editor: emptyEditorDraft(),
  dialog: { kind: "closed" },
  status: null,
  error: null,
  loading: false,
});

export type ReaderSessionAction =
  | { readonly type: "catalogue/load-start"; readonly archived: boolean }
  | {
      readonly type: "catalogue/page";
      readonly documents: readonly DocumentSummary[];
      readonly complete: boolean;
    }
  | {
      readonly type: "catalogue/merge";
      readonly documents: readonly DocumentSummary[];
    }
  | { readonly type: "catalogue/error"; readonly message: string }
  | { readonly type: "catalogue/toggle-archived"; readonly archived: boolean }
  | { readonly type: "cache/revision"; readonly revision: DocumentRevision }
  | { readonly type: "context/open"; readonly context: ReadingContext }
  | { readonly type: "context/merge-view"; readonly view: ReadingContextView }
  | {
      readonly type: "context/sync-scene";
      readonly current: ReaderViewTarget | null;
      readonly companion: ReaderViewTarget | null;
    }
  | {
      readonly type: "context/focus";
      readonly viewId: ViewId;
      readonly anchor: AnchorInput | null;
    }
  | {
      readonly type: "context/set-companion";
      readonly target: ReaderViewTarget | null;
    }
  | { readonly type: "context/add-connection"; readonly connection: Connection }
  | { readonly type: "context/add-question"; readonly question: Question }
  | { readonly type: "context/promote-companion" }
  | {
      readonly type: "context/select-connection";
      readonly connectionId: Connection["id"] | null;
    }
  | { readonly type: "context/mode"; readonly mode: "read" | "overview" }
  | {
      readonly type: "context/scroll";
      readonly viewId: ViewId;
      readonly scrollTop: number;
    }
  | {
      readonly type: "context/replace-revision";
      readonly viewId: ViewId;
      readonly document: DocumentRevision;
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
  | { readonly type: "question/sent"; readonly body: string }
  | { readonly type: "question/failure"; readonly message: string }
  | { readonly type: "question/close" }
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
  | {
      readonly type: "editor/open-create";
      readonly path: string;
      readonly ownerViewId?: ViewId | null;
    }
  | {
      readonly type: "editor/open-edit";
      readonly document: DocumentRevision;
      readonly ownerViewId?: ViewId | null;
    }
  | {
      readonly type: "editor/open-rename";
      readonly document: DocumentRevision;
      readonly ownerViewId?: ViewId | null;
    }
  | { readonly type: "editor/path"; readonly path: string }
  | { readonly type: "editor/title"; readonly title: string }
  | { readonly type: "editor/content"; readonly content: string }
  | { readonly type: "editor/saving" }
  | { readonly type: "editor/error"; readonly message: string }
  | { readonly type: "editor/close" }
  | { readonly type: "dialog/open-search"; readonly query?: string }
  | { readonly type: "dialog/search-query"; readonly query: string }
  | {
      readonly type: "dialog/open-history";
      readonly document: DocumentRevision;
      readonly ownerViewId: ViewId;
    }
  | { readonly type: "dialog/open-settings" }
  | { readonly type: "dialog/close" }
  | { readonly type: "status"; readonly message: string | null }
  | { readonly type: "error"; readonly message: string | null }
  | { readonly type: "loading"; readonly loading: boolean };

function replaceTarget(
  context: ReadingContext,
  viewId: ViewId,
  update: (target: ReaderViewTarget) => ReaderViewTarget,
): ReadingContext {
  const updateIf = (target: ReaderViewTarget | null) =>
    target && target.viewId === viewId ? update(target) : target;
  return {
    ...context,
    current: updateIf(context.current) ?? context.current,
    companion: updateIf(context.companion),
  };
}

function contextFromView(
  view: ReadingContextView,
  revision: DocumentRevision,
  viewId: ViewId,
  documents: readonly DocumentSummary[],
): ReadingContext {
  return {
    id: makeContextId(),
    current: {
      viewId,
      document: revision,
      role: "current",
      focus: null,
      scrollTop: 0,
    },
    companion: null,
    related: documents.filter((item) => item.id !== revision.id),
    connections: view.connections,
    questions: view.questions,
    selectedConnectionId: null,
    mode: "read",
  };
}

let idSequence = 0;
export function makeContextId(): ReaderContextId {
  idSequence += 1;
  return ("reader-context-" + idSequence) as ReaderContextId;
}

export function makeViewId(document: DocumentId, revision: RevisionId): ViewId {
  return ("reader-view-" + document + "-" + revision) as ViewId;
}

export function createContextFromView(
  view: ReadingContextView,
  documents: readonly DocumentSummary[] = [],
  viewId: ViewId = makeViewId(view.document.id, view.document.revisionId),
): ReadingContext {
  return contextFromView(view, view.document, viewId, documents);
}

export function readerSessionReducer(
  state: ReaderSession,
  action: ReaderSessionAction,
): ReaderSession {
  switch (action.type) {
    case "catalogue/load-start":
      return {
        ...state,
        archived: action.archived,
        documents: [],
        catalogueLoading: true,
        catalogueComplete: false,
        catalogueError: null,
      };
    case "catalogue/page": {
      const byId = new Map(
        state.documents.map((document) => [document.id, document]),
      );
      for (const document of action.documents) byId.set(document.id, document);
      return {
        ...state,
        documents: [...byId.values()].sort((a, b) =>
          a.path.localeCompare(b.path),
        ),
        catalogueLoading: !action.complete,
        catalogueComplete: action.complete,
        catalogueError: null,
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
        catalogueLoading: false,
        catalogueError: action.message,
      };
    case "catalogue/toggle-archived":
      return { ...state, archived: action.archived, catalogueComplete: false };
    case "cache/revision": {
      return {
        ...state,
        revisionCache: cacheRevision(
          state.revisionCache,
          action.revision,
          state.active,
        ),
      };
    }
    case "context/open": {
      return {
        ...state,
        active: action.context,
        revisionCache: pruneRevisionCache(state.revisionCache, action.context),
        selection: { kind: "none" },
        question: emptyQuestionDraft(),
        connection: emptyConnectionDraft(),
        loading: false,
        error: null,
      };
    }
    case "context/merge-view": {
      // A refresh can arrive after the scene has closed its last view. It must
      // never resurrect a context from stale network data.
      if (!state.active) return state;
      const current = state.active.current;
      const existing = state.active;
      const sameDocument =
        action.view.document.id === current.document.id &&
        action.view.document.revisionId === current.document.revisionId;
      const nextCurrent = sameDocument
        ? { ...current, document: action.view.document }
        : current;
      const active: ReadingContext = {
        ...existing,
        current: nextCurrent,
        related: state.documents.filter(
          (item) => item.id !== nextCurrent.document.id,
        ),
        connections: sameDocument
          ? action.view.connections
          : existing.connections,
        questions: sameDocument ? action.view.questions : existing.questions,
      };
      return {
        ...state,
        active,
        revisionCache: cacheRevision(
          state.revisionCache,
          action.view.document,
          active,
        ),
        loading: false,
      };
    }
    case "context/sync-scene": {
      if (!action.current) {
        return {
          ...state,
          active: null,
          revisionCache: pruneRevisionCache(state.revisionCache, null),
        };
      }
      const currentTarget = action.current;
      const companion =
        action.companion && action.companion.viewId !== currentTarget.viewId
          ? { ...action.companion, role: "companion" as const }
          : null;
      if (!state.active) {
        const active: ReadingContext = {
          id: makeContextId(),
          current: { ...currentTarget, role: "current" },
          companion,
          related: state.documents.filter(
            (item) => item.id !== currentTarget.document.id,
          ),
          connections: [],
          questions: [],
          selectedConnectionId: null,
          mode: "read",
        };
        return {
          ...state,
          active,
          revisionCache: pruneRevisionCache(state.revisionCache, active),
          selection: { kind: "none" },
          question: emptyQuestionDraft(),
          connection: emptyConnectionDraft(),
          loading: false,
          error: null,
        };
      }
      const currentChanged =
        state.active.current.document.id !== currentTarget.document.id ||
        state.active.current.document.revisionId !==
          currentTarget.document.revisionId;
      const active: ReadingContext = {
        ...state.active,
        current: { ...currentTarget, role: "current" },
        companion,
        related: state.documents.filter(
          (item) => item.id !== currentTarget.document.id,
        ),
        connections: currentChanged ? [] : state.active.connections,
        questions: currentChanged ? [] : state.active.questions,
        selectedConnectionId: currentChanged
          ? null
          : state.active.selectedConnectionId,
      };
      return {
        ...state,
        active,
        revisionCache: pruneRevisionCache(state.revisionCache, active),
      };
    }
    case "context/focus":
      return state.active
        ? {
            ...state,
            active: replaceTarget(state.active, action.viewId, (target) => ({
              ...target,
              focus: action.anchor,
            })),
          }
        : state;
    case "context/set-companion":
      if (!state.active) return state;
      {
        const active: ReadingContext = {
          ...state.active,
          companion:
            action.target &&
            action.target.viewId !== state.active.current.viewId
              ? { ...action.target, role: "companion" }
              : null,
        };
        return {
          ...state,
          active,
          revisionCache: pruneRevisionCache(state.revisionCache, active),
        };
      }
    case "context/add-connection":
      if (!state.active) return state;
      if (
        action.connection.from.documentId !==
          state.active.current.document.id &&
        action.connection.to.documentId !== state.active.current.document.id
      )
        return state;
      if (
        state.active.connections.some(
          (connection) => connection.id === action.connection.id,
        )
      )
        return state;
      return {
        ...state,
        active: {
          ...state.active,
          connections: [...state.active.connections, action.connection],
        },
      };
    case "context/add-question":
      if (!state.active) return state;
      if (
        action.question.anchor.documentId !== state.active.current.document.id
      )
        return state;
      if (
        state.active.questions.some(
          (question) => question.id === action.question.id,
        )
      )
        return state;
      return {
        ...state,
        active: {
          ...state.active,
          questions: [...state.active.questions, action.question],
        },
      };
    case "context/promote-companion": {
      if (!state.active?.companion) return state;
      const current = { ...state.active.current, role: "companion" as const };
      const companion = { ...state.active.companion, role: "current" as const };
      return {
        ...state,
        active: { ...state.active, current: companion, companion: current },
      };
    }
    case "context/select-connection":
      return state.active
        ? {
            ...state,
            active: {
              ...state.active,
              selectedConnectionId: action.connectionId,
            },
          }
        : state;
    case "context/mode":
      return state.active
        ? { ...state, active: { ...state.active, mode: action.mode } }
        : state;
    case "context/scroll":
      return state.active
        ? {
            ...state,
            active: replaceTarget(state.active, action.viewId, (target) => ({
              ...target,
              scrollTop: Math.max(0, action.scrollTop),
            })),
          }
        : state;
    case "context/replace-revision":
      if (!state.active) return state;
      {
        const active = replaceTarget(state.active, action.viewId, (target) => ({
          ...target,
          document: action.document,
          focus:
            target.focus?.revisionId === action.document.revisionId
              ? target.focus
              : null,
        }));
        return {
          ...state,
          active,
          revisionCache: cacheRevision(
            state.revisionCache,
            action.document,
            active,
          ),
        };
      }
    case "selection/set":
      return {
        ...state,
        selection: action.selection,
        question:
          action.selection.kind === "selected"
            ? {
                kind: "editing",
                document: action.selection.document,
                anchor: action.selection.anchor,
                body: "",
                saved: null,
                sentBody: null,
                error: null,
              }
            : emptyQuestionDraft(),
      };
    case "selection/clear":
      return {
        ...state,
        selection: { kind: "none" },
        question: emptyQuestionDraft(),
        connection: emptyConnectionDraft(),
      };
    case "question/open": {
      const previous =
        state.selection.kind === "selected" ? state.selection : null;
      return {
        ...state,
        selection: {
          kind: "selected",
          document: action.document,
          anchor: action.anchor,
          preview: previous?.preview || action.anchor.quote,
          rect: previous?.rect ?? null,
        },
        question: {
          kind: "editing",
          document: action.document,
          anchor: action.anchor,
          body: "",
          saved: null,
          sentBody: null,
          error: null,
        },
      };
    }
    case "question/body":
      if (state.question.kind === "closed") return state;
      return {
        ...state,
        question: {
          ...state.question,
          kind:
            action.body !== state.question.body && state.question.saved
              ? "editing"
              : state.question.kind === "saved"
                ? "editing"
                : state.question.kind,
          body: action.body,
          saved:
            action.body !== state.question.body ? null : state.question.saved,
          sentBody:
            action.body !== state.question.body
              ? null
              : state.question.sentBody,
          error: null,
        } as QuestionDraft,
      };
    case "question/saving":
      if (state.question.kind !== "editing" && state.question.kind !== "failed")
        return state;
      return {
        ...state,
        question: { ...state.question, kind: "saving", error: null },
      };
    case "question/saved":
      if (state.question.kind === "closed") return state;
      if (state.question.body.trim() !== action.body.trim())
        return {
          ...state,
          question: {
            ...state.question,
            kind: "editing",
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
      };
    case "question/sent": {
      const draft = state.question;
      if (draft.kind === "closed" || !draft.saved) return state;
      if (draft.body.trim() !== action.body.trim())
        return {
          ...state,
          question: {
            ...draft,
            kind: "editing",
            sentBody: null,
            error: "问题内容已变化，上一条问题没有发送当前草稿。",
          },
        };
      return {
        ...state,
        question: {
          kind: "saved",
          document: draft.document,
          anchor: draft.anchor,
          body: draft.body,
          saved: draft.saved,
          sentBody: action.body,
          error: null,
        },
      };
    }
    case "question/failure":
      return state.question.kind === "closed"
        ? state
        : {
            ...state,
            question: {
              ...state.question,
              kind: "failed",
              error: action.message,
            },
          };
    case "question/close":
      return {
        ...state,
        selection: { kind: "none" },
        question: emptyQuestionDraft(),
      };
    case "connection/open-first":
      return {
        ...state,
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
        : state.connection.kind === "failed"
          ? {
              ...state,
              connection: {
                kind: "second",
                first: state.connection.first,
                second: state.connection.second,
                relation: action.relation,
                label: state.connection.label,
                error: null,
              },
            }
          : {
              ...state,
              connection: { ...state.connection, relation: action.relation },
            };
    case "connection/label":
      return state.connection.kind === "closed"
        ? state
        : state.connection.kind === "failed"
          ? {
              ...state,
              connection: {
                kind: "second",
                first: state.connection.first,
                second: state.connection.second,
                relation: state.connection.relation,
                label: action.label,
                error: null,
              },
            }
          : {
              ...state,
              connection: { ...state.connection, label: action.label },
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
    case "editor/open-create":
      return {
        ...state,
        editor: {
          kind: "create",
          document: null,
          ownerViewId: action.ownerViewId ?? null,
          path: action.path,
          title: "",
          content: "",
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
          ownerViewId: action.ownerViewId ?? null,
          path: action.document.path,
          title: action.document.title,
          content: action.document.content,
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
          ownerViewId: action.ownerViewId ?? null,
          path: action.document.path,
          title: action.document.title,
          content: "",
          error: null,
          saving: false,
        },
      };
    case "editor/path":
      return {
        ...state,
        editor:
          state.editor.kind === "closed"
            ? state.editor
            : { ...state.editor, path: action.path, error: null },
      };
    case "editor/title":
      return {
        ...state,
        editor:
          state.editor.kind === "closed"
            ? state.editor
            : { ...state.editor, title: action.title, error: null },
      };
    case "editor/content":
      return {
        ...state,
        editor:
          state.editor.kind === "closed"
            ? state.editor
            : { ...state.editor, content: action.content, error: null },
      };
    case "editor/saving":
      return {
        ...state,
        editor:
          state.editor.kind === "closed"
            ? state.editor
            : { ...state.editor, saving: true, error: null },
      };
    case "editor/error":
      return {
        ...state,
        editor:
          state.editor.kind === "closed"
            ? state.editor
            : { ...state.editor, saving: false, error: action.message },
      };
    case "editor/close":
      return { ...state, editor: emptyEditorDraft() };
    case "dialog/open-search":
      return {
        ...state,
        dialog: { kind: "search", query: action.query ?? "" },
      };
    case "dialog/search-query":
      return {
        ...state,
        dialog:
          state.dialog.kind === "search"
            ? { ...state.dialog, query: action.query }
            : state.dialog,
      };
    case "dialog/open-history":
      return {
        ...state,
        dialog: {
          kind: "history",
          document: action.document,
          ownerViewId: action.ownerViewId,
        },
      };
    case "dialog/open-settings":
      return { ...state, dialog: { kind: "settings" } };
    case "dialog/close":
      return { ...state, dialog: { kind: "closed" } };
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

function mergeDocuments(
  current: readonly DocumentSummary[],
  next: readonly DocumentSummary[],
): DocumentSummary[] {
  const byId = new Map(current.map((document) => [document.id, document]));
  for (const document of next) byId.set(document.id, document);
  return [...byId.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function cacheRevision(
  cache: ReadonlyMap<RevisionId, CachedRevision>,
  document: DocumentRevision,
  active: ReadingContext | null,
): ReadonlyMap<RevisionId, CachedRevision> {
  const next = new Map(cache);
  // Map insertion order is the LRU order: remove before re-inserting to touch
  // an existing revision even when its payload has not changed.
  next.delete(document.revisionId);
  next.set(document.revisionId, { document, cachedAt: Date.now() });
  return pruneRevisionCache(next, active);
}

function pruneRevisionCache(
  cache: ReadonlyMap<RevisionId, CachedRevision>,
  active: ReadingContext | null,
): ReadonlyMap<RevisionId, CachedRevision> {
  const next = new Map(cache);
  const protectedRevisionIds = new Set<RevisionId>();
  if (active) {
    protectedRevisionIds.add(active.current.document.revisionId);
    if (active.companion)
      protectedRevisionIds.add(active.companion.document.revisionId);
  }

  const characterCount = () => {
    let total = 0;
    for (const entry of next.values()) total += entry.document.content.length;
    return total;
  };

  while (
    next.size > REVISION_CACHE_MAX_ENTRIES ||
    characterCount() > REVISION_CACHE_MAX_CHARS
  ) {
    const oldestEvictable = [...next.keys()].find(
      (revisionId) => !protectedRevisionIds.has(revisionId),
    );
    // The active current/companion documents are retained even if a caller
    // supplies an unusually large payload for them.
    if (!oldestEvictable) break;
    next.delete(oldestEvictable);
  }
  return next;
}
