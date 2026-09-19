import type { CameraPose } from "./attention";

export interface CameraPoint {
  x: number;
  y: number;
}

/**
 * The viewport uses `perspective: 1480px` and a 50% / 47% perspective
 * origin.  Keep these values next to the projection rather than letting the
 * beam code grow a second, approximate camera model.
 */
export const CSS_PERSPECTIVE_DISTANCE = 1480;
export const CSS_PERSPECTIVE_ORIGIN = { x: 0.5, y: 0.47 } as const;

export type CameraViewport = Pick<DOMRect, "width" | "height">;

function rotationCoefficients(pose: CameraPose) {
  const yaw = (pose.yaw * Math.PI) / 180;
  const pitch = (pose.pitch * Math.PI) / 180;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const zoom = pose.zoom;

  // CSS applies `rotateX(-pitch) rotateY(-yaw) scale(zoom)` to the translated
  // point.  These are the coefficients for the z=0 world plane after that
  // transform.  Keeping them explicit also makes the inverse homography
  // below independent of DOM reads during camera-only motion.
  return {
    x: { u: cosYaw * zoom, v: 0 },
    y: { u: sinPitch * sinYaw * zoom, v: cosPitch * zoom },
    z: { u: cosPitch * sinYaw * zoom, v: -sinPitch * zoom },
  };
}

/**
 * Project a scene point using the same transform order as `.spatial-scene-world`.
 * Coordinates are local to the viewport: (0, 0) is its top-left and the
 * world origin is its center.
 */
export function worldToScreen(
  world: CameraPoint,
  pose: CameraPose,
  viewport: CameraViewport,
): CameraPoint {
  const originX = viewport.width / 2;
  const originY = viewport.height / 2;
  const perspectiveX = viewport.width * CSS_PERSPECTIVE_ORIGIN.x;
  const perspectiveY = viewport.height * CSS_PERSPECTIVE_ORIGIN.y;
  const coefficients = rotationCoefficients(pose);
  const u = world.x - pose.x;
  const v = world.y - pose.y;
  const transformed = {
    x: originX + coefficients.x.u * u + coefficients.x.v * v,
    y: originY + coefficients.y.u * u + coefficients.y.v * v,
    z: coefficients.z.u * u + coefficients.z.v * v,
  };
  const perspectiveScale = 1 - transformed.z / CSS_PERSPECTIVE_DISTANCE;

  return {
    x: perspectiveX + (transformed.x - perspectiveX) / perspectiveScale,
    y: perspectiveY + (transformed.y - perspectiveY) / perspectiveScale,
  };
}

/**
 * Invert `worldToScreen` on the scene's z=0 plane.  This is an inverse
 * projective transform, rather than a 2-D rotation approximation, so a
 * pointer anchor remains stable while yaw, pitch or zoom is changing.
 */
export function screenToWorld(
  screen: CameraPoint,
  pose: CameraPose,
  viewport: CameraViewport,
): CameraPoint {
  const originX = viewport.width / 2;
  const originY = viewport.height / 2;
  const perspectiveX = viewport.width * CSS_PERSPECTIVE_ORIGIN.x;
  const perspectiveY = viewport.height * CSS_PERSPECTIVE_ORIGIN.y;
  const coefficients = rotationCoefficients(pose);
  const distance = CSS_PERSPECTIVE_DISTANCE;

  // Homogeneous screen coefficients for
  //   screen = perspectiveOrigin + (transformed - perspectiveOrigin) / w
  // where w = 1 - transformed.z / distance.
  const denominator = {
    u: -coefficients.z.u / distance,
    v: -coefficients.z.v / distance,
  };
  const numeratorX = {
    u: coefficients.x.u - (perspectiveX * coefficients.z.u) / distance,
    v: coefficients.x.v - (perspectiveX * coefficients.z.v) / distance,
    constant: originX,
  };
  const numeratorY = {
    u: coefficients.y.u - (perspectiveY * coefficients.z.u) / distance,
    v: coefficients.y.v - (perspectiveY * coefficients.z.v) / distance,
    constant: originY,
  };

  const a = numeratorX.u - screen.x * denominator.u;
  const b = numeratorX.v - screen.x * denominator.v;
  const c = numeratorX.constant - screen.x;
  const d = numeratorY.u - screen.y * denominator.u;
  const e = numeratorY.v - screen.y * denominator.v;
  const f = numeratorY.constant - screen.y;
  const determinant = a * e - b * d;

  // Camera limits keep this plane well-conditioned.  A finite fallback is
  // still useful if a caller supplies an invalid pose during error recovery.
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) {
    return {
      x: pose.x,
      y: pose.y,
    };
  }

  const u = (b * f - c * e) / determinant;
  const v = (c * d - a * f) / determinant;
  return {
    x: u + pose.x,
    y: v + pose.y,
  };
}

/**
 * Return a pose whose supplied world point remains under `screen`.  This is
 * used when changing zoom around a pointer and avoids the old center-only
 * formula once the scene has yaw or pitch.
 */
export function poseForScreenAnchor(
  world: CameraPoint,
  screen: CameraPoint,
  pose: CameraPose,
  viewport: CameraViewport,
): CameraPose {
  const relative = screenToWorld(screen, { ...pose, x: 0, y: 0 }, viewport);
  return {
    ...pose,
    x: world.x - relative.x,
    y: world.y - relative.y,
  };
}

/**
 * Match the transform list on `.spatial-scene-world`.  The perspective lives
 * on the parent viewport, so it is intentionally not included here.
 */
export function cameraTransform(pose: CameraPose): string {
  return `rotateX(${-pose.pitch}deg) rotateY(${-pose.yaw}deg) scale(${pose.zoom}) translate3d(${-pose.x}px, ${-pose.y}px, 0)`;
}
