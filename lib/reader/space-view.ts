import {
  CAMERA_HOME,
  normalizeCameraPose,
  type WorldPoint,
} from "./camera";
import type { CameraPose } from "./attention";
import type { SurfaceInstanceId } from "./spatial-contract";

/** A paper occurrence's persisted position in the shared z=0 reading plane. */
export type PaperPlacement =
  | { readonly kind: "automatic" }
  | { readonly kind: "manual"; readonly center: WorldPoint };

/** The mode of the space and the state owned by that mode. */
export type SpaceView =
  | {
      readonly kind: "reading";
      /** A narrow reading presentation may expose either active occurrence. */
      readonly exposedSurfaceId: SurfaceInstanceId | null;
    }
  | {
      readonly kind: "free";
      readonly camera: CameraPose;
      /** Missing entries are canonical automatic placements. */
      readonly placements: ReadonlyMap<SurfaceInstanceId, PaperPlacement>;
    };

const EMPTY_PLACEMENTS: ReadonlyMap<SurfaceInstanceId, PaperPlacement> =
  new Map();

function finitePoint(center: WorldPoint): boolean {
  return Number.isFinite(center.x) && Number.isFinite(center.y);
}

function copyCenter(center: WorldPoint): WorldPoint {
  // WorldPoint is branded at the camera boundary.  Copying its coordinates
  // preserves the brand without widening it back to an untyped screen point.
  return { x: center.x, y: center.y } as WorldPoint;
}

function copyPlacement(placement: PaperPlacement): PaperPlacement {
  if (placement.kind === "automatic") return { kind: "automatic" };
  if (!finitePoint(placement.center)) {
    throw new RangeError("manual paper placement must have finite coordinates");
  }
  return { kind: "manual", center: copyCenter(placement.center) };
}

/** Construct the canonical reading view. */
export function readingView(
  exposedSurfaceId: SurfaceInstanceId | null = null,
): SpaceView {
  return { kind: "reading", exposedSurfaceId };
}

/** Construct a free view with a defensive copy of its placement map. */
export function freeView(
  camera: CameraPose,
  placements: ReadonlyMap<SurfaceInstanceId, PaperPlacement> = EMPTY_PLACEMENTS,
): SpaceView {
  return {
    kind: "free",
    camera: normalizeCameraPose(camera, CAMERA_HOME),
    placements: normalizePaperPlacements(placements),
  };
}

/** Return the canonical automatic placement value. */
export function automaticPlacement(): PaperPlacement {
  return { kind: "automatic" };
}

/** Construct a manual placement after checking its runtime numeric boundary. */
export function manualPlacement(center: WorldPoint): PaperPlacement {
  return copyPlacement({ kind: "manual", center });
}

/**
 * Keep only placements for active occurrences and omit explicit automatic
 * entries.  The omission makes an absent key and `automatic` semantically
 * identical while ensuring stale/departing surfaces cannot enter history.
 */
export function normalizePaperPlacements(
  placements: ReadonlyMap<SurfaceInstanceId, PaperPlacement>,
  activeSurfaceIds?: readonly SurfaceInstanceId[],
): ReadonlyMap<SurfaceInstanceId, PaperPlacement> {
  const active = activeSurfaceIds ? new Set(activeSurfaceIds) : null;
  const normalized = new Map<SurfaceInstanceId, PaperPlacement>();
  for (const [surfaceId, placement] of placements) {
    if (active && !active.has(surfaceId)) continue;
    if (placement.kind === "automatic") continue;
    if (!finitePoint(placement.center)) continue;
    normalized.set(surfaceId, copyPlacement(placement));
  }
  return normalized;
}

/**
 * Normalize a view at an Attention boundary.  `activeSurfaceIds` is ordered
 * current-first, so a replaced/unknown exposed occurrence falls back to the
 * current occurrence as required by the reading contract.
 */
export function normalizeSpaceView(
  view: SpaceView,
  activeSurfaceIds: readonly SurfaceInstanceId[] = [],
  fallbackCamera: CameraPose = CAMERA_HOME,
): SpaceView {
  if (view.kind === "reading") {
    const exposed = view.exposedSurfaceId;
    if (exposed === null) return readingView(null);
    if (activeSurfaceIds.includes(exposed)) return readingView(exposed);
    return readingView(activeSurfaceIds[0] ?? null);
  }
  return {
    kind: "free",
    camera: normalizeCameraPose(view.camera, fallbackCamera),
    placements: normalizePaperPlacements(view.placements, activeSurfaceIds),
  };
}

/** Clone a view before storing it in a snapshot or history entry. */
export function copySpaceView(
  view: SpaceView,
  activeSurfaceIds: readonly SurfaceInstanceId[] = [],
  fallbackCamera: CameraPose = CAMERA_HOME,
): SpaceView {
  return normalizeSpaceView(view, activeSurfaceIds, fallbackCamera);
}

/** Resolve absent/automatic entries without creating a second placement source. */
export function placementForSurface(
  view: Extract<SpaceView, { kind: "free" }>,
  surfaceId: SurfaceInstanceId,
): PaperPlacement {
  const placement = view.placements.get(surfaceId);
  return placement ? copyPlacement(placement) : automaticPlacement();
}

/** Compare canonical view values, treating absent placement as automatic. */
export function sameSpaceView(left: SpaceView, right: SpaceView): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "reading" && right.kind === "reading") {
    return left.exposedSurfaceId === right.exposedSurfaceId;
  }
  if (left.kind !== "free" || right.kind !== "free") return false;
  const camera = left.camera;
  const otherCamera = right.camera;
  if (
    camera.x !== otherCamera.x ||
    camera.y !== otherCamera.y ||
    camera.yaw !== otherCamera.yaw ||
    camera.pitch !== otherCamera.pitch ||
    camera.zoom !== otherCamera.zoom
  )
    return false;
  const ids = new Set([...left.placements.keys(), ...right.placements.keys()]);
  for (const surfaceId of ids) {
    const a = left.placements.get(surfaceId) ?? automaticPlacement();
    const b = right.placements.get(surfaceId) ?? automaticPlacement();
    if (a.kind !== b.kind) return false;
    if (
      a.kind === "manual" &&
      b.kind === "manual" &&
      (a.center.x !== b.center.x || a.center.y !== b.center.y)
    )
      return false;
  }
  return true;
}

/** The camera used by a view; reading derives the home pose. */
export function cameraForView(view: SpaceView): CameraPose {
  return view.kind === "free"
    ? normalizeCameraPose(view.camera, CAMERA_HOME)
    : { ...CAMERA_HOME };
}
