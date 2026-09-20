import assert from "node:assert/strict";
import test from "node:test";
import { paperPoint, worldPoint } from "../lib/reader/camera";
import { buildPassageBandGeometry } from "../lib/reader/range-ribbon";
import { passageMouthInterval } from "../lib/reader/passage-mouth";

const row = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
});
const worldMouth = (mouth: {
  start: { x: number; y: number };
  end: { x: number; y: number };
}) => ({
  start: worldPoint(mouth.start.x, mouth.start.y, 0),
  end: worldPoint(mouth.end.x, mouth.end.y, 0),
});

// Compute the rendered area from indexed triangles, independently of mouth
// construction: the old implementation omitted the spaces between text rows.
function meshArea(positions: Float32Array, indices: Uint16Array) {
  let area = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]].map(
      (index) => [positions[3 * index], positions[3 * index + 1]],
    );
    area +=
      Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) /
      2;
  }
  return area;
}

test("unequal wrapped-row counts produce one filled band including line spacing", () => {
  const source = passageMouthInterval(
    [row(0, 0, 20, 10), row(0, 20, 12, 30), row(0, 40, 18, 50)],
    "right",
  )!;
  const target = passageMouthInterval(
    [row(100, 0, 120, 20), row(100, 35, 140, 50)],
    "left",
  )!;
  const mesh = buildPassageBandGeometry(worldMouth(source), worldMouth(target));
  assert.equal(mesh.positions.length / 3, 4);
  assert.equal(mesh.indices.length / 3, 2);
  assert.equal(meshArea(mesh.positions, mesh.indices), 80 * 50);
  const first = new Set(mesh.indices.slice(0, 3));
  assert.equal(
    [...mesh.indices.slice(3)].filter((index) => first.has(index)).length,
    2,
  );
  assert.deepEqual([...mesh.endpointWeights], [0, 1, 1, 0]);
});

test("facing edges use the whole passage envelope, regardless of short final rows", () => {
  const fragments = [row(8, 20, 70, 30), row(10, 40, 30, 50)];
  assert.deepEqual(passageMouthInterval(fragments, "right"), {
    start: paperPoint(70, 20),
    end: paperPoint(70, 50),
  });
  assert.deepEqual(passageMouthInterval(fragments, "left"), {
    start: paperPoint(8, 20),
    end: paperPoint(8, 50),
  });
  assert.deepEqual(passageMouthInterval(fragments, "top"), {
    start: paperPoint(8, 20),
    end: paperPoint(70, 20),
  });
  assert.deepEqual(passageMouthInterval(fragments, "bottom"), {
    start: paperPoint(8, 50),
    end: paperPoint(70, 50),
  });
});

test("separate anchors stay separate even when their screen rectangles overlap", () => {
  const first = passageMouthInterval([row(5, 10, 40, 30)], "right")!;
  const second = passageMouthInterval([row(5, 20, 40, 40)], "right")!;
  assert.equal(first.end.y, 30);
  assert.equal(second.start.y, 20);
  assert.notDeepEqual(first, second);
  assert.equal(passageMouthInterval([], "right"), null);
});
