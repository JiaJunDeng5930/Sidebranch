import assert from "node:assert/strict";
import test from "node:test";
import {
  AnchorInput,
  AnchorId,
  ConnectionId,
  DocumentId,
  Path,
  RevisionId,
  type Anchor,
  type Connection,
  type DocumentSummary,
} from "../lib/domain/model";
import {
  attentionReducer,
  createConnectionInspection,
  emptyAttention,
  readingPosition,
  returnHistoryIndex,
  focusedPosition,
  primarySurfaceId,
  type ReadingPosition,
  type AttentionState,
} from "../lib/reader/attention";
import {
  formatConnectionLabel,
  relationNavigationItems,
  surfaceInstanceId,
} from "../lib/reader/spatial-contract";
import {
  projectSpaceEdges,
  resolveEdgeActivation,
  type NeighborhoodKnowledge,
} from "../lib/reader/space-index";
import { manualPlacement } from "../lib/reader/space-view";
import { worldPoint } from "../lib/reader/camera";

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

let nextSurface = 0;

function position(document: DocumentSummary, start = 0): ReadingPosition {
  nextSurface += 1;
  return readingPosition(
    document,
    surfaceInstanceId(`attention-test-${nextSurface}`),
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

function connectionBetween(
  seed: number,
  fromDocument: DocumentSummary,
  toDocument: DocumentSummary,
): Connection {
  const anchor = (document: DocumentSummary, offset: number): Anchor => ({
    id: AnchorId.parse(id("40000000", seed * 2 + offset)),
    documentId: document.id,
    revisionId: document.revisionId,
    start: offset,
    end: offset + 2,
    quote: "ab",
  });
  return {
    id: connection(seed),
    from: anchor(fromDocument, 0),
    to: anchor(toDocument, 2),
    relation: "reference",
    label: "",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

test("catalogue creates persistent occurrences before any payload and navigation retains A/B/C", () => {
  const documents = [summary(1, "A"), summary(2, "B"), summary(3, "C")];
  let state = attentionReducer(emptyAttention(), {
    type: "catalogue",
    documents,
  });
  assert.equal(state.space.surfaces.size, 3);
  assert.equal(state.view.focus, null);
  assert.equal(
    new Set([...state.view.placements.values()].map((p) => p.position.x)).size,
    3,
  );
  const ids = documents.map((d) => primarySurfaceId(d.id, d.revisionId));
  for (const surfaceId of ids)
    state = attentionReducer(state, { type: "focus-surface", surfaceId });
  const moved = manualPlacement(worldPoint(77, 88, 99));
  state = attentionReducer(state, {
    type: "view",
    view: {
      ...state.view,
      placements: new Map(state.view.placements).set(ids[1], moved),
    },
  });
  state = attentionReducer(state, { type: "history", index: 1 });
  assert.equal(focusedPosition(state)?.documentId, documents[1].id);
  assert.equal(state.space.surfaces.size, 3);
  assert.deepEqual(state.view.placements.get(ids[1]), moved);
  state = attentionReducer(state, { type: "focus-surface", surfaceId: ids[0] });
  assert.equal(state.history.length, 3);
  assert.equal(state.space.surfaces.has(ids[2]), true);
  assert.equal(returnHistoryIndex(state), 1);
});

test("history restores focus, camera and scroll without restoring old paper poses", () => {
  const a = position(summary(4, "A")),
    b = position(summary(5, "B"));
  let state = attentionReducer(emptyAttention(), {
    type: "navigate",
    position: a,
  });
  state = attentionReducer(state, {
    type: "scroll",
    surfaceId: a.surfaceId,
    scrollTop: 240,
  });
  const savedCamera = state.view.camera;
  state = attentionReducer(state, { type: "navigate", position: b });
  state = attentionReducer(state, {
    type: "scroll",
    surfaceId: a.surfaceId,
    scrollTop: 700,
  });
  state = attentionReducer(state, { type: "history", index: 0 });
  assert.equal(focusedPosition(state)?.scrollTop, 240);
  assert.deepEqual(state.view.camera, savedCamera);
  assert.equal(state.space.surfaces.size, 2);
});

test("same-revision connections bind two distinct retained occurrences and validate exact endpoints", () => {
  const document = summary(6, "Self"),
    other = summary(7, "Other");
  const relation = connectionBetween(6, document, document);
  let state = attentionReducer(emptyAttention(), {
    type: "catalogue",
    documents: [document],
  });
  state = attentionReducer(state, {
    type: "bind-connections",
    connections: [relation],
  });
  const binding = state.bindings.get(relation.id)!;
  assert.notEqual(binding.from, binding.to);
  assert.equal(state.space.surfaces.size, 2);
  const from = state.space.surfaces.get(binding.from)!,
    to = state.space.surfaces.get(binding.to)!;
  assert.equal(createConnectionInspection(relation, from, from, "from"), null);
  assert.equal(
    createConnectionInspection(relation, from, position(other), "from"),
    null,
  );
  const inspection = createConnectionInspection(relation, from, to, "from")!;
  state = attentionReducer(state, { type: "inspect-connection", inspection });
  assert.equal(state.view.focus, binding.to);
  assert.equal(
    state.space.surfaces.get(binding.from)?.focus?.start,
    relation.from.start,
  );
  assert.equal(
    state.space.surfaces.get(binding.to)?.focus?.start,
    relation.to.start,
  );
  state = attentionReducer(state, {
    type: "focus-surface",
    surfaceId: binding.from,
  });
  assert.deepEqual(state.bindings.get(relation.id), binding);
});

test("new catalogue revisions and late payload metadata never overwrite occurrence identity or focus", () => {
  const document = summary(8, "Old");
  let state = attentionReducer(emptyAttention(), {
    type: "catalogue",
    documents: [document],
  });
  const oldId = state.space.primary.get(document.id)!;
  state = attentionReducer(state, { type: "focus-surface", surfaceId: oldId });
  const newer = {
    ...document,
    revisionId: summary(9, "New").revisionId,
    sequence: 6,
  };
  state = attentionReducer(state, { type: "catalogue", documents: [newer] });
  assert.equal(state.space.surfaces.size, 2);
  assert.notEqual(state.space.primary.get(document.id), oldId);
  assert.equal(state.view.focus, oldId);
  const before = state;
  state = attentionReducer(state, {
    type: "admit",
    position: readingPosition(newer, oldId),
    metadata: newer,
  });
  assert.equal(state, before);
});

test("relation navigation keeps both endpoints and stable same-range order", () => {
  const document = summary(62, "Self");
  const first = connectionBetween(62, document, document);
  const secondBase = connectionBetween(63, document, document);
  const second = {
    ...secondBase,
    from: { ...secondBase.from, start: 0, end: 2 },
    to: { ...secondBase.to, start: 0, end: 2 },
  };
  const items = relationNavigationItems([second, first], document.revisionId);
  assert.equal(items.length, 4);
  assert.deepEqual(
    items.map((item) => [item.connectionId, item.endpoint]),
    [
      [first.id, "from"],
      [second.id, "from"],
      [second.id, "to"],
      [first.id, "to"],
    ],
  );
  assert.equal(
    items.filter((item) => item.connectionId === first.id).length,
    2,
  );
  assert.equal(
    items[0]?.label,
    formatConnectionLabel(first, items[0]!.endpoint),
  );
});

test("edge activation follows only an exact loaded current-to-target connection", () => {
  const a = summary(32, "Alpha"),
    b = summary(33, "Beta"),
    c = summary(34, "Gamma");
  const direct = connectionBetween(32, a, b);
  const secondHop = connectionBetween(33, b, c);
  const target = {
    documentId: c.id,
    revisionId: c.revisionId,
    focus: null,
  } as const;

  assert.deepEqual(
    resolveEdgeActivation(
      {
        connectionId: direct.id,
        target: { ...target, documentId: b.id, revisionId: b.revisionId },
      },
      a.revisionId,
      [direct],
    ),
    { kind: "follow", connectionId: direct.id },
  );
  assert.deepEqual(
    resolveEdgeActivation(
      { connectionId: secondHop.id, target },
      a.revisionId,
      [secondHop],
    ),
    { kind: "compare", target },
  );
  assert.deepEqual(
    resolveEdgeActivation(
      {
        connectionId: direct.id,
        target: { ...target, documentId: b.id, revisionId: b.revisionId },
      },
      a.revisionId,
      [],
    ),
    {
      kind: "compare",
      target: { documentId: b.id, revisionId: b.revisionId, focus: null },
    },
  );
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
