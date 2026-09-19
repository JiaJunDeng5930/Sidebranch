import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultPaperPose,
  rangeScrollTarget,
} from "../components/reader/scene-presentation";
test("initial independent papers have distinct depths and orientations", () => {
  const a = defaultPaperPose(0),
    b = defaultPaperPose(1);
  assert.notEqual(a.position.z, b.position.z);
  assert.notDeepEqual(a.orientation, b.orientation);
});
test("range focus keeps short anchors visible and bounds long-anchor scrolling", () => {
  assert.equal(rangeScrollTarget(1000, 1050, true, 500, 2000), 815);
  assert.equal(rangeScrollTarget(0, 2000, true, 500, 2000), 0);
  assert.equal(rangeScrollTarget(5000, 5100, true, 500, 2000), 2000);
});
