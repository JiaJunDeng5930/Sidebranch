import type { AnchorInput, ConnectionId } from "../domain/model";
import { paperPoint, type PaperPoint } from "./camera";
import type { RangeEdge, RangeFragment } from "./range-geometry";
import type { SurfaceInstanceId } from "./spatial-contract";

export type PassageMouthReason =
  "offscreen" | "unmounted" | "unmapped" | "loading" | "error";

/** Precision describes presentation only; the source anchor always stays intact. */
export type PassageMouthPrecision =
  | Readonly<{ precision: "exact" }>
  | Readonly<{ precision: "partial"; reason: "offscreen" | "unmapped" }>
  | Readonly<{ precision: "proxy"; reason: PassageMouthReason }>;

/** One contiguous source anchor owns one interval in paper-local CSS units. */
export type PassageMouth = Readonly<{
  surfaceId: SurfaceInstanceId;
  anchor: AnchorInput;
  start: PaperPoint;
  end: PaperPoint;
}> &
  PassageMouthPrecision;

export type PassageBand = Readonly<{
  connectionId: ConnectionId;
  from: PassageMouth;
  to: PassageMouth;
}>;

/**
 * Call only with fragments resolved for ONE anchor. The interval includes line
 * spacing; screen proximity never grants permission to combine source anchors.
 */
export function passageMouthInterval(
  fragments: readonly RangeFragment[],
  edge: RangeEdge,
): Readonly<{ start: PaperPoint; end: PaperPoint }> | null {
  const valid = fragments.filter(
    (r) =>
      [r.left, r.right, r.top, r.bottom].every(Number.isFinite) &&
      r.right > r.left &&
      r.bottom > r.top,
  );
  if (!valid.length) return null;
  const left = Math.min(...valid.map((r) => r.left));
  const right = Math.max(...valid.map((r) => r.right));
  const top = Math.min(...valid.map((r) => r.top));
  const bottom = Math.max(...valid.map((r) => r.bottom));
  if (edge === "left" || edge === "right") {
    const x = edge === "left" ? left : right;
    return { start: paperPoint(x, top), end: paperPoint(x, bottom) };
  }
  const y = edge === "top" ? top : bottom;
  return { start: paperPoint(left, y), end: paperPoint(right, y) };
}
