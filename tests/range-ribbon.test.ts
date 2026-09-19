import assert from "node:assert/strict";
import test from "node:test";
import { vec4 } from "gl-matrix";
import {
  CAMERA_HOME,
  orientation,
  paperPoint,
  paperToWorld,
  screenRay,
  viewMatrix,
  worldPoint,
  worldToScreen,
  type CameraPose,
} from "../lib/reader/camera";
import {
  buildRangeRibbon,
  clipRangeRibbonToCamera,
  hitTestRangeRibbon,
  intersectPaperRay,
  triangleLeafGeometry,
  type RangeRibbonMouthSegment,
  type RangeRibbonProvenance,
  type RangeRibbonTriangle,
} from "../lib/reader/range-ribbon";

const close = (actual: number, expected: number, epsilon = 0.0001) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
const exact: RangeRibbonProvenance = { kind: "exact" };
const mouth = (
  x: number,
  y0: number,
  y1: number,
  z = 0,
  provenance: RangeRibbonProvenance = exact,
): RangeRibbonMouthSegment => ({
  start: worldPoint(x, y0, z),
  end: worldPoint(x, y1, z),
  provenance,
});
const ribbon = (z = 0) =>
  buildRangeRibbon([mouth(0, 0, 10, z)], [mouth(10, 0, 10, z)]);
const ray = (x: number, y: number, z = 10) => ({
  origin: worldPoint(x, y, z),
  direction: worldPoint(0, 0, -2),
});
const camera: CameraPose = {
  ...CAMERA_HOME,
  position: worldPoint(0, 0, 0),
  orientation: orientation(0, 0),
  near: 3,
};

test("cumulative subdivision covers every fragment and never fills mouth gaps", () => {
  const proxy: RangeRibbonProvenance = { kind: "proxy", reason: "unmapped" };
  const from = [mouth(0, 0, 10), mouth(0, 30, 60, 0, proxy)];
  const to = [mouth(10, 2, 22), mouth(10, 40, 60), mouth(10, 80, 100)];
  const triangles = buildRangeRibbon(from, to);
  assert.equal(triangles.length, 2 * (from.length + to.length - 1));
  assert.deepEqual(
    triangles
      .filter((_, index) => index % 2 === 0)
      .map((triangle) => [triangle.fromSegmentIndex, triangle.toSegmentIndex]),
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
  );
  for (const [weight, segments] of [
    [0, from],
    [1, to],
  ] as const) {
    const coveredLengths = segments.map(() => 0);
    for (const triangle of triangles) {
      const index =
        weight === 0 ? triangle.fromSegmentIndex : triangle.toSegmentIndex;
      const segment = segments[index];
      const vertices = triangle.vertices.filter(
        (v) => v.endpointWeight === weight,
      );
      for (const { point } of vertices) {
        assert.equal(point.x, segment.start.x);
        assert.ok(point.y >= segment.start.y && point.y <= segment.end.y);
      }
      if (vertices.length === 2)
        coveredLengths[index] += Math.abs(
          vertices[1].point.y - vertices[0].point.y,
        );
    }
    coveredLengths.forEach((covered, index) =>
      close(covered, segments[index].end.y - segments[index].start.y),
    );
  }
  assert.equal(hitTestRangeRibbon(ray(0, 20), triangles), null);
  assert.equal(hitTestRangeRibbon(ray(10, 30), triangles), null);
  assert.equal(hitTestRangeRibbon(ray(10, 70), triangles), null);
  assert.ok(
    triangles
      .filter((t) => t.fromSegmentIndex === 1)
      .every((t) => t.from === proxy),
  );
});

test("coincident subdivision boundaries do not add triangles; zero mouths retain original indices", () => {
  const triangles = buildRangeRibbon(
    [mouth(0, 0, 0), mouth(0, 0, 10), mouth(0, 20, 30)],
    [mouth(10, 0, 10), mouth(10, 20, 30)],
  );
  assert.equal(triangles.length, 4);
  assert.deepEqual(
    [...new Set(triangles.map((t) => t.fromSegmentIndex))],
    [1, 2],
  );
  assert.deepEqual(buildRangeRibbon([], [mouth(10, 0, 10)]), []);
  assert.deepEqual(buildRangeRibbon([mouth(0, 0, 0)], [mouth(10, 0, 10)]), []);
  assert.deepEqual(buildRangeRibbon([mouth(0, 0, 10)], [mouth(0, 0, 10)]), []);
});

test("full-size clipped leaves preserve world vertices with an orthonormal transform", () => {
  const triangles = buildRangeRibbon(
    [mouth(-30, 10, 35, -12)],
    [mouth(760, 20, 70, 48)],
  );
  // Include an obtuse triangle whose third vertex needs a negative local x bound.
  triangles.push({
    ...triangles[0],
    vertices: [
      { point: worldPoint(0, 0, 0), endpointWeight: 0 },
      { point: worldPoint(15, 0, 0), endpointWeight: 0 },
      { point: worldPoint(-800, 20, 60), endpointWeight: 1 },
    ],
  });
  for (const triangle of triangles) {
    const leaf = triangleLeafGeometry(triangle)!;
    const matrix = leaf.matrix;
    assert.ok(Math.max(leaf.width, leaf.height) > 750);
    leaf.points.forEach((corner, i) => {
      assert.ok(corner.x >= 0 && corner.x <= leaf.width);
      assert.ok(corner.y >= 0 && corner.y <= leaf.height);
      const transformed = vec4.transformMat4(
        vec4.create(),
        [corner.x, corner.y, 0, 1],
        matrix,
      );
      const point = triangle.vertices[i].point;
      close(transformed[0], point.x);
      close(transformed[1], point.y);
      close(transformed[2], point.z);
    });
    for (const column of [0, 4, 8])
      close(
        Math.hypot(matrix[column], matrix[column + 1], matrix[column + 2]),
        1,
      );
    for (const [a, b] of [
      [0, 4],
      [0, 8],
      [4, 8],
    ])
      close(
        matrix[a] * matrix[b] +
          matrix[a + 1] * matrix[b + 1] +
          matrix[a + 2] * matrix[b + 2],
        0,
      );
  }
});

const crossingTriangle = (): RangeRibbonTriangle => ({
  ...ribbon()[0],
  vertices: [
    { point: worldPoint(0, 0, -2), endpointWeight: 0 },
    { point: worldPoint(10, 0, -4), endpointWeight: 1 },
    { point: worldPoint(0, 10, -4), endpointWeight: 1 },
  ],
});

test("near-plane clipping keeps visible area and interpolates activation weights", () => {
  const triangle = crossingTriangle();
  const clipped = clipRangeRibbonToCamera([triangle], camera);
  assert.equal(clipped.length, 2);
  const newVertices = clipped
    .flatMap((t) => t.vertices)
    .filter((v) => v.point.z === -3);
  assert.ok(newVertices.length > 0);
  assert.ok(newVertices.every((v) => v.endpointWeight === 0.5));
  assert.ok(clipped.flatMap((t) => t.vertices).every((v) => v.point.z <= -3));
  assert.ok(
    clipped.every((t) => t.from === triangle.from && t.to === triangle.to),
  );
  const projectedArea = clipped.reduce((total, t) => {
    const [a, b, c] = t.vertices.map((v) => v.point);
    return (
      total +
      Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2
    );
  }, 0);
  close(projectedArea, 37.5);
  assert.equal(hitTestRangeRibbon(ray(1, 1), clipped), null);
  const hit = hitTestRangeRibbon(ray(3, 3), clipped)!;
  close(hit.endpointWeight, 0.6);
  close(hit.point.z, -3.2);
  const safe = ribbon(-5);
  assert.equal(clipRangeRibbonToCamera(safe, camera)[0], safe[0]);
  assert.deepEqual(clipRangeRibbonToCamera(ribbon(-1), camera), []);
  const oneVisible: RangeRibbonTriangle = {
    ...triangle,
    vertices: [
      { point: worldPoint(0, 0, -4), endpointWeight: 0 },
      { point: worldPoint(10, 0, -2), endpointWeight: 1 },
      { point: worldPoint(0, 10, -2), endpointWeight: 1 },
    ],
  };
  const tip = clipRangeRibbonToCamera([oneVisible], camera);
  assert.equal(tip.length, 1);
  assert.ok(hitTestRangeRibbon(ray(1, 1), tip));
  assert.equal(hitTestRangeRibbon(ray(3, 3), tip), null);
});

test("near clipping uses the camera's world half-space after rotation and translation", () => {
  const rotated = {
    ...camera,
    position: worldPoint(5, -2, 0),
    orientation: orientation(0, 90),
  };
  const triangle: RangeRibbonTriangle = {
    ...crossingTriangle(),
    vertices: [
      { point: worldPoint(3, -2, 0), endpointWeight: 0 },
      { point: worldPoint(1, 8, 0), endpointWeight: 1 },
      { point: worldPoint(1, -2, 10), endpointWeight: 1 },
    ],
  };
  const clipped = clipRangeRibbonToCamera([triangle], rotated);
  assert.equal(clipped.length, 2);
  for (const vertex of clipped.flatMap((t) => t.vertices)) {
    const p = vertex.point;
    const eye = vec4.transformMat4(
      vec4.create(),
      [p.x, p.y, p.z, 1],
      viewMatrix(rotated),
    );
    assert.ok(eye[2] <= -rotated.near + 0.0001);
  }
});

test("ray picking returns the nearest triangle with transverse endpoint weight", () => {
  const far = ribbon();
  const near = ribbon(2);
  for (const mesh of [
    [...far, ...near],
    [...near, ...far],
  ]) {
    const hit = hitTestRangeRibbon(ray(7.5, 4), mesh)!;
    assert.ok(near.includes(hit.triangle));
    close(hit.distance, 8);
    close(hit.endpointWeight, 0.75);
    close(hit.point.z, 2);
  }
  close(hitTestRangeRibbon(ray(0, 5), far)!.endpointWeight, 0);
  close(hitTestRangeRibbon(ray(10, 5), far)!.endpointWeight, 1);
  assert.equal(hitTestRangeRibbon(ray(20, 5), far), null);
  assert.equal(hitTestRangeRibbon(ray(1, 9), [far[0]]), null);
  assert.equal(hitTestRangeRibbon(ray(5, 5, -10), far), null);
  const back = {
    origin: worldPoint(2, 4, -10),
    direction: worldPoint(0, 0, 1),
  };
  close(hitTestRangeRibbon(back, far)!.endpointWeight, 0.2);
  assert.equal(
    hitTestRangeRibbon({ ...back, direction: worldPoint(1, 0, 0) }, far),
    null,
  );
  assert.equal(
    hitTestRangeRibbon({ ...back, direction: worldPoint(0, 0, 0) }, far),
    null,
  );
});

test("degenerate triangles cannot render or intercept clicks, including near-plane tangency", () => {
  const base = ribbon()[0];
  const degenerate: RangeRibbonTriangle = {
    ...base,
    vertices: [base.vertices[0], base.vertices[0], base.vertices[1]],
  };
  assert.equal(triangleLeafGeometry(degenerate), null);
  assert.equal(hitTestRangeRibbon(ray(2, 2), [degenerate]), null);
  const tangent: RangeRibbonTriangle = {
    ...crossingTriangle(),
    vertices: [
      { point: worldPoint(0, 0, -3), endpointWeight: 0 },
      { point: worldPoint(10, 0, -2), endpointWeight: 1 },
      { point: worldPoint(0, 10, -2), endpointWeight: 1 },
    ],
  };
  assert.deepEqual(clipRangeRibbonToCamera([tangent], camera), []);
});

test("paper-ray intersection round-trips a posed local point and rejects rotated bounding-box gaps", () => {
  const pose = {
    position: worldPoint(100, 50, -100),
    orientation: orientation(20, 40, 10),
  };
  const viewport = { width: 1000, height: 800 };
  const expected = paperToWorld(paperPoint(70, 120), pose, 200, 300);
  const projected = worldToScreen(expected, CAMERA_HOME, viewport);
  const hit = intersectPaperRay(
    screenRay(projected, CAMERA_HOME, viewport),
    pose,
    200,
    300,
  )!;
  close(hit.point.x, 70);
  close(hit.point.y, 120);
  close(hit.worldPoint.x, expected.x);
  close(hit.worldPoint.y, expected.y);
  close(hit.worldPoint.z, expected.z);
  const rotated = {
    position: worldPoint(0, 0, 0),
    orientation: orientation(0, 0, 45),
  };
  const outside = paperToWorld(paperPoint(-10, 50), rotated, 100, 100);
  assert.ok(
    Math.abs(outside.x) < Math.SQRT2 * 50 &&
      Math.abs(outside.y) < Math.SQRT2 * 50,
  );
  assert.equal(
    intersectPaperRay(ray(outside.x, outside.y), rotated, 100, 100),
    null,
  );
  assert.equal(intersectPaperRay(ray(0, 0, -10), rotated, 100, 100), null);
  assert.equal(intersectPaperRay(ray(0, 0), rotated, 0, 100), null);
  assert.equal(
    intersectPaperRay(
      { origin: worldPoint(0, 0, 10), direction: worldPoint(1, 0, 0) },
      rotated,
      100,
      100,
    ),
    null,
  );
});
