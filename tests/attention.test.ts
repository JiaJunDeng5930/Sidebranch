import assert from "node:assert/strict";
import test from "node:test";
import {
  AnchorInput,
  ConnectionId,
  DocumentId,
  Path,
  RevisionId,
  type DocumentSummary,
} from "../lib/domain/model";
import {
  attentionReducer,
  emptyAttention,
  readingPosition,
  returnHistoryIndex,
  type AttentionState,
  type ReadingPosition,
} from "../lib/reader/attention";
import {
  projectSpaceEdges,
  type NeighborhoodKnowledge,
} from "../lib/reader/space-index";

function id(prefix: string, value: number): string {
  return `${prefix}-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}

function summary(
  seed: number,
  title: string,
  archived = false,
): DocumentSummary {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: DocumentId.parse(id("00000000", seed)),
    path: Path.parse(`/notes/${seed}.md`),
    title,
    revisionId: RevisionId.parse(id("10000000", seed)),
    sequence: 5,
    format: "markdown",
    createdAt: now,
    updatedAt: now,
    assetId: null,
    archived,
  };
}

function position(document: DocumentSummary, start = 0): ReadingPosition {
  return readingPosition(
    document,
    AnchorInput.parse({
      revisionId: document.revisionId,
      start,
      end: start + 2,
      quote: "ab",
    }),
    start,
  );
}

function connection(seed: number): ConnectionId {
  return ConnectionId.parse(id("30000000", seed));
}

test("attention preserves complete A/B reading context through promote and history", () => {
  const a = summary(1, "Alpha"),
    b = summary(2, "Beta");
  let state = emptyAttention();
  state = attentionReducer(state, {
    type: "navigate",
    position: position(a, 4),
  });
  state = attentionReducer(state, {
    type: "compare",
    position: position(b, 8),
    reason: { kind: "connection", connectionId: connection(1) },
  });
  assert.equal(state.history.length, 2);
  assert.equal(state.attention.kind, "reading");
  if (state.attention.kind !== "reading") return;
  assert.equal(state.attention.current.documentId, a.id);
  assert.equal(state.attention.companion?.position.documentId, b.id);

  state = attentionReducer(state, { type: "promote" });
  assert.equal(state.history.length, 3);
  assert.equal(state.attention.kind, "reading");
  if (state.attention.kind !== "reading") return;
  assert.equal(state.attention.current.documentId, b.id);
  assert.equal(state.attention.companion, null);
  assert.equal(returnHistoryIndex(state), 1);

  state = attentionReducer(state, { type: "history", index: 1 });
  assert.equal(state.attention.kind, "reading");
  if (state.attention.kind !== "reading") return;
  assert.equal(state.attention.current.documentId, a.id);
  assert.equal(state.attention.current.scrollTop, 4);
  assert.equal(state.attention.current.focus?.start, 4);
  assert.equal(state.attention.companion?.position.documentId, b.id);
  assert.equal(state.attention.companion?.position.scrollTop, 8);
  assert.equal(state.history.length, 3, "history restore does not append");
});

test("scroll, focus, and camera replace the current history snapshot", () => {
  const a = summary(3, "Alpha"),
    b = summary(4, "Beta");
  let state = emptyAttention();
  state = attentionReducer(state, { type: "navigate", position: position(a) });
  state = attentionReducer(state, {
    type: "compare",
    position: position(b),
    reason: { kind: "document" },
  });
  const historyLength = state.history.length;
  state = attentionReducer(state, {
    type: "scroll",
    role: "companion",
    scrollTop: 120,
  });
  state = attentionReducer(state, {
    type: "focus",
    role: "current",
    focus: AnchorInput.parse({
      revisionId: a.revisionId,
      start: 2,
      end: 4,
      quote: "ab",
    }),
  });
  state = attentionReducer(state, {
    type: "camera",
    pose: { x: 3, y: -2, yaw: 12, pitch: -4, zoom: 0.8 },
  });
  assert.equal(state.history.length, historyLength);
  const currentEntry = state.history[state.historyIndex];
  assert.equal(currentEntry?.camera.zoom, 0.8);
  assert.equal(currentEntry?.attention.kind, "reading");
  if (!currentEntry || currentEntry.attention.kind !== "reading") return;
  assert.equal(currentEntry.attention.companion?.position.scrollTop, 120);
  assert.equal(currentEntry.attention.current.focus?.start, 2);
});

test("return-to-current is reversible and branch navigation drops forward history", () => {
  const a = summary(5, "Alpha"),
    b = summary(6, "Beta"),
    c = summary(7, "Gamma");
  let state = emptyAttention();
  state = attentionReducer(state, { type: "navigate", position: position(a) });
  state = attentionReducer(state, {
    type: "compare",
    position: position(b),
    reason: { kind: "revision" },
  });
  state = attentionReducer(state, { type: "return-to-current" });
  assert.equal(state.history.length, 3);
  assert.equal(state.attention.kind, "reading");
  if (state.attention.kind !== "reading") return;
  assert.equal(state.attention.companion, null);
  state = attentionReducer(state, { type: "history", index: 1 });
  assert.equal(state.attention.kind, "reading");
  if (state.attention.kind !== "reading") return;
  assert.equal(state.attention.companion?.position.documentId, b.id);

  state = attentionReducer(state, { type: "navigate", position: position(c) });
  assert.equal(state.history.length, 3);
  assert.equal(state.historyIndex, 2);
  assert.equal(state.attention.kind, "reading");
  if (state.attention.kind !== "reading") return;
  assert.equal(state.attention.current.documentId, c.id);
});

test("space projection groups revisions, keeps proven distance, and preserves outer documents", () => {
  const a = summary(8, "Center"),
    direct = summary(9, "Direct"),
    second = summary(10, "Second"),
    outer = summary(11, "Outer"),
    archived = summary(12, "Archived", true);
  const historicalRevision = RevisionId.parse(id("20000000", 9));
  const secondCurrentRevision = RevisionId.parse(id("20000000", 10));
  const knowledge: NeighborhoodKnowledge = {
    kind: "partial",
    centerRevisionId: a.revisionId,
    nodes: [
      {
        document: direct,
        revisionId: historicalRevision,
        sequence: 3,
        distance: 1,
        viaRevisionId: null,
        connectionId: connection(2),
      },
      {
        document: direct,
        revisionId: direct.revisionId,
        sequence: direct.sequence,
        distance: 1,
        viaRevisionId: null,
        connectionId: connection(3),
      },
      {
        document: second,
        revisionId: secondCurrentRevision,
        sequence: 2,
        distance: 2,
        viaRevisionId: direct.revisionId,
        connectionId: connection(4),
      },
    ],
    nextCursor: "next",
  };
  const leaves = projectSpaceEdges(
    [a, direct, second, outer, archived],
    knowledge,
    [position(a)],
  );
  assert.deepEqual(
    leaves.map((leaf) => [leaf.document.title, leaf.band]),
    [
      ["Direct", "direct"],
      ["Second", "second"],
      ["Outer", "other"],
      ["Archived", "archive"],
    ],
  );
  const directLeaf = leaves.find((leaf) => leaf.document.id === direct.id)!;
  assert.equal(directLeaf.target.revisionId, direct.revisionId);
  assert.equal(directLeaf.sequence, direct.sequence);
  assert.equal(directLeaf.connectionId, connection(3));
  assert.deepEqual(directLeaf.alternatives, [
    { revisionId: historicalRevision, sequence: 3 },
  ]);
  assert.equal(
    leaves.filter((leaf) => leaf.document.id === direct.id).length,
    1,
  );
});

test("late or failed neighborhood knowledge still projects already proven nodes", () => {
  const center = summary(13, "Center"),
    target = summary(14, "Target"),
    outer = summary(15, "Outer");
  const node = {
    document: target,
    revisionId: target.revisionId,
    sequence: target.sequence,
    distance: 1 as const,
    viaRevisionId: null,
    connectionId: connection(5),
  };
  for (const kind of ["loading", "failed"] as const) {
    const knowledge: NeighborhoodKnowledge =
      kind === "loading"
        ? { kind, centerRevisionId: center.revisionId, nodes: [node] }
        : {
            kind,
            centerRevisionId: center.revisionId,
            nodes: [node],
            message: "temporarily unavailable",
          };
    const leaves = projectSpaceEdges([center, target, outer], knowledge, [
      position(center),
    ]);
    assert.equal(
      leaves.find((leaf) => leaf.document.id === target.id)?.band,
      "direct",
    );
    assert.equal(
      leaves.find((leaf) => leaf.document.id === outer.id)?.band,
      "other",
    );
  }
});

// Keep the state type in this test module so accidental changes to the public
// reducer return shape are caught by the compiler even when narrowing early.
const stateShapeCheck: AttentionState | null = null;
void stateShapeCheck;
