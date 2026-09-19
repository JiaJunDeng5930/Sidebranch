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
export { defaultPaperPose } from "../../lib/reader/attention";
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
