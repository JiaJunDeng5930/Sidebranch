import assert from "node:assert/strict";
import test from "node:test";
import { projectScenePoints } from "../components/reader/scene-geometry";
import { CAMERA_HOME, worldPoint, worldToScreen } from "../lib/reader/camera";
const viewport = { width: 1440, height: 900 };
test("a 3d contour crossing the near plane is hidden as a whole", () => {
  const safe = [worldPoint(10, 20, -300), worldPoint(30, 40, 200)];
  assert.deepEqual(
    projectScenePoints(safe, CAMERA_HOME, viewport),
    safe.map((p) => worldToScreen(p, CAMERA_HOME, viewport)),
  );
  assert.deepEqual(
    projectScenePoints(
      [...safe, worldPoint(0, 0, 1470)],
      CAMERA_HOME,
      viewport,
    ),
    [],
  );
});
