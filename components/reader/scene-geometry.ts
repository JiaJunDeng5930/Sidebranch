import type { AnchorInput } from "../../lib/domain/model";
import type { CameraPose } from "../../lib/reader/attention";
import {
  isProjectionSafe,
  worldToScreen,
  type CameraViewport,
  type ScreenPoint,
  type WorldPoint3,
} from "../../lib/reader/camera";
import type { RangeFragment } from "../../lib/reader/range-geometry";
import type {
  AnchorCoverage,
  PassageHandle,
  SurfaceInstanceId,
} from "../../lib/reader/spatial-contract";
import type { SurfaceLayout } from "./scene-presentation";

export type CachedAnchorGeometry = {
  readonly coverage: AnchorCoverage;
  readonly missing: readonly { start: number; end: number }[];
  readonly fragments: readonly RangeFragment[];
};

type Rect = { left: number; top: number; right: number; bottom: number };

/** A proxy can leave the paper safety domain; hide its whole primitive before projection. */
export function projectScenePoints(
  points: readonly WorldPoint3[],
  camera: CameraPose,
  viewport: CameraViewport,
): readonly ScreenPoint[] {
  if (
    points.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
    )
  )
    return [];
  const world = points;
  if (!isProjectionSafe(world, camera)) return [];
  return world.map((point) => worldToScreen(point, camera, viewport));
}

/** Content coordinates survive camera and paper movement, and independent scrolling. */
export class SceneGeometry {
  readonly layouts = new Map<SurfaceInstanceId, SurfaceLayout>();
  readonly edgeRects = new Map<string, Rect>();
  private readonly ranges = new Map<string, CachedAnchorGeometry>();
  private contextKey = "";
  viewportOffset = { left: 0, top: 0 };
  dirty = true;
  rangeMeasurements = 0;

  invalidate(): void {
    this.ranges.clear();
    this.dirty = true;
  }

  setContext(key: string): void {
    if (key === this.contextKey) return;
    this.contextKey = key;
    this.invalidate();
  }

  /** The caller must restore transforms after resolving all needed anchors. */
  measureLayout(
    viewport: DOMRect,
    world: HTMLElement | null,
    surfaces: ReadonlyMap<SurfaceInstanceId, HTMLElement>,
    edges: ReadonlyMap<string, HTMLElement>,
  ): () => void {
    this.viewportOffset = { left: viewport.left, top: viewport.top };
    const worldTransform = world?.style.transform ?? "";
    const transforms = [...surfaces.values()].map(
      (node) => [node, node.style.transform] as const,
    );
    if (world) world.style.transform = "none";
    for (const node of surfaces.values()) node.style.transform = "none";
    for (const [id, node] of surfaces) {
      const scroll = node.querySelector<HTMLElement>("[data-document-scroll]");
      if (!scroll) continue;
      const rect = node.getBoundingClientRect();
      const body = scroll.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      this.layouts.set(id, {
        width: rect.width,
        height: rect.height,
        scroll: {
          left: body.left - rect.left,
          top: body.top - rect.top,
          right: body.right - rect.left,
          bottom: body.bottom - rect.top,
        },
        maxScroll: Math.max(0, scroll.scrollHeight - scroll.clientHeight),
      });
    }
    this.edgeRects.clear();
    for (const [key, node] of edges) {
      const rect = node.getBoundingClientRect();
      this.edgeRects.set(key, {
        left: rect.left - viewport.left,
        top: rect.top - viewport.top,
        right: rect.right - viewport.left,
        bottom: rect.bottom - viewport.top,
      });
    }
    return () => {
      if (world) world.style.transform = worldTransform;
      for (const [node, transform] of transforms)
        node.style.transform = transform;
    };
  }

  resolveAnchor(
    surfaceId: SurfaceInstanceId,
    anchor: AnchorInput,
    handle: PassageHandle | undefined,
    scroll: HTMLElement | null | undefined,
    layoutPass: boolean,
  ): CachedAnchorGeometry | undefined {
    const key = [surfaceId, anchor.revisionId, anchor.start, anchor.end].join(
      ":",
    );
    let cached = this.ranges.get(key);
    // Only a neutral layout pass may read browser ranges. Hidden occurrences
    // retain their previous measurable coordinates until their layout changes.
    if (
      layoutPass &&
      handle &&
      scroll?.clientWidth &&
      (this.dirty || !cached)
    ) {
      const rect = scroll.getBoundingClientRect();
      const resolved = handle.resolveAnchor(anchor);
      this.rangeMeasurements += resolved.ranges.length;
      cached = {
        coverage: resolved.coverage,
        missing: resolved.missing,
        fragments: resolved.ranges.flatMap((range) =>
          Array.from(range.getClientRects())
            .filter((part) => part.width > 0 && part.height > 0)
            .map((part) => ({
              left: part.left - rect.left + scroll.scrollLeft,
              top: part.top - rect.top + scroll.scrollTop,
              right: part.right - rect.left + scroll.scrollLeft,
              bottom: part.bottom - rect.top + scroll.scrollTop,
            })),
        ),
      };
      this.ranges.set(key, cached);
    }
    return cached;
  }
}
