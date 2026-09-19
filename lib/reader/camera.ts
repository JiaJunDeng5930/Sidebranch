import { mat4, quat, vec3, vec4 } from "gl-matrix";

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
const tuple = (v: quat): Quaternion => [v[0], v[1], v[2], v[3]];
const vector = (p: WorldPoint3): vec3 => vec3.fromValues(p.x, p.y, p.z);
const point = (v: vec3): WorldPoint3 => worldPoint(v[0], v[1], v[2]);
export const CAMERA_HOME: CameraPose = {
  position: worldPoint(0, 0, 1480),
  orientation: [0, 0, 0, 1],
  target: worldPoint(0, 0, 0),
  perspective: 1480,
  near: 24,
};
export function orientation(x: number, y: number, z = 0): Quaternion {
  return tuple(quat.fromEuler(quat.create(), x, y, z));
}
export function normalizeCameraPose(
  pose: CameraPose,
  fallback = CAMERA_HOME,
): CameraPose {
  const finite = (p: WorldPoint3) =>
    p && [p.x, p.y, p.z].every(Number.isFinite);
  const rotation =
    pose.orientation?.every(Number.isFinite) &&
    Math.hypot(...pose.orientation) > 0
      ? tuple(quat.normalize(quat.create(), pose.orientation))
      : fallback.orientation;
  return {
    position: finite(pose.position) ? pose.position : fallback.position,
    target: finite(pose.target) ? pose.target : fallback.target,
    orientation: rotation,
    perspective:
      Number.isFinite(pose.perspective) && pose.perspective > 0
        ? pose.perspective
        : fallback.perspective,
    near:
      Number.isFinite(pose.near) && pose.near > 0 ? pose.near : fallback.near,
  };
}
export function modelMatrix(pose: PaperPose): mat4 {
  return mat4.fromRotationTranslation(
    mat4.create(),
    pose.orientation,
    vector(pose.position),
  );
}
export function viewMatrix(camera: CameraPose): mat4 {
  return mat4.invert(
    mat4.create(),
    mat4.fromRotationTranslation(
      mat4.create(),
      camera.orientation,
      vector(camera.position),
    ),
  )!;
}
// CSS uses x right, y down, z toward the observer. A +perspective translation
// puts the pinhole at CSS's perspective origin; M and V otherwise stay literal.
export function cameraTransform(camera: CameraPose): string {
  const matrix = mat4.multiply(
    mat4.create(),
    mat4.fromTranslation(mat4.create(), [0, 0, camera.perspective]),
    viewMatrix(camera),
  );
  return matrixCss(matrix);
}
export function matrixCss(matrix: mat4): string {
  return `matrix3d(${Array.from(matrix).join(",")})`;
}
export function paperTransform(
  pose: PaperPose,
  width: number,
  height: number,
): string {
  return matrixCss(
    mat4.translate(modelMatrix(pose), modelMatrix(pose), [
      -width / 2,
      -height / 2,
      0,
    ]),
  );
}
export function paperToWorld(
  local: PaperPoint,
  pose: PaperPose,
  width: number,
  height: number,
): WorldPoint3 {
  return point(
    vec3.transformMat4(
      vec3.create(),
      [local.x - width / 2, local.y - height / 2, 0],
      modelMatrix(pose),
    ),
  );
}
export function projectionMatrix(
  camera: CameraPose,
  viewport: CameraViewport,
): mat4 {
  const p = mat4.create();
  for (let i = 0; i < 16; i++) p[i] = 0;
  p[0] = (2 * camera.perspective) / viewport.width;
  p[5] = (-2 * camera.perspective) / viewport.height;
  p[10] = -1;
  p[11] = -1;
  p[14] = -2 * camera.near;
  return p;
}
export function worldToScreen(
  world: WorldPoint3,
  camera: CameraPose,
  viewport: CameraViewport,
): ScreenPoint {
  const value = vec4.transformMat4(
    vec4.create(),
    [world.x, world.y, world.z, 1],
    mat4.multiply(
      mat4.create(),
      projectionMatrix(camera, viewport),
      viewMatrix(camera),
    ),
  );
  if (value[3] < camera.near) return screenPoint(NaN, NaN);
  return screenPoint(
    ((value[0] / value[3] + 1) * viewport.width) / 2,
    ((1 - value[1] / value[3]) * viewport.height) / 2,
  );
}
export function isProjectionSafe(
  points: readonly WorldPoint3[],
  camera: CameraPose,
): boolean {
  const view = viewMatrix(camera);
  return points.every(
    (p) =>
      vec3.transformMat4(vec3.create(), vector(p), view)[2] <= -camera.near,
  );
}
export function cameraAxis(
  camera: CameraPose,
  axis: readonly [number, number, number],
): WorldPoint3 {
  return point(vec3.transformQuat(vec3.create(), axis, camera.orientation));
}
export function screenRay(
  screen: ScreenPoint,
  camera: CameraPose,
  viewport: CameraViewport,
): { origin: WorldPoint3; direction: WorldPoint3 } {
  // This is inverse P followed by inverse V, in CSS's down-positive axes.
  const direction = vec3.normalize(vec3.create(), [
    (screen.x - viewport.width / 2) / camera.perspective,
    (screen.y - viewport.height / 2) / camera.perspective,
    -1,
  ]);
  return {
    origin: camera.position,
    direction: point(
      vec3.transformQuat(direction, direction, camera.orientation),
    ),
  };
}
export function screenToPlane(
  screen: ScreenPoint,
  camera: CameraPose,
  viewport: CameraViewport,
  origin: WorldPoint3,
  normal = cameraAxis(camera, [0, 0, 1]),
): WorldPoint3 | null {
  const ray = screenRay(screen, camera, viewport);
  const denominator = vec3.dot(vector(ray.direction), vector(normal));
  if (Math.abs(denominator) < 1e-6) return null;
  const t =
    vec3.dot(
      vec3.sub(vec3.create(), vector(origin), vector(ray.origin)),
      vector(normal),
    ) / denominator;
  return t > 0
    ? point(
        vec3.scaleAndAdd(
          vec3.create(),
          vector(ray.origin),
          vector(ray.direction),
          t,
        ),
      )
    : null;
}
export function orbitCamera(
  camera: CameraPose,
  dx: number,
  dy: number,
): CameraPose {
  const rotation = quat.multiply(
    quat.create(),
    orientation(-dy * 0.23, dx * 0.23),
    camera.orientation,
  );
  const distance = vec3.distance(
    vector(camera.position),
    vector(camera.target),
  );
  const offset = vec3.transformQuat(vec3.create(), [0, 0, distance], rotation);
  return {
    ...camera,
    orientation: tuple(rotation),
    position: point(vec3.add(offset, vector(camera.target), offset)),
  };
}
export function panCamera(
  camera: CameraPose,
  dx: number,
  dy: number,
): CameraPose {
  const distance = vec3.distance(
    vector(camera.position),
    vector(camera.target),
  );
  const move = vec3.transformQuat(
    vec3.create(),
    [
      (-dx * distance) / camera.perspective,
      (-dy * distance) / camera.perspective,
      0,
    ],
    camera.orientation,
  );
  return {
    ...camera,
    position: point(vec3.add(vec3.create(), vector(camera.position), move)),
    target: point(vec3.add(vec3.create(), vector(camera.target), move)),
  };
}
export function dollyCamera(camera: CameraPose, amount: number): CameraPose {
  const distance = vec3.distance(
    vector(camera.position),
    vector(camera.target),
  );
  const next = Math.max(160, Math.min(20000, distance * Math.exp(amount)));
  return {
    ...camera,
    position: point(
      vec3.scaleAndAdd(
        vec3.create(),
        vector(camera.target),
        vector(cameraAxis(camera, [0, 0, 1])),
        next,
      ),
    ),
  };
}
export function focusCamera(camera: CameraPose, pose: PaperPose): CameraPose {
  const offset = vec3.transformQuat(
    vec3.create(),
    [0, 0, camera.perspective],
    pose.orientation,
  );
  return {
    ...camera,
    target: pose.position,
    orientation: pose.orientation,
    position: point(vec3.add(offset, vector(pose.position), offset)),
  };
}
