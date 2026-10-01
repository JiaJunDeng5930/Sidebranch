import { Quaternion } from "three";
import {
  worldPoint,
  type PaperPose,
  type CameraPose,
  type Quaternion as Orientation,
} from "../../lib/reader/camera";
import type { PaperGeometry } from "../../lib/reader/paper-geometry";
import type { SpaceView } from "../../lib/reader/space-view";
import type { SurfaceInstanceId } from "../../lib/reader/spatial-contract";

/** Camera, paper transforms and dimensions share one clock and one displayed state. */
export function interpolateReadingFrame(
  from: SpaceView,
  to: SpaceView,
  fromGeometry: ReadonlyMap<SurfaceInstanceId, PaperGeometry>,
  toGeometry: ReadonlyMap<SurfaceInstanceId, PaperGeometry>,
  progress: number,
): {
  view: SpaceView;
  geometry: ReadonlyMap<SurfaceInstanceId, PaperGeometry>;
} {
  const t = progress * progress * (3 - 2 * progress);
  const number = (a: number, b: number) => a + (b - a) * t;
  const point = (a: PaperPose["position"], b: PaperPose["position"]) =>
    worldPoint(number(a.x, b.x), number(a.y, b.y), number(a.z, b.z));
  const orientation = (a: Orientation, b: Orientation): Orientation => {
    const q = new Quaternion(...a).slerp(new Quaternion(...b), t);
    return [q.x, q.y, q.z, q.w];
  };
  const placements = new Map(to.placements);
  for (const [id, end] of to.placements) {
    const start = from.placements.get(id) ?? end;
    placements.set(id, {
      position: point(start.position, end.position),
      orientation: orientation(start.orientation, end.orientation),
    });
  }
  const camera: CameraPose = {
    ...to.camera,
    position: point(from.camera.position, to.camera.position),
    target: point(from.camera.target, to.camera.target),
    orientation: orientation(from.camera.orientation, to.camera.orientation),
    perspective: number(from.camera.perspective, to.camera.perspective),
    near: number(from.camera.near, to.camera.near),
  };
  const geometry = new Map<SurfaceInstanceId, PaperGeometry>();
  for (const [id, end] of toGeometry) {
    const start = fromGeometry.get(id) ?? end;
    geometry.set(id, {
      width: number(start.width, end.width),
      height: number(start.height, end.height),
    });
  }
  return { view: { ...to, camera, placements }, geometry };
}
