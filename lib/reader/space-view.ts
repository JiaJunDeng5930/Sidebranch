import {
  CAMERA_HOME,
  normalizeCameraPose,
  type CameraPose,
  type PaperPose,
  type WorldPoint3,
} from "./camera";
import type { SurfaceInstanceId } from "./spatial-contract";
export type PaperPlacement = PaperPose;
export interface SpaceView {
  readonly camera: CameraPose;
  readonly placements: ReadonlyMap<SurfaceInstanceId, PaperPose>;
  readonly focus: SurfaceInstanceId | null;
}
export function createSpaceView(
  camera: CameraPose = CAMERA_HOME,
  placements: ReadonlyMap<SurfaceInstanceId, PaperPose> = new Map(),
  focus: SurfaceInstanceId | null = null,
): SpaceView {
  return {
    camera: normalizeCameraPose(camera),
    placements: new Map(placements),
    focus,
  };
}
export function manualPlacement(position: WorldPoint3): PaperPose {
  return { position, orientation: [0, 0, 0, 1] };
}
export function normalizePaperPlacements(
  placements: ReadonlyMap<SurfaceInstanceId, PaperPose>,
): ReadonlyMap<SurfaceInstanceId, PaperPose> {
  return new Map(
    [...placements].filter(([, p]) =>
      [p.position.x, p.position.y, p.position.z, ...p.orientation].every(
        Number.isFinite,
      ),
    ),
  );
}
export function normalizeSpaceView(
  view: SpaceView,
  _ids: readonly SurfaceInstanceId[] = [],
  fallback = CAMERA_HOME,
): SpaceView {
  void _ids;
  return {
    ...view,
    camera: normalizeCameraPose(view.camera, fallback),
    placements: normalizePaperPlacements(view.placements),
  };
}
export const copySpaceView = normalizeSpaceView;
export function sameSpaceView(a: SpaceView, b: SpaceView): boolean {
  return (
    JSON.stringify({ ...a, placements: [...a.placements] }) ===
    JSON.stringify({ ...b, placements: [...b.placements] })
  );
}
export function cameraForView(view: SpaceView): CameraPose {
  return view.camera;
}
