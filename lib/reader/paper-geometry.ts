import type { CameraViewport, PaperPose } from "./camera";
import type { SurfaceInstanceId } from "./spatial-contract";

export type PaperGeometry = Readonly<{ width: number; height: number }>;
/** Maximum portrait size; camera motion and payload residency never change paper size. */
export const PAPER_GEOMETRY: PaperGeometry = Object.freeze({
  width: 600,
  height: 780,
});
/** Short viewports need a shorter scroll container, not illegibly scaled portrait text. */
export function paperGeometryForViewport(
  viewport: CameraViewport,
): PaperGeometry {
  const readingWidth = Math.min(
    PAPER_GEOMETRY.width,
    Math.max(1, viewport.width - 32),
  );
  return {
    width: PAPER_GEOMETRY.width,
    height: Math.min(
      PAPER_GEOMETRY.height,
      Math.max(
        // Leave room for the compact header, scroll padding and a line of text.
        160,
        ((viewport.height - 96) * PAPER_GEOMETRY.width) / readingWidth,
      ),
    ),
  };
}
export type PaperInstance = Readonly<{
  surfaceId: SurfaceInstanceId;
  geometry: PaperGeometry;
  pose: PaperPose;
}>;
