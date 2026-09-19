import type { CameraPose } from "./attention";

declare const worldPointBrand: unique symbol;
declare const screenPointBrand: unique symbol;

/** A coordinate on the shared z=0 world plane. */
export type WorldPoint = {
  readonly x: number;
  readonly y: number;
  readonly [worldPointBrand]: "WorldPoint";
};

/** A coordinate relative to the measured scene viewport. */
export type ScreenPoint = {
  readonly x: number;
  readonly y: number;
  readonly [screenPointBrand]: "ScreenPoint";
};

/** Construct a checked world coordinate at a module boundary. */
export function worldPoint(x: number, y: number): WorldPoint {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new RangeError("world point coordinates must be finite");
  }
  return { x, y } as WorldPoint;
}

/** Construct a checked viewport coordinate at a module boundary. */
export function screenPoint(x: number, y: number): ScreenPoint {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new RangeError("screen point coordinates must be finite");
  }
  return { x, y } as ScreenPoint;
}

/**
 * The zoom and angle domain shared by camera gestures and presentation
 * animation. Camera translation has no arbitrary coordinate clamp: its usable
 * domain is determined together with the active paper projection.
 */
export const CAMERA_LIMITS = {
  zoomMin: 0.2,
  zoomMax: 3,
  yaw: 22,
  pitch: 10,
} as const;

/** Home camera derived by every reading view. */
export const CAMERA_HOME: CameraPose = {
  x: 0,
  y: 0,
  yaw: 0,
  pitch: 0,
  zoom: 1,
};

/**
 * The viewport uses `perspective: 1480px` and a 50% / 47% perspective
 * origin. Keep these values next to the projection rather than letting the
 * beam code grow a second, approximate camera model.
 */
export const CSS_PERSPECTIVE_DISTANCE = 1480;
export const CSS_PERSPECTIVE_ORIGIN = { x: 0.5, y: 0.47 } as const;

export type CameraViewport = Readonly<{
  width: number;
  height: number;
}>;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function finitePose(pose: CameraPose): boolean {
  return (
    finite(pose.x) &&
    finite(pose.y) &&
    finite(pose.yaw) &&
    finite(pose.pitch) &&
    finite(pose.zoom)
  );
}

function checkedViewport(viewport: CameraViewport): CameraViewport {
  if (
    !finite(viewport.width) ||
    !finite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    throw new RangeError("camera viewport must have positive finite dimensions");
  }
  return viewport;
}

function checkedWorldPoint(point: WorldPoint): void {
  if (!finite(point.x) || !finite(point.y)) {
    throw new RangeError("world point coordinates must be finite");
  }
}

function checkedScreenPoint(point: ScreenPoint): void {
  if (!finite(point.x) || !finite(point.y)) {
    throw new RangeError("screen point coordinates must be finite");
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Normalize an untrusted pose using the last legal pose as the field-level
 * fallback. Translation remains unbounded; only finite values are required.
 */
export function normalizeCameraPose(
  pose: CameraPose,
  fallback: CameraPose = CAMERA_HOME,
): CameraPose {
  const fallbackX = finite(fallback.x) ? fallback.x : CAMERA_HOME.x;
  const fallbackY = finite(fallback.y) ? fallback.y : CAMERA_HOME.y;
  const fallbackYaw = finite(fallback.yaw) ? fallback.yaw : CAMERA_HOME.yaw;
  const fallbackPitch = finite(fallback.pitch)
    ? fallback.pitch
    : CAMERA_HOME.pitch;
  const fallbackZoom = finite(fallback.zoom) ? fallback.zoom : CAMERA_HOME.zoom;
  const x = finite(pose.x) ? pose.x : fallbackX;
  const y = finite(pose.y) ? pose.y : fallbackY;
  const yaw = clamp(
    finite(pose.yaw) ? pose.yaw : fallbackYaw,
    -CAMERA_LIMITS.yaw,
    CAMERA_LIMITS.yaw,
  );
  const pitch = clamp(
    finite(pose.pitch) ? pose.pitch : fallbackPitch,
    -CAMERA_LIMITS.pitch,
    CAMERA_LIMITS.pitch,
  );
  const zoom = clamp(
    finite(pose.zoom) ? pose.zoom : fallbackZoom,
    CAMERA_LIMITS.zoomMin,
    CAMERA_LIMITS.zoomMax,
  );
  return { x, y, yaw, pitch, zoom };
}

export function isCameraPoseLegal(pose: CameraPose): boolean {
  return (
    finitePose(pose) &&
    pose.zoom >= CAMERA_LIMITS.zoomMin &&
    pose.zoom <= CAMERA_LIMITS.zoomMax &&
    Math.abs(pose.yaw) <= CAMERA_LIMITS.yaw &&
    Math.abs(pose.pitch) <= CAMERA_LIMITS.pitch
  );
}

function rotationCoefficients(pose: CameraPose) {
  const yaw = (pose.yaw * Math.PI) / 180;
  const pitch = (pose.pitch * Math.PI) / 180;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const zoom = pose.zoom;

  // CSS applies `rotateX(-pitch) rotateY(-yaw) scale(zoom)` to the translated
  // point. These are the coefficients for the z=0 world plane after that
  // transform. Keeping them explicit also makes the inverse homography
  // independent of DOM reads during camera-only motion.
  return {
    x: { u: cosYaw * zoom, v: 0 },
    y: { u: sinPitch * sinYaw * zoom, v: cosPitch * zoom },
    z: { u: cosPitch * sinYaw * zoom, v: -sinPitch * zoom },
  };
}

/** The CSS perspective denominator for a world point at a given pose. */
export function projectionWeight(world: WorldPoint, pose: CameraPose): number {
  if (!finitePose(pose) || !finite(world.x) || !finite(world.y)) return NaN;
  const normalizedPose = normalizeCameraPose(pose, pose);
  const coefficients = rotationCoefficients(normalizedPose);
  const u = world.x - normalizedPose.x;
  const v = world.y - normalizedPose.y;
  const transformedZ = coefficients.z.u * u + coefficients.z.v * v;
  return 1 - transformedZ / CSS_PERSPECTIVE_DISTANCE;
}

export interface ProjectionSafety {
  readonly valid: boolean;
  readonly minimumWeight: number;
}

/** Check the four corners (or any supplied world samples) as one domain. */
export function projectionSafety(
  corners: readonly WorldPoint[],
  pose: CameraPose,
): ProjectionSafety {
  if (!isCameraPoseLegal(pose) || corners.length === 0) {
    return { valid: false, minimumWeight: Number.NaN };
  }
  let minimumWeight = Number.POSITIVE_INFINITY;
  for (const corner of corners) {
    checkedWorldPoint(corner);
    const weight = projectionWeight(corner, pose);
    if (!finite(weight)) return { valid: false, minimumWeight: weight };
    minimumWeight = Math.min(minimumWeight, weight);
  }
  return {
    valid: minimumWeight >= 0.25,
    minimumWeight,
  };
}

export function isProjectionSafe(
  corners: readonly WorldPoint[],
  pose: CameraPose,
): boolean {
  return projectionSafety(corners, pose).valid;
}

/**
 * Project a scene point using the same transform order as
 * `.spatial-scene-world`. Coordinates are local to the viewport: (0, 0) is
 * its top-left and the world origin is its center.
 */
export function worldToScreen(
  world: WorldPoint,
  pose: CameraPose,
  viewport: CameraViewport,
): ScreenPoint {
  checkedWorldPoint(world);
  const measuredViewport = checkedViewport(viewport);
  const normalizedPose = normalizeCameraPose(pose, pose);
  const originX = measuredViewport.width / 2;
  const originY = measuredViewport.height / 2;
  const perspectiveX = measuredViewport.width * CSS_PERSPECTIVE_ORIGIN.x;
  const perspectiveY = measuredViewport.height * CSS_PERSPECTIVE_ORIGIN.y;
  const coefficients = rotationCoefficients(normalizedPose);
  const u = world.x - normalizedPose.x;
  const v = world.y - normalizedPose.y;
  const transformed = {
    x: originX + coefficients.x.u * u + coefficients.x.v * v,
    y: originY + coefficients.y.u * u + coefficients.y.v * v,
    z: coefficients.z.u * u + coefficients.z.v * v,
  };
  const perspectiveScale = 1 - transformed.z / CSS_PERSPECTIVE_DISTANCE;
  if (!finite(perspectiveScale) || perspectiveScale <= 0) {
    throw new RangeError("world point lies beyond the camera perspective plane");
  }

  return screenPoint(
    perspectiveX + (transformed.x - perspectiveX) / perspectiveScale,
    perspectiveY + (transformed.y - perspectiveY) / perspectiveScale,
  );
}

/**
 * Invert `worldToScreen` on the scene's z=0 plane. This is an inverse
 * projective transform, rather than a 2-D rotation approximation, so a
 * pointer anchor remains stable while yaw, pitch or zoom is changing.
 */
export function screenToWorld(
  screen: ScreenPoint,
  pose: CameraPose,
  viewport: CameraViewport,
): WorldPoint {
  checkedScreenPoint(screen);
  const measuredViewport = checkedViewport(viewport);
  const normalizedPose = normalizeCameraPose(pose, pose);
  const originX = measuredViewport.width / 2;
  const originY = measuredViewport.height / 2;
  const perspectiveX = measuredViewport.width * CSS_PERSPECTIVE_ORIGIN.x;
  const perspectiveY = measuredViewport.height * CSS_PERSPECTIVE_ORIGIN.y;
  const coefficients = rotationCoefficients(normalizedPose);
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

  // The legal camera domain keeps the inverse well-conditioned. If an
  // external caller still supplies a singular input, retain the normalized
  // camera center rather than inventing a zero coordinate.
  if (!finite(determinant) || Math.abs(determinant) < 1e-8) {
    return worldPoint(normalizedPose.x, normalizedPose.y);
  }

  const u = (b * f - c * e) / determinant;
  const v = (c * d - a * f) / determinant;
  if (!finite(u) || !finite(v)) {
    return worldPoint(normalizedPose.x, normalizedPose.y);
  }
  return worldPoint(u + normalizedPose.x, v + normalizedPose.y);
}

export interface ScreenAnchorConstraint {
  readonly world: WorldPoint;
  readonly screen: ScreenPoint;
  readonly viewport: CameraViewport;
}

export interface PoseForScreenAnchorOptions {
  /** Active paper corners used as the shared projection domain. */
  readonly safetyCorners?: readonly WorldPoint[];
}

function anchoredPose(
  world: WorldPoint,
  screen: ScreenPoint,
  pose: CameraPose,
  viewport: CameraViewport,
): CameraPose {
  const normalizedPose = normalizeCameraPose(pose, pose);
  const relative = screenToWorld(
    screen,
    { ...normalizedPose, x: 0, y: 0 },
    viewport,
  );
  const x = world.x - relative.x;
  const y = world.y - relative.y;
  return {
    ...normalizedPose,
    x: finite(x) ? x : normalizedPose.x,
    y: finite(y) ? y : normalizedPose.y,
  };
}

function convergeAnglesToSafety(
  pose: CameraPose,
  safetyCorners: readonly WorldPoint[],
  anchor: ScreenAnchorConstraint | null,
): CameraPose {
  if (isProjectionSafe(safetyCorners, pose)) return pose;
  const makeCandidate = (factor: number): CameraPose => {
    const requested = {
      ...pose,
      yaw: pose.yaw * factor,
      pitch: pose.pitch * factor,
    };
    return anchor
      ? anchoredPose(anchor.world, anchor.screen, requested, anchor.viewport)
      : requested;
  };

  // At zero yaw/pitch every z=0 point has w=1. Find the largest safe point on
  // the straight angle path so a distant paper cannot cross the perspective
  // plane while the pointer anchor remains fixed.
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 28; iteration += 1) {
    const middle = (low + high) / 2;
    if (isProjectionSafe(safetyCorners, makeCandidate(middle))) low = middle;
    else high = middle;
  }
  return makeCandidate(low);
}

/**
 * Return a pose whose supplied world point remains under `screen`. If paper
 * corners are supplied, yaw and pitch converge together toward zero until the
 * anchored candidate is inside the shared w>=0.25 domain.
 */
export function poseForScreenAnchor(
  world: WorldPoint,
  screen: ScreenPoint,
  pose: CameraPose,
  viewport: CameraViewport,
  options: PoseForScreenAnchorOptions = {},
): CameraPose {
  checkedWorldPoint(world);
  checkedScreenPoint(screen);
  const candidate = anchoredPose(world, screen, pose, viewport);
  const corners = options.safetyCorners;
  return corners?.length
    ? convergeAnglesToSafety(candidate, corners, {
        world,
        screen,
        viewport,
      })
    : candidate;
}

export interface CameraConstraintOptions {
  readonly safetyCorners?: readonly WorldPoint[];
  readonly anchor?: ScreenAnchorConstraint;
}

/** Constrain a candidate without ever clamping translation to a magic range. */
export function constrainCameraPose(
  candidate: CameraPose,
  fallback: CameraPose = CAMERA_HOME,
  options: CameraConstraintOptions = {},
): CameraPose {
  const normalized = normalizeCameraPose(candidate, fallback);
  const anchor = options.anchor;
  const anchored = anchor
    ? poseForScreenAnchor(
        anchor.world,
        anchor.screen,
        normalized,
        anchor.viewport,
        { safetyCorners: options.safetyCorners },
      )
    : normalized;
  return options.safetyCorners?.length
    ? convergeAnglesToSafety(anchored, options.safetyCorners, anchor ?? null)
    : anchored;
}

/**
 * Match the transform list on `.spatial-scene-world`. The perspective lives
 * on the parent viewport, so it is intentionally not included here.
 */
export function cameraTransform(pose: CameraPose): string {
  const normalized = normalizeCameraPose(pose, pose);
  return `rotateX(${-normalized.pitch}deg) rotateY(${-normalized.yaw}deg) scale(${normalized.zoom}) translate3d(${-normalized.x}px, ${-normalized.y}px, 0)`;
}
