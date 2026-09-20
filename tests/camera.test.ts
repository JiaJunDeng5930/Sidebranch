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
  fitCameraToPapers,
  isPaperVisible,
} from "../lib/reader/camera";
import {
  PAPER_GEOMETRY,
  paperGeometryForViewport,
} from "../lib/reader/paper-geometry";
const viewport = { width: 1440, height: 900 };
const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 0.002, `${a} != ${b}`);
test("short viewport papers retain readable projected type and narrow screens retain portrait pages", () => {
  const paper = {
    position: worldPoint(0, 0, 0),
    orientation: orientation(0, 0),
  };
  // The embedded host's controls can leave substantially less than the browser height.
  for (const height of [302, 166]) {
    const size = { width: 900, height };
    const geometry = paperGeometryForViewport(size);
    const pose = fitCameraToPaper(
      focusCamera(CAMERA_HOME, paper),
      geometry.width,
      geometry.height,
      size,
    );
    const start = worldToScreen(
      paperToWorld(paperPoint(0, 0), paper, geometry.width, geometry.height),
      pose,
      size,
    );
    const end = worldToScreen(
      paperToWorld(
        paperPoint(geometry.width, geometry.height),
        paper,
        geometry.width,
        geometry.height,
      ),
      pose,
      size,
    );
    assert.ok((24 * (end.x - start.x)) / geometry.width >= 16);
    assert.ok(start.y >= 0 && end.y <= size.height);
  }
  assert.deepEqual(
    paperGeometryForViewport({ width: 390, height: 786 }),
    PAPER_GEOMETRY,
  );
});
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
      a.x >= Math.min(40, size.width * 0.04) - 1 &&
        a.y >= 47 &&
        b.x <= size.width - Math.min(40, size.width * 0.04) + 1 &&
        b.y <= size.height - 47,
    );
  }
  assert.deepEqual(PAPER_GEOMETRY, { width: 600, height: 780 });
});

test("comparison frames both tilted papers at different depths without moving either", () => {
  const papers = [
    {
      pose: {
        position: worldPoint(-900, 350, 200),
        orientation: orientation(5, -14, 3),
      },
      ...PAPER_GEOMETRY,
    },
    {
      pose: {
        position: worldPoint(1600, -420, -950),
        orientation: orientation(-8, 21, -4),
      },
      ...PAPER_GEOMETRY,
    },
  ];
  const original = JSON.stringify(papers);
  for (const size of [
    viewport,
    { width: 390, height: 740 },
    { width: 900, height: 360 },
  ]) {
    const camera = fitCameraToPapers(
      focusCamera(CAMERA_HOME, papers[1].pose),
      papers,
      size,
    );
    for (const { pose, width, height } of papers)
      for (const [x, y] of [
        [0, 0],
        [width, 0],
        [width, height],
        [0, height],
      ]) {
        const projected = worldToScreen(
          paperToWorld(paperPoint(x, y), pose, width, height),
          camera,
          size,
        );
        assert.ok(projected.x >= 0 && projected.x <= size.width);
        assert.ok(projected.y >= 0 && projected.y <= size.height);
      }
  }
  assert.equal(JSON.stringify(papers), original);
});

test("paper visibility rejects near-plane crossings, backs, and offscreen papers", () => {
  const camera = createPerspectiveCamera(CAMERA_HOME, viewport);
  const visible = (x: number, z: number, yRotation = 0) =>
    isPaperVisible(
      camera,
      {
        position: worldPoint(x, 0, z),
        orientation: orientation(0, yRotation),
      },
      600,
      780,
    );
  assert.equal(visible(0, 0), true);
  assert.equal(visible(0, 1400), true);
  assert.equal(visible(0, 1460), false);
  assert.equal(visible(0, 1400, 20), false);
  assert.equal(visible(0, 1700), false);
  assert.equal(visible(0, 0, 180), false);
  assert.equal(visible(5000, 0), false);
});

test("large collection framing remains within the renderer far plane", () => {
  const papers = [0, 60000].map((y) => ({
    pose: {
      position: worldPoint(0, y, -y / 5),
      orientation: orientation(0, 0),
    },
    ...PAPER_GEOMETRY,
  }));
  const pose = fitCameraToPapers(CAMERA_HOME, papers, viewport);
  const camera = createPerspectiveCamera(pose, viewport);
  for (const paper of papers)
    assert.equal(
      isPaperVisible(camera, paper.pose, paper.width, paper.height),
      true,
    );
});
