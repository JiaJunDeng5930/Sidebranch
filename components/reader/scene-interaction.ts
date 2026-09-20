import {
  cameraAxis,
  screenPoint,
  screenToPlane,
  worldPoint,
  type CameraPose,
  type CameraViewport,
  type ScreenPoint,
  type WorldPoint3,
  type PaperPose,
} from "../../lib/reader/camera";
import { sameSpaceView, type SpaceView } from "../../lib/reader/space-view";
import type {
  SurfaceInstanceId,
  ViewCheckpoint,
} from "../../lib/reader/spatial-contract";
type PointerInput = Pick<
  PointerEvent,
  | "pointerId"
  | "pointerType"
  | "clientX"
  | "clientY"
  | "button"
  | "shiftKey"
  | "target"
  | "preventDefault"
>;
type Context = {
  generation: number;
  view: SpaceView;
  viewport: CameraViewport;
  offset: { left: number; top: number };
  element: HTMLElement | null;
};
export interface SceneInteractionAdapter {
  context(): Context;
  pose(view: SpaceView, id: SurfaceInstanceId): PaperPose;
  grabPoint?(id: SurfaceInstanceId, point: ScreenPoint): WorldPoint3 | null;
  paint(view: SpaceView): void;
  checkpoint(checkpoint: ViewCheckpoint): void;
  settled(): void;
  stopPresentation(): void;
  stopCameraInput?(): void;
  setCameraEnabled?(enabled: boolean): void;
  wheelCamera?(
    dx: number,
    dy: number,
    dolly: boolean,
    point: ScreenPoint,
  ): CameraPose;
}
type Draft = { before: SpaceView; draft: SpaceView; generation: number };
type PaperGesture = Draft & {
  origin: ScreenPoint;
  id: number;
  mode: "paper" | "depth";
  surfaceId: SurfaceInstanceId;
  pose: PaperPose;
  grab: WorldPoint3;
  normal: WorldPoint3;
  started: boolean;
};

/** Coordinates immutable gesture drafts. OrbitControls alone owns camera pointer mechanics. */
export class SceneInteraction {
  private adapter!: SceneInteractionAdapter;
  private gesture: PaperGesture | null = null;
  private cameraDraft: Draft | null = null;
  private wheelDraft: Draft | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private suppressed = false;
  configure(adapter: SceneInteractionAdapter) {
    this.adapter = adapter;
  }
  get active() {
    return !!(this.gesture || this.cameraDraft || this.wheelDraft);
  }
  get activeSurfaceId() {
    return this.gesture?.surfaceId ?? null;
  }
  private point(event: { clientX: number; clientY: number }) {
    const { offset } = this.adapter.context();
    return screenPoint(event.clientX - offset.left, event.clientY - offset.top);
  }
  consumeClick(): boolean {
    const value = this.suppressed;
    this.suppressed = false;
    return value;
  }
  synchronize() {
    const active = this.gesture ?? this.cameraDraft ?? this.wheelDraft;
    if (active && active.generation !== this.adapter.context().generation)
      this.cancel();
  }
  private startDraft(): Draft {
    const { view, generation } = this.adapter.context();
    return { before: view, draft: view, generation };
  }
  cameraStart(): void {
    if (this.gesture) return;
    this.finishWheel();
    this.suppressed = false;
    this.cameraDraft = this.startDraft();
    this.adapter.stopPresentation();
  }
  cameraChange(camera: CameraPose): void {
    if (!this.cameraDraft || this.gesture) return;
    this.cameraDraft.draft = { ...this.cameraDraft.draft, camera };
    this.adapter.paint(this.cameraDraft.draft);
  }
  cameraEnd(): void {
    const draft = this.cameraDraft;
    this.cameraDraft = null;
    if (!draft) return;
    this.suppressed = !sameSpaceView(draft.before, draft.draft);
    this.commit(draft);
  }
  pointerDown(event: PointerInput): void {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    if (!this.active) this.suppressed = false;
    const edge = event.target.closest<HTMLElement>("[data-paper-grip]");
    if (
      !edge ||
      event.target.closest("button,a,input,textarea") ||
      this.gesture ||
      this.cameraDraft
    )
      return;
    this.finishWheel();
    const { view, viewport } = this.adapter.context();
    const id = edge.dataset.paperGrip as SurfaceInstanceId;
    const pose = this.adapter.pose(view, id),
      origin = this.point(event);
    const grab =
      this.adapter.grabPoint?.(id, origin) ??
      screenToPlane(origin, view.camera, viewport, pose.position);
    if (!grab) return;
    this.gesture = {
      ...this.startDraft(),
      origin,
      id: event.pointerId,
      mode: event.shiftKey ? "depth" : "paper",
      surfaceId: id,
      pose,
      grab,
      normal: cameraAxis(view.camera, [0, 0, 1]),
      started: false,
    };
    this.adapter.setCameraEnabled?.(false);
  }
  pointerMove(event: PointerInput): void {
    const gesture = this.gesture;
    if (!gesture || gesture.id !== event.pointerId) return;
    const p = this.point(event);
    if (
      !gesture.started &&
      Math.hypot(p.x - gesture.origin.x, p.y - gesture.origin.y) < 5
    )
      return;
    if (!gesture.started) {
      gesture.started = true;
      this.adapter.stopPresentation();
      try {
        this.adapter.context().element?.setPointerCapture(event.pointerId);
      } catch {}
    }
    let position: WorldPoint3;
    if (gesture.mode === "depth") {
      const delta = (gesture.origin.y - p.y) * 3;
      position = worldPoint(
        gesture.pose.position.x + gesture.normal.x * delta,
        gesture.pose.position.y + gesture.normal.y * delta,
        gesture.pose.position.z + gesture.normal.z * delta,
      );
    } else {
      // Freeze the grabbed point, camera and plane at pointerdown; threshold crossing
      // must not move the plane or produce a discontinuity on a tilted paper.
      const hit = screenToPlane(
        p,
        gesture.before.camera,
        this.adapter.context().viewport,
        gesture.grab,
        gesture.normal,
      );
      if (!hit) return;
      position = worldPoint(
        gesture.pose.position.x + hit.x - gesture.grab.x,
        gesture.pose.position.y + hit.y - gesture.grab.y,
        gesture.pose.position.z + hit.z - gesture.grab.z,
      );
    }
    gesture.draft = {
      ...gesture.draft,
      placements: new Map(gesture.draft.placements).set(gesture.surfaceId, {
        ...gesture.pose,
        position,
      }),
    };
    this.adapter.paint(gesture.draft);
    event.preventDefault();
  }
  pointerUp(event: Pick<PointerEvent, "pointerId">): void {
    const gesture = this.gesture;
    if (!gesture || gesture.id !== event.pointerId) return;
    this.gesture = null;
    this.suppressed = gesture.started;
    this.releasePaperCapture(gesture.id);
    this.adapter.setCameraEnabled?.(true);
    this.commit(gesture);
  }
  lostPointerCapture(event: Pick<PointerEvent, "pointerId">): void {
    if (this.gesture?.id === event.pointerId || this.cameraDraft) this.cancel();
  }
  private releasePaperCapture(id: number) {
    const node = this.adapter.context().element;
    try {
      if (node?.hasPointerCapture(id)) node.releasePointerCapture(id);
    } catch {}
  }
  private commit(draft: Draft): void {
    if (!sameSpaceView(draft.before, draft.draft))
      this.adapter.checkpoint({
        generation: draft.generation,
        view: draft.draft,
      });
    this.adapter.settled();
  }
  cancel(): boolean {
    const draft = this.gesture ?? this.cameraDraft ?? this.wheelDraft;
    if (!draft) return false;
    const id = this.gesture?.id;
    this.gesture = null;
    this.cameraDraft = null;
    this.clearWheel();
    if (id !== undefined) this.releasePaperCapture(id);
    this.adapter.stopCameraInput?.();
    this.adapter.setCameraEnabled?.(true);
    this.adapter.paint(draft.before);
    this.adapter.settled();
    this.suppressed = true;
    return true;
  }
  private clearWheel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.wheelDraft = null;
  }
  private finishWheel(): void {
    const draft = this.wheelDraft;
    this.clearWheel();
    if (draft) this.commit(draft);
  }
  wheel(
    event: Pick<
      WheelEvent,
      | "target"
      | "deltaX"
      | "deltaY"
      | "deltaMode"
      | "ctrlKey"
      | "altKey"
      | "clientX"
      | "clientY"
      | "preventDefault"
      | "stopImmediatePropagation"
    >,
  ): void {
    const dolly = event.ctrlKey || event.altKey;
    if (
      !(event.target instanceof Element) ||
      (!dolly && event.target.closest("[data-paper],button,a,input,textarea"))
    )
      return;
    if (this.gesture || this.cameraDraft) {
      if (dolly) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (!this.adapter.wheelCamera) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!this.wheelDraft) {
      this.wheelDraft = this.startDraft();
      this.adapter.stopPresentation();
    }
    const scale =
      event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? this.adapter.context().viewport.height
          : 1;
    this.wheelDraft.draft = {
      ...this.wheelDraft.draft,
      camera: this.adapter.wheelCamera(
        event.deltaX * scale,
        event.deltaY * scale,
        event.ctrlKey || event.altKey,
        this.point(event),
      ),
    };
    this.adapter.paint(this.wheelDraft.draft);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.finishWheel(), 160);
  }
  keyDown(
    event: Pick<
      KeyboardEvent,
      "key" | "shiftKey" | "target" | "preventDefault" | "stopPropagation"
    >,
  ): boolean {
    if (event.key === "Escape" && this.cancel()) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    if (!(event.target instanceof Element)) return false;
    const edge = event.target.closest<HTMLElement>("[data-paper-grip]");
    if (!edge) return false;
    const delta = (
      {
        ArrowLeft: [-24, 0],
        ArrowRight: [24, 0],
        ArrowUp: [0, -24],
        ArrowDown: [0, 24],
      } as Record<string, number[]>
    )[event.key];
    if (!delta) return false;
    const context = this.adapter.context(),
      id = edge.dataset.paperGrip as SurfaceInstanceId,
      pose = this.adapter.pose(context.view, id);
    const axis = cameraAxis(
      context.view.camera,
      event.shiftKey ? [0, 0, -delta[1]] : [delta[0], delta[1], 0],
    );
    const view = {
      ...context.view,
      placements: new Map(context.view.placements).set(id, {
        ...pose,
        position: worldPoint(
          pose.position.x + axis.x,
          pose.position.y + axis.y,
          pose.position.z + axis.z,
        ),
      }),
    };
    this.adapter.paint(view);
    this.adapter.checkpoint({ generation: context.generation, view });
    this.adapter.settled();
    event.preventDefault();
    return true;
  }
  dispose(): void {
    this.cancel();
    this.clearWheel();
  }
}
