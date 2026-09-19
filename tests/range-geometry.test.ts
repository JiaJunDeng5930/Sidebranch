import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRangeGeometry,
  pointInPolygon,
  polygonHits,
  ruledSurface,
} from "../lib/reader/range-geometry";

test("buildRangeGeometry preserves distinct line mouths", () => {
  const geometry = buildRangeGeometry({
    coverage: "complete",
    edge: "right",
    clip: { left: 0, top: 0, right: 300, bottom: 160 },
    ranges: [
      { left: 20, top: 20, right: 100, bottom: 40 },
      { left: 20, top: 44, right: 74, bottom: 64 },
      { left: 35, top: 68, right: 122, bottom: 88 },
    ],
  });

  assert.equal(geometry.visibility, "range");
  assert.equal(geometry.segments.length, 3);
  assert.deepEqual(geometry.endpoint, {
    edge: "right",
    coordinate: 122,
    start: 20,
    end: 88,
    precise: true,
    proxy: false,
  });
  assert.equal(geometry.contours[1]?.[0].x, 20);
  assert.equal(geometry.contours[1]?.[2].y, 64);
});

test("clipping reports a clipped range and never claims a missing span", () => {
  const clipped = buildRangeGeometry({
    coverage: "complete",
    edge: "right",
    clip: { left: 0, top: 30, right: 300, bottom: 80 },
    ranges: [
      { left: 20, top: 10, right: 100, bottom: 40 },
      { left: 20, top: 52, right: 100, bottom: 100 },
    ],
  });
  assert.equal(clipped.visibility, "clipped-range");
  assert.equal(clipped.precise, true);
  assert.equal(clipped.segments.length, 2);
  assert.equal(clipped.segments[0]?.top, 30);
  assert.equal(clipped.segments[1]?.bottom, 80);

  const partial = buildRangeGeometry({
    coverage: "partial",
    edge: "right",
    clip: { left: 0, top: 0, right: 300, bottom: 200 },
    ranges: [
      { left: 20, top: 10, right: 100, bottom: 30 },
      { left: 20, top: 150, right: 100, bottom: 170 },
    ],
    missing: [{ start: 30, end: 90 }],
  });
  assert.equal(partial.visibility, "partial-range");
  assert.equal(partial.precise, false);
  assert.equal(partial.contours.length, 2);
  assert.equal(partial.endpoint?.proxy, true);
});

test("offscreen and unmounted anchors use small proxy mouths", () => {
  const offscreen = buildRangeGeometry({
    coverage: "complete",
    edge: "right",
    clip: { left: 0, top: 0, right: 300, bottom: 200 },
    ranges: [{ left: 20, top: 500, right: 100, bottom: 520 }],
  });
  assert.equal(offscreen.visibility, "offscreen-range");
  assert.equal(offscreen.segments.length, 0);
  assert.equal(offscreen.endpoint?.proxy, true);
  assert.equal(offscreen.endpoint?.coordinate, 300);

  const unmounted = buildRangeGeometry({
    coverage: "unmounted",
    edge: "left",
    clip: { left: 0, top: 0, right: 300, bottom: 200 },
    ranges: [],
  });
  assert.equal(unmounted.visibility, "unmounted-range");
  assert.equal(unmounted.precise, false);
  assert.equal(unmounted.endpoint, null);
});

test("ruled surfaces are four-sided and polygon hits preserve candidate order", () => {
  const from = {
    edge: "right" as const,
    coordinate: 100,
    start: 10,
    end: 42,
    precise: true,
    proxy: false,
  };
  const to = {
    edge: "left" as const,
    coordinate: 260,
    start: 30,
    end: 82,
    precise: true,
    proxy: false,
  };
  const surface = ruledSurface(from, to);
  assert.deepEqual(surface.polygon, [
    { x: 100, y: 10 },
    { x: 260, y: 30 },
    { x: 260, y: 82 },
    { x: 100, y: 42 },
  ]);
  assert.equal(surface.precise, true);
  assert.equal(pointInPolygon({ x: 180, y: 40 }, surface.polygon), true);
  assert.deepEqual(
    polygonHits({ x: 180, y: 40 }, [
      { id: "first", polygon: surface.polygon },
      { id: "second", polygon: surface.polygon },
    ]),
    ["first", "second"],
  );
});
