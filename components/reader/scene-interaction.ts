import type { CameraPose } from "../../lib/reader/attention";
import {
  CAMERA_LIMITS,
  constrainCameraPose,
  isProjectionSafe,
  screenPoint,
  screenToWorld,
  worldPoint,
  type CameraViewport,
  type ScreenPoint,
  type WorldPoint,
} from "../../lib/reader/camera";
import { sameSpaceView, type SpaceView } from "../../lib/reader/space-view";
import type {
  SurfaceInstanceId,
  ViewCheckpoint,
} from "../../lib/reader/spatial-contract";

type FreeView = Extract<SpaceView, { kind: "free" }>;
type Pointer = { id: number; point: ScreenPoint; type: string };
type Before = { generation: number; view: SpaceView };
type Active = Before & { draft: FreeView };
type PointerIntent = {
  pointer: Pointer;
  origin: ScreenPoint;
  target:
    | { kind: "camera"; mode: "pan" | "orbit" }
    | { kind: "paper"; surfaceId: SurfaceInstanceId };
};
type InputTransaction =
  | { kind: "idle" }
  | ({ kind: "armed" } & Before & PointerIntent)
  | ({
      kind: "camera";
      mode: "pan" | "orbit" | "pinch" | "wheel";
      pointers: readonly Pointer[];
    } & Active)
  | ({
      kind: "paper";
      surfaceId: SurfaceInstanceId;
      pointer: Pointer | null;
      grab: WorldPoint;
      center: WorldPoint;
    } & Active);

export interface SceneInteractionAdapter {
  context(): Before & {
    viewport: CameraViewport;
    offset: { left: number; top: number };
    element: HTMLElement | null;
  };
  enterFree(): FreeView;
  center(view: FreeView, id: SurfaceInstanceId): WorldPoint;
  corners(view: FreeView): readonly WorldPoint[];
  stopPresentation(): void;
  paint(view: SpaceView): void;
  checkpoint(value: ViewCheckpoint): void;
  settled(): void;
}

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
type KeyInput = Pick<
  KeyboardEvent,
  "key" | "shiftKey" | "target" | "preventDefault" | "stopPropagation"
>;

function selectionExists(): boolean {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed);
}

function control(target: Element): boolean {
  return Boolean(
    target.closest(
      "input,textarea,select,button,a,[role='button'],[contenteditable='true']",
    ),
  );
}

/** One owner for pointer, wheel and keyboard drafts; only finish publishes a view. */
export class SceneInteraction {
  private transaction: InputTransaction = { kind: "idle" };
  private frame: number | null = null;
  private wheelTimer: number | null = null;
  private readonly captures = new Set<number>();
  private callbacks: SceneInteractionAdapter | null = null;
  configure(callbacks: SceneInteractionAdapter): void {
    this.callbacks = callbacks;
  }
  private adapter(): SceneInteractionAdapter {
    if (!this.callbacks)
      throw new Error("SceneInteraction requires configured callbacks");
    return this.callbacks;
  }

  get active(): boolean {
    return this.transaction.kind !== "idle";
  }

  private point(event: { clientX: number; clientY: number }): ScreenPoint {
    const offset = this.adapter().context().offset;
    return screenPoint(event.clientX - offset.left, event.clientY - offset.top);
  }

  private capture(id: number): void {
    const element = this.adapter().context().element;
    try {
      element?.setPointerCapture(id);
      this.captures.add(id);
    } catch {
      /* Pointer may already have ended. */
    }
  }

  private clear(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    if (this.wheelTimer !== null) window.clearTimeout(this.wheelTimer);
    this.frame = null;
    this.wheelTimer = null;
    const element = this.adapter().context().element;
    // Enter idle before release: normal lostpointercapture must not roll back a commit.
    this.transaction = { kind: "idle" };
    for (const id of this.captures)
      if (element?.hasPointerCapture(id)) element.releasePointerCapture(id);
    this.captures.clear();
  }

  cancel(): boolean {
    const transaction = this.transaction;
    if (transaction.kind === "idle") return false;
    const context = this.adapter().context();
    this.clear();
    if (transaction.kind !== "armed") {
      this.adapter().paint(
        transaction.generation === context.generation
          ? transaction.view
          : context.view,
      );
      this.adapter().settled();
    }
    return true;
  }

  synchronize(): void {
    if (this.active) this.cancel();
  }

  private paint(): void {
    this.frame = null;
    const transaction = this.transaction;
    if (transaction.kind === "idle" || transaction.kind === "armed") return;
    if (transaction.generation !== this.adapter().context().generation) {
      this.cancel();
      return;
    }
    this.adapter().paint(transaction.draft);
  }

  private schedule(): void {
    if (this.frame === null)
      this.frame = requestAnimationFrame(() => this.paint());
  }

  private finish(): void {
    const transaction = this.transaction;
    if (transaction.kind === "idle") return;
    if (transaction.kind === "armed") {
      this.clear();
      return;
    }
    if (transaction.generation !== this.adapter().context().generation) {
      this.cancel();
      return;
    }
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.paint();
    this.clear();
    this.adapter().settled();
    if (!sameSpaceView(transaction.view, transaction.draft))
      this.adapter().checkpoint({
        generation: transaction.generation,
        view: transaction.draft,
      });
  }

  private begin(): Active {
    const context = this.adapter().context();
    const draft = this.adapter().enterFree();
    this.adapter().stopPresentation();
    return { generation: context.generation, view: context.view, draft };
  }

  private camera(
    pose: CameraPose,
    anchor?: { world: WorldPoint; screen: ScreenPoint },
  ): void {
    const transaction = this.transaction;
    if (transaction.kind !== "camera") return;
    const viewport = this.adapter().context().viewport;
    const camera = constrainCameraPose(pose, transaction.draft.camera, {
      safetyCorners: this.adapter().corners(transaction.draft),
      ...(anchor ? { anchor: { ...anchor, viewport } } : {}),
    });
    transaction.draft = { ...transaction.draft, camera };
    this.schedule();
  }

  pointerDown(event: PointerInput): void {
    const target = event.target;
    if (!(target instanceof Element) || event.button !== 0) return;
    const grip = target.closest<HTMLElement>("[data-paper-grip]");
    const stage =
      target.closest<HTMLElement>("[data-hit-role]")?.dataset.hitRole ===
      "stage";
    if (
      !grip &&
      (!stage || control(target) || target.closest("[data-document-scroll]"))
    )
      return;
    if (selectionExists() && !grip) return;
    if (this.transaction.kind === "camera" && this.transaction.mode === "wheel")
      this.finish();
    const pointer: Pointer = {
      id: event.pointerId,
      type: event.pointerType,
      point: this.point(event),
    };
    const old = this.transaction;
    if (old.kind !== "idle") {
      if (!stage || pointer.type !== "touch") return;
      const first =
        old.kind === "armed" &&
        old.target.kind === "camera" &&
        old.target.mode === "pan"
          ? old.pointer
          : old.kind === "camera" && old.mode === "pan"
            ? old.pointers[0]
            : null;
      if (!first || first.type !== "touch" || first.id === pointer.id) return;
      const active = old.kind === "armed" ? this.begin() : (old as Active);
      this.transaction = {
        ...active,
        kind: "camera",
        mode: "pinch",
        pointers: [first, pointer],
      };
      this.capture(first.id);
      this.capture(pointer.id);
      event.preventDefault();
      this.schedule();
      return;
    }
    const context = this.adapter().context();
    this.transaction = {
      kind: "armed",
      generation: context.generation,
      view: context.view,
      pointer,
      origin: pointer.point,
      target: grip
        ? {
            kind: "paper",
            surfaceId: grip.dataset.paperGrip as SurfaceInstanceId,
          }
        : { kind: "camera", mode: event.shiftKey ? "orbit" : "pan" },
    };
  }

  pointerMove(event: PointerInput): void {
    let transaction = this.transaction;
    if (transaction.kind === "idle") return;
    if (transaction.generation !== this.adapter().context().generation) {
      this.cancel();
      return;
    }
    const point = this.point(event);
    if (transaction.kind === "armed") {
      if (event.pointerId !== transaction.pointer.id) return;
      const threshold = transaction.pointer.type === "touch" ? 8 : 4;
      if (
        Math.hypot(
          point.x - transaction.origin.x,
          point.y - transaction.origin.y,
        ) < threshold
      )
        return;
      const active = this.begin();
      if (transaction.target.kind === "camera") {
        this.transaction = {
          ...active,
          kind: "camera",
          mode: transaction.target.mode,
          pointers: [transaction.pointer],
        };
      } else {
        const center = this.adapter().center(
          active.draft,
          transaction.target.surfaceId,
        );
        this.transaction = {
          ...active,
          kind: "paper",
          surfaceId: transaction.target.surfaceId,
          pointer: transaction.pointer,
          center,
          grab: screenToWorld(
            transaction.origin,
            active.draft.camera,
            this.adapter().context().viewport,
          ),
        };
      }
      this.capture(event.pointerId);
      transaction = this.transaction;
    }
    const viewport = this.adapter().context().viewport;
    if (transaction.kind === "paper") {
      if (transaction.pointer?.id !== event.pointerId) return;
      const world = screenToWorld(point, transaction.draft.camera, viewport);
      this.movePaper(
        worldPoint(
          transaction.center.x + world.x - transaction.grab.x,
          transaction.center.y + world.y - transaction.grab.y,
        ),
      );
    } else if (transaction.kind === "camera") {
      const index = transaction.pointers.findIndex(
        (pointer) => pointer.id === event.pointerId,
      );
      if (index < 0) return;
      const before = transaction.pointers;
      const next = before.map((pointer, i) =>
        i === index ? { ...pointer, point } : pointer,
      );
      const camera = transaction.draft.camera;
      if (transaction.mode === "pinch" && before.length === 2) {
        const midpoint = (points: readonly Pointer[]) =>
          screenPoint(
            (points[0].point.x + points[1].point.x) / 2,
            (points[0].point.y + points[1].point.y) / 2,
          );
        const distance = (points: readonly Pointer[]) =>
          Math.hypot(
            points[0].point.x - points[1].point.x,
            points[0].point.y - points[1].point.y,
          );
        const ratio = distance(next) / Math.max(1, distance(before));
        this.camera(
          { ...camera, zoom: camera.zoom * ratio },
          {
            world: screenToWorld(midpoint(before), camera, viewport),
            screen: midpoint(next),
          },
        );
      } else if (transaction.mode === "pan") {
        this.camera(camera, {
          world: screenToWorld(before[index].point, camera, viewport),
          screen: point,
        });
      } else if (transaction.mode === "orbit") {
        const anchor = screenPoint(viewport.width / 2, viewport.height / 2);
        this.camera(
          {
            ...camera,
            yaw: camera.yaw + (point.x - before[index].point.x) * 0.18,
            pitch: camera.pitch + (point.y - before[index].point.y) * 0.12,
          },
          { world: screenToWorld(anchor, camera, viewport), screen: anchor },
        );
      }
      transaction.pointers = next;
    }
    event.preventDefault();
  }

  pointerUp(event: PointerInput): void {
    this.pointerMove(event);
    const transaction = this.transaction;
    if (
      (transaction.kind === "armed" || transaction.kind === "paper") &&
      transaction.pointer?.id === event.pointerId
    )
      this.finish();
    else if (
      transaction.kind === "camera" &&
      transaction.pointers.some((pointer) => pointer.id === event.pointerId)
    )
      this.finish();
  }

  pointerCancel(event: Pick<PointerEvent, "pointerId">): void {
    const transaction = this.transaction;
    if (
      this.captures.has(event.pointerId) ||
      (transaction.kind === "armed" &&
        transaction.pointer.id === event.pointerId)
    )
      this.cancel();
  }

  wheel(event: WheelEvent): void {
    const target = event.target;
    if (!(target instanceof Element) || selectionExists() || control(target))
      return;
    const zoom = event.ctrlKey || event.metaKey;
    const stage =
      target.closest<HTMLElement>("[data-hit-role]")?.dataset.hitRole ===
      "stage";
    if (!zoom && !stage) return;
    if (
      this.transaction.kind !== "idle" &&
      !(this.transaction.kind === "camera" && this.transaction.mode === "wheel")
    )
      return;
    event.preventDefault();
    if (this.transaction.kind === "idle")
      this.transaction = {
        ...this.begin(),
        kind: "camera",
        mode: "wheel",
        pointers: [],
      };
    const transaction = this.transaction;
    if (transaction.kind !== "camera") return;
    const { viewport } = this.adapter().context();
    const scale =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1;
    const point = this.point(event);
    const camera = transaction.draft.camera;
    const destination = zoom
      ? point
      : screenPoint(
          point.x - (event.shiftKey ? event.deltaY : event.deltaX) * scale,
          point.y - (event.shiftKey ? 0 : event.deltaY) * scale,
        );
    this.camera(
      {
        ...camera,
        zoom: zoom
          ? camera.zoom * Math.exp(-event.deltaY * scale * 0.001)
          : camera.zoom,
      },
      { world: screenToWorld(point, camera, viewport), screen: destination },
    );
    if (this.wheelTimer !== null) window.clearTimeout(this.wheelTimer);
    const generation = transaction.generation;
    this.wheelTimer = window.setTimeout(() => {
      if (
        this.transaction.kind === "camera" &&
        this.transaction.mode === "wheel" &&
        this.transaction.generation === generation
      )
        this.finish();
    }, 120);
  }

  zoom(zoom: number): void {
    if (this.active || !Number.isFinite(zoom)) return;
    this.transaction = {
      ...this.begin(),
      kind: "camera",
      mode: "wheel",
      pointers: [],
    };
    const { viewport } = this.adapter().context();
    const point = screenPoint(viewport.width / 2, viewport.height / 2);
    const camera = this.transaction.draft.camera;
    this.camera(
      {
        ...camera,
        zoom: Math.max(
          CAMERA_LIMITS.zoomMin,
          Math.min(CAMERA_LIMITS.zoomMax, zoom),
        ),
      },
      { world: screenToWorld(point, camera, viewport), screen: point },
    );
    this.finish();
  }

  private movePaper(center: WorldPoint): void {
    const transaction = this.transaction;
    if (transaction.kind !== "paper") return;
    const previous = this.adapter().center(
      transaction.draft,
      transaction.surfaceId,
    );
    const candidate = (fraction: number): FreeView => ({
      ...transaction.draft,
      placements: new Map(transaction.draft.placements).set(
        transaction.surfaceId,
        {
          kind: "manual",
          center: worldPoint(
            previous.x + (center.x - previous.x) * fraction,
            previous.y + (center.y - previous.y) * fraction,
          ),
        },
      ),
    });
    let draft = candidate(1);
    if (!isProjectionSafe(this.adapter().corners(draft), draft.camera)) {
      let low = 0;
      let high = 1;
      for (let i = 0; i < 28; i += 1) {
        const middle = (low + high) / 2;
        const next = candidate(middle);
        if (isProjectionSafe(this.adapter().corners(next), next.camera))
          low = middle;
        else high = middle;
      }
      draft = candidate(low);
    }
    transaction.draft = draft;
    this.schedule();
  }

  keyDown(event: KeyInput): boolean {
    if (event.key === "Escape" && this.cancel()) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    const target = event.target;
    const grip =
      target instanceof Element
        ? target.closest<HTMLElement>("[data-paper-grip]")
        : null;
    if (!grip) return false;
    if (this.transaction.kind === "idle" && event.key === "Enter") {
      const active = this.begin();
      const surfaceId = grip.dataset.paperGrip as SurfaceInstanceId;
      const center = this.adapter().center(active.draft, surfaceId);
      this.transaction = {
        ...active,
        kind: "paper",
        surfaceId,
        pointer: null,
        center,
        grab: center,
      };
      this.schedule();
    } else if (
      this.transaction.kind === "paper" &&
      this.transaction.pointer === null &&
      this.transaction.surfaceId === grip.dataset.paperGrip
    ) {
      if (event.key === "Enter") this.finish();
      else {
        const delta = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        }[event.key];
        if (!delta) return false;
        const center = this.adapter().center(
          this.transaction.draft,
          this.transaction.surfaceId,
        );
        const step = event.shiftKey ? 80 : 20;
        this.movePaper(
          worldPoint(center.x + delta[0] * step, center.y + delta[1] * step),
        );
      }
    } else return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  }
}
