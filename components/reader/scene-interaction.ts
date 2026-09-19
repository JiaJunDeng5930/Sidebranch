import {
  cameraAxis,
  dollyCamera,
  orbitCamera,
  panCamera,
  screenPoint,
  screenToPlane,
  worldPoint,
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
  paint(view: SpaceView): void;
  checkpoint(checkpoint: ViewCheckpoint): void;
  settled(): void;
  stopPresentation(): void;
}
type Gesture = {
  before: SpaceView;
  draft: SpaceView;
  generation: number;
  origin: ScreenPoint;
  last: ScreenPoint;
  id: number;
  mode: "orbit" | "pan" | "paper" | "depth";
  surfaceId: SurfaceInstanceId | null;
  center: WorldPoint3 | null;
  grab: WorldPoint3 | null;
  started: boolean;
};
export class SceneInteraction {
  private adapter!: SceneInteractionAdapter;
  private gesture: Gesture | null = null;
  private pointers = new Map<number, ScreenPoint>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wheelBefore: SpaceView | null = null;
  private wheelGeneration: number | null = null;
  private wheelDraft: SpaceView | null = null;
  private suppressed = false;
  configure(adapter: SceneInteractionAdapter) {
    this.adapter = adapter;
  }
  get active() {
    return Boolean(this.gesture || this.wheelBefore);
  }
  private point(event: { clientX: number; clientY: number }) {
    const { offset } = this.adapter.context();
    return screenPoint(event.clientX - offset.left, event.clientY - offset.top);
  }
  private release() {
    const node = this.adapter.context().element;
    for (const id of this.pointers.keys()) {
      try {
        if (node?.hasPointerCapture(id)) node.releasePointerCapture(id);
      } catch {}
    }
    this.pointers.clear();
  }
  consumeClick(): boolean {
    const value = this.suppressed;
    this.suppressed = false;
    return value;
  }
  synchronize() {
    if (
      this.gesture &&
      this.gesture.generation !== this.adapter.context().generation
    )
      this.cancel();
  }
  pointerDown(event: PointerInput) {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const edge = event.target.closest<HTMLElement>("[data-paper-grip]");
    if (
      !edge &&
      event.target.closest(
        "[data-paper],button,a,input,textarea,[role='button']",
      )
    )
      return;
    const p = this.point(event);
    this.suppressed = false;
    if (this.gesture) {
      if (event.pointerType !== "touch" || this.gesture.surfaceId) return;
      this.pointers.set(event.pointerId, p);
      this.gesture.started = true;
      for (const id of this.pointers.keys())
        try {
          this.adapter.context().element?.setPointerCapture(id);
        } catch {}
      event.preventDefault();
      return;
    }
    this.finishWheel();
    const { view, generation, viewport } = this.adapter.context();
    const id = edge?.dataset.paperGrip as SurfaceInstanceId | undefined;
    const center = id ? this.adapter.pose(view, id).position : null;
    this.gesture = {
      before: view,
      draft: view,
      generation,
      origin: p,
      last: p,
      id: event.pointerId,
      mode: id
        ? event.shiftKey
          ? "depth"
          : "paper"
        : event.shiftKey
          ? "pan"
          : "orbit",
      surfaceId: id ?? null,
      center,
      grab: center ? screenToPlane(p, view.camera, viewport, center) : null,
      started: false,
    };
    this.pointers.set(event.pointerId, p);
  }
  pointerMove(event: PointerInput) {
    const g = this.gesture;
    if (!g || !this.pointers.has(event.pointerId)) return;
    const p = this.point(event);
    const { viewport } = this.adapter.context();
    if (!g.started && Math.hypot(p.x - g.origin.x, p.y - g.origin.y) < 5)
      return;
    if (!g.started) {
      g.started = true;
      this.adapter.stopPresentation();
      try {
        this.adapter.context().element?.setPointerCapture(event.pointerId);
      } catch {}
    }
    const old = [...this.pointers.values()];
    this.pointers.set(event.pointerId, p);
    let view = g.draft;
    if (this.pointers.size === 2 && !g.surfaceId) {
      const next = [...this.pointers.values()];
      const midpoint = (a: ScreenPoint, b: ScreenPoint) =>
        screenPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      const a = midpoint(old[0], old[1]),
        b = midpoint(next[0], next[1]);
      const ratio =
        Math.hypot(old[0].x - old[1].x, old[0].y - old[1].y) /
        Math.max(1, Math.hypot(next[0].x - next[1].x, next[0].y - next[1].y));
      view = {
        ...view,
        camera: dollyCamera(
          panCamera(view.camera, b.x - a.x, b.y - a.y),
          Math.log(ratio),
        ),
      };
    } else if (g.surfaceId && g.center && g.grab) {
      let center: WorldPoint3;
      if (g.mode === "depth") {
        const axis = cameraAxis(view.camera, [0, 0, 1]);
        const delta = (g.origin.y - p.y) * 3;
        center = worldPoint(
          g.center.x + axis.x * delta,
          g.center.y + axis.y * delta,
          g.center.z + axis.z * delta,
        );
      } else {
        const hit = screenToPlane(p, view.camera, viewport, g.center);
        if (!hit) return;
        center = worldPoint(
          g.center.x + hit.x - g.grab.x,
          g.center.y + hit.y - g.grab.y,
          g.center.z + hit.z - g.grab.z,
        );
      }
      view = {
        ...view,
        placements: new Map(view.placements).set(g.surfaceId, {
          ...this.adapter.pose(view, g.surfaceId),
          position: center,
        }),
      };
    } else
      view = {
        ...view,
        camera: (g.mode === "pan" ? panCamera : orbitCamera)(
          view.camera,
          p.x - g.last.x,
          p.y - g.last.y,
        ),
      };
    g.last = p;
    g.draft = view;
    this.adapter.paint(view);
    event.preventDefault();
  }
  pointerUp(event: Pick<PointerEvent, "pointerId">) {
    const g = this.gesture;
    if (!g || !this.pointers.has(event.pointerId)) return;
    if (this.pointers.size > 1) {
      this.pointers.delete(event.pointerId);
      const [id, p] = [...this.pointers][0];
      g.id = id;
      g.last = p;
      return;
    }
    this.gesture = null;
    this.suppressed = g.started;
    this.release();
    if (g.started && !sameSpaceView(g.before, g.draft))
      this.adapter.checkpoint({ generation: g.generation, view: g.draft });
    this.adapter.settled();
  }
  lostPointerCapture(event: Pick<PointerEvent, "pointerId">) {
    if (this.pointers.has(event.pointerId)) this.cancel();
  }
  cancel(): boolean {
    const g = this.gesture;
    this.gesture = null;
    if (g) {
      this.release();
      this.adapter.paint(g.before);
      this.adapter.settled();
      return true;
    }
    if (this.wheelBefore) {
      const view = this.wheelBefore;
      this.clearWheel();
      this.adapter.paint(view);
      return true;
    }
    return false;
  }
  private clearWheel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.wheelBefore = null;
    this.wheelDraft = null;
    this.wheelGeneration = null;
  }
  private finishWheel() {
    if (this.wheelDraft) {
      this.adapter.checkpoint({
        generation: this.wheelGeneration ?? this.adapter.context().generation,
        view: this.wheelDraft,
      });
      this.clearWheel();
      this.adapter.settled();
    }
  }
  wheel(
    event: Pick<
      WheelEvent,
      "target" | "deltaY" | "deltaMode" | "ctrlKey" | "preventDefault"
    >,
  ) {
    if (
      !(event.target instanceof Element) ||
      event.target.closest("[data-paper],button,a,input") ||
      this.gesture
    )
      return;
    event.preventDefault();
    const context = this.adapter.context();
    this.wheelBefore ??= context.view;
    this.wheelGeneration ??= context.generation;
    const view = this.wheelDraft ?? context.view;
    const scale =
      event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? context.viewport.height
          : 1;
    this.wheelDraft = {
      ...view,
      camera: dollyCamera(
        view.camera,
        event.deltaY * scale * (event.ctrlKey ? 0.006 : 0.0015),
      ),
    };
    this.adapter.paint(this.wheelDraft);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.finishWheel(), 150);
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
    event.preventDefault();
    return true;
  }
  dispose() {
    this.cancel();
    this.clearWheel();
  }
}
