import { test } from "node:test";
import assert from "node:assert/strict";
import { passageHighlightRuns } from "../lib/reader/passage-highlights";

test("crowded and partially overlapping passage links paint once without filling unlinked text", () => {
  const repeated = Array.from({ length: 100 }, () => ({
    start: 10,
    end: 20,
    relation: "explanation" as const,
  }));
  assert.deepEqual(passageHighlightRuns(repeated), [
    { start: 10, end: 20, relation: "explanation" },
  ]);
  assert.deepEqual(
    passageHighlightRuns([
      ...repeated,
      { start: 15, end: 25, relation: "reference" },
      { start: 30, end: 35, relation: "reference" },
    ]),
    [
      { start: 10, end: 15, relation: "explanation" },
      { start: 15, end: 20, relation: "overlap" },
      { start: 20, end: 25, relation: "reference" },
      { start: 30, end: 35, relation: "reference" },
    ],
  );
});
