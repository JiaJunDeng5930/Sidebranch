import assert from "node:assert/strict";
import test from "node:test";
import { MOUSE, TOUCH } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SceneInteraction } from "../components/reader/scene-interaction";
import { configureSceneControls } from "../components/reader/three-scene-runtime";
import {
  CAMERA_HOME,
  createPerspectiveCamera,
  snapshotCameraPose,
  worldPoint,
  orientation,
} from "../lib/reader/camera";
import { createSpaceView } from "../lib/reader/space-view";
import { surfaceInstanceId } from "../lib/reader/spatial-contract";
const id = surfaceInstanceId("paper");
class Target {
  dataset: Record<string, string>;
  captures = new Set<number>();
  constructor(readonly kind: "stage" | "paper" | "edge") {
    this.dataset = kind === "edge" ? { paperGrip: id } : {};
  }
  closest(selector: string) {
    if (selector === "[data-paper-grip]")
      return this.kind === "edge" ? this : null;
    return this.kind === "paper" && selector.includes("[data-paper]")
      ? this
      : null;
  }
  setPointerCapture(id: number) {
    this.captures.add(id);
  }
  hasPointerCapture(id: number) {
    return this.captures.has(id);
  }
  releasePointerCapture(id: number) {
    this.captures.delete(id);
  }
}
function setup() {
  Object.defineProperty(globalThis, "Element", {
    configurable: true,
    value: Target,
  });
  const stage = new Target("stage"),
    edge = new Target("edge"),
    paper = new Target("paper");
  let generation = 1,
    checkpoints = 0;
  let view = createSpaceView(
    CAMERA_HOME,
    new Map([
      [
        id,
        { position: worldPoint(0, 0, -250), orientation: orientation(5, 12) },
      ],
    ]),
  );
  const owner = new SceneInteraction(),
    camera = createPerspectiveCamera(view.camera, { width: 1000, height: 800 });
  const controls = new OrbitControls(camera);
  configureSceneControls(controls);
  controls.domElement = { clientWidth: 1000, clientHeight: 800 } as HTMLElement;
  const snapshot = () =>
    snapshotCameraPose(camera, controls.target, view.camera);
  owner.configure({
    context: () => ({
      generation,
      view,
      viewport: { width: 1000, height: 800 },
      offset: { left: 0, top: 0 },
      element: stage as unknown as HTMLElement,
    }),
    pose: (value, surfaceId) => value.placements.get(surfaceId)!,
    paint: (value) => {
      view = value;
    },
    checkpoint: (value) => {
      view = value.view;
      checkpoints++;
    },
    settled: () => {},
    stopPresentation: () => {},
    cameraSnapshot: snapshot,
    wheelCamera: (dx, dy, dolly) => {
      if (dolly) controls.dollyOut(Math.exp(-dy * 0.003));
      else controls.pan(-dx, -dy);
      return snapshot();
    },
  });
  const event = (target: Target, x: number, y: number, shiftKey = false) => ({
    target: target as unknown as EventTarget,
    clientX: x,
    clientY: y,
    shiftKey,
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    preventDefault() {},
  });
  return {
    owner,
    controls,
    snapshot,
    event,
    stage,
    edge,
    paper,
    advance: () => {
      generation++;
    },
    get view() {
      return view;
    },
    get checkpoints() {
      return checkpoints;
    },
  };
}
test("background camera mechanics use OrbitControls pan, explicit orbit, and native paper exclusion", () => {
  const h = setup();
  assert.equal(h.controls.mouseButtons.LEFT, MOUSE.PAN);
  assert.equal(h.controls.mouseButtons.RIGHT, MOUSE.ROTATE);
  assert.equal(h.controls.touches.ONE, TOUCH.ROTATE);
  assert.equal(h.controls.touches.TWO, TOUCH.DOLLY_PAN);
  h.owner.pointerDown(h.event(h.paper, 500, 400));
  h.owner.pointerMove(h.event(h.paper, 560, 440));
  assert.equal(h.owner.active, false);
  h.owner.cameraStart();
  h.controls.pan(60, 40);
  h.owner.cameraChange(h.snapshot());
  h.owner.cameraEnd();
  assert.ok(h.view.camera.position.x < CAMERA_HOME.position.x);
  assert.ok(
    h.view.camera.orientation.every(
      (value, index) =>
        Math.abs(value - CAMERA_HOME.orientation[index]) < 1e-12,
    ),
  );
  assert.equal(h.checkpoints, 1);
});
test("paper grip retains its pose orientation and cancellation releases capture", () => {
  const h = setup(),
    initial = h.view.placements.get(id)!;
  h.owner.pointerDown(h.event(h.edge, 500, 400));
  h.owner.pointerMove(h.event(h.edge, 580, 400));
  h.owner.pointerUp({ pointerId: 1 });
  const moved = h.view.placements.get(id)!;
  assert.ok(moved.position.x > 80);
  assert.equal(moved.position.z, initial.position.z);
  assert.deepEqual(moved.orientation, initial.orientation);
  h.owner.pointerDown(h.event(h.edge, 580, 400, true));
  h.owner.pointerMove(h.event(h.edge, 580, 500, true));
  assert.equal(h.view.placements.get(id)!.position.z, initial.position.z - 300);
  h.owner.cancel();
  assert.deepEqual(h.view.placements.get(id), moved);
  assert.equal(h.stage.captures.size, 0);
  assert.equal(h.checkpoints, 1);
});
test("a new generation cancels a live camera draft without checkpointing stale motion", () => {
  const h = setup(),
    before = h.view;
  h.owner.cameraStart();
  h.controls.rotateLeft(0.3);
  h.owner.cameraChange(h.snapshot());
  assert.notDeepEqual(h.view.camera, before.camera);
  h.advance();
  h.owner.synchronize(before);
  assert.deepEqual(h.view, before);
  assert.equal(h.checkpoints, 0);
});
test("capture loss before OrbitControls end commits the final camera exactly once", () => {
  const h = setup();
  h.owner.cameraStart();
  h.controls.pan(60, 40);
  h.owner.cameraChange(h.snapshot());
  // The runtime may have moved after the last delivered change notification.
  h.controls.pan(20, 10);
  const released = h.snapshot();
  h.owner.lostPointerCapture({ pointerId: 1 });
  h.owner.cameraEnd();
  assert.deepEqual(h.view.camera, released);
  assert.equal(h.checkpoints, 1);
  assert.equal(h.owner.active, false);
});
test("same-presentation refreshes retain active and completed movement while admitting papers", () => {
  const h = setup(),
    before = h.view,
    extra = surfaceInstanceId("new-paper"),
    pose = { position: worldPoint(900, 0, 0), orientation: orientation(0, 0) };
  h.owner.cameraStart();
  h.controls.pan(60, 40);
  h.owner.cameraChange(h.snapshot());
  const moved = h.view.camera;
  const refreshed = {
    ...before,
    placements: new Map([...before.placements, [extra, pose]]),
  };
  h.owner.synchronize(refreshed);
  assert.equal(h.owner.active, true);
  assert.deepEqual(h.view.camera, moved);
  assert.equal(h.view.placements.get(extra), pose);
  h.owner.cameraEnd();
  h.owner.synchronize(refreshed);
  assert.deepEqual(h.view.camera, moved);
  assert.equal(h.checkpoints, 1);
});
test("involuntary paper capture loss and blur preserve the visible placement", () => {
  const h = setup(),
    before = h.view;
  h.owner.pointerDown(h.event(h.edge, 500, 400));
  h.owner.pointerMove(h.event(h.edge, 580, 400));
  const moved = h.view;
  h.owner.synchronize({ ...before, placements: new Map(before.placements) });
  h.owner.lostPointerCapture({ pointerId: 1 });
  h.owner.pointerUp({ pointerId: 1 });
  h.owner.finish();
  h.owner.synchronize(before);
  assert.deepEqual(h.view, moved);
  assert.equal(h.stage.captures.size, 0);
  assert.equal(h.checkpoints, 1);
});
test("a drag's click is suppressed even after returning to its origin, but a fresh click is allowed", () => {
  const h = setup();
  h.owner.beginPointer();
  h.owner.cameraStart();
  h.controls.pan(60, 40);
  h.owner.cameraChange(h.snapshot());
  h.controls.pan(-60, -40);
  h.owner.cameraChange(h.snapshot());
  h.owner.cameraEnd();
  assert.equal(h.owner.consumeClick(), true);
  h.owner.beginPointer();
  assert.equal(h.owner.consumeClick(), false);
  h.owner.pointerDown(h.event(h.edge, 500, 400));
  h.owner.pointerMove(h.event(h.edge, 580, 400));
  h.owner.pointerUp({ pointerId: 1 });
  // Browsers need not emit a click after every pointer sequence.
  h.owner.beginPointer();
  assert.equal(h.owner.consumeClick(), false);
});
test("wheel pan is a single checkpoint and modifier wheel over paper owns dolly", async () => {
  const h = setup();
  let prevented = 0;
  const wheel = {
    target: h.paper as unknown as EventTarget,
    deltaX: 0,
    deltaY: 60,
    deltaMode: 0,
    ctrlKey: false,
    altKey: false,
    clientX: 500,
    clientY: 400,
    preventDefault() {
      prevented++;
    },
    stopImmediatePropagation() {},
  };
  h.owner.wheel(wheel);
  assert.equal(prevented, 0);
  h.owner.wheel({ ...wheel, target: h.stage as unknown as EventTarget });
  h.owner.wheel({ ...wheel, target: h.stage as unknown as EventTarget });
  assert.ok(h.view.camera.target.y > 0);
  assert.equal(h.checkpoints, 0);
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(h.checkpoints, 1);
  const before = h.view;
  h.owner.wheel({ ...wheel, ctrlKey: true, deltaY: -100 });
  assert.ok(h.view.camera.position.z < before.camera.position.z);
  h.owner.cancel();
  assert.deepEqual(h.view, before);
  assert.equal(h.checkpoints, 1);
});
