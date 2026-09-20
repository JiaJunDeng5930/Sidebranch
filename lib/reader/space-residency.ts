import type { SpaceSurface, SurfaceInstanceId } from "./spatial-contract";
import type { SpaceView } from "./space-view";
import {
  createPerspectiveCamera,
  toThreeWorld,
  paperPoint,
  paperToWorld,
  type CameraViewport,
} from "./camera";
import { paperGeometryForViewport } from "./paper-geometry";
import {
  REVISION_CACHE_MAX_CHARS,
  REVISION_CACHE_MAX_ENTRIES,
} from "./session";

/** Proximity governs payload work, never the collection of spatial occurrences. */
export function desiredFullText(
  surfaces: readonly SpaceSurface[],
  view: SpaceView,
  viewport: CameraViewport,
  residency: Readonly<{
    resident?: ReadonlySet<SurfaceInstanceId>;
    pinned?: ReadonlySet<SurfaceInstanceId>;
  }> = {},
): SurfaceInstanceId[] {
  const { width, height } = paperGeometryForViewport(viewport);
  const camera = createPerspectiveCamera(view.camera, viewport);
  const candidates = surfaces
    .flatMap((surface) => {
      const pose = view.placements.get(surface.surfaceId);
      if (!pose) return [];
      const corners = [
        [0, 0],
        [width, 0],
        [width, height],
        [0, height],
      ].map(([x, y]) => {
        const world = toThreeWorld(
          paperToWorld(paperPoint(x, y), pose, width, height),
        );
        if (
          world.clone().applyMatrix4(camera.matrixWorldInverse).z > -camera.near
        )
          return { x: NaN, y: NaN };
        const projected = world.project(camera);
        return {
          x: ((projected.x + 1) * viewport.width) / 2,
          y: ((1 - projected.y) * viewport.height) / 2,
        };
      });
      const xs = corners.map((p) => p.x),
        ys = corners.map((p) => p.y);
      const left = Math.min(...xs),
        right = Math.max(...xs),
        top = Math.min(...ys),
        bottom = Math.max(...ys);
      const focused =
        view.focus === surface.surfaceId ||
        residency.pinned?.has(surface.surfaceId) === true;
      const resident = residency.resident?.has(surface.surfaceId) === true;
      // Keep hydrated text through a wider boundary than admission, so small
      // camera changes cannot repeatedly unmount a readable passage.
      const margin = resident ? 240 : 100;
      const minimumWidth = resident ? 135 : 180;
      if (
        !focused &&
        (!corners.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) ||
          right < -margin ||
          left > viewport.width + margin ||
          bottom < -margin ||
          top > viewport.height + margin ||
          right - left < minimumWidth)
      )
        return [];
      return [
        {
          surface,
          focused,
          resident,
          distance: Math.hypot(
            (left + right) / 2 - viewport.width / 2,
            (top + bottom) / 2 - viewport.height / 2,
          ),
        },
      ];
    })
    .sort(
      (a, b) =>
        Number(b.focused) - Number(a.focused) ||
        Number(b.resident) - Number(a.resident) ||
        a.distance - b.distance,
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
