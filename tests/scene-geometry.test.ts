import assert from "node:assert/strict";
import test from "node:test";
import {
  SceneGeometry,
  visibleAnchorFragments,
} from "../components/reader/scene-geometry";
import type { AnchorInput, RevisionId } from "../lib/domain/model";
import {
  surfaceInstanceId,
  type PassageHandle,
} from "../lib/reader/spatial-contract";

const first = surfaceInstanceId("first"),
  second = surfaceInstanceId("second");
const anchor: AnchorInput = {
  revisionId: "revision" as RevisionId,
  start: 10,
  end: 20,
  quote: "range text",
};
const scroll = {
  clientWidth: 100,
  clientHeight: 100,
  scrollLeft: 10,
  scrollTop: 100,
  getBoundingClientRect: () => ({ left: 20, top: 30 }),
} as HTMLElement;
const fragments = [
  { left: 25, top: 35, right: 55, bottom: 50, width: 30, height: 15 },
  { left: 70, top: 35, right: 90, bottom: 50, width: 20, height: 15 },
];
const handle: PassageHandle = {
  resolveAnchor: () => ({
    coverage: "partial",
    missing: [{ start: 15, end: 17 }],
    ranges: [{ getClientRects: () => fragments } as unknown as Range],
  }),
  firstVisibleSourceOffset: () => 10,
};

test("native range cache survives pose/scroll updates and new unrelated bindings", () => {
  const geometry = new SceneGeometry();
  geometry.setSurfaceContext(first, "document:revision:layout-1");
  geometry.setSurfaceContext(second, "document:revision:layout-1");
  const initial = geometry.resolveAnchor(first, anchor, handle, scroll, true)!;
  geometry.resolveAnchor(second, anchor, handle, scroll, true);
  assert.equal(geometry.rangeMeasurements, 2);
  assert.equal(initial.coverage, "partial");
  assert.deepEqual(initial.missing, [{ start: 15, end: 17 }]);
  assert.deepEqual(initial.fragments, [
    { left: 15, top: 105, right: 45, bottom: 120 },
    { left: 60, top: 105, right: 80, bottom: 120 },
  ]);
  assert.strictEqual(
    geometry.resolveAnchor(first, anchor, handle, scroll, false),
    initial,
  );
  const another = { ...anchor, start: 30, end: 40 };
  geometry.resolveAnchor(second, another, handle, scroll, true);
  assert.strictEqual(
    geometry.resolveAnchor(first, anchor, handle, scroll, true),
    initial,
  );
  assert.equal(geometry.rangeMeasurements, 3);
  geometry.invalidate(second);
  geometry.resolveAnchor(second, anchor, handle, scroll, true);
  assert.strictEqual(
    geometry.resolveAnchor(first, anchor, handle, scroll, true),
    initial,
  );
  assert.equal(geometry.rangeMeasurements, 4);
});

test("layout changes discard only that occurrence's ranges; camera motion cannot read them", () => {
  const geometry = new SceneGeometry();
  geometry.setSurfaceContext(first, "document:revision:layout-1");
  const initial = geometry.resolveAnchor(first, anchor, handle, scroll, true);
  geometry.setSurfaceContext(first, "document:revision:layout-1");
  assert.strictEqual(
    geometry.resolveAnchor(first, anchor, handle, scroll, true),
    initial,
  );
  geometry.setSurfaceContext(first, "document:revision:layout-2");
  assert.equal(
    geometry.resolveAnchor(first, anchor, handle, scroll, false),
    undefined,
  );
  assert.equal(geometry.rangeMeasurements, 1);
  assert.notStrictEqual(
    geometry.resolveAnchor(first, anchor, handle, scroll, true),
    initial,
  );
  assert.equal(geometry.rangeMeasurements, 2);
});

test("scroll clipping preserves separate fragments and both scroll axes", () => {
  const fragments = visibleAnchorFragments(
    {
      coverage: "complete",
      missing: [],
      fragments: [
        { left: 0, right: 50, top: 90, bottom: 120 },
        { left: 70, right: 150, top: 90, bottom: 120 },
        { left: 20, right: 80, top: 180, bottom: 230 },
        { left: 0, right: 100, top: 230, bottom: 250 },
      ],
    },
    {
      width: 160,
      height: 240,
      maxScroll: 500,
      scroll: { left: 30, right: 130, top: 60, bottom: 160 },
    },
    scroll,
  );
  assert.deepEqual(fragments, [
    { left: 30, right: 70, top: 60, bottom: 80 },
    { left: 90, right: 130, top: 60, bottom: 80 },
    { left: 40, right: 100, top: 140, bottom: 160 },
  ]);
});
