import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAMERA_LIMITS,
  constrainCameraPose,
  poseForScreenAnchor,
  projectionSafety,
  screenPoint,
  screenToWorld,
  worldPoint,
  worldToScreen,
} from "../lib/reader/camera";
import type { CameraPose } from "../lib/reader/attention";

const viewport = { width: 1363, height: 936 };

function assertClose(actual: number, expected: number, message: string): void {
  assert.ok(
    Math.abs(actual - expected) < 1e-6,
    `${message}: expected ${expected}, got ${actual}`,
  );
}

test("camera projection is the inverse of the CSS perspective transform", () => {
  const poses: CameraPose[] = [
    { x: 0, y: 0, yaw: 0, pitch: 0, zoom: 1 },
    { x: 120, y: -80, yaw: 18, pitch: -8, zoom: 1.3 },
    { x: -340, y: 230, yaw: -20, pitch: 10, zoom: 0.6 },
  ];
  const points = [worldPoint(0, 0), worldPoint(300, -120), worldPoint(-700, 600)];

  for (const pose of poses) {
    for (const point of points) {
      const screen = worldToScreen(point, pose, viewport);
      const roundTrip = screenToWorld(screen, pose, viewport);
      assertClose(roundTrip.x, point.x, "world x");
      assertClose(roundTrip.y, point.y, "world y");
    }
  }
});

test("screen anchor remains fixed when zoom changes with yaw and pitch", () => {
  const pose: CameraPose = {
    x: 96,
    y: -42,
    yaw: 16,
    pitch: -7,
    zoom: 1,
  };
  const screen = screenPoint(814, 386);
  const world = screenToWorld(screen, pose, viewport);
  const zoomed = poseForScreenAnchor(
    world,
    screen,
    { ...pose, zoom: 1.55 },
    viewport,
  );
  const projected = worldToScreen(world, zoomed, viewport);
  assertClose(projected.x, screen.x, "anchored screen x");
  assertClose(projected.y, screen.y, "anchored screen y");
});

test("the common projection round-trips at the complete zoom range", () => {
  const points = [worldPoint(-280, -180), worldPoint(140, 240)];
  for (const zoom of [CAMERA_LIMITS.zoomMin, 1, CAMERA_LIMITS.zoomMax]) {
    for (const yaw of [-22, 0, 22]) {
      for (const pitch of [-10, 0, 10]) {
        const pose: CameraPose = {
          x: 120,
          y: -80,
          yaw,
          pitch,
          zoom,
        };
        for (const point of points) {
          const screen = worldToScreen(point, pose, viewport);
          const roundTrip = screenToWorld(screen, pose, viewport);
          assertClose(roundTrip.x, point.x, "range round-trip x");
          assertClose(roundTrip.y, point.y, "range round-trip y");
        }
      }
    }
  }
});

test("paper corners are a shared projection domain and bad angles converge", () => {
  const remoteCorners = [
    worldPoint(10_640, 410),
    worldPoint(10_640, 810),
    worldPoint(10_000, 410),
    worldPoint(10_000, 810),
  ];
  const unsafe: CameraPose = {
    x: 0,
    y: 0,
    yaw: 22,
    pitch: 10,
    zoom: 1.8,
  };
  assert.equal(projectionSafety(remoteCorners, unsafe).valid, false);
  const safe = constrainCameraPose(unsafe, unsafe, {
    safetyCorners: remoteCorners,
  });
  assert.equal(projectionSafety(remoteCorners, safe).valid, true);
  assert.ok(Math.abs(safe.yaw) < Math.abs(unsafe.yaw));
  assert.ok(Math.abs(safe.pitch) < Math.abs(unsafe.pitch));
});

test("an invalid candidate retains its previous finite translation", () => {
  const previous: CameraPose = {
    x: 12_000,
    y: -9_000,
    yaw: 4,
    pitch: -3,
    zoom: 1.2,
  };
  const repaired = constrainCameraPose(
    { ...previous, x: Number.NaN, zoom: Number.POSITIVE_INFINITY },
    previous,
  );
  assert.equal(repaired.x, previous.x);
  assert.equal(repaired.y, previous.y);
  assert.equal(repaired.zoom, previous.zoom);
});
