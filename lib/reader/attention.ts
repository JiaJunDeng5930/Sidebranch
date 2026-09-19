import type {
  AnchorInput,
  DocumentRevision,
  RevisionId,
  DocumentId,
  ConnectionId,
  QuestionId,
} from "../domain/model";

/** A source-bound position in a document revision. */
export interface ReadingPosition {
  readonly documentId: DocumentId;
  readonly revisionId: RevisionId;
  readonly focus: AnchorInput | null;
  readonly scrollTop: number;
}

export type SurfaceRole = "current" | "companion";

export interface CameraPose {
  readonly x: number;
  readonly y: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly zoom: number;
}

export type ComparisonReason =
  | { readonly kind: "connection"; readonly connectionId: ConnectionId }
  | { readonly kind: "document" }
  | { readonly kind: "revision" }
  | { readonly kind: "answer"; readonly questionId: QuestionId };

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
  readonly camera: CameraPose;
}

export interface AttentionState extends AttentionSnapshot {
  readonly history: readonly AttentionSnapshot[];
  readonly historyIndex: number;
}

export type AttentionAction =
  | { readonly type: "navigate"; readonly position: ReadingPosition }
  | {
      readonly type: "compare";
      readonly position: ReadingPosition;
      readonly reason: ComparisonReason;
    }
  | { readonly type: "promote" }
  | { readonly type: "return-to-current" }
  | { readonly type: "history"; readonly index: number }
  | {
      readonly type: "scroll";
      readonly role: SurfaceRole;
      readonly scrollTop: number;
    }
  | {
      readonly type: "focus";
      readonly role: SurfaceRole;
      readonly focus: AnchorInput | null;
    }
  | {
      readonly type: "replace-revision";
      readonly role: SurfaceRole;
      readonly position: ReadingPosition;
    }
  | { readonly type: "camera"; readonly pose: CameraPose };

/** The initial presentation used before a document has been selected. */
export const DEFAULT_CAMERA: CameraPose = {
  x: 0,
  y: 0,
  yaw: 0,
  pitch: 0,
  zoom: 1,
};

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
    documentId: position.documentId,
    revisionId: position.revisionId,
    // A focus for another immutable revision cannot safely be restored on
    // this surface.  Clearing it preserves the revision-bound invariant.
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
      return { kind: "connection", connectionId: reason.connectionId };
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

function normalizeCamera(
  pose: CameraPose,
  fallback: CameraPose = DEFAULT_CAMERA,
): CameraPose {
  return {
    x: finiteOr(pose.x, fallback.x),
    y: finiteOr(pose.y, fallback.y),
    yaw: finiteOr(pose.yaw, fallback.yaw),
    pitch: finiteOr(pose.pitch, fallback.pitch),
    zoom: finiteOr(pose.zoom, fallback.zoom),
  };
}

function copyCamera(pose: CameraPose): CameraPose {
  return normalizeCamera(pose);
}

function copySnapshot(snapshot: AttentionSnapshot): AttentionSnapshot {
  return {
    attention: copyAttention(snapshot.attention),
    camera: copyCamera(snapshot.camera),
  };
}

function snapshotOf(
  attention: Attention,
  camera: CameraPose,
): AttentionSnapshot {
  return {
    attention: copyAttention(attention),
    camera: copyCamera(camera),
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
        right.kind === "connection" && left.connectionId === right.connectionId
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

function sameCamera(left: CameraPose, right: CameraPose): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.yaw === right.yaw &&
    left.pitch === right.pitch &&
    left.zoom === right.zoom
  );
}

/** Create an empty session with no synthetic document or view identity. */
export function emptyAttention(): AttentionState {
  return {
    attention: { kind: "empty" },
    camera: copyCamera(DEFAULT_CAMERA),
    history: [],
    historyIndex: -1,
  };
}

/**
 * Construct a revision-bound reading position from either a full revision or
 * a metadata summary carrying the same identity fields.
 */
export function readingPosition(
  document: Pick<DocumentRevision, "id" | "revisionId">,
  focus: AnchorInput | null = null,
  scrollTop = 0,
): ReadingPosition {
  return normalizePosition({
    documentId: document.id,
    revisionId: document.revisionId,
    focus,
    scrollTop,
  });
}

function append(
  state: AttentionState,
  attention: Attention,
  camera: CameraPose,
): AttentionState {
  const nextSnapshot = snapshotOf(attention, camera);
  const prefix =
    state.historyIndex >= 0 && state.historyIndex < state.history.length
      ? state.history.slice(0, state.historyIndex + 1)
      : [];
  const history = [...prefix, nextSnapshot];
  return {
    attention: copyAttention(nextSnapshot.attention),
    camera: copyCamera(nextSnapshot.camera),
    history,
    historyIndex: history.length - 1,
  };
}

/** Update the live snapshot in place in the logical history, without append. */
function updateLive(
  state: AttentionState,
  attention: Attention,
  camera: CameraPose,
): AttentionState {
  const nextSnapshot = snapshotOf(attention, camera);
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
    camera: copyCamera(nextSnapshot.camera),
    history,
    historyIndex,
  };
}

function updateAttentionLive(
  state: AttentionState,
  attention: Attention,
): AttentionState {
  return updateLive(state, attention, state.camera);
}

function updateCameraLive(
  state: AttentionState,
  camera: CameraPose,
): AttentionState {
  return updateLive(state, state.attention, camera);
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

function updateRoleScroll(
  attention: Extract<Attention, { kind: "reading" }>,
  role: SurfaceRole,
  scrollTop: number,
): Attention {
  const nextScrollTop = normalizeScrollTop(scrollTop);
  if (role === "current") {
    if (attention.current.scrollTop === nextScrollTop) return attention;
    return updateRolePosition(attention, role, {
      ...attention.current,
      scrollTop: nextScrollTop,
    });
  }
  if (!attention.companion) return attention;
  if (attention.companion.position.scrollTop === nextScrollTop)
    return attention;
  return updateRolePosition(attention, role, {
    ...attention.companion.position,
    scrollTop: nextScrollTop,
  });
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

/**
 * Return the nearest earlier entry whose current document or immutable
 * revision differs from the current attention.  Companion-only changes do
 * not count as a different current destination.
 */
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
      // An intentional root navigation gets the readable home framing.  The
      // prefix history still contains the previous live pose, so Back can
      // restore the camera together with its reading position.
      return append(state, next, DEFAULT_CAMERA);
    }
    case "compare": {
      if (state.attention.kind === "empty") return state;
      const position = normalizePosition(action.position);
      const next: Attention = {
        kind: "reading",
        current: copyPosition(state.attention.current),
        companion: {
          position,
          reason: copyReason(action.reason),
        },
      };
      if (sameAttention(state.attention, next)) return state;
      // Comparison is an intentional destination.  Keep the current pose in
      // the previous snapshot and let the new companion settle at home.
      return append(state, next, DEFAULT_CAMERA);
    }
    case "promote": {
      if (
        state.attention.kind === "empty" ||
        state.attention.companion === null
      )
        return state;
      const next: Attention = {
        kind: "reading",
        current: copyPosition(state.attention.companion.position),
        companion: null,
      };
      // Promotion changes the reading root, so it follows the same framing
      // rule as navigate/compare while preserving the compare pose in history.
      return append(state, next, DEFAULT_CAMERA);
    }
    case "return-to-current": {
      if (
        state.attention.kind === "empty" ||
        state.attention.companion === null
      )
        return state;
      const next: Attention = {
        kind: "reading",
        current: copyPosition(state.attention.current),
        companion: null,
      };
      return append(state, next, state.camera);
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
        camera: restored.camera,
        history: state.history,
        historyIndex: action.index,
      };
    }
    case "scroll": {
      if (state.attention.kind === "empty") return state;
      const next = updateRoleScroll(
        state.attention,
        action.role,
        action.scrollTop,
      );
      if (next === state.attention || sameAttention(next, state.attention))
        return state;
      return updateAttentionLive(state, next);
    }
    case "focus": {
      if (state.attention.kind === "empty") return state;
      const next = updateRoleFocus(state.attention, action.role, action.focus);
      if (next === state.attention || sameAttention(next, state.attention))
        return state;
      return updateAttentionLive(state, next);
    }
    case "replace-revision": {
      if (state.attention.kind === "empty") return state;
      const next = updateRolePosition(
        state.attention,
        action.role,
        action.position,
      );
      if (next === state.attention || sameAttention(next, state.attention))
        return state;
      return updateAttentionLive(state, next);
    }
    case "camera": {
      const next = normalizeCamera(action.pose, state.camera);
      if (sameCamera(next, state.camera)) return state;
      return updateCameraLive(state, next);
    }
  }
}
