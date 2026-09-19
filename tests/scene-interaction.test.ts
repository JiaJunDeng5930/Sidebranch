import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { SceneInteraction } from "../components/reader/scene-interaction";
import {
  CAMERA_HOME,
  screenPoint,
  worldPoint,
  worldToScreen,
} from "../lib/reader/camera";
import {
  cameraForView,
  readingView,
  type SpaceView,
} from "../lib/reader/space-view";
import {
  surfaceInstanceId,
  type ViewCheckpoint,
} from "../lib/reader/spatial-contract";

const paperId = surfaceInstanceId("moving-paper");
class Target {
  dataset: Record<string, string>;
  captures = new Set<number>();
  constructor(readonly kind: "stage" | "text" | "grip" | "control") {
    this.dataset = {
      hitRole: kind === "grip" ? "paper-grip" : kind,
      ...(kind === "grip" ? { paperGrip: paperId } : {}),
    };
  }
  closest(selector: string): Target | null {
    if (selector === "[data-paper-grip]")
      return this.kind === "grip" ? this : null;
    if (selector === "[data-hit-role]") return this;
    if (selector === "[data-document-scroll]")
      return this.kind === "text" ? this : null;
    return this.kind === "control" || this.kind === "grip" ? this : null;
  }
  setPointerCapture(id: number) {
    this.captures.add(id);
  }
  releasePointerCapture(id: number) {
    this.captures.delete(id);
  }
  hasPointerCapture(id: number) {
    return this.captures.has(id);
  }
}

function harness(t: TestContext) {
  const frames = new Map<number, FrameRequestCallback>();
  const timers = new Map<number, () => void>();
  let next = 0;
  const globals = [
    "window",
    "Element",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ] as const;
  const originals = globals.map((key) =>
    Object.getOwnPropertyDescriptor(globalThis, key),
  );
  const values = [
    {
      getSelection: () => ({ isCollapsed: true }),
      setTimeout: (callback: () => void) => {
        timers.set(++next, callback);
        return next;
      },
      clearTimeout: (id: number) => timers.delete(id),
    },
    Target,
    (callback: FrameRequestCallback) => {
      frames.set(++next, callback);
      return next;
    },
    (id: number) => frames.delete(id),
  ];
  globals.forEach((key, i) =>
    Object.defineProperty(globalThis, key, {
      value: values[i],
      configurable: true,
      writable: true,
    }),
  );
  t.after(() =>
    globals.forEach((key, i) => {
      const original = originals[i];
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    }),
  );
  const stage = new Target("stage");
  const grip = new Target("grip");
  const text = new Target("text");
  let committed: SpaceView = readingView(paperId);
  let painted = committed;
  let generation = 4;
  const checkpoints: ViewCheckpoint[] = [];
  let paints = 0;
  let independentScroll = 120;
  const controller = new SceneInteraction();
  controller.configure({
    context: () => ({
      generation,
      view: committed,
      viewport: { width: 800, height: 600 },
      offset: { left: 30, top: 20 },
      element: stage as unknown as HTMLElement,
    }),
    enterFree: () =>
      painted.kind === "free"
        ? painted
        : { kind: "free", camera: { ...CAMERA_HOME }, placements: new Map() },
    center: (view, id) => {
      const placement = view.placements.get(id);
      return placement?.kind === "manual" ? placement.center : worldPoint(0, 0);
    },
    corners: (view) => {
      const placement = view.placements.get(paperId);
      const center =
        placement?.kind === "manual" ? placement.center : worldPoint(0, 0);
      return [-1, 1].flatMap((x) =>
        [-1, 1].map((y) => worldPoint(center.x + x * 180, center.y + y * 200)),
      );
    },
    stopPresentation: () => {},
    paint: (view) => {
      painted = view;
      paints += 1;
    },
    checkpoint: (value) => {
      checkpoints.push(value);
      committed = value.view;
    },
    settled: () => {},
  });
  const pointer = (
    target: Target,
    x: number,
    y: number,
    id = 1,
    type = "mouse",
  ) =>
    ({
      target,
      clientX: x + 30,
      clientY: y + 20,
      pointerId: id,
      pointerType: type,
      button: 0,
      shiftKey: false,
      preventDefault() {},
    }) as unknown as PointerEvent;
  return {
    controller,
    stage,
    grip,
    text,
    checkpoints,
    pointer,
    paint: () => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(0));
    },
    timers: () => {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((callback) => callback());
    },
    get view() {
      return painted;
    },
    get paints() {
      return paints;
    },
    get scroll() {
      return independentScroll;
    },
    scrollTo: (value: number) => {
      independentScroll = value;
    },
    navigate: () => {
      generation += 1;
      committed = readingView(paperId);
      controller.synchronize();
    },
  };
}

test("paper drafts paint without checkpoints and commit the final release once", (t) => {
  const h = harness(t);
  h.controller.pointerDown(h.pointer(h.grip, 400, 300));
  h.controller.pointerMove(h.pointer(h.grip, 403, 300));
  h.paint();
  assert.equal(h.paints, 0);
  h.controller.pointerMove(h.pointer(h.grip, 440, 325));
  h.paint();
  assert.equal(h.checkpoints.length, 0);
  h.controller.pointerUp(h.pointer(h.grip, 460, 330));
  assert.equal(h.checkpoints.length, 1);
  assert.equal(h.view.kind, "free");
  if (h.view.kind === "free")
    assert.deepEqual(h.view.placements.get(paperId), {
      kind: "manual",
      center: worldPoint(60, 30),
    });
  h.controller.pointerCancel({ pointerId: 1 });
  assert.equal(h.checkpoints.length, 1);
});

test("cancel preserves independent scroll and restores automatic or committed manual placement", (t) => {
  const h = harness(t);
  h.controller.pointerDown(h.pointer(h.grip, 400, 300));
  h.controller.pointerMove(h.pointer(h.grip, 460, 300));
  h.paint();
  h.scrollTo(450);
  h.controller.cancel();
  assert.equal(h.view.kind, "reading");
  assert.equal(h.scroll, 450);
  assert.equal(h.checkpoints.length, 0);
  h.controller.pointerDown(h.pointer(h.grip, 400, 300));
  h.controller.pointerUp(h.pointer(h.grip, 480, 300));
  const before = h.view;
  h.controller.pointerDown(h.pointer(h.grip, 480, 300));
  h.controller.pointerMove(h.pointer(h.grip, 580, 300));
  h.paint();
  h.controller.cancel();
  assert.deepEqual(h.view, before);
});

test("pinch uses the distance ratio and commits once when either finger ends", (t) => {
  const h = harness(t);
  h.controller.pointerDown(h.pointer(h.stage, 300, 300, 1, "touch"));
  h.controller.pointerDown(h.pointer(h.stage, 500, 300, 2, "touch"));
  h.controller.pointerMove(h.pointer(h.stage, 600, 300, 2, "touch"));
  h.paint();
  assert.equal(cameraForView(h.view).zoom, 1.5);
  const anchor = worldToScreen(worldPoint(0, 0), cameraForView(h.view), {
    width: 800,
    height: 600,
  });
  assert.deepEqual(anchor, screenPoint(450, 300));
  h.controller.pointerUp(h.pointer(h.stage, 600, 300, 2, "touch"));
  h.controller.pointerMove(h.pointer(h.stage, 350, 300, 1, "touch"));
  h.paint();
  assert.equal(h.checkpoints.length, 1);
  assert.equal(h.controller.active, false);
});

test("native text input stays native and modified wheel anchors to viewport coordinates", (t) => {
  const h = harness(t);
  h.controller.pointerDown(h.pointer(h.text, 200, 200));
  h.controller.pointerMove(h.pointer(h.text, 400, 200));
  h.paint();
  assert.equal(h.controller.active, false);
  let prevented = false;
  const wheel = {
    target: h.text,
    clientX: 280,
    clientY: 220,
    deltaX: 0,
    deltaY: -300,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault() {
      prevented = true;
    },
  };
  h.controller.wheel(wheel as unknown as WheelEvent);
  assert.equal(prevented, false);
  h.controller.wheel({ ...wheel, ctrlKey: true } as unknown as WheelEvent);
  h.paint();
  assert.equal(prevented, true);
  assert.equal(h.checkpoints.length, 0);
  const projected = worldToScreen(
    worldPoint(-150, -100),
    cameraForView(h.view),
    { width: 800, height: 600 },
  );
  assert.ok(
    Math.abs(projected.x - 250) < 0.001 && Math.abs(projected.y - 200) < 0.001,
  );
  h.timers();
  assert.equal(h.checkpoints.length, 1);
});

test("generation changes discard late frames, releases and wheel deadlines", (t) => {
  const h = harness(t);
  h.controller.wheel({
    target: h.stage,
    clientX: 400,
    clientY: 300,
    deltaX: 0,
    deltaY: 40,
    deltaMode: 0,
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    preventDefault() {},
  } as unknown as WheelEvent);
  h.navigate();
  h.paint();
  h.timers();
  h.controller.pointerUp(h.pointer(h.stage, 500, 300));
  assert.equal(h.view.kind, "reading");
  assert.equal(h.checkpoints.length, 0);
});

test("keyboard paper movement shares cancellation and one-checkpoint commit", (t) => {
  const h = harness(t);
  const key = (key: string, shiftKey = false) =>
    ({
      key,
      shiftKey,
      target: h.grip,
      preventDefault() {},
      stopPropagation() {},
    }) as unknown as KeyboardEvent;
  h.controller.keyDown(key("Enter"));
  h.controller.keyDown(key("ArrowRight"));
  h.controller.keyDown(key("ArrowDown", true));
  h.paint();
  h.controller.keyDown(key("Enter"));
  assert.equal(h.checkpoints.length, 1);
  if (h.view.kind === "free")
    assert.deepEqual(h.view.placements.get(paperId), {
      kind: "manual",
      center: worldPoint(20, 80),
    });
  h.controller.keyDown(key("Enter"));
  h.controller.keyDown(key("ArrowLeft"));
  h.controller.keyDown(key("Escape"));
  assert.equal(h.checkpoints.length, 1);
});
