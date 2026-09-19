import assert from "node:assert/strict";
import test from "node:test";
import {
  CAMERA_HOME,
  worldPoint,
  worldToScreen,
  paperPoint,
  paperToWorld,
  screenToPlane,
  orientation,
  orbitCamera,
  focusCamera,
  cameraTransform,
  paperTransform,
  viewMatrix,
} from "../lib/reader/camera";
import { mat4, vec4 } from "gl-matrix";
const viewport = { width: 1440, height: 900 };
const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 0.002, `${a} != ${b}`);
test("independent rotated paper points round trip through a camera ray and plane", () => {
  const paper = {
    position: worldPoint(240, 80, -370),
    orientation: orientation(8, -17, 3),
  };
  const camera = orbitCamera(CAMERA_HOME, 85, -20);
  const world = paperToWorld(paperPoint(150, 260), paper, 600, 700);
  const screen = worldToScreen(world, camera, viewport);
  const hit = screenToPlane(screen, camera, viewport, world)!;
  close(hit.x, world.x);
  close(hit.y, world.y);
  close(hit.z, world.z);
});
test("CSS and range geometry use identical model and view projection", () => {
  const paper = {
    position: worldPoint(-160, 40, -250),
    orientation: orientation(-3, 15, 2),
  };
  const camera = orbitCamera(CAMERA_HOME, 35, 10);
  const parse = (s: string) =>
    s.slice(9, -1).split(",").map(Number) as unknown as mat4;
  const css = mat4.multiply(
    mat4.create(),
    parse(cameraTransform(camera)),
    parse(paperTransform(paper, 600, 700)),
  );
  const p = vec4.transformMat4(vec4.create(), [170, 230, 0, 1], css);
  const factor = camera.perspective / (camera.perspective - p[2]);
  const screen = worldToScreen(
    paperToWorld(paperPoint(170, 230), paper, 600, 700),
    camera,
    viewport,
  );
  close(screen.x, viewport.width / 2 + p[0] * factor);
  close(screen.y, viewport.height / 2 + p[1] * factor);
});
test("depth changes parallax and focus approaches the existing independent pose", () => {
  const camera = orbitCamera(CAMERA_HOME, 70, 0);
  const near = worldToScreen(worldPoint(0, 0, 200), camera, viewport),
    far = worldToScreen(worldPoint(0, 0, -400), camera, viewport);
  assert.ok(Math.abs(near.x - far.x) > 100);
  const paper = {
    position: worldPoint(500, -80, -350),
    orientation: orientation(3, 12),
  };
  const focused = focusCamera(camera, paper);
  const center = worldToScreen(paper.position, focused, viewport);
  close(center.x, 720);
  close(center.y, 450);
  const pose = vec4.transformMat4(
    vec4.create(),
    [paper.position.x, paper.position.y, paper.position.z, 1],
    viewMatrix(focused),
  );
  close(pose[2], -focused.perspective);
});
