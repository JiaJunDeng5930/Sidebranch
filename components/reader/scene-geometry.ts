import type { AnchorInput } from "../../lib/domain/model";
import { paperPoint } from "../../lib/reader/camera";
import { PAPER_GEOMETRY } from "../../lib/reader/paper-geometry";
import {
  passageMouthInterval,
  type PassageMouth,
  type PassageMouthReason,
} from "../../lib/reader/passage-mouth";
import type { RangeEdge, RangeFragment } from "../../lib/reader/range-geometry";
import type {
  AnchorCoverage,
  PassageHandle,
  SurfaceInstanceId,
} from "../../lib/reader/spatial-contract";
import { anchorKey } from "../../lib/reader/spatial-contract";
import type { SurfaceLayout } from "./scene-presentation";

export type CachedAnchorGeometry = {
  readonly coverage: AnchorCoverage;
  readonly missing: readonly { start: number; end: number }[];
  readonly fragments: readonly RangeFragment[];
};

/** Content coordinates survive camera and paper movement, and independent scrolling. */
export class SceneGeometry {
  readonly layouts = new Map<SurfaceInstanceId, SurfaceLayout>();
  private readonly ranges = new Map<
    SurfaceInstanceId,
    Map<string, CachedAnchorGeometry>
  >();
  private readonly surfaceContexts = new Map<SurfaceInstanceId, string>();
  dirty = true;
  rangeMeasurements = 0;

  invalidate(id?: SurfaceInstanceId): void {
    if (id) this.ranges.delete(id);
    else this.ranges.clear();
    this.dirty = true;
  }

  setSurfaceContext(id: SurfaceInstanceId, key: string): void {
    if (this.surfaceContexts.get(id) === key) return;
    this.surfaceContexts.set(id, key);
    this.invalidate(id);
  }

  hasAnchor(id: SurfaceInstanceId, anchor: AnchorInput): boolean {
    return this.ranges.get(id)?.has(anchorKey(anchor)) ?? false;
  }

  /** The caller must restore transforms after resolving all needed anchors. */
  measureLayout(
    world: HTMLElement | null,
    surfaces: ReadonlyMap<SurfaceInstanceId, HTMLElement>,
  ): () => void {
    const worldTransform = world?.style.transform ?? "";
    const transforms = [...surfaces.values()].map(
      (node) => [node, node.style.transform, node.style.display] as const,
    );
    if (world) world.style.transform = "none";
    for (const node of surfaces.values()) {
      node.style.transform = "none";
      node.style.display = "block";
    }
    for (const [id, node] of surfaces) {
      const scroll = node.querySelector<HTMLElement>("[data-document-scroll]");
      const rect = node.getBoundingClientRect();
      const body = scroll?.getBoundingClientRect() ?? rect;
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
        maxScroll: scroll
          ? Math.max(0, scroll.scrollHeight - scroll.clientHeight)
          : 0,
      });
    }
    return () => {
      if (world) world.style.transform = worldTransform;
      for (const [node, transform, display] of transforms) {
        node.style.transform = transform;
        node.style.display = display;
      }
    };
  }

  resolveAnchor(
    surfaceId: SurfaceInstanceId,
    anchor: AnchorInput,
    handle: PassageHandle | undefined,
    scroll: HTMLElement | null | undefined,
    layoutPass: boolean,
  ): CachedAnchorGeometry | undefined {
    const key = anchorKey(anchor);
    let cached = this.ranges.get(surfaceId)?.get(key);
    // Only a neutral layout pass may read browser ranges. Hidden occurrences
    // retain their previous measurable coordinates until their layout changes.
    if (layoutPass && handle && scroll?.clientWidth && !cached) {
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
      let occurrence = this.ranges.get(surfaceId);
      if (!occurrence) this.ranges.set(surfaceId, (occurrence = new Map()));
      occurrence.set(key, cached);
    }
    return cached;
  }
}

/** Clip every measured fragment in content coordinates before placing it on paper. */
export function visibleAnchorFragments(
  geometry: CachedAnchorGeometry,
  layout: SurfaceLayout,
  scroll: Pick<
    HTMLElement,
    "scrollLeft" | "scrollTop" | "clientWidth" | "clientHeight"
  >,
): RangeFragment[] {
  return geometry.fragments.flatMap((part) => {
    const left = Math.max(0, part.left - scroll.scrollLeft);
    const right = Math.min(scroll.clientWidth, part.right - scroll.scrollLeft);
    const top = Math.max(0, part.top - scroll.scrollTop);
    const bottom = Math.min(
      scroll.clientHeight,
      part.bottom - scroll.scrollTop,
    );
    return right > left && bottom > top
      ? [
          {
            left: left + layout.scroll.left,
            right: right + layout.scroll.left,
            top: top + layout.scroll.top,
            bottom: bottom + layout.scroll.top,
          },
        ]
      : [];
  });
}

export type ResolvePassageMouthInput = Readonly<{
  surfaceId: SurfaceInstanceId;
  anchor: AnchorInput;
  edge: RangeEdge;
  layout?: SurfaceLayout;
  geometry?: CachedAnchorGeometry;
  scroll?: Pick<
    HTMLElement,
    "scrollLeft" | "scrollTop" | "clientWidth" | "clientHeight"
  > | null;
  availability?: "ready" | "unloaded" | "unmounted" | "loading" | "error";
}>;

/** Resolve presentation for one source anchor without changing native ranges. */
export function resolvePassageMouth({
  surfaceId,
  anchor,
  edge,
  layout = {
    ...PAPER_GEOMETRY,
    maxScroll: 0,
    scroll: {
      left: 0,
      top: 0,
      right: PAPER_GEOMETRY.width,
      bottom: PAPER_GEOMETRY.height,
    },
  },
  geometry,
  scroll,
  availability = "ready",
}: ResolvePassageMouthInput): PassageMouth {
  const identity = { surfaceId, anchor };
  const proxy = (reason: PassageMouthReason): PassageMouth => {
    const horizontal = edge === "top" || edge === "bottom";
    let x =
      edge === "left"
        ? 4
        : edge === "right"
          ? layout.width - 4
          : layout.width / 2;
    let y =
      edge === "top"
        ? 4
        : edge === "bottom"
          ? layout.height - 4
          : layout.height / 2;
    // A fully scrolled-away anchor still has a visible directional endpoint.
    if (reason === "offscreen" && geometry?.fragments.length && scroll) {
      const before = geometry.fragments.every(
        (r) => r.bottom <= scroll.scrollTop,
      );
      const after = geometry.fragments.every(
        (r) => r.top >= scroll.scrollTop + scroll.clientHeight,
      );
      if (!horizontal && (before || after))
        y = before ? layout.scroll.top + 9 : layout.scroll.bottom - 9;
      const left = geometry.fragments.every(
        (r) => r.right <= scroll.scrollLeft,
      );
      const right = geometry.fragments.every(
        (r) => r.left >= scroll.scrollLeft + scroll.clientWidth,
      );
      if (horizontal && (left || right))
        x = left ? layout.scroll.left + 9 : layout.scroll.right - 9;
    }
    return {
      ...identity,
      start: horizontal ? paperPoint(x - 9, y) : paperPoint(x, y - 9),
      end: horizontal ? paperPoint(x + 9, y) : paperPoint(x, y + 9),
      precision: "proxy",
      reason,
    };
  };
  if (availability !== "ready")
    return proxy(availability === "unloaded" ? "unmounted" : availability);
  if (!geometry) return proxy("unmounted");
  if (geometry.coverage === "unmounted" || geometry.coverage === "unmapped")
    return proxy(geometry.coverage);
  if (!scroll) return proxy("unmounted");
  const interval = passageMouthInterval(
    visibleAnchorFragments(geometry, layout, scroll),
    edge,
  );
  if (!interval) return proxy("offscreen");
  if (geometry.coverage === "partial")
    return {
      ...identity,
      ...interval,
      precision: "partial",
      reason: "unmapped",
    };
  const clipped = geometry.fragments.some(
    (r) =>
      r.left < scroll.scrollLeft ||
      r.right > scroll.scrollLeft + scroll.clientWidth ||
      r.top < scroll.scrollTop ||
      r.bottom > scroll.scrollTop + scroll.clientHeight,
  );
  return clipped
    ? { ...identity, ...interval, precision: "partial", reason: "offscreen" }
    : { ...identity, ...interval, precision: "exact" };
}
