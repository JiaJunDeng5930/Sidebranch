import assert from "node:assert/strict";
import test from "node:test";
import type { DocumentId, RevisionId } from "../lib/domain/model";
import { desiredFullText } from "../lib/reader/space-residency";
import { createSpaceView } from "../lib/reader/space-view";
import { CAMERA_HOME, orientation, worldPoint } from "../lib/reader/camera";
import {
  surfaceInstanceId,
  type SpaceSurface,
} from "../lib/reader/spatial-contract";
const surfaces: SpaceSurface[] = Array.from({ length: 30 }, (_, index) => {
  const surfaceId = surfaceInstanceId(`paper-${index}`);
  return {
    surfaceId,
    position: {
      surfaceId,
      documentId: `document-${index}` as DocumentId,
      revisionId: `revision-${index}` as RevisionId,
      focus: null,
      scrollTop: 0,
    },
    metadata: null,
    document: null,
    payload: "unloaded",
    error: null,
  };
});
const placements = new Map(
  surfaces.map((surface) => [
    surface.surfaceId,
    { position: worldPoint(0, 0, 0), orientation: orientation(0, 0) },
  ]),
);
const viewport = { width: 1200, height: 850 };
test("readable viewport demand exceeds two papers but obeys the payload entry budget", () => {
  const view = createSpaceView(CAMERA_HOME, placements);
  assert.equal(desiredFullText(surfaces.slice(0, 3), view, viewport).length, 3);
  assert.equal(desiredFullText(surfaces, view, viewport).length, 24);
  const distant = {
    ...view,
    placements: new Map(placements).set(surfaces[0].surfaceId, {
      position: worldPoint(20000, 0, 0),
      orientation: orientation(0, 0),
    }),
  };
  assert.equal(
    desiredFullText(surfaces, distant, viewport).includes(
      surfaces[0].surfaceId,
    ),
    false,
  );
  assert.equal(
    desiredFullText(
      surfaces,
      { ...distant, focus: surfaces[0].surfaceId },
      viewport,
    )[0],
    surfaces[0].surfaceId,
  );
});
test("known payload sizes bound hydration without removing occurrences", () => {
  const candidates = surfaces.map((surface) => ({
    ...surface,
    payloadSize: 2 * 1024 * 1024,
  }));
  assert.equal(
    desiredFullText(
      candidates,
      createSpaceView(CAMERA_HOME, placements),
      viewport,
    ).length,
    4,
  );
  assert.equal(candidates.length, 30);
});

test("payload admission has hysteresis while paper geometry and pinned selections stay stable", () => {
  const surface = surfaces[0],
    before = createSpaceView(
      CAMERA_HOME,
      new Map(placements).set(surface.surfaceId, {
        position: worldPoint(0, 0, -4440),
        orientation: orientation(0, 0),
      }),
    );
  assert.deepEqual(desiredFullText([surface], before, viewport), []);
  assert.deepEqual(
    desiredFullText([surface], before, viewport, {
      resident: new Set([surface.surfaceId]),
    }),
    [surface.surfaceId],
  );
  const farther = {
    ...before,
    placements: new Map(before.placements).set(surface.surfaceId, {
      position: worldPoint(0, 0, -6500),
      orientation: orientation(0, 0),
    }),
  };
  assert.deepEqual(
    desiredFullText([surface], farther, viewport, {
      resident: new Set([surface.surfaceId]),
    }),
    [],
  );
  assert.deepEqual(
    desiredFullText([surface], farther, viewport, {
      pinned: new Set([surface.surfaceId]),
    }),
    [surface.surfaceId],
  );
  assert.equal(before.placements.get(surface.surfaceId)!.position.z, -4440);
  assert.equal(surface.surfaceId, surfaces[0].surfaceId);
});
