import type { PaperPose } from "./camera";
import type { SurfaceInstanceId } from "./spatial-contract";

export type PaperGeometry = Readonly<{ width: number; height: number }>;
/** Intrinsic paper size is occurrence geometry, independent of viewport and payload residency. */
export const PAPER_GEOMETRY: PaperGeometry = Object.freeze({
  width: 600,
  height: 780,
});
export type PaperInstance = Readonly<{
  surfaceId: SurfaceInstanceId;
  geometry: PaperGeometry;
  pose: PaperPose;
}>;
