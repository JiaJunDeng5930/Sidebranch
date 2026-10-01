import type {
  AnchorInput,
  Connection,
  ConnectionId,
  DocumentId,
  DocumentRevision,
  DocumentSummary,
  RevisionId,
} from "../domain/model";
import {
  surfaceInstanceId,
  type ConnectionEndpoint,
  type SurfaceInstanceId,
} from "./spatial-contract";
import {
  createSpaceView,
  normalizeSpaceView,
  sameSpaceView,
  type SpaceView,
} from "./space-view";
import {
  CAMERA_HOME,
  focusCamera,
  orientation,
  worldPoint,
  type CameraPose,
  type PaperPose,
} from "./camera";
import type { ReadingIntent } from "./reading-presentation";
export type { CameraPose } from "./camera";
export type { ReadingIntent } from "./reading-presentation";
export type { PaperPlacement, SpaceView } from "./space-view";

export interface ReadingPosition {
  readonly surfaceId: SurfaceInstanceId;
  readonly documentId: DocumentId;
  readonly revisionId: RevisionId;
  readonly focus: AnchorInput | null;
  readonly scrollTop: number;
}
/** Membership outlives payload residency and camera attention. */
export interface DocumentSurface extends ReadingPosition {
  readonly metadata: DocumentSummary | null;
}
export interface DocumentSpace {
  readonly surfaces: ReadonlyMap<SurfaceInstanceId, DocumentSurface>;
  readonly primary: ReadonlyMap<DocumentId, SurfaceInstanceId>;
}
export interface ConnectionBinding {
  readonly from: SurfaceInstanceId;
  readonly to: SurfaceInstanceId;
}
export interface AttentionSnapshot {
  readonly reading: ReadingIntent;
  readonly focus: SurfaceInstanceId | null;
  readonly camera: CameraPose;
  readonly positions: ReadonlyMap<SurfaceInstanceId, ReadingPosition>;
  readonly selectedConnectionId: ConnectionId | null;
}
export interface AttentionState {
  readonly space: DocumentSpace;
  /** Sole owner of camera, occurrence poses, and attention. */
  readonly view: SpaceView;
  readonly reading: ReadingIntent;
  readonly bindings: ReadonlyMap<ConnectionId, ConnectionBinding>;
  readonly selectedConnectionId: ConnectionId | null;
  readonly history: readonly AttentionSnapshot[];
  readonly historyIndex: number;
}
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
  | {
      readonly type: "admit";
      readonly position: ReadingPosition;
      readonly metadata?: DocumentSummary;
    }
  | {
      readonly type: "catalogue";
      readonly documents: readonly DocumentSummary[];
    }
  | { readonly type: "navigate"; readonly position: ReadingPosition }
  | {
      readonly type: "bind-connections";
      readonly connections: readonly Connection[];
    }
  | {
      readonly type: "inspect-connection";
      readonly inspection: ConnectionInspection;
    }
  | { readonly type: "focus-surface"; readonly surfaceId: SurfaceInstanceId }
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
export const DEFAULT_CAMERA = CAMERA_HOME;
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

export function emptyAttention(): AttentionState {
  return {
    space: { surfaces: new Map(), primary: new Map() },
    view: createSpaceView(),
    reading: { primary: null, companion: null, connectionId: null },
    bindings: new Map(),
    selectedConnectionId: null,
    history: [],
    historyIndex: -1,
  };
}
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
export function focusedPosition(state: AttentionState): DocumentSurface | null {
  return state.view.focus
    ? (state.space.surfaces.get(state.view.focus) ?? null)
    : null;
}
export function findOccurrence(
  state: AttentionState,
  documentId: DocumentId,
  revisionId: RevisionId,
  exclude?: SurfaceInstanceId,
): DocumentSurface | undefined {
  return [...state.space.surfaces.values()].find(
    (surface) =>
      surface.documentId === documentId &&
      surface.revisionId === revisionId &&
      surface.surfaceId !== exclude,
  );
}
/** Stable IDs can be allocated before asynchronous payload reads. */
export function primarySurfaceId(
  documentId: DocumentId,
  revisionId: RevisionId,
): SurfaceInstanceId {
  return surfaceInstanceId(`document:${documentId}:${revisionId}`);
}
export function defaultPaperPose(index: number): PaperPose {
  const column = index % 4,
    row = Math.floor(index / 4);
  return {
    position: worldPoint(
      -300 + column * 660,
      -12 + row * 850 + (column % 2) * 47,
      110 - column * 370 - row * 170,
    ),
    orientation: orientation(
      column % 2 ? 3 : -2,
      7 - column * 10,
      column % 2 ? 2 : -1,
    ),
  };
}
function admit(
  state: AttentionState,
  position: ReadingPosition,
  metadata?: DocumentSummary,
): AttentionState {
  const existing = state.space.surfaces.get(position.surfaceId);
  // An occurrence's immutable revision identity cannot be overwritten by a late result.
  if (
    existing &&
    (existing.documentId !== position.documentId ||
      existing.revisionId !== position.revisionId)
  )
    return state;
  const proven =
    metadata?.id === position.documentId &&
    metadata.revisionId === position.revisionId
      ? metadata
      : undefined;
  const surfaces = new Map(state.space.surfaces);
  const summary = proven
    ? {
        id: proven.id,
        revisionId: proven.revisionId,
        path: proven.path,
        title: proven.title,
        sequence: proven.sequence,
        format: proven.format,
        createdAt: proven.createdAt,
        updatedAt: proven.updatedAt,
        assetId: proven.assetId,
        archived: proven.archived,
      }
    : (existing?.metadata ?? null);
  surfaces.set(position.surfaceId, {
    ...normalizePosition(position),
    metadata: summary,
  });
  const placements = new Map(state.view.placements);
  if (!placements.has(position.surfaceId))
    placements.set(position.surfaceId, defaultPaperPose(placements.size));
  return {
    ...state,
    space: { ...state.space, surfaces },
    view: state.view.placements.has(position.surfaceId)
      ? state.view
      : { ...state.view, placements },
  };
}
function snapshot(state: AttentionState): AttentionSnapshot {
  return {
    reading: { ...state.reading },
    focus: state.view.focus,
    camera: state.view.camera,
    positions: new Map(
      [...state.space.surfaces].map(([id, p]) => [id, normalizePosition(p)]),
    ),
    selectedConnectionId: state.selectedConnectionId,
  };
}
function checkpoint(state: AttentionState, append = false): AttentionState {
  const history = append
    ? state.history.slice(0, state.historyIndex + 1)
    : [...state.history];
  const historyIndex =
    append || state.historyIndex < 0 ? history.length : state.historyIndex;
  history[historyIndex] = snapshot(state);
  return { ...state, history, historyIndex };
}
function approach(
  state: AttentionState,
  surfaceId: SurfaceInstanceId,
  reading: ReadingIntent = {
    primary: surfaceId,
    companion: null,
    connectionId: null,
  },
): AttentionState {
  if (!state.space.surfaces.has(surfaceId)) return state;
  const pose = state.view.placements.get(surfaceId)!;
  return checkpoint(
    {
      ...state,
      reading,
      selectedConnectionId: reading.connectionId,
      view: {
        ...state.view,
        focus: surfaceId,
        camera: focusCamera(state.view.camera, pose),
      },
    },
    state.view.focus !== surfaceId ||
      state.selectedConnectionId !== reading.connectionId ||
      state.reading.companion !== reading.companion,
  );
}
function intentForFocus(
  reading: ReadingIntent,
  surfaceId: SurfaceInstanceId | null,
): ReadingIntent {
  if (surfaceId === reading.primary) return reading;
  if (surfaceId && surfaceId === reading.companion)
    return { ...reading, primary: surfaceId, companion: reading.primary };
  return { primary: surfaceId, companion: null, connectionId: null };
}
export function returnHistoryIndex(state: AttentionState): number | null {
  for (let i = state.historyIndex - 1; i >= 0; i--)
    if (state.history[i].focus !== state.view.focus) return i;
  return null;
}
export function attentionReducer(
  state: AttentionState,
  action: AttentionAction,
): AttentionState {
  switch (action.type) {
    case "admit":
      return admit(state, action.position, action.metadata);
    case "catalogue": {
      let next = state;
      const primary = new Map(state.space.primary);
      for (const metadata of action.documents) {
        const existing = findOccurrence(next, metadata.id, metadata.revisionId);
        const position =
          existing ??
          readingPosition(
            metadata,
            primarySurfaceId(metadata.id, metadata.revisionId),
          );
        next = admit(next, position, metadata);
        primary.set(metadata.id, position.surfaceId);
        // Mutable document metadata applies to retained historical revisions too.
        const surfaces = new Map(next.space.surfaces);
        for (const [id, surface] of surfaces)
          if (
            surface.documentId === metadata.id &&
            surface.metadata &&
            surface.revisionId !== metadata.revisionId
          )
            surfaces.set(id, {
              ...surface,
              metadata: {
                ...surface.metadata,
                path: metadata.path,
                title: metadata.title,
                archived: metadata.archived,
              },
            });
        next = { ...next, space: { ...next.space, surfaces } };
      }
      return { ...next, space: { ...next.space, primary } };
    }
    case "navigate":
      return approach(admit(state, action.position), action.position.surfaceId);
    case "focus-surface":
      return approach(
        state,
        action.surfaceId,
        intentForFocus(state.reading, action.surfaceId),
      );
    case "bind-connections": {
      let next = state;
      const bindings = new Map(state.bindings);
      for (const connection of action.connections) {
        if (bindings.has(connection.id)) continue;
        const ends = {} as Record<ConnectionEndpoint, SurfaceInstanceId>;
        for (const endpoint of ["from", "to"] as const) {
          const anchor = connection[endpoint];
          const existing = findOccurrence(
            next,
            anchor.documentId,
            anchor.revisionId,
            endpoint === "to" ? ends.from : undefined,
          );
          const id =
            existing?.surfaceId ??
            (endpoint === "to" &&
            connection.from.revisionId === anchor.revisionId
              ? surfaceInstanceId(`connection:${connection.id}:to`)
              : primarySurfaceId(anchor.documentId, anchor.revisionId));
          next = admit(
            next,
            existing ??
              readingPosition(
                { id: anchor.documentId, revisionId: anchor.revisionId },
                id,
              ),
          );
          ends[endpoint] = id;
        }
        bindings.set(connection.id, ends);
      }
      return { ...next, bindings };
    }
    case "inspect-connection": {
      const { current, companion, connectionId, currentEndpoint } =
        action.inspection;
      let next = admit(admit(state, current), companion);
      const bindings = new Map(next.bindings);
      bindings.set(
        connectionId,
        currentEndpoint === "from"
          ? { from: current.surfaceId, to: companion.surfaceId }
          : { from: companion.surfaceId, to: current.surfaceId },
      );
      next = { ...next, bindings };
      return approach(next, companion.surfaceId, {
        primary: companion.surfaceId,
        companion: current.surfaceId,
        connectionId,
      });
    }
    case "history": {
      if (
        !Number.isSafeInteger(action.index) ||
        action.index < 0 ||
        action.index >= state.history.length ||
        action.index === state.historyIndex
      )
        return state;
      const saved = state.history[action.index];
      const surfaces = new Map(state.space.surfaces);
      for (const [id, position] of saved.positions) {
        const surface = surfaces.get(id);
        if (surface) surfaces.set(id, { ...surface, ...position });
      }
      return {
        ...state,
        space: { ...state.space, surfaces },
        view: { ...state.view, focus: saved.focus, camera: saved.camera },
        reading: saved.reading,
        selectedConnectionId: saved.selectedConnectionId,
        historyIndex: action.index,
      };
    }
    case "scroll":
    case "focus": {
      const surface = state.space.surfaces.get(action.surfaceId);
      if (!surface) return state;
      const position = normalizePosition({
        ...surface,
        ...(action.type === "scroll"
          ? { scrollTop: action.scrollTop }
          : { focus: action.focus }),
      });
      if (
        position.scrollTop === surface.scrollTop &&
        JSON.stringify(position.focus) === JSON.stringify(surface.focus)
      )
        return state;
      return checkpoint(admit(state, position));
    }
    case "replace-revision":
      return approach(admit(state, action.position), action.position.surfaceId);
    case "view": {
      if (action.view.focus && !state.space.surfaces.has(action.view.focus))
        return state;
      const placements = new Map(state.view.placements);
      for (const [id, pose] of action.view.placements)
        if (state.space.surfaces.has(id)) placements.set(id, pose);
      const view = normalizeSpaceView({ ...action.view, placements });
      const reading = intentForFocus(state.reading, view.focus);
      return sameSpaceView(view, state.view)
        ? state
        : checkpoint({
            ...state,
            view,
            reading,
            selectedConnectionId: reading.connectionId,
          });
    }
  }
}
