import assert from "node:assert/strict";
import { test } from "node:test";
import { projectScenePoints } from "../components/reader/scene-geometry";
import {
  isProjectionSafe,
  worldPoint,
  worldToScreen,
} from "../lib/reader/camera";

const viewport = { width: 1440, height: 900 };

test("relation projection hides an unsafe proxy without restricting a distant safe paper", () => {
  const camera = { x: 10000, y: 0, zoom: 1, yaw: -22, pitch: 0 };
  const paper = [
    worldPoint(9680, -300),
    worldPoint(10320, -300),
    worldPoint(10320, 300),
    worldPoint(9680, 300),
  ];
  const proxy = worldPoint(0, 0);
  const label = worldPoint(5000, 0);
  assert.equal(isProjectionSafe(paper, camera), true);
  assert.throws(() => worldToScreen(label, camera, viewport), RangeError);
  assert.deepEqual(projectScenePoints([label], camera, viewport), []);
  assert.deepEqual(
    projectScenePoints([paper[0], paper[1], proxy], camera, viewport),
    [],
  );
  assert.deepEqual(
    projectScenePoints(paper, camera, viewport),
    paper.map((point) => worldToScreen(point, camera, viewport)),
  );
  // A later safe frame projects the same primitive again; no stale hidden state is cached.
  const restored = { ...camera, yaw: 0 };
  assert.deepEqual(projectScenePoints([label], restored, viewport), [
    worldToScreen(label, restored, viewport),
  ]);
});

test("a contour crossing the perspective safety boundary is hidden as a whole", () => {
  const camera = { x: 10000, y: 0, zoom: 1, yaw: -22, pitch: 0 };
  const contour = [
    worldPoint(9900, 0),
    worldPoint(7000, 10),
    worldPoint(10000, 20),
  ];
  assert.deepEqual(projectScenePoints(contour, camera, viewport), []);
  assert.deepEqual(projectScenePoints([], camera, viewport), []);
});
