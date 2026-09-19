import type { AnchorInput } from "../../lib/domain/model";
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
    return this.ranges.get(id)?.has(this.anchorKey(anchor)) ?? false;
  }

  private anchorKey(anchor: AnchorInput): string {
    return [anchor.revisionId, anchor.start, anchor.end].join(":");
  }

  /** The caller must restore transforms after resolving all needed anchors. */
  measureLayout(
    world: HTMLElement | null,
    surfaces: ReadonlyMap<SurfaceInstanceId, HTMLElement>,
  ): () => void {
    const worldTransform = world?.style.transform ?? "";
    const transforms = [...surfaces.values()].map(
      (node) => [node, node.style.transform] as const,
    );
    if (world) world.style.transform = "none";
    for (const node of surfaces.values()) node.style.transform = "none";
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
    const key = this.anchorKey(anchor);
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
