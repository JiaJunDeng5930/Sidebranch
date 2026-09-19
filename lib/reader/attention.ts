import type {
  AnchorInput,
  Connection,
  ConnectionId,
  DocumentRevision,
  DocumentId,
  QuestionId,
  RevisionId,
} from "../domain/model";
import type { ConnectionEndpoint, SurfaceInstanceId } from "./spatial-contract";
import {
  copySpaceView,
  normalizeSpaceView,
  createSpaceView,
  sameSpaceView,
  type SpaceView,
} from "./space-view";

export type { PaperPlacement, SpaceView } from "./space-view";

/** A source-bound occurrence on the reading plane. */
export interface ReadingPosition {
  readonly surfaceId: SurfaceInstanceId;
  readonly documentId: DocumentId;
  readonly revisionId: RevisionId;
  readonly focus: AnchorInput | null;
  readonly scrollTop: number;
}

export type SurfaceRole = "current" | "companion";

export type { CameraPose } from "./camera";
import { CAMERA_HOME, type CameraPose } from "./camera";

export type ComparisonReason =
  | {
      readonly kind: "connection";
      readonly connectionId: ConnectionId;
      readonly currentEndpoint: ConnectionEndpoint;
    }
  | { readonly kind: "document" }
  | { readonly kind: "revision" }
  | { readonly kind: "answer"; readonly questionId: QuestionId };

/** Reasons reserved for ordinary document/revision/answer comparison. */
export type OrdinaryComparisonReason = Exclude<
  ComparisonReason,
  { readonly kind: "connection" }
>;

export type Attention =
  | { readonly kind: "empty" }
  | {
      readonly kind: "reading";
      readonly current: ReadingPosition;
      readonly companion: {
        readonly position: ReadingPosition;
        readonly reason: ComparisonReason;
      } | null;
    };

export interface AttentionSnapshot {
  readonly attention: Attention;
  readonly view: SpaceView;
}

export interface AttentionState extends AttentionSnapshot {
  readonly history: readonly AttentionSnapshot[];
  readonly historyIndex: number;
}

/** A validated, complete two-end destination for an inspect action. */
export interface ConnectionInspection {
  readonly connectionId: ConnectionId;
  readonly currentEndpoint: ConnectionEndpoint;
  readonly current: ReadingPosition;
  readonly companion: ReadingPosition;
}

/**
 * Verify both page identities before constructing an atomic connection
 * destination. The reducer accepts only the resulting positions; it never
 * guesses an endpoint from a revision or connection id.
 */
export function createConnectionInspection(
  connection: Connection,
  current: ReadingPosition,
  companion: ReadingPosition,
  currentEndpoint: ConnectionEndpoint,
): ConnectionInspection | null {
  if (current.surfaceId === companion.surfaceId) return null;
  const currentAnchor = connection[currentEndpoint];
  const companionAnchor =
    connection[currentEndpoint === "from" ? "to" : "from"];
  if (
    current.documentId !== currentAnchor.documentId ||
    current.revisionId !== currentAnchor.revisionId ||
    companion.documentId !== companionAnchor.documentId ||
    companion.revisionId !== companionAnchor.revisionId
  )
    return null;
  return {
    connectionId: connection.id,
    currentEndpoint,
    current: normalizePosition({
      ...current,
      focus: { ...currentAnchor },
    }),
    companion: normalizePosition({
      ...companion,
      focus: { ...companionAnchor },
    }),
  };
}

export type AttentionAction =
  | { readonly type: "navigate"; readonly position: ReadingPosition }
  | {
      readonly type: "compare";
      readonly position: ReadingPosition;
      readonly reason: OrdinaryComparisonReason;
    }
  | {
      readonly type: "inspect-connection";
      readonly inspection: ConnectionInspection;
    }
  | { readonly type: "promote" }
  | { readonly type: "return-to-current" }
  | { readonly type: "history"; readonly index: number }
  | {
      readonly type: "scroll";
      readonly surfaceId: SurfaceInstanceId;
      readonly scrollTop: number;
    }
  | {
      readonly type: "focus";
      readonly surfaceId: SurfaceInstanceId;
      readonly focus: AnchorInput | null;
    }
  | {
      readonly type: "replace-revision";
      readonly surfaceId: SurfaceInstanceId;
      readonly position: ReadingPosition;
    }
  | { readonly type: "view"; readonly view: SpaceView };

/** The initial presentation used before a document has been selected. */
export const DEFAULT_CAMERA: CameraPose = CAMERA_HOME;

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeScrollTop(scrollTop: number): number {
  return Math.max(0, finiteOr(scrollTop, 0));
}

function copyFocus(focus: AnchorInput | null): AnchorInput | null {
  return focus ? { ...focus } : null;
}

function normalizePosition(position: ReadingPosition): ReadingPosition {
  return {
    surfaceId: position.surfaceId,
    documentId: position.documentId,
    revisionId: position.revisionId,
    // A focus for another immutable revision cannot safely be restored on
    // this occurrence. Clearing it preserves the revision-bound invariant.
    focus:
      position.focus && position.focus.revisionId === position.revisionId
        ? copyFocus(position.focus)
        : null,
    scrollTop: normalizeScrollTop(position.scrollTop),
  };
}

function copyPosition(position: ReadingPosition): ReadingPosition {
  return normalizePosition(position);
}

function copyReason(reason: ComparisonReason): ComparisonReason {
  switch (reason.kind) {
    case "connection":
      return {
        kind: "connection",
        connectionId: reason.connectionId,
        currentEndpoint: reason.currentEndpoint,
      };
    case "answer":
      return { kind: "answer", questionId: reason.questionId };
    case "document":
      return { kind: "document" };
    case "revision":
      return { kind: "revision" };
  }
}

function copyAttention(attention: Attention): Attention {
  if (attention.kind === "empty") return { kind: "empty" };
  return {
    kind: "reading",
    current: copyPosition(attention.current),
    companion: attention.companion
      ? {
          position: copyPosition(attention.companion.position),
          reason: copyReason(attention.companion.reason),
        }
      : null,
  };
}

function activeSurfaceIds(attention: Attention): readonly SurfaceInstanceId[] {
  if (attention.kind === "empty") return [];
  return [
    attention.current.surfaceId,
    ...(attention.companion ? [attention.companion.position.surfaceId] : []),
  ];
}

function copySnapshot(snapshot: AttentionSnapshot): AttentionSnapshot {
  const attention = copyAttention(snapshot.attention);
  return {
    attention,
    view:
      attention.kind === "empty"
        ? createSpaceView()
        : copySpaceView(snapshot.view, activeSurfaceIds(attention)),
  };
}

function snapshotOf(attention: Attention, view: SpaceView): AttentionSnapshot {
  const copiedAttention = copyAttention(attention);
  return {
    attention: copiedAttention,
    view:
      copiedAttention.kind === "empty"
        ? createSpaceView()
        : normalizeSpaceView(view, activeSurfaceIds(copiedAttention)),
  };
}

function sameFocus(
  left: AnchorInput | null,
  right: AnchorInput | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.revisionId === right.revisionId &&
    left.start === right.start &&
    left.end === right.end &&
    left.quote === right.quote
  );
}

function samePosition(left: ReadingPosition, right: ReadingPosition): boolean {
  return (
    left.surfaceId === right.surfaceId &&
    left.documentId === right.documentId &&
    left.revisionId === right.revisionId &&
    left.scrollTop === right.scrollTop &&
    sameFocus(left.focus, right.focus)
  );
}

function sameReason(left: ComparisonReason, right: ComparisonReason): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "connection":
      return (
        right.kind === "connection" &&
        left.connectionId === right.connectionId &&
        left.currentEndpoint === right.currentEndpoint
      );
    case "answer":
      return right.kind === "answer" && left.questionId === right.questionId;
    case "document":
    case "revision":
      return true;
  }
}

function sameAttention(left: Attention, right: Attention): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "empty" || right.kind === "empty") return true;
  if (!samePosition(left.current, right.current)) return false;
  if (left.companion === right.companion) return true;
  if (!left.companion || !right.companion) return false;
  return (
    samePosition(left.companion.position, right.companion.position) &&
    sameReason(left.companion.reason, right.companion.reason)
  );
}

/** Create an empty session with no synthetic document or view identity. */
export function emptyAttention(): AttentionState {
  return {
    attention: { kind: "empty" },
    view: createSpaceView(),
    history: [],
    historyIndex: -1,
  };
}

/** Construct a source-bound occurrence at a Reader/navigation boundary. */
export function readingPosition(
  document: Pick<DocumentRevision, "id" | "revisionId">,
  surfaceId: SurfaceInstanceId,
  focus?: AnchorInput | null,
  scrollTop?: number,
): ReadingPosition;
export function readingPosition(
  document: Pick<DocumentRevision, "id" | "revisionId">,
  surfaceId: SurfaceInstanceId,
  focus: AnchorInput | null = null,
  scrollTop = 0,
): ReadingPosition {
  return normalizePosition({
    surfaceId,
    documentId: document.id,
    revisionId: document.revisionId,
    focus,
    scrollTop,
  });
}

function append(
  state: AttentionState,
  attention: Attention,
  view: SpaceView,
): AttentionState {
  const nextSnapshot = snapshotOf(attention, view);
  const prefix =
    state.historyIndex >= 0 && state.historyIndex < state.history.length
      ? state.history.slice(0, state.historyIndex + 1)
      : [];
  const history = [...prefix, nextSnapshot];
  return {
    attention: copyAttention(nextSnapshot.attention),
    view: copySpaceView(
      nextSnapshot.view,
      activeSurfaceIds(nextSnapshot.attention),
    ),
    history,
    historyIndex: history.length - 1,
  };
}

/** Update the live snapshot in place in logical history, without append. */
function updateLive(
  state: AttentionState,
  attention: Attention,
  view: SpaceView,
): AttentionState {
  const nextSnapshot = snapshotOf(attention, view);
  let history: AttentionSnapshot[];
  let historyIndex = state.historyIndex;
  if (historyIndex >= 0 && historyIndex < state.history.length) {
    history = state.history.slice();
    history[historyIndex] = nextSnapshot;
  } else {
    history = [nextSnapshot];
    historyIndex = 0;
  }
  return {
    attention: copyAttention(nextSnapshot.attention),
    view: copySpaceView(
      nextSnapshot.view,
      activeSurfaceIds(nextSnapshot.attention),
    ),
    history,
    historyIndex,
  };
}

function updateAttentionLive(
  state: AttentionState,
  attention: Attention,
): AttentionState {
  return updateLive(state, attention, state.view);
}

function updateRolePosition(
  attention: Extract<Attention, { kind: "reading" }>,
  role: SurfaceRole,
  position: ReadingPosition,
): Attention {
  const nextPosition = normalizePosition(position);
  if (role === "current") {
    return {
      kind: "reading",
      current: nextPosition,
      companion: attention.companion
        ? {
            position: copyPosition(attention.companion.position),
            reason: copyReason(attention.companion.reason),
          }
        : null,
    };
  }
  if (!attention.companion) return attention;
  return {
    kind: "reading",
    current: copyPosition(attention.current),
    companion: {
      position: nextPosition,
      reason: copyReason(attention.companion.reason),
    },
  };
}

function roleForSurface(
  attention: Extract<Attention, { kind: "reading" }>,
  surfaceId: SurfaceInstanceId,
): SurfaceRole | null {
  if (attention.current.surfaceId === surfaceId) return "current";
  if (attention.companion?.position.surfaceId === surfaceId) return "companion";
  return null;
}

function updateSurfacePosition(
  attention: Extract<Attention, { kind: "reading" }>,
  surfaceId: SurfaceInstanceId,
  position: ReadingPosition,
): Attention {
  const role = roleForSurface(attention, surfaceId);
  return role ? updateRolePosition(attention, role, position) : attention;
}

function updateRoleScroll(
  attention: Extract<Attention, { kind: "reading" }>,
  role: SurfaceRole,
  scrollTop: number,
): Attention {
  const nextScrollTop = normalizeScrollTop(scrollTop);
  const position =
    role === "current" ? attention.current : attention.companion?.position;
  if (!position || position.scrollTop === nextScrollTop) return attention;
  return updateRolePosition(attention, role, {
    ...position,
    scrollTop: nextScrollTop,
  });
}

function updateSurfaceScroll(
  attention: Extract<Attention, { kind: "reading" }>,
  surfaceId: SurfaceInstanceId,
  scrollTop: number,
): Attention {
  const role = roleForSurface(attention, surfaceId);
  return role ? updateRoleScroll(attention, role, scrollTop) : attention;
}

function updateRoleFocus(
  attention: Extract<Attention, { kind: "reading" }>,
  role: SurfaceRole,
  focus: AnchorInput | null,
): Attention {
  const position =
    role === "current" ? attention.current : attention.companion?.position;
  if (!position) return attention;
  const nextFocus =
    focus && focus.revisionId === position.revisionId ? copyFocus(focus) : null;
  if (sameFocus(position.focus, nextFocus)) return attention;
  return updateRolePosition(attention, role, {
    ...position,
    focus: nextFocus,
  });
}

function updateSurfaceFocus(
  attention: Extract<Attention, { kind: "reading" }>,
  surfaceId: SurfaceInstanceId,
  focus: AnchorInput | null,
): Attention {
  const role = roleForSurface(attention, surfaceId);
  return role ? updateRoleFocus(attention, role, focus) : attention;
}

/** Return the nearest earlier entry with a different current destination. */
export function returnHistoryIndex(state: AttentionState): number | null {
  const current =
    state.attention.kind === "reading" ? state.attention.current : null;
  for (let index = state.historyIndex - 1; index >= 0; index -= 1) {
    const candidate = state.history[index]?.attention;
    if (!candidate || candidate.kind !== "reading") continue;
    if (
      !current ||
      candidate.current.documentId !== current.documentId ||
      candidate.current.revisionId !== current.revisionId
    )
      return index;
  }
  return null;
}

export function attentionReducer(
  state: AttentionState,
  action: AttentionAction,
): AttentionState {
  switch (action.type) {
    case "navigate": {
      const next: Attention = {
        kind: "reading",
        current: normalizePosition(action.position),
        companion: null,
      };
      if (sameAttention(state.attention, next)) return state;
      return append(state, next, state.view);
    }
    case "compare": {
      if (state.attention.kind === "empty") return state;
      const next: Attention = {
        kind: "reading",
        current: copyPosition(state.attention.current),
        companion: {
          position: normalizePosition(action.position),
          reason: copyReason(action.reason),
        },
      };
      if (sameAttention(state.attention, next)) return state;
      return append(state, next, state.view);
    }
    case "inspect-connection": {
      const inspection = action.inspection;
      const next: Attention = {
        kind: "reading",
        current: normalizePosition(inspection.current),
        companion: {
          position: normalizePosition(inspection.companion),
          reason: {
            kind: "connection",
            connectionId: inspection.connectionId,
            currentEndpoint: inspection.currentEndpoint,
          },
        },
      };
      const nextCompanion = next.companion;
      // Repositioning an already selected connection is an alignment update,
      // not another readable destination in history.
      if (
        state.attention.kind === "reading" &&
        state.attention.companion?.reason.kind === "connection" &&
        sameReason(state.attention.companion.reason, nextCompanion!.reason) &&
        state.attention.current.surfaceId === next.current.surfaceId &&
        state.attention.companion.position.surfaceId ===
          nextCompanion!.position.surfaceId
      )
        return updateLive(state, next, state.view);
      if (sameAttention(state.attention, next)) return state;
      return append(state, next, state.view);
    }
    case "promote": {
      if (state.attention.kind === "empty" || !state.attention.companion)
        return state;
      const companion = state.attention.companion;
      if (companion.reason.kind === "connection") {
        const next: Attention = {
          kind: "reading",
          current: copyPosition(companion.position),
          companion: {
            position: copyPosition(state.attention.current),
            reason: {
              kind: "connection",
              connectionId: companion.reason.connectionId,
              currentEndpoint:
                companion.reason.currentEndpoint === "from" ? "to" : "from",
            },
          },
        };
        return append(state, next, state.view);
      }
      const next: Attention = {
        kind: "reading",
        current: copyPosition(companion.position),
        companion: null,
      };
      return append(state, next, state.view);
    }
    case "return-to-current": {
      if (state.attention.kind === "empty" || !state.attention.companion)
        return state;
      const next: Attention = {
        kind: "reading",
        current: copyPosition(state.attention.current),
        companion: null,
      };
      return append(state, next, state.view);
    }
    case "history": {
      if (
        !Number.isSafeInteger(action.index) ||
        action.index < 0 ||
        action.index >= state.history.length ||
        action.index === state.historyIndex
      )
        return state;
      const snapshot = state.history[action.index];
      if (!snapshot) return state;
      const restored = copySnapshot(snapshot);
      return {
        attention: restored.attention,
        view: restored.view,
        history: state.history,
        historyIndex: action.index,
      };
    }
    case "scroll": {
      if (state.attention.kind === "empty") return state;
      const next = updateSurfaceScroll(
        state.attention,
        action.surfaceId,
        action.scrollTop,
      );
      if (next === state.attention || sameAttention(next, state.attention))
        return state;
      return updateAttentionLive(state, next);
    }
    case "focus": {
      if (state.attention.kind === "empty") return state;
      const next = updateSurfaceFocus(
        state.attention,
        action.surfaceId,
        action.focus,
      );
      if (next === state.attention || sameAttention(next, state.attention))
        return state;
      return updateAttentionLive(state, next);
    }
    case "replace-revision": {
      if (state.attention.kind === "empty") return state;
      const next = updateSurfacePosition(
        state.attention,
        action.surfaceId,
        action.position,
      );
      if (next === state.attention || sameAttention(next, state.attention))
        return state;
      const downgraded: Attention =
        next.kind === "reading" && next.companion?.reason.kind === "connection"
          ? {
              ...next,
              companion: {
                position: next.companion.position,
                reason: { kind: "revision" },
              },
            }
          : next;
      return updateAttentionLive(state, downgraded);
    }
    case "view": {
      const next =
        state.attention.kind === "empty"
          ? state.view
          : normalizeSpaceView(
              action.view,
              activeSurfaceIds(state.attention),
              state.view.camera,
            );
      if (sameSpaceView(next, state.view)) return state;
      return updateLive(state, state.attention, next);
    }
  }
}
