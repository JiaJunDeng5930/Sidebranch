import { test } from "node:test";
import assert from "node:assert/strict";
import { passageHighlightRuns } from "../lib/reader/passage-highlights";

test("crowded and partially overlapping passage links paint once without filling unlinked text", () => {
  const repeated = Array.from({ length: 100 }, () => ({
    start: 10,
    end: 20,
    color: "#1f716d",
  }));
  assert.deepEqual(passageHighlightRuns(repeated), [
    { start: 10, end: 20, color: "#1f716d" },
  ]);
  assert.deepEqual(
    passageHighlightRuns([
      ...repeated,
      { start: 15, end: 25, color: "#9a5c1f" },
      { start: 30, end: 35, color: "#9a5c1f" },
    ]),
    [
      { start: 10, end: 15, color: "#1f716d" },
      { start: 15, end: 20, color: "#62676c" },
      { start: 20, end: 25, color: "#9a5c1f" },
      { start: 30, end: 35, color: "#9a5c1f" },
    ],
  );
});
