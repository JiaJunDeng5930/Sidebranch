import {
  Euler,
  MathUtils,
  Matrix4,
  Object3D,
  PerspectiveCamera,
  Plane,
  Quaternion as ThreeQuaternion,
  Raycaster,
  Vector2,
  Vector3,
} from "three";

declare const worldBrand: unique symbol;
declare const paperBrand: unique symbol;
declare const screenBrand: unique symbol;
export type WorldPoint3 = Readonly<{
  x: number;
  y: number;
  z: number;
  [worldBrand]: true;
}>;
export type WorldPoint = WorldPoint3;
export type PaperPoint = Readonly<{ x: number; y: number; [paperBrand]: true }>;
export type ScreenPoint = Readonly<{
  x: number;
  y: number;
  [screenBrand]: true;
}>;
export type Quaternion = readonly [number, number, number, number];
export type PaperPose = Readonly<{
  position: WorldPoint3;
  orientation: Quaternion;
}>;
export type CameraPose = Readonly<{
  position: WorldPoint3;
  orientation: Quaternion;
  target: WorldPoint3;
  perspective: number;
  near: number;
}>;
export type CameraViewport = Readonly<{ width: number; height: number }>;
export const worldPoint = (x: number, y: number, z = 0): WorldPoint3 => {
  if (![x, y, z].every(Number.isFinite))
    throw new RangeError("World coordinates must be finite");
  return { x, y, z } as WorldPoint3;
};
export const paperPoint = (x: number, y: number): PaperPoint =>
  ({ x, y }) as PaperPoint;
export const screenPoint = (x: number, y: number): ScreenPoint =>
  ({ x, y }) as ScreenPoint;

// Domain snapshots use y down. Three owns all mutable geometry in y-up space.
export const toThreeWorld = (p: WorldPoint3): Vector3 =>
  new Vector3(p.x, -p.y, p.z);
export const fromThreeWorld = (p: Vector3): WorldPoint3 =>
  worldPoint(p.x, -p.y, p.z);
export const toThreeQuaternion = (q: Quaternion): ThreeQuaternion =>
  new ThreeQuaternion(-q[0], q[1], -q[2], q[3]);
export const fromThreeQuaternion = (q: ThreeQuaternion): Quaternion => [
  -q.x,
  q.y,
  -q.z,
  q.w,
];
export const CAMERA_HOME: CameraPose = {
  position: worldPoint(0, 0, 1480),
  orientation: [0, 0, 0, 1],
  target: worldPoint(0, 0, 0),
  perspective: 1480,
  near: 24,
};
export const CAMERA_MIN_DISTANCE = 160;
export const CAMERA_MAX_DISTANCE = 20000;
export function orientation(x: number, y: number, z = 0): Quaternion {
  // Persisted orientation tuples use intrinsic ZYX Euler angles.
  const q = new ThreeQuaternion().setFromEuler(
    new Euler(
      MathUtils.degToRad(x),
      MathUtils.degToRad(y),
      MathUtils.degToRad(z),
      "ZYX",
    ),
  );
  return [q.x, q.y, q.z, q.w];
}
export function normalizeCameraPose(
  pose: CameraPose,
  fallback = CAMERA_HOME,
): CameraPose {
  const finite = (p: WorldPoint3) =>
    p && [p.x, p.y, p.z].every(Number.isFinite);
  return {
    position: finite(pose.position) ? pose.position : fallback.position,
    target: finite(pose.target) ? pose.target : fallback.target,
    orientation:
      pose.orientation?.every(Number.isFinite) &&
      Math.hypot(...pose.orientation) > 0
        ? fromThreeQuaternion(toThreeQuaternion(pose.orientation).normalize())
        : fallback.orientation,
    perspective:
      Number.isFinite(pose.perspective) && pose.perspective > 0
        ? pose.perspective
        : fallback.perspective,
    near:
      Number.isFinite(pose.near) && pose.near > 0 ? pose.near : fallback.near,
  };
}
export function setPaperObjectTransform(
  object: Object3D,
  pose: PaperPose,
): void {
  object.position.copy(toThreeWorld(pose.position));
  object.quaternion.copy(toThreeQuaternion(pose.orientation));
  object.updateMatrixWorld(true);
}
export function synchronizePerspectiveCamera(
  camera: PerspectiveCamera,
  pose: CameraPose,
  viewport: CameraViewport,
): void {
  camera.fov = MathUtils.radToDeg(
    2 * Math.atan(Math.max(1, viewport.height) / (2 * pose.perspective)),
  );
  camera.aspect = Math.max(1, viewport.width) / Math.max(1, viewport.height);
  camera.near = pose.near;
  camera.far = 100000;
  camera.position.copy(toThreeWorld(pose.position));
  camera.quaternion.copy(toThreeQuaternion(pose.orientation));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}
export function createPerspectiveCamera(
  pose: CameraPose,
  viewport: CameraViewport,
): PerspectiveCamera {
  const camera = new PerspectiveCamera();
  synchronizePerspectiveCamera(camera, pose, viewport);
  return camera;
}
export function snapshotCameraPose(
  camera: PerspectiveCamera,
  target: Vector3,
  reference: CameraPose,
): CameraPose {
  return {
    ...reference,
    position: fromThreeWorld(camera.position),
    orientation: fromThreeQuaternion(camera.quaternion),
    target: fromThreeWorld(target),
  };
}
export function modelMatrix(pose: PaperPose): Matrix4 {
  return new Matrix4().compose(
    toThreeWorld(pose.position),
    toThreeQuaternion(pose.orientation),
    new Vector3(1, 1, 1),
  );
}
export function viewMatrix(camera: CameraPose): Matrix4 {
  return modelMatrix(camera).invert();
}
export function paperToWorld(
  local: PaperPoint,
  pose: PaperPose,
  width: number,
  height: number,
): WorldPoint3 {
  return fromThreeWorld(
    new Vector3(local.x - width / 2, height / 2 - local.y, 0).applyMatrix4(
      modelMatrix(pose),
    ),
  );
}
export function worldToScreen(
  world: WorldPoint3,
  pose: CameraPose,
  viewport: CameraViewport,
): ScreenPoint {
  const camera = createPerspectiveCamera(pose, viewport);
  const p = toThreeWorld(world);
  if (p.clone().applyMatrix4(camera.matrixWorldInverse).z > -camera.near)
    return screenPoint(NaN, NaN);
  p.project(camera);
  return screenPoint(
    ((p.x + 1) * viewport.width) / 2,
    ((1 - p.y) * viewport.height) / 2,
  );
}
export function isProjectionSafe(
  points: readonly WorldPoint3[],
  camera: CameraPose,
): boolean {
  const view = viewMatrix(camera);
  return points.every(
    (p) => toThreeWorld(p).applyMatrix4(view).z <= -camera.near,
  );
}
export function cameraAxis(
  camera: Pick<CameraPose, "orientation">,
  axis: readonly [number, number, number],
): WorldPoint3 {
  return fromThreeWorld(
    new Vector3(axis[0], -axis[1], axis[2]).applyQuaternion(
      toThreeQuaternion(camera.orientation),
    ),
  );
}
export function screenRaycaster(
  screen: ScreenPoint,
  camera: PerspectiveCamera,
  viewport: CameraViewport,
): Raycaster {
  camera.updateMatrixWorld(true);
  const raycaster = new Raycaster();
  raycaster.setFromCamera(
    new Vector2(
      (screen.x / viewport.width) * 2 - 1,
      1 - (screen.y / viewport.height) * 2,
    ),
    camera,
  );
  raycaster.near = camera.near;
  raycaster.far = camera.far;
  return raycaster;
}
export function screenRay(
  screen: ScreenPoint,
  pose: CameraPose,
  viewport: CameraViewport,
): { origin: WorldPoint3; direction: WorldPoint3 } {
  const ray = screenRaycaster(
    screen,
    createPerspectiveCamera(pose, viewport),
    viewport,
  ).ray;
  return {
    origin: fromThreeWorld(ray.origin),
    direction: fromThreeWorld(ray.direction),
  };
}
export function screenToPlane(
  screen: ScreenPoint,
  pose: CameraPose,
  viewport: CameraViewport,
  origin: WorldPoint3,
  normal = cameraAxis(pose, [0, 0, 1]),
): WorldPoint3 | null {
  const ray = screenRaycaster(
    screen,
    createPerspectiveCamera(pose, viewport),
    viewport,
  ).ray;
  const plane = new Plane().setFromNormalAndCoplanarPoint(
    toThreeWorld(normal).normalize(),
    toThreeWorld(origin),
  );
  const hit = ray.intersectPlane(plane, new Vector3());
  return hit ? fromThreeWorld(hit) : null;
}
export function focusCamera(camera: CameraPose, pose: PaperPose): CameraPose {
  const position = new Vector3(0, 0, camera.perspective)
    .applyQuaternion(toThreeQuaternion(pose.orientation))
    .add(toThreeWorld(pose.position));
  return {
    ...camera,
    target: pose.position,
    orientation: pose.orientation,
    position: fromThreeWorld(position),
  };
}
export function fitCameraToPaper(
  camera: CameraPose,
  width: number,
  height: number,
  viewport: CameraViewport,
): CameraPose {
  const distance =
    camera.perspective *
    Math.max(
      width / Math.max(1, viewport.width - 80),
      height / Math.max(1, viewport.height - 96),
    );
  return {
    ...camera,
    position: fromThreeWorld(
      new Vector3(0, 0, Math.max(CAMERA_MIN_DISTANCE, distance))
        .applyQuaternion(toThreeQuaternion(camera.orientation))
        .add(toThreeWorld(camera.target)),
    ),
  };
}
