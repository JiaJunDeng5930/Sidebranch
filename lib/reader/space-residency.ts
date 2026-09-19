import type { SpaceSurface, SurfaceInstanceId } from "./spatial-contract";
import type { SpaceView } from "./space-view";
import {
  paperPoint,
  paperToWorld,
  worldToScreen,
  type CameraViewport,
} from "./camera";
import {
  REVISION_CACHE_MAX_CHARS,
  REVISION_CACHE_MAX_ENTRIES,
} from "./session";

/** Proximity governs payload work, never the collection of spatial occurrences. */
export function desiredFullText(
  surfaces: readonly SpaceSurface[],
  view: SpaceView,
  viewport: CameraViewport,
): SurfaceInstanceId[] {
  const width = Math.min(600, Math.max(320, viewport.width - 48));
  const height = Math.max(300, Math.min(780, viewport.height - 150));
  const candidates = surfaces
    .flatMap((surface) => {
      const pose = view.placements.get(surface.surfaceId);
      if (!pose) return [];
      const corners = [
        [0, 0],
        [width, 0],
        [width, height],
        [0, height],
      ].map(([x, y]) =>
        worldToScreen(
          paperToWorld(paperPoint(x, y), pose, width, height),
          view.camera,
          viewport,
        ),
      );
      const xs = corners.map((p) => p.x),
        ys = corners.map((p) => p.y);
      const left = Math.min(...xs),
        right = Math.max(...xs),
        top = Math.min(...ys),
        bottom = Math.max(...ys);
      const focused = view.focus === surface.surfaceId;
      if (
        !focused &&
        (!corners.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) ||
          right < -100 ||
          left > viewport.width + 100 ||
          bottom < -100 ||
          top > viewport.height + 100 ||
          right - left < 180)
      )
        return [];
      return [
        {
          surface,
          focused,
          distance: Math.hypot(
            (left + right) / 2 - viewport.width / 2,
            (top + bottom) / 2 - viewport.height / 2,
          ),
        },
      ];
    })
    .sort(
      (a, b) =>
        Number(b.focused) - Number(a.focused) || a.distance - b.distance,
    );
  let characters = 0;
  const revisions = new Set<string>();
  return candidates.flatMap(({ surface, focused }) => {
    const existing = revisions.has(surface.position.revisionId);
    const size = existing
      ? 0
      : (surface.payloadSize ?? surface.document?.content.length ?? 0);
    if (
      !focused &&
      ((!existing && revisions.size >= REVISION_CACHE_MAX_ENTRIES) ||
        characters + size > REVISION_CACHE_MAX_CHARS)
    )
      return [];
    characters += size;
    revisions.add(surface.position.revisionId);
    return [surface.surfaceId];
  });
}
