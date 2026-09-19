import assert from "node:assert/strict";
import test from "node:test";
import {
  AnchorId,
  AnchorInput,
  ConnectionId,
  DocumentId,
  Path,
  QuestionId,
  RevisionId,
  type Connection,
  type DocumentRevision,
  type DocumentSummary,
  type Question,
} from "../lib/domain/model";
import {
  emptySession,
  hasProtectedDraft,
  isEditorDirty,
  navigationAttemptId,
  navigationIntentId,
  questionDeliveryAttemptId,
  questionPersistenceAttemptId,
  readerSessionReducer,
  type ReaderSession,
} from "../lib/reader/session";
import { readingPosition, returnHistoryIndex } from "../lib/reader/attention";

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

function anchor(document: DocumentRevision): AnchorInput {
  return AnchorInput.parse({
    revisionId: document.revisionId,
    start: 2,
    end: 10,
    quote: document.content.slice(2, 10),
  });
}

function summary(document: DocumentRevision): DocumentSummary {
  return {
    id: document.id,
    revisionId: document.revisionId,
    path: document.path,
    title: document.title,
    sequence: document.sequence,
    format: document.format,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    assetId: document.assetId,
    archived: document.archived,
  };
}

function questionFor(document: DocumentRevision, body: string): Question {
  const selected = anchor(document);
  return {
    id: QuestionId.parse(`20000000-0000-4000-8000-${document.id.slice(-12)}`),
    anchor: {
      ...selected,
      id: AnchorId.parse(`30000000-0000-4000-8000-${document.id.slice(-12)}`),
      documentId: document.id,
    },
    body,
    createdAt: "2026-01-01T00:00:00.000Z",
    answers: [],
  };
}

function startReading(state: ReaderSession, document: DocumentRevision) {
  return readerSessionReducer(state, {
    type: "attention",
    action: { type: "navigate", position: readingPosition(document) },
  });
}

test("attention owns current, companion, promote, and return history", () => {
  const first = revision("000000000001");
  const second = revision("000000000002");
  let state = startReading(emptySession(), first);
  state = readerSessionReducer(state, {
    type: "attention",
    action: {
      type: "compare",
      position: readingPosition(second, anchor(second), 420),
      reason: { kind: "document" },
    },
  });
  assert.equal(state.attention.attention.kind, "reading");
  if (state.attention.attention.kind !== "reading")
    throw new Error("missing reading attention");
  assert.equal(state.attention.attention.current.documentId, first.id);
  assert.equal(
    state.attention.attention.companion?.position.documentId,
    second.id,
  );
  assert.equal(state.attention.history.length, 2);

  state = readerSessionReducer(state, {
    type: "attention",
    action: { type: "promote" },
  });
  assert.equal(state.attention.attention.kind, "reading");
  if (state.attention.attention.kind !== "reading")
    throw new Error("missing promoted attention");
  assert.equal(state.attention.attention.current.documentId, second.id);
  assert.equal(state.attention.attention.companion, null);
  const back = returnHistoryIndex(state.attention);
  assert.equal(back, 1);
  assert.equal(state.attention.history[back!]?.attention.kind, "reading");
});

test("scroll and focus update the live history entry without adding navigation", () => {
  const document = revision("000000000003");
  let state = startReading(emptySession(), document);
  const before = state.attention.history.length;
  state = readerSessionReducer(state, {
    type: "attention",
    action: { type: "scroll", role: "current", scrollTop: 180 },
  });
  state = readerSessionReducer(state, {
    type: "attention",
    action: { type: "focus", role: "current", focus: anchor(document) },
  });
  assert.equal(state.attention.history.length, before);
  assert.equal(state.attention.attention.kind, "reading");
  if (state.attention.attention.kind !== "reading")
    throw new Error("missing reading attention");
  assert.equal(state.attention.attention.current.scrollTop, 180);
  assert.equal(
    state.attention.attention.current.focus?.quote,
    anchor(document).quote,
  );
});

test("selecting text only opens the action layer; question editing is explicit", () => {
  const document = revision("000000000004");
  const selected = anchor(document);
  let state = startReading(emptySession(), document);
  state = readerSessionReducer(state, {
    type: "selection/set",
    selection: {
      kind: "selected",
      document,
      anchor: selected,
      preview: selected.quote,
      rect: null,
    },
  });
  assert.equal(state.question.kind, "closed");
  assert.equal(hasProtectedDraft(state), true);
  state = readerSessionReducer(state, {
    type: "question/open",
    document,
    anchor: selected,
  });
  assert.equal(state.question.kind, "draft");
  assert.equal(state.question.body, "");
});

test("late question save cannot replace a changed draft", () => {
  const document = revision("000000000005");
  const selected = anchor(document);
  const saved = questionFor(document, "old body");
  let state = startReading(emptySession(), document);
  state = readerSessionReducer(state, {
    type: "question/open",
    document,
    anchor: selected,
  });
  state = readerSessionReducer(state, {
    type: "question/body",
    body: "new body",
  });
  if (state.question.kind !== "draft") throw new Error("missing question draft");
  const draftId = state.question.draftId;
  const persistenceAttemptId = questionPersistenceAttemptId(1);
  state = readerSessionReducer(state, {
    type: "question/saving",
    draftId,
    attemptId: persistenceAttemptId,
    body: "new body",
  });
  state = readerSessionReducer(state, {
    type: "question/body",
    body: "newer body",
  });
  state = readerSessionReducer(state, {
    type: "question/saved",
    question: saved,
    body: "old body",
    draftId,
    attemptId: persistenceAttemptId,
  });
  assert.equal(state.question.kind, "draft");
  assert.equal(state.question.body, "newer body");
  assert.equal("question" in state.question, false);
  assert.equal(state.question.error, null);
  assert.equal(state.questions[0]?.id, saved.id);
  assert.equal(state.questionTasks[0]?.status, "saved");
});

test("persisted question states do not block a new destination", () => {
  const document = revision("000000000051");
  const selected = anchor(document);
  const saved = questionFor(document, "saved question");
  let state = startReading(emptySession(), document);
  state = readerSessionReducer(state, {
    type: "question/open",
    document,
    anchor: selected,
  });
  state = readerSessionReducer(state, {
    type: "question/body",
    body: saved.body,
  });
  if (state.question.kind !== "draft") throw new Error("missing question draft");
  const draftId = state.question.draftId;
  const persistenceAttemptId = questionPersistenceAttemptId(2);
  state = readerSessionReducer(state, {
    type: "question/saving",
    draftId,
    attemptId: persistenceAttemptId,
    body: saved.body,
  });
  state = readerSessionReducer(state, {
    type: "question/saved",
    question: saved,
    body: saved.body,
    draftId,
    attemptId: persistenceAttemptId,
  });
  // The selection remains a protected host interaction until it is explicitly
  // cleared, even though the persisted question itself is safe to navigate.
  assert.equal(hasProtectedDraft(state), true);
  state = readerSessionReducer(state, { type: "selection/clear" });
  assert.equal(hasProtectedDraft(state), false);

  state = readerSessionReducer(state, {
    type: "question/sending",
    questionId: saved.id,
    draftId,
    attemptId: questionDeliveryAttemptId(1),
    body: saved.body,
  });
  state = readerSessionReducer(state, {
    type: "question/sent",
    questionId: saved.id,
    draftId,
    attemptId: questionDeliveryAttemptId(1),
    body: saved.body,
  });
  assert.equal(hasProtectedDraft(state), false);

  state = readerSessionReducer(state, {
    type: "question/body",
    body: "edited after saving",
  });
  assert.equal(hasProtectedDraft(state), true);
});

test("answer arrival is a notification and preserves a different question draft", () => {
  const source = revision("000000000006");
  const answer = revision("000000000007");
  const activeQuestion = questionFor(source, "draft in progress");
  const answered = { ...activeQuestion, answers: [answer.id] };
  let state = startReading(emptySession(), source);
  state = readerSessionReducer(state, {
    type: "question/open",
    document: source,
    anchor: anchor(source),
  });
  state = readerSessionReducer(state, {
    type: "question/body",
    body: "draft in progress",
  });
  state = readerSessionReducer(state, {
    type: "answer/arrived",
    notification: {
      questionId: activeQuestion.id,
      answerDocumentId: answer.id,
      answerRevisionId: answer.revisionId,
      title: answer.title,
      status: "unseen",
    },
  });
  state = readerSessionReducer(state, {
    type: "question/answered",
    question: answered,
  });
  assert.equal(state.answers[0]?.status, "unseen");
  assert.equal(state.attention.attention.kind, "reading");
  if (state.question.kind === "closed") throw new Error("draft was lost");
  assert.equal(state.question.body, "draft in progress");
});

test("question delivery identities update the task and reject late receipts", () => {
  const document = revision("000000000061");
  const selected = anchor(document);
  const question = questionFor(document, "identity");
  let state = startReading(emptySession(), document);
  state = readerSessionReducer(state, {
    type: "question/open",
    document,
    anchor: selected,
  });
  state = readerSessionReducer(state, {
    type: "question/body",
    body: question.body,
  });
  if (state.question.kind !== "draft") throw new Error("missing draft");
  const draftId = state.question.draftId;
  const persistenceAttemptId = questionPersistenceAttemptId(61);
  state = readerSessionReducer(state, {
    type: "question/saving",
    draftId,
    attemptId: persistenceAttemptId,
    body: question.body,
  });
  state = readerSessionReducer(state, {
    type: "question/saved",
    question,
    body: question.body,
    draftId,
    attemptId: persistenceAttemptId,
  });
  const deliveryAttemptId = questionDeliveryAttemptId(61);
  state = readerSessionReducer(state, {
    type: "question/sending",
    questionId: question.id,
    draftId,
    attemptId: deliveryAttemptId,
    body: question.body,
  });
  state = readerSessionReducer(state, {
    type: "question/sent",
    questionId: question.id,
    draftId,
    attemptId: deliveryAttemptId,
    body: question.body,
  });
  assert.equal(state.question.kind, "awaiting");
  assert.equal(state.questionTasks[0]?.status, "awaiting");

  state = readerSessionReducer(state, {
    type: "question/answered",
    question: { ...question, answers: [document.id] },
  });
  assert.equal(state.question.kind, "answered");
  state = readerSessionReducer(state, {
    type: "question/failure",
    stage: "sending",
    questionId: question.id,
    draftId,
    attemptId: deliveryAttemptId,
    body: question.body,
    message: "late failure",
  });
  assert.equal(state.question.kind, "answered");
  assert.equal(state.questionTasks[0]?.status, "answered");
});

test("old delivery receipts update only their independent task after editing", () => {
  const document = revision("000000000062");
  const selected = anchor(document);
  const question = questionFor(document, "old delivery");
  let state = startReading(emptySession(), document);
  state = readerSessionReducer(state, {
    type: "question/open",
    document,
    anchor: selected,
  });
  state = readerSessionReducer(state, {
    type: "question/body",
    body: question.body,
  });
  if (state.question.kind !== "draft") throw new Error("missing draft");
  const draftId = state.question.draftId;
  const persistenceAttemptId = questionPersistenceAttemptId(62);
  state = readerSessionReducer(state, {
    type: "question/saving",
    draftId,
    attemptId: persistenceAttemptId,
    body: question.body,
  });
  state = readerSessionReducer(state, {
    type: "question/saved",
    question,
    body: question.body,
    draftId,
    attemptId: persistenceAttemptId,
  });
  const deliveryAttemptId = questionDeliveryAttemptId(62);
  state = readerSessionReducer(state, {
    type: "question/sending",
    questionId: question.id,
    draftId,
    attemptId: deliveryAttemptId,
    body: question.body,
  });
  state = readerSessionReducer(state, {
    type: "question/body",
    body: "new draft",
  });
  assert.equal(state.question.kind, "draft");
  const newDraftId = state.question.draftId;
  assert.notEqual(newDraftId, draftId);
  state = readerSessionReducer(state, {
    type: "question/sent",
    questionId: question.id,
    draftId,
    attemptId: deliveryAttemptId,
    body: question.body,
  });
  assert.equal(state.question.kind, "draft");
  assert.equal(state.question.body, "new draft");
  assert.equal(state.questionTasks[0]?.status, "awaiting");
});

test("active and archived catalogue completion are independent", () => {
  const active = revision("000000000008");
  const archived = { ...revision("000000000009"), archived: true };
  let state = emptySession();
  state = readerSessionReducer(state, {
    type: "catalogue/load-start",
    scope: "active",
  });
  state = readerSessionReducer(state, {
    type: "catalogue/load-start",
    scope: "archived",
  });
  state = readerSessionReducer(state, {
    type: "catalogue/page",
    scope: "active",
    documents: [summary(active)],
    complete: true,
  });
  assert.equal(state.catalogue.activeComplete, true);
  assert.equal(state.catalogue.archivedComplete, false);
  assert.equal(state.catalogue.activeLoading, false);
  assert.equal(state.catalogue.loading, true);
  state = readerSessionReducer(state, {
    type: "catalogue/page",
    scope: "archived",
    documents: [summary(archived)],
    complete: true,
  });
  assert.equal(state.catalogue.archivedComplete, true);
  assert.equal(state.catalogue.archivedLoading, false);
  assert.equal(state.catalogue.loading, false);
  assert.deepEqual(
    state.documents.map((document) => document.id),
    [active.id, archived.id].sort(),
  );
});

test("dirty editor and question drafts are protected from deferred navigation", () => {
  const first = revision("000000000010");
  const second = revision("000000000011");
  let state = startReading(emptySession(), first);
  state = readerSessionReducer(state, {
    type: "editor/open-edit",
    document: first,
    owner: readingPosition(first),
  });
  state = readerSessionReducer(state, {
    type: "editor/content",
    content: "unsaved",
  });
  assert.equal(isEditorDirty(state.editor), true);
  assert.equal(hasProtectedDraft(state), true);
  state = readerSessionReducer(state, {
    type: "navigation/defer",
    navigation: {
      lifecycle: "blocked",
      intentId: navigationIntentId(1),
      target: {
        kind: "resolved",
        target: {
          documentId: second.id,
          revisionId: second.revisionId,
          focus: null,
        },
        title: second.title,
        revision: second,
        message: "当前有未保存草稿。",
      },
    },
  });
  assert.equal(
    state.pendingNavigation?.lifecycle === "blocked" &&
      state.pendingNavigation.target.kind === "resolved"
      ? state.pendingNavigation.target.target.revisionId
      : null,
    second.revisionId,
  );
  assert.equal(state.attention.attention.kind, "reading");
  if (state.attention.attention.kind !== "reading")
    throw new Error("missing attention");
  assert.equal(state.attention.attention.current.revisionId, first.revisionId);
});

test("deferred navigation has retryable attempts and identity-scoped cleanup", () => {
  const first = revision("000000000063");
  const second = revision("000000000064");
  let state = startReading(emptySession(), first);
  const intentId = navigationIntentId(63);
  state = readerSessionReducer(state, {
    type: "navigation/defer",
    navigation: {
      lifecycle: "blocked",
      intentId,
      target: {
        kind: "resolved",
        target: {
          documentId: second.id,
          revisionId: second.revisionId,
          focus: null,
        },
        title: second.title,
        revision: second,
        message: "当前有未保存草稿。",
      },
    },
  });
  const firstAttempt = navigationAttemptId(63);
  state = readerSessionReducer(state, {
    type: "navigation/start",
    intentId,
    attemptId: firstAttempt,
  });
  state = readerSessionReducer(state, {
    type: "navigation/failure",
    intentId,
    attemptId: firstAttempt,
    message: "一次失败",
  });
  assert.equal(state.pendingNavigation?.lifecycle, "failed");

  const secondAttempt = navigationAttemptId(64);
  state = readerSessionReducer(state, {
    type: "navigation/start",
    intentId,
    attemptId: secondAttempt,
  });
  state = readerSessionReducer(state, {
    type: "navigation/failure",
    intentId,
    attemptId: firstAttempt,
    message: "过期失败",
  });
  assert.equal(state.pendingNavigation?.lifecycle, "opening");
  state = readerSessionReducer(state, {
    type: "navigation/clear",
    intentId: navigationIntentId(999),
  });
  assert.equal(state.pendingNavigation?.lifecycle, "opening");
  state = readerSessionReducer(state, {
    type: "navigation/clear",
    intentId,
  });
  assert.equal(state.pendingNavigation, null);
});

test("connection draft, saved relation, and question draft remain independent", () => {
  const first = revision("000000000012");
  const second = revision("000000000013");
  const firstAnchor = anchor(first);
  const secondAnchor = anchor(second);
  let state = startReading(emptySession(), first);
  state = readerSessionReducer(state, {
    type: "question/open",
    document: first,
    anchor: firstAnchor,
  });
  state = readerSessionReducer(state, {
    type: "question/body",
    body: "keep this",
  });
  state = readerSessionReducer(state, {
    type: "connection/open-first",
    document: first,
    anchor: firstAnchor,
  });
  state = readerSessionReducer(state, {
    type: "connection/open-second",
    document: second,
    anchor: secondAnchor,
  });
  assert.equal(state.connection.kind, "second");
  assert.equal(state.question.kind, "draft");
  if (state.connection.kind !== "second")
    throw new Error("missing second endpoint");
  const connection: Connection = {
    id: ConnectionId.parse("40000000-0000-4000-8000-000000000012"),
    from: {
      ...firstAnchor,
      id: AnchorId.parse("50000000-0000-4000-8000-000000000012"),
      documentId: first.id,
    },
    to: {
      ...secondAnchor,
      id: AnchorId.parse("50000000-0000-4000-8000-000000000013"),
      documentId: second.id,
    },
    relation: "reference",
    label: "",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  state = readerSessionReducer(state, {
    type: "connection/saving",
    requestId: 1,
  });
  state = readerSessionReducer(state, {
    type: "connection/label",
    label: "changed while saving",
  });
  state = readerSessionReducer(state, {
    type: "connection/added",
    requestId: 1,
    connection,
  });
  assert.equal(state.connections.length, 1);
  assert.equal(state.connection.kind, "second");
  if (state.connection.kind !== "second")
    throw new Error("edited connection draft was lost");
  assert.equal(state.connection.label, "changed while saving");
  state = readerSessionReducer(state, {
    type: "connection/saving",
    requestId: 2,
  });
  state = readerSessionReducer(state, {
    type: "connection/added",
    requestId: 2,
    connection,
  });
  assert.equal(state.connection.kind, "closed");
  assert.equal(state.question.kind, "draft");
});

test("answer status keeps same question's answer identities independent", () => {
  const source = revision("000000000014");
  const answerOne = revision("000000000015");
  const answerTwo = revision("000000000016");
  const question = questionFor(source, "two answers");
  const first = {
    questionId: question.id,
    answerDocumentId: answerOne.id,
    answerRevisionId: answerOne.revisionId,
    title: answerOne.title,
    status: "unseen" as const,
  };
  const second = {
    questionId: question.id,
    answerDocumentId: answerTwo.id,
    answerRevisionId: answerTwo.revisionId,
    title: answerTwo.title,
    status: "unseen" as const,
  };
  let state = emptySession();
  state = readerSessionReducer(state, {
    type: "answer/arrived",
    notification: first,
  });
  state = readerSessionReducer(state, {
    type: "answer/arrived",
    notification: second,
  });
  state = readerSessionReducer(state, {
    type: "answer/status",
    questionId: first.questionId,
    answerDocumentId: first.answerDocumentId,
    answerRevisionId: first.answerRevisionId,
    status: "seen",
  });
  assert.deepEqual(
    state.answers.map((answer) => [answer.answerDocumentId, answer.status]),
    [
      [answerOne.id, "seen"],
      [answerTwo.id, "unseen"],
    ],
  );
});

test("late editor failure cannot replace a changed draft", () => {
  const document = revision("000000000017");
  let state = startReading(emptySession(), document);
  state = readerSessionReducer(state, {
    type: "editor/open-edit",
    document,
    owner: readingPosition(document, anchor(document), 240),
  });
  state = readerSessionReducer(state, {
    type: "editor/content",
    content: "first edit",
  });
  state = readerSessionReducer(state, {
    type: "editor/saving",
    requestId: 1,
  });
  state = readerSessionReducer(state, {
    type: "editor/content",
    content: "newer edit",
  });
  state = readerSessionReducer(state, {
    type: "editor/error",
    requestId: 1,
    message: "late failure",
  });
  assert.equal(state.editor.kind, "edit");
  if (state.editor.kind !== "edit") throw new Error("editor closed");
  assert.equal(state.editor.content, "newer edit");
  assert.equal(state.editor.saving, false);
  assert.equal(state.editor.error, null);
});

test("editing an existing title is read only and question close clears the draft", () => {
  const document = revision("000000000018");
  const selected = anchor(document);
  let state = startReading(emptySession(), document);
  state = readerSessionReducer(state, {
    type: "editor/open-edit",
    document,
    owner: readingPosition(document),
  });
  state = readerSessionReducer(state, {
    type: "editor/title",
    title: "should use rename",
  });
  assert.equal(state.editor.kind, "edit");
  if (state.editor.kind !== "edit") throw new Error("editor closed");
  assert.equal(state.editor.title, document.title);

  state = readerSessionReducer(state, {
    type: "question/open",
    document,
    anchor: selected,
  });
  state = readerSessionReducer(state, {
    type: "question/body",
    body: "discard explicitly",
  });
  assert.equal(hasProtectedDraft(state), true);
  state = readerSessionReducer(state, { type: "question/close" });
  assert.equal(state.question.kind, "closed");
  assert.equal(hasProtectedDraft(state), false);
});
