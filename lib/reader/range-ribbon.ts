import { mat4 } from "gl-matrix";
import {
  modelMatrix,
  paperPoint,
  viewMatrix,
  worldPoint,
  type CameraPose,
  type PaperPoint,
  type PaperPose,
  type WorldPoint3,
} from "./camera";

export type RangeRibbonProxyReason =
  | "outside-visible-text"
  | "unmapped"
  | "folded"
  | "unloaded"
  | "loading"
  | "error";
export type RangeRibbonProvenance =
  | Readonly<{ kind: "exact" }>
  | Readonly<{ kind: "proxy"; reason: RangeRibbonProxyReason }>;
export type RangeRibbonMouthSegment = Readonly<{
  start: WorldPoint3;
  end: WorldPoint3;
  provenance: RangeRibbonProvenance;
}>;
export type RangeRibbonVertex = Readonly<{
  point: WorldPoint3;
  /** Transverse position: zero at the from mouth, one at the to mouth. */
  endpointWeight: number;
}>;
export type RangeRibbonTriangle = Readonly<{
  vertices: readonly [RangeRibbonVertex, RangeRibbonVertex, RangeRibbonVertex];
  from: RangeRibbonProvenance;
  to: RangeRibbonProvenance;
  fromSegmentIndex: number;
  toSegmentIndex: number;
  stripStart: number;
  stripEnd: number;
}>;
export type WorldRay = Readonly<{
  origin: WorldPoint3;
  direction: WorldPoint3;
}>;
export type RangeRibbonHit = Readonly<{
  triangle: RangeRibbonTriangle;
  point: WorldPoint3;
  /** World distance, even when the supplied ray direction is not normalized. */
  distance: number;
  endpointWeight: number;
}>;

type Vector = readonly [number, number, number];
const subtract = (a: WorldPoint3, b: WorldPoint3): Vector => [
  a.x - b.x,
  a.y - b.y,
  a.z - b.z,
];
const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vector, b: Vector): Vector => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (v: Vector) => Math.hypot(...v);
const interpolate = (a: WorldPoint3, b: WorldPoint3, t: number) =>
  worldPoint(
    a.x + (b.x - a.x) * t,
    a.y + (b.y - a.y) * t,
    a.z + (b.z - a.z) * t,
  );
const vector = (p: WorldPoint3): Vector => [p.x, p.y, p.z];
const EPSILON = 1e-10;

function triangleBasis(triangle: RangeRibbonTriangle) {
  const [a, b, c] = triangle.vertices.map((vertex) => vertex.point);
  const x = subtract(b, a);
  const y = subtract(c, a);
  const normal = cross(x, y);
  const area = length(normal);
  if (!Number.isFinite(area) || area <= EPSILON * length(x) * length(y))
    return null;
  return { origin: a, x, y, normal, area };
}

function parameterize(segments: readonly RangeRibbonMouthSegment[]) {
  let total = 0;
  const valid = segments.flatMap((segment, index) => {
    const size = length(subtract(segment.end, segment.start));
    if (!Number.isFinite(size) || size === 0) return [];
    const start = total;
    total += size;
    return [{ segment, index, start, end: total }];
  });
  if (!Number.isFinite(total) || total === 0) return [];
  return valid.map((part) => ({
    ...part,
    start: part.start / total,
    end: part.end / total,
  }));
}

/**
 * Join complete mouth lists in O(n + m) space and time. Segment gaps have no
 * parameter length: each subdivision uses its own segment's boundary points,
 * so a jump never becomes a spurious edge along the mouth.
 */
export function buildRangeRibbon(
  from: readonly RangeRibbonMouthSegment[],
  to: readonly RangeRibbonMouthSegment[],
): RangeRibbonTriangle[] {
  const source = parameterize(from);
  const target = parameterize(to);
  const triangles: RangeRibbonTriangle[] = [];
  let i = 0;
  let j = 0;
  let start = 0;
  while (i < source.length && j < target.length) {
    const a = source[i];
    const b = target[j];
    const end = Math.min(a.end, b.end);
    if (end > start) {
      const at = (
        part: (typeof source)[number],
        u: number,
        endpointWeight: number,
      ): RangeRibbonVertex => ({
        point: interpolate(
          part.segment.start,
          part.segment.end,
          Math.max(0, Math.min(1, (u - part.start) / (part.end - part.start))),
        ),
        endpointWeight,
      });
      const a0 = at(a, start, 0);
      const a1 = at(a, end, 0);
      const b0 = at(b, start, 1);
      const b1 = at(b, end, 1);
      const metadata = {
        from: a.segment.provenance,
        to: b.segment.provenance,
        fromSegmentIndex: a.index,
        toSegmentIndex: b.index,
        stripStart: start,
        stripEnd: end,
      };
      for (const vertices of [
        [a0, b0, b1],
        [a0, b1, a1],
      ] as const) {
        const triangle = { ...metadata, vertices };
        if (triangleBasis(triangle)) triangles.push(triangle);
      }
    }
    if (a.end <= end) i++;
    if (b.end <= end) j++;
    start = end;
  }
  return triangles;
}

export type RangeRibbonLeaf = Readonly<{
  matrix: mat4;
  width: number;
  height: number;
  points: readonly [PaperPoint, PaperPoint, PaperPoint];
}>;

/** Rasterize at paper-unit size: scaling a 1px clipped layer magnifies its edge errors. */
export function triangleLeafGeometry(
  triangle: RangeRibbonTriangle,
): RangeRibbonLeaf | null {
  const basis = triangleBasis(triangle);
  if (!basis) return null;
  const { x, y, normal, area, origin } = basis;
  const span = length(x);
  const right: Vector = [x[0] / span, x[1] / span, x[2] / span];
  const front: Vector = [normal[0] / area, normal[1] / area, normal[2] / area];
  const down = cross(front, right);
  const thirdX = dot(y, right),
    thirdY = dot(y, down);
  const left = Math.min(0, thirdX);
  return {
    matrix: mat4.fromValues(
      ...right,
      0,
      ...down,
      0,
      ...front,
      0,
      origin.x + left * right[0],
      origin.y + left * right[1],
      origin.z + left * right[2],
      1,
    ),
    width: Math.max(1, Math.ceil(Math.max(span, thirdX) - left)),
    height: Math.max(1, Math.ceil(thirdY)),
    points: [
      paperPoint(-left, 0),
      paperPoint(span - left, 0),
      paperPoint(thirdX - left, thirdY),
    ],
  };
}

/** Preserve safe world triangles by identity; clip crossing triangles only. */
export function clipRangeRibbonToCamera(
  triangles: readonly RangeRibbonTriangle[],
  camera: CameraPose,
): RangeRibbonTriangle[] {
  const view = viewMatrix(camera);
  const distance = ({ point: p }: RangeRibbonVertex) =>
    -camera.near - (view[2] * p.x + view[6] * p.y + view[10] * p.z + view[14]);
  return triangles.flatMap((triangle) => {
    const distances = triangle.vertices.map(distance);
    if (distances.every((d) => d >= 0))
      return triangleBasis(triangle) ? [triangle] : [];
    if (distances.every((d) => d < 0)) return [];
    const polygon: RangeRibbonVertex[] = [];
    for (let i = 0; i < 3; i++) {
      const a = triangle.vertices[i];
      const b = triangle.vertices[(i + 1) % 3];
      const da = distances[i];
      const db = distances[(i + 1) % 3];
      if (da >= 0) polygon.push(a);
      if (da >= 0 !== db >= 0) {
        const t = da / (da - db);
        polygon.push({
          point: interpolate(a.point, b.point, t),
          endpointWeight:
            a.endpointWeight + (b.endpointWeight - a.endpointWeight) * t,
        });
      }
    }
    const clipped: RangeRibbonTriangle[] = [];
    for (let i = 1; i + 1 < polygon.length; i++) {
      const part: RangeRibbonTriangle = {
        ...triangle,
        vertices: [polygon[0], polygon[i], polygon[i + 1]],
      };
      if (triangleBasis(part)) clipped.push(part);
    }
    return clipped;
  });
}

/** Double-sided ray picking; callers supply the same clipped mesh they paint. */
export function hitTestRangeRibbon(
  ray: WorldRay,
  triangles: readonly RangeRibbonTriangle[],
): RangeRibbonHit | null {
  const direction = vector(ray.direction);
  const rayLength = length(direction);
  if (rayLength === 0) return null;
  let nearest: RangeRibbonHit | null = null;
  for (const triangle of triangles) {
    const basis = triangleBasis(triangle);
    if (!basis) continue;
    const p = cross(direction, basis.y);
    const determinant = dot(basis.x, p);
    if (Math.abs(determinant) <= EPSILON * basis.area * rayLength) continue;
    const offset = subtract(ray.origin, basis.origin);
    const u = dot(offset, p) / determinant;
    const q = cross(offset, basis.x);
    const v = dot(direction, q) / determinant;
    if (u < -EPSILON || v < -EPSILON || u + v > 1 + EPSILON) continue;
    const t = dot(basis.y, q) / determinant;
    if (t <= 0 || (nearest && t * rayLength >= nearest.distance)) continue;
    const [a, b, c] = triangle.vertices;
    nearest = {
      triangle,
      distance: t * rayLength,
      point: worldPoint(
        ray.origin.x + ray.direction.x * t,
        ray.origin.y + ray.direction.y * t,
        ray.origin.z + ray.direction.z * t,
      ),
      endpointWeight: Math.max(
        0,
        Math.min(
          1,
          (1 - u - v) * a.endpointWeight +
            u * b.endpointWeight +
            v * c.endpointWeight,
        ),
      ),
    };
  }
  return nearest;
}

/** Intersect the actual posed paper rectangle, not its projected bounding box. */
export function intersectPaperRay(
  ray: WorldRay,
  pose: PaperPose,
  width: number,
  height: number,
): { point: PaperPoint; worldPoint: WorldPoint3; distance: number } | null {
  if (!(width > 0 && height > 0)) return null;
  const inverse = mat4.invert(mat4.create(), modelMatrix(pose));
  if (!inverse) return null;
  const transform = (p: WorldPoint3, w: number): Vector => [
    inverse[0] * p.x + inverse[4] * p.y + inverse[8] * p.z + inverse[12] * w,
    inverse[1] * p.x + inverse[5] * p.y + inverse[9] * p.z + inverse[13] * w,
    inverse[2] * p.x + inverse[6] * p.y + inverse[10] * p.z + inverse[14] * w,
  ];
  const origin = transform(ray.origin, 1);
  const direction = transform(ray.direction, 0);
  const rayLength = length(vector(ray.direction));
  if (Math.abs(direction[2]) <= EPSILON * rayLength) return null;
  const t = -origin[2] / direction[2];
  if (t <= 0) return null;
  const x = origin[0] + t * direction[0] + width / 2;
  const y = origin[1] + t * direction[1] + height / 2;
  if (x < 0 || x > width || y < 0 || y > height) return null;
  return {
    point: paperPoint(x, y),
    worldPoint: worldPoint(
      ray.origin.x + ray.direction.x * t,
      ray.origin.y + ray.direction.y * t,
      ray.origin.z + ray.direction.z * t,
    ),
    distance: t * rayLength,
  };
}
