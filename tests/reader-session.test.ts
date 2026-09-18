import assert from "node:assert/strict";
import test from "node:test";
import {
  AnchorInput,
  AnchorId,
  ConnectionId,
  DocumentId,
  Path,
  QuestionId,
  RevisionId,
  type DocumentRevision,
  type Question,
} from "../lib/domain/model";
import {
  emptySession,
  readerSessionReducer,
  type ReadingContext,
  type ReaderViewTarget,
} from "../lib/reader/session";
import type { ViewId } from "../lib/reader/scene";

function revision(seed: string, sequence = 1): DocumentRevision {
  const id = DocumentId.parse(
    `00000000-0000-4000-8000-${seed.padStart(12, "0")}`,
  );
  const revisionId = RevisionId.parse(
    `10000000-0000-4000-8000-${seed.padStart(12, "0")}`,
  );
  return {
    id,
    revisionId,
    path: Path.parse(`/notes/${seed}.md`),
    title: `Document ${seed}`,
    sequence,
    format: "markdown",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    assetId: null,
    archived: false,
    content: `# Document ${seed}\n\nA passage for ${seed}.`,
    parentId: null,
    isCurrent: true,
  };
}

function anchor(document: DocumentRevision) {
  return AnchorInput.parse({
    revisionId: document.revisionId,
    start: 2,
    end: 10,
    quote: document.content.slice(2, 10),
  });
}

function target(
  document: DocumentRevision,
  viewId: string,
  role: "current" | "companion",
): ReaderViewTarget {
  return {
    viewId: viewId as ViewId,
    document,
    role,
    focus: null,
    scrollTop: 0,
  };
}

function context(
  current: DocumentRevision,
  companion: DocumentRevision | null = null,
): ReadingContext {
  return {
    id: "context-test" as ReadingContext["id"],
    current: target(current, "view-current", "current"),
    companion: companion
      ? target(companion, "view-companion", "companion")
      : null,
    related: [],
    connections: [],
    questions: [],
    selectedConnectionId: null,
    mode: "read",
  };
}

test("opening a document records a reading context without replacing its entities", () => {
  const first = revision("000000000001");
  const second = revision("000000000002");
  let state = emptySession();
  state = readerSessionReducer(state, {
    type: "context/open",
    context: context(first),
  });
  const selected = anchor(first);
  state = readerSessionReducer(state, {
    type: "selection/set",
    selection: {
      kind: "selected",
      document: first,
      anchor: selected,
      preview: "Document",
      rect: null,
    },
  });
  state = readerSessionReducer(state, {
    type: "context/open",
    context: context(second),
  });

  assert.equal(state.active?.current.document.id, second.id);
  assert.equal(state.active?.current.viewId, "view-current");
  assert.equal(state.selection.kind, "none");
  assert.equal(state.connection.kind, "closed");
  assert.notEqual(state.active?.current.document.id, first.id);
});

test("promoting a companion swaps roles while retaining both open views", () => {
  const first = revision("000000000003");
  const second = revision("000000000004");
  let state = readerSessionReducer(emptySession(), {
    type: "context/open",
    context: context(first, second),
  });

  state = readerSessionReducer(state, { type: "context/promote-companion" });
  assert.equal(state.active?.current.document.id, second.id);
  assert.equal(state.active?.companion?.document.id, first.id);
  assert.equal(state.active?.current.role, "current");
  assert.equal(state.active?.companion?.role, "companion");
});

test("changing a saved question body invalidates the saved question", () => {
  const document = revision("000000000005");
  const selected = anchor(document);
  const questionId = QuestionId.parse("20000000-0000-4000-8000-000000000005");
  const question: Question = {
    id: questionId,
    anchor: {
      ...selected,
      id: AnchorId.parse("30000000-0000-4000-8000-000000000005"),
      documentId: document.id,
    },
    body: "old body",
    createdAt: "2026-01-01T00:00:00.000Z",
    answers: [],
  };
  let state = emptySession();
  state = readerSessionReducer(state, {
    type: "question/open",
    document,
    anchor: selected,
  });
  state = readerSessionReducer(state, {
    type: "question/body",
    body: "old body",
  });
  state = readerSessionReducer(state, {
    type: "question/saved",
    question,
    body: "old body",
  });
  state = readerSessionReducer(state, {
    type: "question/sent",
    body: "old body",
  });
  state = readerSessionReducer(state, {
    type: "question/body",
    body: "new body",
  });

  assert.equal(state.question.kind, "editing");
  assert.equal(state.question.saved, null);
  assert.equal(state.question.sentBody, null);
});

test("catalogue pagination deduplicates pages and resets when archive scope changes", () => {
  const first = revision("000000000006");
  const second = revision("000000000007");
  const summary = (document: DocumentRevision) => ({
    id: document.id,
    path: document.path,
    title: document.title,
    revisionId: document.revisionId,
    sequence: document.sequence,
    format: document.format,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    assetId: document.assetId,
    archived: document.archived,
  });
  let state = readerSessionReducer(emptySession(), {
    type: "catalogue/load-start",
    archived: false,
  });
  state = readerSessionReducer(state, {
    type: "catalogue/page",
    documents: [summary(first)],
    complete: false,
  });
  state = readerSessionReducer(state, {
    type: "catalogue/page",
    documents: [summary(first), summary(second)],
    complete: true,
  });
  assert.equal(state.documents.length, 2);
  assert.equal(state.catalogueComplete, true);

  state = readerSessionReducer(state, {
    type: "catalogue/load-start",
    archived: true,
  });
  assert.equal(state.documents.length, 0);
  assert.equal(state.archived, true);
  assert.equal(state.catalogueComplete, false);
});

test("following a companion retains exact focus and scroll", () => {
  const first = revision("000000000008");
  const second = revision("000000000009");
  const secondAnchor = anchor(second);
  let state = readerSessionReducer(emptySession(), {
    type: "context/open",
    context: context(first),
  });
  state = readerSessionReducer(state, {
    type: "context/set-companion",
    target: {
      viewId: "view-companion" as ViewId,
      document: second,
      role: "companion",
      focus: secondAnchor,
      scrollTop: 420,
    },
  });
  assert.equal(state.active?.companion?.document.revisionId, second.revisionId);
  assert.equal(state.active?.companion?.focus?.quote, secondAnchor.quote);
  assert.equal(state.active?.companion?.scrollTop, 420);
});

test("a late save or send result cannot replace a newer question draft", () => {
  const document = revision("000000000010");
  const selected = anchor(document);
  const questionId = QuestionId.parse("20000000-0000-4000-8000-000000000010");
  const question: Question = {
    id: questionId,
    anchor: {
      ...selected,
      id: AnchorId.parse("30000000-0000-4000-8000-000000000010"),
      documentId: document.id,
    },
    body: "old body",
    createdAt: "2026-01-01T00:00:00.000Z",
    answers: [],
  };
  let state = readerSessionReducer(emptySession(), {
    type: "question/open",
    document,
    anchor: selected,
  });
  state = readerSessionReducer(state, {
    type: "question/body",
    body: "new body",
  });
  state = readerSessionReducer(state, {
    type: "question/saved",
    question,
    body: "old body",
  });
  assert.equal(state.question.kind, "editing");
  assert.equal(state.question.saved, null);
  assert.match(state.question.error ?? "", /发生了变化/);

  state = readerSessionReducer(state, {
    type: "question/sent",
    body: "old body",
  });
  assert.equal(state.question.kind, "editing");
  assert.equal(state.question.sentBody, null);
});

test("connection draft and saved relation stay independent from question state", () => {
  const first = revision("000000000011");
  const second = revision("000000000012");
  const firstAnchor = anchor(first);
  const secondAnchor = anchor(second);
  let state = readerSessionReducer(emptySession(), {
    type: "selection/set",
    selection: {
      kind: "selected",
      document: first,
      anchor: firstAnchor,
      preview: firstAnchor.quote,
      rect: null,
    },
  });
  state = readerSessionReducer(state, {
    type: "selection/clear",
  });
  state = readerSessionReducer(state, {
    type: "connection/open-first",
    document: first,
    anchor: firstAnchor,
  });
  state = readerSessionReducer(state, {
    type: "selection/set",
    selection: {
      kind: "selected",
      document: second,
      anchor: secondAnchor,
      preview: secondAnchor.quote,
      rect: null,
    },
  });
  state = readerSessionReducer(state, {
    type: "connection/open-second",
    document: second,
    anchor: secondAnchor,
  });
  assert.equal(state.connection.kind, "second");
  if (state.connection.kind !== "second")
    throw new Error("connection did not reach second endpoint");
  assert.equal(state.connection.first.document.id, first.id);
  assert.equal(state.connection.second.document.id, second.id);
  assert.equal(state.question.kind, "editing");
});

test("refreshing a companion cannot overwrite the current document's relation data", () => {
  const current = revision("000000000013");
  const companion = revision("000000000014");
  const currentAnchor = anchor(current);
  const questionId = QuestionId.parse("20000000-0000-4000-8000-000000000013");
  const question: Question = {
    id: questionId,
    anchor: {
      ...currentAnchor,
      id: AnchorId.parse("30000000-0000-4000-8000-000000000013"),
      documentId: current.id,
    },
    body: "current question",
    createdAt: "2026-01-01T00:00:00.000Z",
    answers: [],
  };
  let state = readerSessionReducer(emptySession(), {
    type: "context/open",
    context: {
      ...context(current, companion),
      questions: [question],
    },
  });
  state = readerSessionReducer(state, {
    type: "context/merge-view",
    view: {
      document: companion,
      connections: [],
      questions: [],
    },
  });
  assert.deepEqual(state.active?.questions, [question]);
});

test("scene sync creates a projection, gates relations, and clears them on current changes", () => {
  const first = revision("000000000015");
  const second = revision("000000000016");
  const unrelated = revision("000000000017");
  const firstAnchor = {
    ...anchor(first),
    id: AnchorId.parse("30000000-0000-4000-8000-000000000015"),
    documentId: first.id,
  };
  const secondAnchor = {
    ...anchor(second),
    id: AnchorId.parse("30000000-0000-4000-8000-000000000016"),
    documentId: second.id,
  };
  const unrelatedAnchor = {
    ...anchor(unrelated),
    id: AnchorId.parse("30000000-0000-4000-8000-000000000017"),
    documentId: unrelated.id,
  };
  const question: Question = {
    id: QuestionId.parse("20000000-0000-4000-8000-000000000015"),
    anchor: firstAnchor,
    body: "question on current",
    createdAt: "2026-01-01T00:00:00.000Z",
    answers: [],
  };
  const companionQuestion: Question = {
    ...question,
    id: QuestionId.parse("20000000-0000-4000-8000-000000000016"),
    anchor: secondAnchor,
  };
  const connection = {
    id: ConnectionId.parse("40000000-0000-4000-8000-000000000015"),
    from: firstAnchor,
    to: secondAnchor,
    relation: "reference" as const,
    label: "current to companion",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const unrelatedConnection = {
    ...connection,
    id: ConnectionId.parse("40000000-0000-4000-8000-000000000016"),
    from: secondAnchor,
    to: unrelatedAnchor,
  };

  let state = emptySession();
  state = readerSessionReducer(state, {
    type: "context/sync-scene",
    current: target(first, "view-current", "current"),
    companion: target(second, "view-companion", "companion"),
  });
  assert.equal(state.active?.current.document.id, first.id);
  assert.equal(state.active?.connections.length, 0);
  assert.equal(state.active?.questions.length, 0);

  state = readerSessionReducer(state, {
    type: "context/add-question",
    question,
  });
  state = readerSessionReducer(state, {
    type: "context/add-question",
    question: companionQuestion,
  });
  state = readerSessionReducer(state, {
    type: "context/add-connection",
    connection,
  });
  state = readerSessionReducer(state, {
    type: "context/add-connection",
    connection: unrelatedConnection,
  });
  assert.equal(state.active?.questions.length, 1);
  assert.equal(state.active?.connections.length, 1);

  // Scene-only changes that keep the current document preserve its relation projection.
  state = readerSessionReducer(state, {
    type: "context/sync-scene",
    current: target(first, "view-current", "current"),
    companion: null,
  });
  assert.equal(state.active?.questions.length, 1);
  assert.equal(state.active?.connections.length, 1);

  // A new current document/revision gets a blank relation projection.
  state = readerSessionReducer(state, {
    type: "context/sync-scene",
    current: target(second, "view-current", "current"),
    companion: null,
  });
  assert.equal(state.active?.current.document.id, second.id);
  assert.equal(state.active?.questions.length, 0);
  assert.equal(state.active?.connections.length, 0);
  assert.equal(state.active?.selectedConnectionId, null);

  // A late merge cannot recreate a context after the scene closes it.
  state = readerSessionReducer(state, {
    type: "context/sync-scene",
    current: null,
    companion: null,
  });
  const late = readerSessionReducer(state, {
    type: "context/merge-view",
    view: { document: first, connections: [connection], questions: [question] },
  });
  assert.strictEqual(late, state);
  assert.equal(late.active, null);
});

test("revision cache uses LRU entry and character budgets while protecting scene views", () => {
  const current = revision("000000000018");
  const companion = revision("000000000019");
  let state = readerSessionReducer(emptySession(), {
    type: "context/open",
    context: context(current, companion),
  });
  state = readerSessionReducer(state, {
    type: "cache/revision",
    revision: current,
  });
  state = readerSessionReducer(state, {
    type: "cache/revision",
    revision: companion,
  });

  const revisions = Array.from({ length: 28 }, (_, index) =>
    revision(String(index + 20).padStart(12, "0")),
  );
  for (const document of revisions) {
    state = readerSessionReducer(state, {
      type: "cache/revision",
      revision: document,
    });
  }
  assert.equal(state.revisionCache.size, 24);
  assert.equal(state.revisionCache.has(current.revisionId), true);
  assert.equal(state.revisionCache.has(companion.revisionId), true);
  assert.equal(state.revisionCache.has(revisions[0].revisionId), false);
  assert.equal(state.revisionCache.has(revisions.at(-1)!.revisionId), true);

  // Touching an evicted revision makes it newest and evicts the oldest remaining non-active one.
  state = readerSessionReducer(state, {
    type: "cache/revision",
    revision: revisions[0],
  });
  assert.equal(state.revisionCache.has(revisions[0].revisionId), true);
  assert.equal(state.revisionCache.has(revisions[1].revisionId), false);

  const oversizedCurrent = {
    ...revision("000000000048"),
    content: "x".repeat(3 * 1024 * 1024),
  };
  const oversizedCompanion = {
    ...revision("000000000049"),
    content: "y".repeat(3 * 1024 * 1024),
  };
  const oversizedOther = {
    ...revision("000000000050"),
    content: "z".repeat(3 * 1024 * 1024),
  };
  state = readerSessionReducer(state, {
    type: "context/open",
    context: context(oversizedCurrent, oversizedCompanion),
  });
  state = readerSessionReducer(state, {
    type: "cache/revision",
    revision: oversizedCurrent,
  });
  state = readerSessionReducer(state, {
    type: "cache/revision",
    revision: oversizedCompanion,
  });
  state = readerSessionReducer(state, {
    type: "cache/revision",
    revision: oversizedOther,
  });
  assert.equal(state.revisionCache.has(oversizedCurrent.revisionId), true);
  assert.equal(state.revisionCache.has(oversizedCompanion.revisionId), true);
  assert.equal(state.revisionCache.has(oversizedOther.revisionId), false);
});

test("editor drafts encode create, edit, and rename requirements", () => {
  const document = revision("000000000051");
  let state = readerSessionReducer(emptySession(), {
    type: "editor/open-create",
    path: "/notes/new.md",
  });
  assert.equal(state.editor.kind, "create");
  if (state.editor.kind !== "create") throw new Error("create draft missing");
  assert.equal(state.editor.document, null);
  assert.equal("expectedRevisionId" in state.editor, false);

  state = readerSessionReducer(state, { type: "editor/open-edit", document });
  assert.equal(state.editor.kind, "edit");
  if (state.editor.kind !== "edit") throw new Error("edit draft missing");
  assert.equal(state.editor.document.revisionId, document.revisionId);
  assert.equal(state.editor.expectedRevisionId, document.revisionId);

  state = readerSessionReducer(state, { type: "editor/open-rename", document });
  assert.equal(state.editor.kind, "rename");
  if (state.editor.kind !== "rename") throw new Error("rename draft missing");
  assert.equal(state.editor.document.revisionId, document.revisionId);
  assert.equal("expectedRevisionId" in state.editor, false);
});
