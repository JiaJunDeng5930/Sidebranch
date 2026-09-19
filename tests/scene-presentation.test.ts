import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alignPaperReadingLines,
  interpolatePaperMotion,
  paperRect,
  rangeScrollTarget,
  reconcileFocusScroll,
  type PaperMotion,
  type SurfaceLayout,
} from "../components/reader/scene-presentation";

const layout: SurfaceLayout = {
  width: 600,
  height: 800,
  scroll: { left: 0, top: 60, right: 600, bottom: 800 },
  maxScroll: 2000,
};

test("promotion and interrupted reversal start at the displayed occurrence poses", () => {
  const initial: PaperMotion<string> = new Map([
    ["A", { x: -300, y: 0, scale: 1, opacity: 1 }],
    ["B", { x: 300, y: 0, scale: 0.88, opacity: 1 }],
  ]);
  const promoted: PaperMotion<string> = new Map([
    ["B", initial.get("A")!],
    ["A", initial.get("B")!],
  ]);
  const displayed = interpolatePaperMotion(initial, promoted, 0.25);
  assert.equal(displayed.get("A")!.x, -150);
  assert.equal(displayed.get("B")!.x, 150);
  assert.deepEqual(interpolatePaperMotion(displayed, initial, 0), displayed);
  assert.equal(
    interpolatePaperMotion(displayed, initial, 0.5).get("A")!.x,
    -225,
  );
  assert.deepEqual(interpolatePaperMotion(displayed, initial, 1), initial);
});

test("scaled bodies with different headers share a reading line", () => {
  const poses: PaperMotion<string> = new Map([
    ["A", { x: -300, y: 0, scale: 1, opacity: 1 }],
    ["B", { x: 300, y: 12, scale: 0.88, opacity: 1 }],
  ]);
  const layouts = new Map([
    ["A", layout],
    ["B", { ...layout, scroll: { ...layout.scroll, top: 80 } }],
  ]);
  const aligned = alignPaperReadingLines(poses, layouts, "A");
  assert.ok(Math.abs(aligned.get("B")!.y - -13.712) < 1e-9);
  assert.deepEqual(
    paperRect(layout, aligned.get("A")!, { width: 1280, height: 900 }),
    { left: 40, top: 50, right: 640, bottom: 850 },
  );
  assert.equal(alignPaperReadingLines(aligned, layouts, "A"), aligned);
});

test("focus centering respects long or missing spans and real scroll limits", () => {
  assert.equal(rangeScrollTarget(400, 500, true, 500, 2000), 240);
  assert.equal(rangeScrollTarget(400, 800, true, 500, 2000), 190);
  assert.equal(rangeScrollTarget(400, 500, false, 500, 2000), 190);
  assert.equal(rangeScrollTarget(20, 80, true, 500, 2000), 0);
  assert.equal(rangeScrollTarget(2300, 2340, true, 500, 2000), 2000);
});

test("late spacer measurements correct one endpoint without cancelling its peer", () => {
  const inFlight = new Map([
    ["A", 24790],
    ["C", 21711],
  ]);
  const measured = new Map([
    ["A", 25500],
    ["C", 21711],
  ]);
  const corrected = reconcileFocusScroll(
    measured,
    new Map([
      ["A", 24500],
      ["C", 21000],
    ]),
    inFlight,
    new Set(),
  );
  assert.deepEqual(
    corrected,
    new Map([
      ["A", 25500],
      ["C", 21711],
    ]),
  );
  assert.equal(
    reconcileFocusScroll(
      measured,
      new Map([
        ["A", 24500],
        ["C", 21000],
      ]),
      corrected!,
      new Set(),
    ),
    undefined,
  );
  assert.equal(
    reconcileFocusScroll(measured, measured, new Map(), new Set()),
    undefined,
  );
});

test("manual scroll revokes later geometry corrections for only that endpoint", () => {
  const measured = new Map([
    ["A", 25500],
    ["C", 25500],
  ]);
  assert.deepEqual(
    reconcileFocusScroll(
      measured,
      new Map([
        ["A", 100],
        ["C", 21711],
      ]),
      new Map(),
      new Set(["A"]),
    ),
    new Map([["C", 25500]]),
  );
  assert.equal(
    reconcileFocusScroll(measured, new Map(), new Map(), new Set(["A", "C"])),
    undefined,
  );
});
