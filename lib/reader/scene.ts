import type {
  AnchorInput,
  ConnectionId,
  DocumentRevision,
} from "../domain/model";

/** An open slab instance. It is deliberately not a DocumentId. */
export type ViewId = string & { readonly __viewId: unique symbol };

export function createViewId(seed?: string): ViewId {
  if (seed) return seed as ViewId;
  const webCrypto = typeof globalThis.crypto !== "undefined" ? globalThis.crypto : undefined;
  if (webCrypto && typeof webCrypto.randomUUID === "function")
    return webCrypto.randomUUID() as ViewId;
  if (webCrypto && typeof webCrypto.getRandomValues === "function") {
    const bytes = new Uint32Array(4);
    webCrypto.getRandomValues(bytes);
    return `view-${Array.from(bytes, (value) => value.toString(36)).join("-")}` as ViewId;
  }
  return `view-${Date.now().toString(36)}-${(++viewSequence).toString(36)}-${Math.random().toString(36).slice(2)}` as ViewId;
}

let viewSequence = 0;

export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CameraState {
  readonly position: Point3;
  readonly rotation: { readonly x: number; readonly y: number };
  readonly zoom: number;
}

export interface DocumentView {
  readonly id: ViewId;
  readonly document: DocumentRevision;
  readonly position: Point3;
  readonly scrollTop: number;
  readonly focus: AnchorInput | null;
}

export interface ViewHistoryState {
  readonly id: ViewId;
  readonly position: Point3;
  readonly scrollTop: number;
  readonly focus: AnchorInput | null;
}

export interface SceneHistoryEntry {
  readonly currentViewId: ViewId | null;
  readonly companionViewId: ViewId | null;
  readonly camera: CameraState;
  readonly views: readonly ViewHistoryState[];
}

interface SceneStateCommon {
  readonly camera: CameraState;
  readonly history: readonly SceneHistoryEntry[];
  readonly historyIndex: number;
}

export type EmptySceneState = SceneStateCommon & {
  readonly kind: "empty";
  readonly views: readonly [];
  readonly currentViewId: null;
  readonly companionViewId: null;
};

export type PopulatedSceneState = SceneStateCommon & {
  readonly kind: "populated";
  readonly views: readonly [DocumentView, ...DocumentView[]];
  readonly currentViewId: ViewId;
  readonly companionViewId: ViewId | null;
};

/** Roles are discriminated: an empty scene cannot expose a current or companion ID. */
export type SceneState = EmptySceneState | PopulatedSceneState;

interface SceneDraft {
  views: readonly DocumentView[];
  currentViewId: ViewId | null;
  companionViewId: ViewId | null;
  camera: CameraState;
}

export type SceneRole = "current" | "companion" | "peripheral";

export type FollowExistingAction = {
  type: "follow";
  viewId: ViewId;
  document?: never;
  focus?: AnchorInput | null;
  position?: Point3;
  connectionId?: ConnectionId;
};

export type FollowDocumentAction = {
  type: "follow";
  document: DocumentRevision;
  viewId?: never;
  focus?: AnchorInput | null;
  position?: Point3;
  connectionId?: ConnectionId;
};

export type SceneAction =
  | {
      type: "open-document";
      document: DocumentRevision;
      viewId?: ViewId;
      focus?: AnchorInput | null;
      position?: Point3;
      besideViewId?: ViewId;
      role?: SceneRole;
    }
  | {
      type: "open-new-view";
      document: DocumentRevision;
      viewId?: ViewId;
      focus?: AnchorInput | null;
      position?: Point3;
      besideViewId?: ViewId;
      role?: SceneRole;
    }
  | FollowExistingAction
  | FollowDocumentAction
  | {
      type: "focus-view";
      viewId: ViewId;
      focus?: AnchorInput | null;
      history?: boolean;
    }
  | { type: "promote-view"; viewId: ViewId }
  | { type: "close-view"; viewId: ViewId }
  | {
      type: "update-view";
      viewId: ViewId;
      patch: Partial<Pick<DocumentView, "position" | "scrollTop" | "focus">>;
    }
  | {
      type: "replace-document";
      viewId: ViewId;
      document: DocumentRevision;
      focus?: AnchorInput | null;
    }
  | { type: "camera"; patch: Partial<CameraState> }
  | { type: "reset-camera" }
  | { type: "overview-camera"; width: number; height: number }
  | { type: "history-back" }
  | { type: "history-forward" };

export const SCENE_CAMERA_LIMITS = {
  position: 100_000,
  depth: 3200,
  rotation: 48,
  zoomMin: 0.12,
  zoomMax: 1.8,
} as const;

export const DEFAULT_CAMERA: CameraState = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0 },
  zoom: 1,
};

function numberOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function finitePoint(point: Point3, fallback = { x: 0, y: 0, z: 0 }): Point3 {
  return {
    x: clamp(numberOr(point.x, fallback.x), -SCENE_CAMERA_LIMITS.position, SCENE_CAMERA_LIMITS.position),
    y: clamp(numberOr(point.y, fallback.y), -SCENE_CAMERA_LIMITS.position, SCENE_CAMERA_LIMITS.position),
    z: clamp(numberOr(point.z, fallback.z), -SCENE_CAMERA_LIMITS.depth, SCENE_CAMERA_LIMITS.depth),
  };
}

function copyPoint(point: Point3): Point3 {
  return { x: point.x, y: point.y, z: point.z };
}

function copyFocus(focus: AnchorInput | null): AnchorInput | null {
  return focus ? { ...focus } : null;
}

function copyCamera(camera: CameraState): CameraState {
  return {
    position: copyPoint(camera.position),
    rotation: { x: camera.rotation.x, y: camera.rotation.y },
    zoom: camera.zoom,
  };
}

function normalizeCamera(camera: CameraState): CameraState {
  return {
    position: finitePoint(camera.position),
    rotation: {
      x: clamp(numberOr(camera.rotation.x, 0), -SCENE_CAMERA_LIMITS.rotation, SCENE_CAMERA_LIMITS.rotation),
      y: clamp(numberOr(camera.rotation.y, 0), -SCENE_CAMERA_LIMITS.rotation, SCENE_CAMERA_LIMITS.rotation),
    },
    zoom: clamp(
      numberOr(camera.zoom, DEFAULT_CAMERA.zoom),
      SCENE_CAMERA_LIMITS.zoomMin,
      SCENE_CAMERA_LIMITS.zoomMax,
    ),
  };
}

function viewHistoryState(view: DocumentView): ViewHistoryState {
  return {
    id: view.id,
    position: copyPoint(view.position),
    scrollTop: Math.max(0, numberOr(view.scrollTop, 0)),
    focus: copyFocus(view.focus),
  };
}

function snapshot(state: SceneDraft): SceneHistoryEntry {
  return {
    currentViewId: state.currentViewId,
    companionViewId: state.companionViewId,
    camera: copyCamera(state.camera),
    views: state.views.map(viewHistoryState),
  };
}

function baseState(state: SceneState, values: {
  views?: readonly DocumentView[];
  currentViewId?: ViewId | null;
  companionViewId?: ViewId | null;
  camera?: CameraState;
}): SceneDraft {
  return {
    views: values.views ?? state.views,
    currentViewId:
      values.currentViewId === undefined
        ? state.currentViewId
        : values.currentViewId,
    companionViewId:
      values.companionViewId === undefined
        ? state.companionViewId
        : values.companionViewId,
    camera: values.camera ? normalizeCamera(values.camera) : copyCamera(state.camera),
  };
}

function enforceRoles(
  state: SceneDraft,
): SceneDraft {
  const ids = new Set(state.views.map((view) => view.id));
  let current = state.currentViewId && ids.has(state.currentViewId)
    ? state.currentViewId
    : null;
  let companion =
    state.companionViewId &&
    ids.has(state.companionViewId) &&
    state.companionViewId !== current
      ? state.companionViewId
      : null;
  if (!state.views.length) return { ...state, currentViewId: null, companionViewId: null };
  if (!current) current = state.views[0].id;
  if (companion === current) companion = null;
  return { ...state, currentViewId: current, companionViewId: companion };
}

function withLiveHistory(
  state: SceneState,
  values: SceneDraft,
): SceneState {
  const next = enforceRoles(values);
  const history = state.history.length
    ? state.history.slice()
    : [snapshot(next)];
  const historyIndex = clamp(
    state.historyIndex < 0 ? history.length - 1 : state.historyIndex,
    0,
    history.length - 1,
  );
  history[historyIndex] = snapshot(next);
  return finalize(next, history, historyIndex);
}

function readingCamera(state: SceneDraft): CameraState {
  const current = state.views.find(view => view.id === state.currentViewId);
  const companion = state.views.find(view => view.id === state.companionViewId);
  if (!current) return copyCamera(DEFAULT_CAMERA);
  return {
    position: companion ? {
      x: (current.position.x + companion.position.x) / 2,
      y: (current.position.y + companion.position.y) / 2,
      z: Math.max(current.position.z, companion.position.z),
    } : copyPoint(current.position),
    rotation: { x: 0, y: 0 },
    zoom: companion ? 0.8 : 1,
  };
}

function withNavigation(
  state: SceneState,
  values: SceneDraft,
): SceneState {
  const roles = enforceRoles(values);
  const next = { ...roles, camera: readingCamera(roles) };
  const sameFocus = (a: AnchorInput | null, b: AnchorInput | null) => a?.revisionId === b?.revisionId && a?.start === b?.start && a?.end === b?.end;
  if (state.currentViewId === next.currentViewId && state.companionViewId === next.companionViewId && state.views.length === next.views.length && next.views.every(view => {
    const previous = state.views.find(item => item.id === view.id);
    return previous?.document.revisionId === view.document.revisionId && sameFocus(previous.focus, view.focus);
  })) return withLiveHistory(state, next);
  const previousHistory = state.history.length
    ? state.history.slice(0, Math.max(0, state.historyIndex + 1))
    : [];
  previousHistory.push(snapshot(next));
  return finalize(next, previousHistory, previousHistory.length - 1);
}

function hasViews(views: readonly DocumentView[]): views is readonly [DocumentView, ...DocumentView[]] {
  return views.length > 0;
}

function finalize(
  values: SceneDraft,
  history: readonly SceneHistoryEntry[],
  historyIndex: number,
): SceneState {
  const next = enforceRoles(values);
  if (!hasViews(next.views))
    return {
      kind: "empty",
      views: [],
      currentViewId: null,
      companionViewId: null,
      camera: copyCamera(next.camera),
      history,
      historyIndex,
    };
  const currentViewId = next.currentViewId ?? next.views[0].id;
  return {
    kind: "populated",
    views: next.views,
    currentViewId,
    companionViewId:
      next.companionViewId === currentViewId ? null : next.companionViewId,
    camera: copyCamera(next.camera),
    history,
    historyIndex,
  };
}

function positionFor(
  state: SceneState,
  role: SceneRole,
  besideViewId?: ViewId,
): Point3 {
  const beside = besideViewId
    ? state.views.find((view) => view.id === besideViewId)
    : undefined;
  if (beside) {
    return finitePoint({
      x: beside.position.x + (role === "companion" ? 700 : 780),
      y: beside.position.y + (role === "companion" ? 4 : -45),
      z: beside.position.z - (role === "companion" ? 20 : 190),
    });
  }
  if (role === "current") {
    const current = state.views.find(view => view.id === state.currentViewId);
    return current
      ? finitePoint({ x: current.position.x + 700, y: current.position.y, z: current.position.z })
      : { x: 0, y: 0, z: 0 };
  }
  if (role === "companion") {
    const current = state.currentViewId
      ? state.views.find((view) => view.id === state.currentViewId)
      : undefined;
    return finitePoint({
      x: (current?.position.x ?? 0) + 700,
      y: current?.position.y ?? 0,
      z: (current?.position.z ?? 0) - 20,
    });
  }
  const index = state.views.length;
  const side = index % 2 === 0 ? 1 : -1;
  return finitePoint({
    x: side * (560 + Math.floor(index / 2) * 90),
    y: (index % 3 - 1) * 90,
    z: -240 - Math.floor(index / 3) * 130,
  });
}

function sameRevision(a: DocumentRevision, b: DocumentRevision): boolean {
  return a.revisionId === b.revisionId;
}

function open(
  state: SceneState,
  action: Extract<SceneAction, { type: "open-document" | "open-new-view" }>,
  forceNew: boolean,
): SceneState {
  const role = action.role ?? "current";
  const existing = !forceNew
    ? state.views.find((view) => sameRevision(view.document, action.document))
    : undefined;
  if (existing) {
    const views = state.views.map((view) =>
      view.id === existing.id
        ? {
            ...view,
            position: action.position
              ? finitePoint(action.position, view.position)
              : view.position,
            focus:
              action.focus === undefined ? view.focus : copyFocus(action.focus),
          }
        : view,
    );
    const nextCurrent = role === "current" ? existing.id : state.currentViewId;
    const nextCompanion =
      role === "companion" && existing.id !== nextCurrent
        ? existing.id
        : role === "current" && existing.id !== state.currentViewId
          ? state.currentViewId
          : state.companionViewId === existing.id && role !== "companion"
            ? null
            : state.companionViewId;
    return withNavigation(
      state,
      baseState(state, {
        views,
        currentViewId: nextCurrent,
        companionViewId: nextCompanion,
      }),
    );
  }
  const id =
    action.viewId && !state.views.some((view) => view.id === action.viewId)
      ? action.viewId
      : createViewId();
  const view: DocumentView = {
    id,
    document: action.document,
    position: action.position
      ? finitePoint(action.position)
      : positionFor(state, role, action.besideViewId),
    scrollTop: 0,
    focus: copyFocus(action.focus ?? null),
  };
  const views = [...state.views, view];
  let current = state.currentViewId;
  let companion = state.companionViewId;
  if (!current || role === "current") {
    companion = current && current !== id ? current : companion;
    current = id;
  } else if (role === "companion") {
    companion = id;
  }
  return withNavigation(
    state,
    baseState(state, { views, currentViewId: current, companionViewId: companion }),
  );
}

function follow(state: SceneState, action: Extract<SceneAction, { type: "follow" }>): SceneState {
  if ("viewId" in action) {
    const target = state.views.find((view) => view.id === action.viewId);
    if (!target) return state;
    const views = state.views.map((view) =>
      view.id === target.id
        ? {
            ...view,
            position: action.position
              ? finitePoint(action.position, view.position)
              : state.currentViewId === target.id || state.companionViewId === target.id
                ? view.position
                : positionFor(state, "companion"),
            focus: action.focus === undefined ? view.focus : copyFocus(action.focus),
          }
        : view,
    );
    if (!state.currentViewId || state.currentViewId === target.id) {
      return withNavigation(
        state,
        baseState(state, { views, currentViewId: target.id, companionViewId: null }),
      );
    }
    return withNavigation(state, baseState(state, { views, companionViewId: target.id }));
  }
  if (!action.document) {
    // This is unreachable for TypeScript callers because FollowAction is an XOR.
    // Keep malformed JavaScript calls loud instead of silently dropping a follow.
    throw new Error("A follow action requires either viewId or document.");
  }
  const target = state.views.find((view) => sameRevision(view.document, action.document));
  if (!target) {
    const id = createViewId();
    const newTarget: DocumentView = {
      id,
      document: action.document,
      position: action.position
        ? finitePoint(action.position)
        : positionFor(state, "companion"),
      scrollTop: 0,
      focus: copyFocus(action.focus ?? null),
    };
    const values = baseState(state, {
      views: [...state.views, newTarget],
      currentViewId: state.currentViewId ?? newTarget.id,
      companionViewId: state.currentViewId ? newTarget.id : null,
    });
    return withNavigation(state, values);
  }
  const views = state.views.map((view) =>
    view.id === target.id
      ? {
          ...view,
          position: action.position
            ? finitePoint(action.position, view.position)
            : state.currentViewId === target.id || state.companionViewId === target.id
              ? view.position
              : positionFor(state, "companion"),
          focus: action.focus === undefined ? view.focus : copyFocus(action.focus),
        }
      : view,
  );
  if (!state.currentViewId || state.currentViewId === target.id) {
    return withNavigation(
      state,
      baseState(state, { views, currentViewId: target.id, companionViewId: null }),
    );
  }
  return withNavigation(
    state,
    baseState(state, { views, companionViewId: target.id }),
  );
}

function restoreHistory(state: SceneState, entry: SceneHistoryEntry): SceneState {
  const saved = new Map(entry.views.map((view) => [view.id, view]));
  const views = state.views.map((view) => {
    const context = saved.get(view.id);
    return context
      ? {
          ...view,
          position: copyPoint(context.position),
          scrollTop: Math.max(0, context.scrollTop),
          focus:
            context.focus?.revisionId === view.document.revisionId
              ? copyFocus(context.focus)
              : null,
        }
      : view;
  });
  const values = enforceRoles(
    baseState(state, {
      views,
      currentViewId: entry.currentViewId,
      companionViewId: entry.companionViewId,
      camera: entry.camera,
    }),
  );
  return finalize(values, state.history, state.historyIndex);
}

export function emptyScene(): SceneState {
  const values: SceneDraft = {
    views: [],
    currentViewId: null,
    companionViewId: null,
    camera: copyCamera(DEFAULT_CAMERA),
  };
  return finalize(values, [], -1);
}

export function sceneReducer(state: SceneState, action: SceneAction): SceneState {
  switch (action.type) {
    case "open-document":
      return open(state, action, false);
    case "open-new-view":
      return open(state, action, true);
    case "follow":
      return follow(state, action);
    case "focus-view": {
      if (!state.views.some((view) => view.id === action.viewId)) return state;
      const views = state.views.map((view) =>
        view.id === action.viewId && action.focus !== undefined
          ? { ...view, focus: copyFocus(action.focus) }
          : view,
      );
      const target = views.find(view => view.id === action.viewId)!;
      const values = baseState(state, {
        views,
        currentViewId: state.currentViewId ?? action.viewId,
        camera: { position: copyPoint(target.position), rotation: { x: 0, y: 0 }, zoom: 1 },
      });
      return action.history ? withNavigation(state, values) : withLiveHistory(state, values);
    }
    case "promote-view": {
      if (!state.views.some((view) => view.id === action.viewId)) return state;
      if (state.currentViewId === action.viewId) return state;
      return withNavigation(
        state,
        baseState(state, {
          currentViewId: action.viewId,
          companionViewId: state.currentViewId,
        }),
      );
    }
    case "close-view": {
      if (!state.views.some((view) => view.id === action.viewId)) return state;
      const views = state.views.filter((view) => view.id !== action.viewId);
      let current = state.currentViewId === action.viewId ? null : state.currentViewId;
      let companion =
        state.companionViewId === action.viewId ? null : state.companionViewId;
      if (!current) {
        current = companion && views.some((view) => view.id === companion)
          ? companion
          : views[0]?.id ?? null;
        if (current === companion) companion = null;
      }
      return withNavigation(
        state,
        baseState(state, { views, currentViewId: current, companionViewId: companion }),
      );
    }
    case "update-view": {
      const views = state.views.map((view) => {
        if (view.id !== action.viewId) return view;
        const patch = action.patch;
        return {
          ...view,
          position: patch.position
            ? finitePoint(patch.position, view.position)
            : view.position,
          scrollTop:
            patch.scrollTop === undefined
              ? view.scrollTop
              : Math.max(0, numberOr(patch.scrollTop, view.scrollTop)),
          focus: patch.focus === undefined ? view.focus : copyFocus(patch.focus),
        };
      });
      if (views.every((view, index) => view === state.views[index])) return state;
      return withLiveHistory(state, baseState(state, { views }));
    }
    case "replace-document": {
      const existing = state.views.find((view) => view.id === action.viewId);
      if (!existing) return state;
      const views = state.views.map((view) =>
        view.id !== action.viewId
          ? view
          : {
              ...view,
              document: action.document,
              focus:
                action.focus !== undefined
                  ? copyFocus(action.focus)
                  : view.focus?.revisionId === action.document.revisionId
                    ? view.focus
                    : null,
            },
      );
      return withLiveHistory(state, baseState(state, { views }));
    }
    case "camera": {
      const patch = action.patch;
      const camera = normalizeCamera({
        position: patch.position
          ? finitePoint(patch.position, state.camera.position)
          : state.camera.position,
        rotation: patch.rotation
          ? {
              x: numberOr(patch.rotation.x, state.camera.rotation.x),
              y: numberOr(patch.rotation.y, state.camera.rotation.y),
            }
          : state.camera.rotation,
        zoom: numberOr(patch.zoom, state.camera.zoom),
      });
      return withLiveHistory(state, baseState(state, { camera }));
    }
    case "reset-camera":
      return withLiveHistory(state, baseState(state, { camera: readingCamera(state) }));
    case "overview-camera": {
      if (!state.views.length) return state;
      const xs = state.views.map(view => view.position.x);
      const ys = state.views.map(view => view.position.y);
      const left = Math.min(...xs) - 340, right = Math.max(...xs) + 340;
      const top = Math.min(...ys) - 390, bottom = Math.max(...ys) + 390;
      const camera = normalizeCamera({
        position: { x: (left + right) / 2, y: (top + bottom) / 2, z: 0 },
        rotation: { x: 8, y: -13 },
        zoom: Math.min(0.72, Math.max(1, action.width - 80) / (right - left), Math.max(1, action.height - 60) / (bottom - top)),
      });
      return withLiveHistory(state, baseState(state, { camera }));
    }
    case "history-back": {
      if (state.historyIndex <= 0) return state;
      const historyIndex = state.historyIndex - 1;
      return { ...restoreHistory(state, state.history[historyIndex]), historyIndex };
    }
    case "history-forward": {
      if (state.historyIndex >= state.history.length - 1) return state;
      const historyIndex = state.historyIndex + 1;
      return { ...restoreHistory(state, state.history[historyIndex]), historyIndex };
    }
  }
}
