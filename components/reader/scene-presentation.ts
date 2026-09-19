import {
  orientation,
  worldPoint,
  type PaperPose,
} from "../../lib/reader/camera";
export type { PaperPose } from "../../lib/reader/camera";
export type PaperRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
export type SurfaceLayout = {
  width: number;
  height: number;
  scroll: PaperRect;
  maxScroll: number;
};
/** The two loaded occurrences are only a first-slice adapter. Their poses are
 * materialized in SpaceView and are never recalculated when focus changes. */
export function defaultPaperPose(index: number): PaperPose {
  return {
    position: worldPoint(
      index === 0 ? -300 : 360,
      index === 0 ? -12 : 35,
      index === 0 ? 110 : -260,
    ),
    orientation: index === 0 ? orientation(-2, 7, -1) : orientation(3, -13, 2),
  };
}
export function rangeScrollTarget(
  top: number,
  bottom: number,
  complete: boolean,
  height: number,
  maxScroll: number,
): number {
  const anchor =
    complete && bottom - top <= height * 0.6 ? (top + bottom) / 2 : top;
  return Math.max(0, Math.min(maxScroll, anchor - height * 0.42));
}
