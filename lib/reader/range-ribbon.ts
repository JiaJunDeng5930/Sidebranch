import type { WorldPoint3 } from "./camera";

export type WorldPassageMouth = Readonly<{
  start: WorldPoint3;
  end: WorldPoint3;
}>;

export type PassageBandGeometry = Readonly<{
  /** Four world-space vertices in domain coordinates (x-right, y-down). */
  positions: Float32Array;
  indices: Uint16Array;
  /** Interpolate this attribute at a Three ray hit to choose its endpoint. */
  endpointWeights: Float32Array;
}>;

/**
 * A single connected indexed surface, independent of either passage's row count.
 * The renderer converts positions to its coordinate basis and lets Three handle
 * near-plane clipping and raycasting. Apply paper-normal offsets before calling.
 */
export function buildPassageBandGeometry(
  from: WorldPassageMouth,
  to: WorldPassageMouth,
): PassageBandGeometry {
  const points = [from.start, to.start, to.end, from.end];
  return {
    positions: new Float32Array(points.flatMap((p) => [p.x, p.y, p.z])),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    endpointWeights: new Float32Array([0, 1, 1, 0]),
  };
}
