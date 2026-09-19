import type { SurfaceInstanceId } from "../../lib/reader/spatial-contract";
/** Private presentation math; coordinates are unscaled paper CSS pixels. */
export type PaperRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
export type PaperPose = { x: number; y: number } & {
  scale: number;
  opacity: number;
};
export type PaperMotion<Id extends string = SurfaceInstanceId> = ReadonlyMap<
  Id,
  PaperPose
>;
export type SurfaceLayout = {
  width: number;
  height: number;
  scroll: PaperRect;
  maxScroll: number;
};
export function interpolatePaperMotion<Id extends string>(
  a: PaperMotion<Id>,
  b: PaperMotion<Id>,
  amount: number,
): PaperMotion<Id> {
  return new Map(
    [...b].map(([id, target]) => {
      const start = a.get(id) ?? target;
      return [
        id,
        {
          x: start.x + (target.x - start.x) * amount,
          y: start.y + (target.y - start.y) * amount,
          scale: start.scale + (target.scale - start.scale) * amount,
          opacity: start.opacity + (target.opacity - start.opacity) * amount,
        },
      ];
    }),
  );
}

export function paperRect(
  layout: SurfaceLayout,
  pose: PaperPose,
  viewport: { width: number; height: number },
): PaperRect {
  const left = viewport.width / 2 + pose.x - (layout.width * pose.scale) / 2;
  const top = viewport.height / 2 + pose.y - (layout.height * pose.scale) / 2;
  return {
    left,
    top,
    right: left + layout.width * pose.scale,
    bottom: top + layout.height * pose.scale,
  };
}

/** Align each body's own 42% line after role scaling, before camera projection. */
export function alignPaperReadingLines<Id extends string>(
  poses: PaperMotion<Id>,
  layouts: ReadonlyMap<Id, SurfaceLayout>,
  currentId: Id | undefined,
): PaperMotion<Id> {
  if (!currentId) return poses;
  const currentPose = poses.get(currentId);
  const currentLayout = layouts.get(currentId);
  if (!currentPose || !currentLayout) return poses;
  const lineOffset = (layout: SurfaceLayout, scale: number) =>
    (-layout.height / 2 +
      layout.scroll.top +
      (layout.scroll.bottom - layout.scroll.top) * 0.42) *
    scale;
  const line = currentPose.y + lineOffset(currentLayout, currentPose.scale);
  let result: Map<Id, PaperPose> | undefined;
  for (const [id, pose] of poses) {
    if (id === currentId || pose.opacity < 1) continue;
    const layout = layouts.get(id);
    if (!layout) continue;
    const y = line - lineOffset(layout, pose.scale);
    if (Math.abs(y - pose.y) < 0.01) continue;
    result ??= new Map(poses);
    result.set(id, { ...pose, y });
  }
  return result ?? poses;
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

/** Reconcile focus targets after virtual spacer measurements commit.
 * A layout correction preserves the other endpoint's unfinished scroll.
 */
export function reconcileFocusScroll<Id extends string>(
  measured: ReadonlyMap<Id, number>,
  displayed: ReadonlyMap<Id, number>,
  scheduled: ReadonlyMap<Id, number>,
  interrupted: ReadonlySet<Id>,
): ReadonlyMap<Id, number> | undefined {
  let next: Map<Id, number> | undefined;
  for (const [id, target] of measured) {
    if (interrupted.has(id)) continue;
    const previous = scheduled.get(id) ?? displayed.get(id);
    if (previous !== undefined && Math.abs(target - previous) <= 1) continue;
    next ??= new Map(scheduled);
    next.set(id, target);
  }
  if (next) for (const id of interrupted) next.delete(id);
  return next;
}
