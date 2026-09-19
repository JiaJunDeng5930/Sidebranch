import assert from "node:assert/strict";
import test from "node:test";
import { SceneInteraction } from "../components/reader/scene-interaction";
import { CAMERA_HOME, worldPoint, orientation } from "../lib/reader/camera";
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
    return this.kind === "paper" ? this : null;
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
  let view = createSpaceView(
    CAMERA_HOME,
    new Map([
      [
        id,
        { position: worldPoint(0, 0, -250), orientation: orientation(5, 12) },
      ],
    ]),
  );
  let checkpoints = 0;
  const owner = new SceneInteraction();
  owner.configure({
    context: () => ({
      generation: 1,
      view,
      viewport: { width: 1000, height: 800 },
      offset: { left: 0, top: 0 },
      element: stage as unknown as HTMLElement,
    }),
    pose: (v, id) => v.placements.get(id)!,
    paint: (v) => {
      view = v;
    },
    checkpoint: (v) => {
      view = v.view;
      checkpoints++;
    },
    settled: () => {},
    stopPresentation: () => {},
  });
  const event = (
    target: Target,
    x: number,
    y: number,
    shiftKey = false,
    pointerId = 1,
    pointerType = "mouse",
  ) => ({
    target: target as unknown as EventTarget,
    clientX: x,
    clientY: y,
    shiftKey,
    pointerId,
    pointerType,
    button: 0,
    preventDefault() {},
  });
  return {
    owner,
    event,
    stage,
    edge,
    paper,
    get view() {
      return view;
    },
    get checkpoints() {
      return checkpoints;
    },
  };
}
test("blank drag orbits; text does not capture native selection", () => {
  const h = setup();
  h.owner.pointerDown(h.event(h.paper, 500, 400));
  h.owner.pointerMove(h.event(h.paper, 560, 440));
  assert.equal(h.owner.active, false);
  h.owner.pointerDown(h.event(h.stage, 500, 400));
  h.owner.pointerMove(h.event(h.stage, 560, 440));
  h.owner.pointerUp({ pointerId: 1 });
  assert.notDeepEqual(h.view.camera.orientation, CAMERA_HOME.orientation);
  assert.equal(h.checkpoints, 1);
});
test("edge moves at its existing depth, Shift moves independently along camera depth", () => {
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
  h.owner.pointerUp({ pointerId: 1 });
  assert.equal(h.view.placements.get(id)!.position.z, initial.position.z - 300);
  assert.deepEqual(h.view.camera, CAMERA_HOME);
});
test("cancel restores gesture start and two touch pointers pan and pinch", () => {
  const h = setup(),
    before = h.view;
  h.owner.pointerDown(h.event(h.stage, 500, 400));
  h.owner.pointerMove(h.event(h.stage, 560, 400));
  h.owner.cancel();
  assert.deepEqual(h.view, before);
  assert.equal(h.checkpoints, 0);
  h.owner.pointerDown(h.event(h.stage, 400, 400, false, 1, "touch"));
  h.owner.pointerDown(h.event(h.stage, 600, 400, false, 2, "touch"));
  h.owner.pointerMove(h.event(h.stage, 680, 420, false, 2, "touch"));
  assert.notEqual(h.view.camera.position.z, CAMERA_HOME.position.z);
  assert.notEqual(h.view.camera.target.x, 0);
  h.owner.cancel();
});

test("a prior drag does not swallow the next independent paper click", () => {
  const h = setup();
  h.owner.pointerDown(h.event(h.edge, 500, 400));
  h.owner.pointerMove(h.event(h.edge, 560, 420));
  h.owner.pointerUp({ pointerId: 1 });
  h.owner.pointerDown(h.event(h.paper, 600, 450));
  assert.equal(h.owner.consumeClick(), false);
});
