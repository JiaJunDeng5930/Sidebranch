import type { ConnectionId } from "../domain/model";
import { defaultPaperPose } from "./attention";
import { worldPoint, type CameraViewport } from "./camera";
import { paperGeometryForViewport, type PaperGeometry } from "./paper-geometry";
import type { SpaceView } from "./space-view";
import type { SurfaceInstanceId } from "./spatial-contract";

export interface ReadingIntent {
  readonly primary: SurfaceInstanceId | null;
  readonly companion: SurfaceInstanceId | null;
  readonly connectionId: ConnectionId | null;
}

export type ReadingRole = "primary" | "companion" | "context";
export interface ReadingArrangement {
  readonly view: SpaceView;
  readonly geometry: ReadonlyMap<SurfaceInstanceId, PaperGeometry>;
  readonly roles: ReadonlyMap<SurfaceInstanceId, ReadingRole>;
  readonly paired: "beside" | "stacked" | "single" | "collapsed";
  readonly scale: number;
  readonly readableSurfaceIds: readonly SurfaceInstanceId[];
}

export interface ReadingArrangementInput {
  readonly intent: ReadingIntent;
  readonly view: SpaceView;
  readonly viewport: CameraViewport;
  readonly surfaceIds: readonly SurfaceInstanceId[];
  /** Most recent prior primary first. */
  readonly trail: readonly SurfaceInstanceId[];
  readonly bodyFontSize: number;
}

/** Derive temporary reading poses in CSS pixels without changing saved placements. */
export function arrangeReading({
  intent,
  view,
  viewport,
  surfaceIds,
  trail,
  bodyFontSize,
}: ReadingArrangementInput): ReadingArrangement {
  const geometry = new Map<SurfaceInstanceId, PaperGeometry>();
  const roles = new Map<SurfaceInstanceId, ReadingRole>();
  for (const id of surfaceIds) {
    geometry.set(
      id,
      intent.primary
        ? { width: 600, height: 100 }
        : paperGeometryForViewport(viewport),
    );
    roles.set(id, "context");
  }
  if (!intent.primary)
    return {
      view,
      geometry,
      roles,
      paired: "single",
      scale:
        view.camera.perspective /
        Math.hypot(
          view.camera.position.x - view.camera.target.x,
          view.camera.position.y - view.camera.target.y,
          view.camera.position.z - view.camera.target.z,
        ),
      readableSurfaceIds: [],
    };

  const ids = new Set(surfaceIds);
  const prior =
    viewport.height < 300
      ? []
      : [...new Set(trail)]
          .filter(
            (id) =>
              ids.has(id) && id !== intent.primary && id !== intent.companion,
          )
          .slice(0, 3);
  const top = prior.length ? 76 : 20;
  const availableWidth = Math.max(1, viewport.width - 32);
  const availableHeight = Math.max(1, viewport.height - top - 16);
  const fontSize =
    Number.isFinite(bodyFontSize) && bodyFontSize > 0 ? bodyFontSize : 24;
  const desiredScale = 16.5 / fontSize;
  const beside =
    !!intent.companion && availableWidth >= 1200 * desiredScale + 32;
  const collapsed = !!intent.companion && availableHeight < 180;
  const paired: ReadingArrangement["paired"] = !intent.companion
    ? "single"
    : collapsed
      ? "collapsed"
      : beside
        ? "beside"
        : "stacked";
  const scale =
    paired === "beside"
      ? Math.min(1, availableWidth / (1200 + 32 / desiredScale))
      : Math.max(desiredScale, Math.min(1, availableWidth / 600));
  const width =
    paired === "beside" ? 600 : Math.min(600, availableWidth / scale);
  const placements = new Map(view.placements);
  for (const [index, id] of surfaceIds.entries())
    if (!placements.has(id)) placements.set(id, defaultPaperPose(index));
  const place = (
    id: SurfaceInstanceId,
    x: number,
    y: number,
    paperWidth: number,
    screenHeight: number,
    z = 0,
  ) => {
    geometry.set(id, {
      width: Math.max(1, paperWidth),
      height: Math.max(1, screenHeight / scale),
    });
    placements.set(id, {
      position: worldPoint(
        (x - viewport.width / 2) / scale,
        (y - viewport.height / 2) / scale,
        z,
      ),
      orientation: [0, 0, 0, 1],
    });
  };
  roles.set(intent.primary, "primary");
  if (intent.companion)
    roles.set(intent.companion, collapsed ? "context" : "companion");

  if (paired === "beside" && intent.companion) {
    const centerY = top + availableHeight / 2;
    const offset = (600 * scale + 32) / 2;
    place(
      intent.companion,
      viewport.width / 2 - offset,
      centerY,
      600,
      Math.min(availableHeight * 0.76, 620 * scale),
    );
    place(
      intent.primary,
      viewport.width / 2 + offset,
      centerY,
      600,
      Math.min(availableHeight, 780 * scale),
    );
  } else {
    const companionHeight = intent.companion
      ? collapsed
        ? Math.min(28, Math.max(1, availableHeight - 11))
        : Math.min(160, availableHeight * 0.28)
      : 0;
    // A finite viewport can expose only one body; keep a recognizable other end.
    const gap = intent.companion
      ? Math.max(
          0,
          Math.min(collapsed ? 10 : 14, availableHeight - companionHeight - 1),
        )
      : 0;
    const primaryHeight = Math.max(
      1,
      Math.min(availableHeight - companionHeight - gap, 1100 * scale),
    );
    const contentHeight = companionHeight + gap + primaryHeight;
    const contentTop = top + (availableHeight - contentHeight) / 2;
    if (intent.companion)
      place(
        intent.companion,
        viewport.width / 2,
        contentTop + companionHeight / 2,
        width,
        companionHeight,
      );
    place(
      intent.primary,
      viewport.width / 2,
      contentTop + companionHeight + gap + primaryHeight / 2,
      width,
      primaryHeight,
    );
  }

  for (const [index, id] of prior.entries()) {
    const slotWidth = availableWidth / prior.length;
    const trailWidth = Math.max(1, Math.min(240, slotWidth - 12));
    place(id, 16 + slotWidth * (index + 0.5), 40, trailWidth / scale, 48, -20);
  }
  return {
    view: {
      ...view,
      focus: intent.primary,
      placements,
      camera: {
        ...view.camera,
        position: worldPoint(0, 0, view.camera.perspective / scale),
        target: worldPoint(0, 0, 0),
        orientation: [0, 0, 0, 1],
      },
    },
    geometry,
    roles,
    paired,
    scale,
    readableSurfaceIds:
      intent.companion && !collapsed
        ? [intent.primary, intent.companion]
        : [intent.primary],
  };
}
