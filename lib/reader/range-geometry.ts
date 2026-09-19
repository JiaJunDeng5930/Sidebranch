/**
 * Geometry for source ranges in the reading plane.
 *
 * This module deliberately contains no DOM or React code.  A scene measures
 * DOM ranges once after a layout change, converts them to these small value
 * objects, and can then project and hit-test them for as many camera frames
 * as necessary.
 */

export type RangeCoverage = "complete" | "partial" | "unmounted" | "unmapped";

export type RangeVisibility =
  | "range"
  | "clipped-range"
  | "offscreen-range"
  | "partial-range"
  | "unmounted-range"
  | "peripheral"
  | "unavailable";

export type RangeEdge = "left" | "right" | "top" | "bottom";

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface RangeFragment extends Rect {
  /** Optional source offsets are kept for stable ordering, when available. */
  readonly sourceStart?: number;
  readonly sourceEnd?: number;
}

export interface MissingRange {
  readonly start: number;
  readonly end: number;
}

export interface RangeEndpoint {
  readonly edge: RangeEdge;
  /** Position along the edge's outward normal. */
  readonly coordinate: number;
  /** Span along the paper edge.  For left/right these are y coordinates. */
  readonly start: number;
  readonly end: number;
  readonly precise: boolean;
  readonly proxy: boolean;
}

export interface RangeSegment extends Rect {
  readonly row: number;
}

export interface RangeGeometry {
  readonly visibility: RangeVisibility;
  /** Measured and clip-intersected pieces only. */
  readonly segments: readonly RangeSegment[];
  /** One orthogonal polygon per measured piece; no missing gap is bridged. */
  readonly contours: readonly (readonly Point[])[];
  readonly visibleBounds: Rect | null;
  readonly endpoint: RangeEndpoint | null;
  /** Endpoint of measured pieces, when any; never used as a complete mouth for partial coverage. */
  readonly measuredEndpoint: RangeEndpoint | null;
  /** True only when the endpoint describes measured source pixels. */
  readonly precise: boolean;
  readonly hasVisiblePart: boolean;
}

export interface RangeGeometryInput {
  readonly coverage: RangeCoverage;
  readonly ranges?: readonly RangeFragment[];
  readonly missing?: readonly MissingRange[];
  readonly clip?: Rect | null;
  /** A paper occurrence without a mounted readable body. */
  readonly peripheral?: boolean;
  /** A failed/unmapped revision must remain discoverable but has no geometry. */
  readonly unavailable?: boolean;
  readonly edge?: RangeEdge;
  /** Proxy coordinate used for offscreen/unmounted/peripheral states. */
  readonly proxy?: RangeEndpoint | null;
}

export interface RuledSurface {
  readonly polygon: readonly [Point, Point, Point, Point];
  readonly precise: boolean;
  readonly proxy: boolean;
}

export interface RangeGeometryOptions {
  /** DOM fractional coordinates within this tolerance belong to one row. */
  readonly rowTolerance?: number;
  /** Segments this close on one row are treated as one text run. */
  readonly mergeGap?: number;
}

const EPSILON = 0.0001;
const DEFAULT_ROW_TOLERANCE = 1.5;
const DEFAULT_MERGE_GAP = 1.5;

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}

function isRect(rect: Rect): boolean {
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.right) &&
    Number.isFinite(rect.bottom) &&
    rect.right - rect.left > EPSILON &&
    rect.bottom - rect.top > EPSILON
  );
}

function normalizeRect(rect: Rect): Rect | null {
  const left = Math.min(finite(rect.left), finite(rect.right));
  const right = Math.max(finite(rect.left), finite(rect.right));
  const top = Math.min(finite(rect.top), finite(rect.bottom));
  const bottom = Math.max(finite(rect.top), finite(rect.bottom));
  const normalized = { left, top, right, bottom };
  return isRect(normalized) ? normalized : null;
}

/**
 * Drop empty DOM rectangles and sort them in source-reading order.  Keeping
 * this operation pure makes the cache key independent of browser object
 * identity and prevents an accidental AABB union from hiding a gap.
 */
export function normalizeRangeFragments(
  ranges: readonly RangeFragment[],
): readonly RangeFragment[] {
  return ranges
    .flatMap((range) => {
      const rect = normalizeRect(range);
      return rect
        ? [
            {
              ...rect,
              ...(range.sourceStart === undefined
                ? {}
                : { sourceStart: range.sourceStart }),
              ...(range.sourceEnd === undefined
                ? {}
                : { sourceEnd: range.sourceEnd }),
            },
          ]
        : [];
    })
    .sort((left, right) => {
      const source =
        (left.sourceStart ?? Number.POSITIVE_INFINITY) -
        (right.sourceStart ?? Number.POSITIVE_INFINITY);
      if (source !== 0) return source;
      return (
        compareNumbers(left.top, right.top) ||
        compareNumbers(left.left, right.left) ||
        compareNumbers(left.bottom, right.bottom) ||
        compareNumbers(left.right, right.right)
      );
    });
}

function sameRow(left: RangeFragment, right: RangeFragment, tolerance: number) {
  return (
    Math.abs(left.top - right.top) <= tolerance &&
    Math.abs(left.bottom - right.bottom) <= tolerance
  );
}

function mergeRows(
  ranges: readonly RangeFragment[],
  options: RangeGeometryOptions,
): readonly RangeSegment[] {
  const rowTolerance = Math.max(
    0,
    options.rowTolerance ?? DEFAULT_ROW_TOLERANCE,
  );
  const mergeGap = Math.max(0, options.mergeGap ?? DEFAULT_MERGE_GAP);
  const rows: RangeFragment[][] = [];

  for (const range of normalizeRangeFragments(ranges)) {
    let row = rows.find((candidate) =>
      sameRow(candidate[0], range, rowTolerance),
    );
    if (!row) {
      row = [];
      rows.push(row);
    }
    row.push(range);
  }

  return rows
    .sort((left, right) => left[0].top - right[0].top)
    .flatMap((row, rowIndex) => {
      const segments: RangeSegment[] = [];
      for (const range of row.sort((left, right) => left.left - right.left)) {
        const previous = segments[segments.length - 1];
        if (previous && range.left - previous.right <= mergeGap) {
          segments[segments.length - 1] = {
            left: previous.left,
            top: Math.min(previous.top, range.top),
            right: Math.max(previous.right, range.right),
            bottom: Math.max(previous.bottom, range.bottom),
            row: rowIndex,
          };
        } else {
          segments.push({ ...range, row: rowIndex });
        }
      }
      return segments;
    });
}

function intersectRect(left: Rect, right: Rect): Rect | null {
  const result = {
    left: Math.max(left.left, right.left),
    top: Math.max(left.top, right.top),
    right: Math.min(left.right, right.right),
    bottom: Math.min(left.bottom, right.bottom),
  };
  return isRect(result) ? result : null;
}

function clipSegments(
  segments: readonly RangeSegment[],
  clip: Rect | null | undefined,
): readonly RangeSegment[] {
  if (!clip) return segments;
  const normalizedClip = normalizeRect(clip);
  if (!normalizedClip) return [];
  return segments.flatMap((segment) => {
    const visible = intersectRect(segment, normalizedClip);
    return visible ? [{ ...visible, row: segment.row }] : [];
  });
}

function proxyForClip(
  all: readonly RangeSegment[],
  clip: Rect | null,
  edge: RangeEdge,
): RangeEndpoint | null {
  if (!clip) return null;
  const bounds = boundsOf(all);
  if (!bounds) return null;
  const clipSpan =
    edge === "left" || edge === "right"
      ? Math.max(1, clip.bottom - clip.top)
      : Math.max(1, clip.right - clip.left);
  const span = Math.min(24, Math.max(12, clipSpan * 0.08));
  const center =
    edge === "left" || edge === "right"
      ? Math.min(
          clip.bottom - span / 2,
          Math.max(clip.top + span / 2, (bounds.top + bounds.bottom) / 2),
        )
      : Math.min(
          clip.right - span / 2,
          Math.max(clip.left + span / 2, (bounds.left + bounds.right) / 2),
        );
  switch (edge) {
    case "left":
      return {
        edge,
        coordinate: clip.left,
        start: center - span / 2,
        end: center + span / 2,
        precise: false,
        proxy: true,
      };
    case "right":
      return {
        edge,
        coordinate: clip.right,
        start: center - span / 2,
        end: center + span / 2,
        precise: false,
        proxy: true,
      };
    case "top":
      return {
        edge,
        coordinate: clip.top,
        start: center - span / 2,
        end: center + span / 2,
        precise: false,
        proxy: true,
      };
    case "bottom":
      return {
        edge,
        coordinate: clip.bottom,
        start: center - span / 2,
        end: center + span / 2,
        precise: false,
        proxy: true,
      };
  }
}

function boundsOf(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null;
  return rects.reduce(
    (bounds, rect) => ({
      left: Math.min(bounds.left, rect.left),
      top: Math.min(bounds.top, rect.top),
      right: Math.max(bounds.right, rect.right),
      bottom: Math.max(bounds.bottom, rect.bottom),
    }),
    { ...rects[0] },
  );
}

function contourForSegment(segment: Rect): readonly Point[] {
  return [
    { x: segment.left, y: segment.top },
    { x: segment.right, y: segment.top },
    { x: segment.right, y: segment.bottom },
    { x: segment.left, y: segment.bottom },
  ];
}

function edgeForDirection(edge: RangeEdge | undefined): RangeEdge {
  return edge ?? "right";
}

function endpointForSegments(
  segments: readonly RangeSegment[],
  edge: RangeEdge,
  precise: boolean,
): RangeEndpoint | null {
  if (!segments.length) return null;
  const bounds = boundsOf(segments);
  if (!bounds) return null;
  switch (edge) {
    case "left":
      return {
        edge,
        coordinate: bounds.left,
        start: bounds.top,
        end: bounds.bottom,
        precise,
        proxy: !precise,
      };
    case "right":
      return {
        edge,
        coordinate: bounds.right,
        start: bounds.top,
        end: bounds.bottom,
        precise,
        proxy: !precise,
      };
    case "top":
      return {
        edge,
        coordinate: bounds.top,
        start: bounds.left,
        end: bounds.right,
        precise,
        proxy: !precise,
      };
    case "bottom":
      return {
        edge,
        coordinate: bounds.bottom,
        start: bounds.left,
        end: bounds.right,
        precise,
        proxy: !precise,
      };
  }
}

function visibilityFor(
  coverage: RangeCoverage,
  visible: readonly RangeSegment[],
  all: readonly RangeSegment[],
  clipped: boolean,
  peripheral: boolean,
  unavailable: boolean,
): RangeVisibility {
  if (unavailable || coverage === "unmapped") return "unavailable";
  if (peripheral) return "peripheral";
  if (coverage === "unmounted") return "unmounted-range";
  if (coverage === "partial") return "partial-range";
  if (!all.length || !visible.length) return "offscreen-range";
  return clipped ? "clipped-range" : "range";
}

/**
 * Classify an anchor and retain only measured, visible geometry.  A partial
 * or unavailable anchor can never become exact merely because its measured
 * fragments happen to form a convenient rectangle.
 */
export function buildRangeGeometry(
  input: RangeGeometryInput,
  options: RangeGeometryOptions = {},
): RangeGeometry {
  const all = mergeRows(input.ranges ?? [], options);
  const normalizedClip = input.clip ? normalizeRect(input.clip) : null;
  const visible = clipSegments(all, normalizedClip);
  const hasClippedFragment =
    !!normalizedClip &&
    all.some((segment) => {
      const clipped = intersectRect(segment, normalizedClip);
      return (
        !!clipped &&
        (clipped.left > segment.left + EPSILON ||
          clipped.top > segment.top + EPSILON ||
          clipped.right < segment.right - EPSILON ||
          clipped.bottom < segment.bottom - EPSILON)
      );
    });
  const visibility = visibilityFor(
    input.coverage,
    visible,
    all,
    hasClippedFragment,
    !!input.peripheral,
    !!input.unavailable,
  );
  const precise = visibility === "range" || visibility === "clipped-range";
  const measuredSegments =
    visibility === "unavailable" || visibility === "peripheral" ? [] : visible;
  const measuredEndpoint = endpointForSegments(
    measuredSegments,
    edgeForDirection(input.edge),
    precise,
  );
  const endpoint =
    (precise ? measuredEndpoint : null) ??
    input.proxy ??
    proxyForClip(all, normalizedClip, edgeForDirection(input.edge));

  return {
    visibility,
    segments: measuredSegments,
    contours: measuredSegments.map(contourForSegment),
    visibleBounds: boundsOf(measuredSegments),
    endpoint,
    measuredEndpoint,
    precise,
    hasVisiblePart: measuredSegments.length > 0,
  };
}

function endpointPoint(endpoint: RangeEndpoint, at: "start" | "end"): Point {
  const span = at === "start" ? endpoint.start : endpoint.end;
  switch (endpoint.edge) {
    case "left":
    case "right":
      return { x: endpoint.coordinate, y: span };
    case "top":
    case "bottom":
      return { x: span, y: endpoint.coordinate };
  }
}

/**
 * Construct the straight ruled surface between two measured/proxy mouths.
 * The order is from-start, to-start, to-end, from-end, so callers can use
 * the same polygon for drawing and point-in-polygon hit testing.
 */
export function ruledSurface(
  from: RangeEndpoint,
  to: RangeEndpoint,
): RuledSurface {
  const polygon = [
    endpointPoint(from, "start"),
    endpointPoint(to, "start"),
    endpointPoint(to, "end"),
    endpointPoint(from, "end"),
  ] as const;
  return {
    polygon,
    precise: from.precise && to.precise,
    proxy: from.proxy || to.proxy,
  };
}

export function polygonBounds(polygon: readonly Point[]): Rect | null {
  if (!polygon.length) return null;
  return polygon.reduce(
    (bounds, point) => ({
      left: Math.min(bounds.left, point.x),
      top: Math.min(bounds.top, point.y),
      right: Math.max(bounds.right, point.x),
      bottom: Math.max(bounds.bottom, point.y),
    }),
    {
      left: polygon[0].x,
      top: polygon[0].y,
      right: polygon[0].x,
      bottom: polygon[0].y,
    },
  );
}

/** Boundary-inclusive point-in-polygon test for relation surface clicks. */
export function pointInPolygon(
  point: Point,
  polygon: readonly Point[],
): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index++
  ) {
    const current = polygon[index];
    const prior = polygon[previous];
    const cross =
      (point.y - prior.y) * (current.x - prior.x) -
      (point.x - prior.x) * (current.y - prior.y);
    const onSegment =
      Math.abs(cross) <= EPSILON &&
      point.x >= Math.min(prior.x, current.x) - EPSILON &&
      point.x <= Math.max(prior.x, current.x) + EPSILON &&
      point.y >= Math.min(prior.y, current.y) - EPSILON &&
      point.y <= Math.max(prior.y, current.y) + EPSILON;
    if (onSegment) return true;
    const crosses =
      prior.y > point.y !== current.y > point.y &&
      point.x <
        ((current.x - prior.x) * (point.y - prior.y)) / (current.y - prior.y) +
          prior.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Return all hit IDs in caller-provided stable order; painter order is ignored. */
export function polygonHits<T>(
  point: Point,
  polygons: readonly { readonly id: T; readonly polygon: readonly Point[] }[],
): readonly T[] {
  return polygons
    .filter((candidate) => pointInPolygon(point, candidate.polygon))
    .map((candidate) => candidate.id);
}

export function polygonToPath(polygon: readonly Point[]): string {
  if (!polygon.length) return "";
  const [first, ...rest] = polygon;
  return [
    `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`,
    ...rest.map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`),
    "Z",
  ].join(" ");
}
