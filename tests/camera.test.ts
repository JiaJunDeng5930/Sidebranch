import assert from "node:assert/strict";
import test from "node:test";
import { Object3D, Vector3 } from "three";
import {
  CAMERA_HOME,
  worldPoint,
  worldToScreen,
  paperPoint,
  paperToWorld,
  screenToPlane,
  orientation,
  focusCamera,
  createPerspectiveCamera,
  setPaperObjectTransform,
  snapshotCameraPose,
  toThreeWorld,
  fitCameraToPaper,
} from "../lib/reader/camera";
import { PAPER_GEOMETRY } from "../lib/reader/paper-geometry";
const viewport = { width: 1440, height: 900 };
const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 0.002, `${a} != ${b}`);
test("independent rotated paper points round trip through Three camera ray and plane", () => {
  const paper = {
    position: worldPoint(240, 80, -370),
    orientation: orientation(8, -17, 3),
  };
  const camera = focusCamera(CAMERA_HOME, {
    position: worldPoint(0, 0, 0),
    orientation: orientation(-4, 19, 2),
  });
  const world = paperToWorld(paperPoint(150, 260), paper, 600, 780);
  const hit = screenToPlane(
    worldToScreen(world, camera, viewport),
    camera,
    viewport,
    world,
  )!;
  close(hit.x, world.x);
  close(hit.y, world.y);
  close(hit.z, world.z);
});
test("paper Object3D and domain projection share a centered y-up basis", () => {
  const paper = {
    position: worldPoint(-160, 40, -250),
    orientation: orientation(-3, 15, 2),
  };
  const pose = focusCamera(CAMERA_HOME, paper),
    camera = createPerspectiveCamera(pose, viewport),
    object = new Object3D();
  setPaperObjectTransform(object, paper);
  const p = object
    .localToWorld(new Vector3(170 - 300, 390 - 230, 0))
    .project(camera);
  const screen = worldToScreen(
    paperToWorld(paperPoint(170, 230), paper, 600, 780),
    pose,
    viewport,
  );
  close(screen.x, ((p.x + 1) * viewport.width) / 2);
  close(screen.y, ((1 - p.y) * viewport.height) / 2);
  const snapshot = snapshotCameraPose(camera, toThreeWorld(pose.target), pose);
  close(snapshot.position.x, pose.position.x);
  close(snapshot.position.y, pose.position.y);
  snapshot.orientation.forEach((value, index) =>
    close(value, pose.orientation[index]),
  );
});
test("focus fits stable paper by moving the camera, including narrow viewports", () => {
  const paper = {
    position: worldPoint(500, -80, -350),
    orientation: orientation(3, 12),
  };
  for (const size of [viewport, { width: 390, height: 600 }]) {
    const pose = fitCameraToPaper(
      focusCamera(CAMERA_HOME, paper),
      PAPER_GEOMETRY.width,
      PAPER_GEOMETRY.height,
      size,
    );
    const center = worldToScreen(paper.position, pose, size);
    close(center.x, size.width / 2);
    close(center.y, size.height / 2);
    const a = worldToScreen(
      paperToWorld(paperPoint(0, 0), paper, 600, 780),
      pose,
      size,
    );
    const b = worldToScreen(
      paperToWorld(paperPoint(600, 780), paper, 600, 780),
      pose,
      size,
    );
    assert.ok(
      a.x >= 39 &&
        a.y >= 47 &&
        b.x <= size.width - 39 &&
        b.y <= size.height - 47,
    );
  }
  assert.deepEqual(PAPER_GEOMETRY, { width: 600, height: 780 });
});
