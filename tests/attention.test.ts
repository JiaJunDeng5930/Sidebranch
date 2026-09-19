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
  type AttentionState,
  type ReadingPosition,
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
import {
  freeView,
  manualPlacement,
  readingView,
} from "../lib/reader/space-view";
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

test("attention preserves complete A/B reading context through promote and history", () => {
  const a = summary(1, "Alpha"),
    b = summary(2, "Beta");
  let state = emptyAttention();
  state = attentionReducer(state, {
    type: "navigate",
    position: position(a, 4),
  });
  const inspection = createConnectionInspection(
    connectionBetween(1, a, b),
    position(a, 4),
    position(b, 8),
    "from",
  );
  assert.ok(inspection);
  state = attentionReducer(state, {
    type: "inspect-connection",
    inspection,
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
  assert.equal(state.attention.companion?.position.documentId, a.id);
  assert.equal(
    state.attention.companion?.reason.kind === "connection"
      ? state.attention.companion.reason.currentEndpoint
      : null,
    "to",
  );
  assert.equal(returnHistoryIndex(state), 1);

  state = attentionReducer(state, { type: "history", index: 1 });
  assert.equal(state.attention.kind, "reading");
  if (state.attention.kind !== "reading") return;
  assert.equal(state.attention.current.documentId, a.id);
  assert.equal(state.attention.current.scrollTop, 4);
  assert.equal(state.attention.current.focus?.start, 0);
  assert.equal(state.attention.companion?.position.documentId, b.id);
  assert.equal(state.attention.companion?.position.scrollTop, 8);
  assert.equal(state.history.length, 3, "history restore does not append");
});

test("connection inspection keeps occurrence identity, aligns twice without history, and swaps both ends", () => {
  const a = summary(60, "Alpha");
  const b = summary(61, "Beta");
  const relation = connectionBetween(60, a, b);
  const current = position(a, 2);
  const companion = position(b, 4);
  const inspection = createConnectionInspection(
    relation,
    { ...current, surfaceId: surfaceInstanceId("a-occurrence") },
    { ...companion, surfaceId: surfaceInstanceId("b-occurrence") },
    "from",
  );
  assert.ok(inspection);
  let state = attentionReducer(emptyAttention(), {
    type: "inspect-connection",
    inspection,
  });
  assert.equal(state.history.length, 1);
  assert.equal(state.attention.kind, "reading");
  if (state.attention.kind !== "reading") return;
  assert.notEqual(
    state.attention.current.surfaceId,
    state.attention.companion?.position.surfaceId,
  );
  const realigned = createConnectionInspection(
    relation,
    { ...inspection.current, scrollTop: 140 },
    { ...inspection.companion, scrollTop: 220 },
    "from",
  );
  assert.ok(realigned);
  state = attentionReducer(state, {
    type: "inspect-connection",
    inspection: realigned,
  });
  assert.equal(state.history.length, 1, "alignment does not append history");
  assert.equal(state.attention.kind, "reading");
  if (state.attention.kind !== "reading") return;
  assert.equal(state.attention.current.scrollTop, 140);
  state = attentionReducer(state, { type: "promote" });
  assert.equal(state.history.length, 2);
  assert.equal(state.attention.kind, "reading");
  if (state.attention.kind !== "reading") return;
  assert.equal(state.attention.current.documentId, b.id);
  assert.equal(state.attention.companion?.position.documentId, a.id);
  assert.equal(
    state.attention.companion?.reason.kind === "connection"
      ? state.attention.companion.reason.currentEndpoint
      : null,
    "to",
  );
  assert.equal(
    createConnectionInspection(
      relation,
      { ...inspection.current, documentId: b.id },
      inspection.companion,
      "from",
    ),
    null,
  );
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
  const items = relationNavigationItems(
    [second, first],
    document.revisionId,
  );
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
  assert.equal(items[0]?.label, formatConnectionLabel(first, items[0]!.endpoint));
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
    surfaceId:
      state.attention.kind === "reading"
        ? state.attention.companion!.position.surfaceId
        : surfaceInstanceId("missing"),
    scrollTop: 120,
  });
  state = attentionReducer(state, {
    type: "focus",
    surfaceId:
      state.attention.kind === "reading"
        ? state.attention.current.surfaceId
        : surfaceInstanceId("missing"),
    focus: AnchorInput.parse({
      revisionId: a.revisionId,
      start: 2,
      end: 4,
      quote: "ab",
    }),
  });
  state = attentionReducer(state, {
    type: "view",
    view: freeView({ x: 3, y: -2, yaw: 12, pitch: -4, zoom: 0.8 }),
  });
  assert.equal(state.history.length, historyLength);
  const currentEntry = state.history[state.historyIndex];
  assert.equal(
    currentEntry?.view.kind === "free" ? currentEntry.view.camera.zoom : null,
    0.8,
  );
  assert.equal(currentEntry?.attention.kind, "reading");
  if (!currentEntry || currentEntry.attention.kind !== "reading") return;
  assert.equal(currentEntry.attention.companion?.position.scrollTop, 120);
  assert.equal(currentEntry.attention.current.focus?.start, 2);
});

test("intentional destinations use readable home framing and preserve the old pose", () => {
  const a = summary(30, "Alpha"),
    b = summary(31, "Beta");
  let state = attentionReducer(emptyAttention(), {
    type: "navigate",
    position: position(a),
  });
  const firstPose = { x: 240, y: -90, yaw: 12, pitch: -4, zoom: 0.8 };
  state = attentionReducer(state, { type: "view", view: freeView(firstPose) });
  state = attentionReducer(state, {
    type: "compare",
    position: position(b),
    reason: { kind: "document" },
  });
  assert.deepEqual(state.view, { kind: "reading", exposedSurfaceId: null });
  assert.deepEqual(state.history[0]?.view, {
    kind: "free",
    camera: firstPose,
    placements: new Map(),
  });

  const comparePose = { x: -180, y: 64, yaw: -8, pitch: 3, zoom: 1.2 };
  state = attentionReducer(state, {
    type: "view",
    view: freeView(comparePose),
  });
  state = attentionReducer(state, { type: "promote" });
  assert.deepEqual(state.view, { kind: "reading", exposedSurfaceId: null });
  assert.deepEqual(state.history[1]?.view, {
    kind: "free",
    camera: comparePose,
    placements: new Map(),
  });
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
      { connectionId: direct.id, target: { ...target, documentId: b.id, revisionId: b.revisionId } },
      a.revisionId,
      [direct],
    ),
    { kind: "follow", connectionId: direct.id },
  );
  assert.deepEqual(
    resolveEdgeActivation({ connectionId: secondHop.id, target }, a.revisionId, [
      secondHop,
    ]),
    { kind: "compare", target },
  );
  assert.deepEqual(
    resolveEdgeActivation({ connectionId: direct.id, target: { ...target, documentId: b.id, revisionId: b.revisionId } }, a.revisionId, []),
    {
      kind: "compare",
      target: { documentId: b.id, revisionId: b.revisionId, focus: null },
    },
  );
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

test("free view history carries occurrence placements without losing scroll", () => {
  const a = summary(70, "Alpha"),
    b = summary(71, "Beta");
  let state = attentionReducer(emptyAttention(), {
    type: "navigate",
    position: position(a, 5),
  });
  state = attentionReducer(state, {
    type: "compare",
    position: position(b, 8),
    reason: { kind: "document" },
  });
  assert.equal(state.attention.kind, "reading");
  if (state.attention.kind !== "reading") return;
  const currentId = state.attention.current.surfaceId;
  const companionId = state.attention.companion!.position.surfaceId;
  state = attentionReducer(state, {
    type: "view",
    view: freeView(
      { x: 1_200, y: -900, yaw: 8, pitch: -4, zoom: 1.4 },
      new Map([
        [currentId, manualPlacement(worldPoint(320, -140))],
        [surfaceInstanceId("stale-occurrence"), manualPlacement(worldPoint(9, 9))],
      ]),
    ),
  });
  state = attentionReducer(state, {
    type: "scroll",
    surfaceId: companionId,
    scrollTop: 640,
  });
  const freeIndex = state.historyIndex;
  assert.equal(state.history.length, 2);
  assert.equal(state.view.kind, "free");
  if (state.view.kind !== "free") return;
  assert.deepEqual(state.view.placements.get(currentId), {
    kind: "manual",
    center: worldPoint(320, -140),
  });
  assert.equal(state.view.placements.has(surfaceInstanceId("stale-occurrence")), false);
  assert.equal(
    state.attention.kind === "reading"
      ? state.attention.companion?.position.scrollTop
      : null,
    640,
  );

  state = attentionReducer(state, { type: "return-to-reading" });
  assert.equal(state.history.length, 3);
  assert.deepEqual(state.view, readingView(null));
  assert.equal(
    state.attention.kind === "reading"
      ? state.attention.companion?.position.scrollTop
      : null,
    640,
  );
  state = attentionReducer(state, { type: "history", index: freeIndex });
  assert.equal(state.view.kind, "free");
  if (state.view.kind !== "free") return;
  assert.equal(state.view.camera.zoom, 1.4);
  assert.equal(
    state.attention.kind === "reading"
      ? state.attention.companion?.position.scrollTop
      : null,
    640,
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
