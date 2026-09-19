import { test } from "node:test";
import assert from "node:assert/strict";
import {
  poseForScreenAnchor,
  screenToWorld,
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
  const points = [
    { x: 0, y: 0 },
    { x: 300, y: -120 },
    { x: -700, y: 600 },
  ];

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
  const screen = { x: 814, y: 386 };
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
