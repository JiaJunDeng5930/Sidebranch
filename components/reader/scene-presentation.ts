import type { SurfaceInstanceId } from "../../lib/reader/spatial-contract";
import type { CameraPose } from "../../lib/reader/attention";
import {
  worldPoint,
  type WorldPoint,
} from "../../lib/reader/camera";
import type {
  PaperPlacement,
  SpaceView,
} from "../../lib/reader/space-view";
/** Private presentation math; coordinates are unscaled paper CSS pixels. */
export type PaperRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
export type PaperPose = { x: number; y: number } & {
  scale: number;
  opacity: number;
};

export type ReadableRectangle = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type SceneFraming =
  | {
      kind: "single";
      rectangles: { current: ReadableRectangle };
    }
  | {
      kind: "paired";
      rectangles: {
        current: ReadableRectangle;
        companion: ReadableRectangle;
      };
      gap: number;
    }
  | {
      kind: "recessed-companion";
      rectangles: { current: ReadableRectangle };
      gap: number;
    };

export type ScenePresentationPlan = {
  framing: SceneFraming;
  paperWidth: number;
  companionWidth: number | null;
  paperMaxHeight: number;
  currentPosition: { x: number; y: number };
  companionPosition: { x: number; y: number };
};

/** The measured body of one active occurrence. */
export type SurfaceMeasurement = {
  readonly surfaceId: SurfaceInstanceId;
  readonly width: number;
  readonly height: number;
};

export type SpacePresentationPlan = {
  readonly kind: SpaceView["kind"];
  readonly reading: ScenePresentationPlan;
  /** Automatic centers before manual placement overrides. */
  readonly automaticCenters: ReadonlyMap<SurfaceInstanceId, WorldPoint>;
  /** Final centers consumed by the live paper transform. */
  readonly centers: ReadonlyMap<SurfaceInstanceId, WorldPoint>;
  readonly poses: PaperMotion;
  readonly paperMaxHeight: number;
  readonly companionWidth: number | null;
};

const FREE_PAPER_GAP = 96;

const READABLE_MIN_WIDTH = 440;
const PRIMARY_MAX_WIDTH = 640;
const COMPANION_MAX_WIDTH = 520;
const PAIRED_THRESHOLD = 1104;
const PAIRED_GAP = 96;

function readableRectangle(
  centerX: number,
  width: number,
  height: number,
  viewportHeight: number,
  bottomInset: number,
): ReadableRectangle {
  const top = Math.max(
    88,
    88 + (viewportHeight - 88 - bottomInset - height) / 2,
  );
  return {
    left: centerX - width / 2,
    top,
    right: centerX + width / 2,
    bottom: top + height,
    width,
    height,
  };
}

function positionForRectangle(
  rectangle: ReadableRectangle,
  viewportWidth: number,
  viewportHeight: number,
) {
  return {
    x: (rectangle.left + rectangle.right) / 2 - viewportWidth / 2,
    y: (rectangle.top + rectangle.bottom) / 2 - viewportHeight / 2,
  };
}

/**
 * Resolve the only scene framing decision from the measured scene container.
 * The returned rectangles are the final readable paper bounds; callers must
 * not reimplement the 1104px fit rule or shrink a companion to make it fit.
 */
export function planScenePresentation(
  width: number,
  height: number,
  hasCompanion: boolean,
): ScenePresentationPlan {
  const measuredWidth = Math.max(0, Number.isFinite(width) ? width : 0);
  const measuredHeight = Math.max(176, Number.isFinite(height) ? height : 176);
  const bottomInset = measuredWidth <= 620 ? 128 : 84;
  const paperMaxHeight = Math.min(
    820,
    Math.max(176, measuredHeight - 88 - bottomInset),
  );
  const margin = measuredWidth < 560 ? 16 : 64;

  if (hasCompanion && measuredWidth >= PAIRED_THRESHOLD) {
    const available = Math.max(
      READABLE_MIN_WIDTH * 2,
      measuredWidth - margin * 2 - PAIRED_GAP,
    );
    const extra = Math.max(0, available - READABLE_MIN_WIDTH * 2);
    let currentWidth = Math.min(
      PRIMARY_MAX_WIDTH,
      READABLE_MIN_WIDTH + extra * 0.58,
    );
    let companionWidth = Math.min(
      COMPANION_MAX_WIDTH,
      READABLE_MIN_WIDTH + extra * 0.42,
    );
    const used = currentWidth + companionWidth;
    const remaining = Math.max(0, available - used);
    currentWidth = Math.min(PRIMARY_MAX_WIDTH, currentWidth + remaining);
    companionWidth = Math.min(
      COMPANION_MAX_WIDTH,
      companionWidth + Math.max(0, available - currentWidth - companionWidth),
    );
    const total = currentWidth + PAIRED_GAP + companionWidth;
    const start = (measuredWidth - total) / 2;
    const current = readableRectangle(
      start + currentWidth / 2,
      currentWidth,
      paperMaxHeight,
      measuredHeight,
      bottomInset,
    );
    const companion = readableRectangle(
      start + currentWidth + PAIRED_GAP + companionWidth / 2,
      companionWidth,
      paperMaxHeight,
      measuredHeight,
      bottomInset,
    );
    return {
      framing: {
        kind: "paired",
        rectangles: { current, companion },
        gap: PAIRED_GAP,
      },
      paperWidth: currentWidth,
      companionWidth,
      paperMaxHeight,
      currentPosition: positionForRectangle(
        current,
        measuredWidth,
        measuredHeight,
      ),
      companionPosition: positionForRectangle(
        companion,
        measuredWidth,
        measuredHeight,
      ),
    };
  }

  const currentWidth = Math.min(
    PRIMARY_MAX_WIDTH,
    Math.max(320, measuredWidth - margin * 2),
  );
  const current = readableRectangle(
    measuredWidth / 2,
    currentWidth,
    paperMaxHeight,
    measuredHeight,
    bottomInset,
  );
  const framing: SceneFraming = hasCompanion
    ? { kind: "recessed-companion", rectangles: { current }, gap: 40 }
    : { kind: "single", rectangles: { current } };
  return {
    framing,
    paperWidth: currentWidth,
    companionWidth: hasCompanion
      ? Math.min(COMPANION_MAX_WIDTH, currentWidth)
      : null,
    paperMaxHeight,
    currentPosition: positionForRectangle(
      current,
      measuredWidth,
      measuredHeight,
    ),
    // A recessed occurrence keeps full reading geometry while hidden. Its lip
    // is a separate affordance, never a second source of paper coordinates.
    companionPosition: positionForRectangle(
      current,
      measuredWidth,
      measuredHeight,
    ),
  };
}

export interface SpacePresentationInput {
  readonly width: number;
  readonly height: number;
  readonly current: SurfaceMeasurement;
  readonly companion: SurfaceMeasurement | null;
  readonly view: SpaceView;
}

function finiteDimension(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Lay active papers out on the shared world plane. The measured dimensions
 * are deliberately used in free mode: entering free must not reflow a narrow
 * 358px paper into a 640px paper while the pointer is down.
 */
export function planFreePaperCenters(
  current: SurfaceMeasurement,
  companion: SurfaceMeasurement | null,
): ReadonlyMap<SurfaceInstanceId, WorldPoint> {
  const currentWidth = finiteDimension(current.width, 0);
  const currentCenter = companion
    ? worldPoint(-(finiteDimension(companion.width, 0) + FREE_PAPER_GAP) / 2, 0)
    : worldPoint(0, 0);
  const centers = new Map<SurfaceInstanceId, WorldPoint>([
    [current.surfaceId, currentCenter],
  ]);
  if (companion) {
    centers.set(
      companion.surfaceId,
      worldPoint((currentWidth + FREE_PAPER_GAP) / 2, 0),
    );
  }
  return centers;
}

/** Apply only active manual overrides to one automatic center plan. */
export function resolvePaperCenters(
  automaticCenters: ReadonlyMap<SurfaceInstanceId, WorldPoint>,
  placements: ReadonlyMap<SurfaceInstanceId, PaperPlacement>,
): ReadonlyMap<SurfaceInstanceId, WorldPoint> {
  const resolved = new Map<SurfaceInstanceId, WorldPoint>();
  for (const [surfaceId, automatic] of automaticCenters) {
    const placement = placements.get(surfaceId);
    if (
      placement?.kind === "manual" &&
      Number.isFinite(placement.center.x) &&
      Number.isFinite(placement.center.y)
    ) {
      resolved.set(
        surfaceId,
        worldPoint(placement.center.x, placement.center.y),
      );
    } else {
      resolved.set(surfaceId, worldPoint(automatic.x, automatic.y));
    }
  }
  return resolved;
}

/** Resolve reading/free geometry and manual placements through one plan. */
export function planSpacePresentation(
  input: SpacePresentationInput,
): SpacePresentationPlan {
  const reading = planScenePresentation(
    input.width,
    input.height,
    input.companion !== null,
  );
  const activeIds = [
    input.current.surfaceId,
    ...(input.companion ? [input.companion.surfaceId] : []),
  ];
  const automaticCenters =
    input.view.kind === "free"
      ? planFreePaperCenters(input.current, input.companion)
      : new Map<SurfaceInstanceId, WorldPoint>([
          [
            input.current.surfaceId,
            worldPoint(reading.currentPosition.x, reading.currentPosition.y),
          ],
          ...(input.companion
            ? [
                [
                  input.companion.surfaceId,
                  worldPoint(
                    reading.companionPosition.x,
                    reading.companionPosition.y,
                  ),
                ] as const,
              ]
            : []),
        ]);
  const placements =
    input.view.kind === "free" ? input.view.placements : new Map();
  const centers = resolvePaperCenters(automaticCenters, placements);
  const poses = new Map<SurfaceInstanceId, PaperPose>();
  for (const surfaceId of activeIds) {
    const center = centers.get(surfaceId);
    if (!center) continue;
    poses.set(surfaceId, { x: center.x, y: center.y, scale: 1, opacity: 1 });
  }
  return {
    kind: input.view.kind,
    reading,
    automaticCenters,
    centers,
    poses,
    paperMaxHeight: reading.paperMaxHeight,
    companionWidth:
      input.view.kind === "free"
        ? input.companion?.width ?? null
        : reading.companionWidth,
  };
}

/**
 * Re-anchor the camera when paper centers change at free-entry. Since the
 * transform depends on world minus camera translation, this preserves every
 * point of the selected paper under the same camera pose.
 */
export function compensateCameraForPaperReflow(
  camera: CameraPose,
  previousCenter: WorldPoint,
  nextCenter: WorldPoint,
): CameraPose {
  return {
    ...camera,
    x: camera.x + nextCenter.x - previousCenter.x,
    y: camera.y + nextCenter.y - previousCenter.y,
  };
}

export type PaperMotion<Id extends string = SurfaceInstanceId> = ReadonlyMap<
  Id,
  PaperPose
>;
export type SurfaceLayout = {
  width: number;
  height: number;
  scroll: PaperRect;
  maxScroll: number;
};
export function interpolatePaperMotion<Id extends string>(
  a: PaperMotion<Id>,
  b: PaperMotion<Id>,
  amount: number,
): PaperMotion<Id> {
  return new Map(
    [...b].map(([id, target]) => {
      const start = a.get(id) ?? target;
      return [
        id,
        {
          x: start.x + (target.x - start.x) * amount,
          y: start.y + (target.y - start.y) * amount,
          scale: start.scale + (target.scale - start.scale) * amount,
          opacity: start.opacity + (target.opacity - start.opacity) * amount,
        },
      ];
    }),
  );
}

export function paperRect(
  layout: SurfaceLayout,
  pose: PaperPose,
  viewport: { width: number; height: number },
): PaperRect {
  const left = viewport.width / 2 + pose.x - (layout.width * pose.scale) / 2;
  const top = viewport.height / 2 + pose.y - (layout.height * pose.scale) / 2;
  return {
    left,
    top,
    right: left + layout.width * pose.scale,
    bottom: top + layout.height * pose.scale,
  };
}

/** Align each body's own 42% line after role scaling, before camera projection. */
export function alignPaperReadingLines<Id extends string>(
  poses: PaperMotion<Id>,
  layouts: ReadonlyMap<Id, SurfaceLayout>,
  currentId: Id | undefined,
  paperMaxHeight?: number,
  manualSurfaceIds: ReadonlySet<Id> = new Set(),
): PaperMotion<Id> {
  if (!currentId) return poses;
  const currentPose = poses.get(currentId);
  const currentLayout = layouts.get(currentId);
  if (!currentPose || !currentLayout) return poses;
  const lineOffset = (layout: SurfaceLayout, scale: number) =>
    (-layout.height / 2 +
      layout.scroll.top +
      (layout.scroll.bottom - layout.scroll.top) * 0.42) *
    scale;
  const line = currentPose.y + lineOffset(currentLayout, currentPose.scale);
  let result: Map<Id, PaperPose> | undefined;
  for (const [id, pose] of poses) {
    // A manual world center is a user decision. Range-line alignment can
    // correct an automatic peer, but it must never rewrite that center (or
    // indirectly move the peer through a paired correction pass).
    if (id === currentId || manualSurfaceIds.has(id) || pose.opacity < 1)
      continue;
    const layout = layouts.get(id);
    if (!layout) continue;
    const readingLineY = line - lineOffset(layout, pose.scale);
    // The framing reserves room for folds and controls. Line alignment can use
    // only the spare height of a short paper, never move its header offstage.
    const spareHeight =
      paperMaxHeight === undefined
        ? Infinity
        : Math.max(0, (paperMaxHeight - layout.height * pose.scale) / 2);
    const y = Math.max(
      currentPose.y - spareHeight,
      Math.min(currentPose.y + spareHeight, readingLineY),
    );
    if (Math.abs(y - pose.y) < 0.01) continue;
    result ??= new Map(poses);
    result.set(id, { ...pose, y });
  }
  return result ?? poses;
}

export function rangeScrollTarget(
  top: number,
  bottom: number,
  complete: boolean,
  height: number,
  maxScroll: number,
): number {
  const anchor =
    complete && bottom - top <= height * 0.6 ? (top + bottom) / 2 : top;
  return Math.max(0, Math.min(maxScroll, anchor - height * 0.42));
}

/** Reconcile focus targets after virtual spacer measurements commit.
 * A layout correction preserves the other endpoint's unfinished scroll.
 */
export function reconcileFocusScroll<Id extends string>(
  measured: ReadonlyMap<Id, number>,
  displayed: ReadonlyMap<Id, number>,
  scheduled: ReadonlyMap<Id, number>,
  interrupted: ReadonlySet<Id>,
): ReadonlyMap<Id, number> | undefined {
  let next: Map<Id, number> | undefined;
  for (const [id, target] of measured) {
    if (interrupted.has(id)) continue;
    const previous = scheduled.get(id) ?? displayed.get(id);
    if (previous !== undefined && Math.abs(target - previous) <= 1) continue;
    next ??= new Map(scheduled);
    next.set(id, target);
  }
  if (next) for (const id of interrupted) next.delete(id);
  return next;
}
