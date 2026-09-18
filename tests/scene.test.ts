import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AssetId,
  DocumentId,
  RevisionId,
} from "../lib/domain/model";
import {
  createViewId,
  emptyScene,
  sceneReducer,
} from "../lib/reader/scene";
import type { DocumentRevision } from "../lib/domain/model";

function revision(title: string, content: string): DocumentRevision {
  const now = new Date(0).toISOString();
  const documentId = DocumentId.parse(crypto.randomUUID());
  const revisionId = RevisionId.parse(crypto.randomUUID());
  return {
    id: documentId,
    path: `/tests/${title.toLowerCase()}.md` as DocumentRevision["path"],
    title,
    revisionId,
    sequence: 1,
    format: "markdown",
    createdAt: now,
    updatedAt: now,
    assetId: AssetId.parse(crypto.randomUUID()),
    archived: false,
    content,
    parentId: null,
    isCurrent: true,
  };
}

function anchor(document: DocumentRevision, start = 0, end = 2) {
  return {
    revisionId: document.revisionId,
    start,
    end,
    quote: document.content.slice(start, end),
  };
}

test("scene keeps current and companion roles while follow/promote/back retain context", () => {
  const a = revision("Alpha", "alpha text"),
    b = revision("Beta", "beta text"),
    aView = createViewId("alpha-view");
  let state = sceneReducer(emptyScene(), {
    type: "open-document",
    document: a,
    viewId: aView,
    focus: anchor(a),
  });
  state = sceneReducer(state, {
    type: "follow",
    document: b,
    focus: anchor(b),
  });
  assert.equal(state.currentViewId, aView);
  assert.equal(state.companionViewId, state.views.find((v) => v.document.id === b.id)?.id);
  assert.equal(state.views.find((v) => v.id === aView)?.document.id, a.id);
  const companion = state.companionViewId!;
  state = sceneReducer(state, { type: "promote-view", viewId: companion });
  assert.equal(state.currentViewId, companion);
  assert.equal(state.companionViewId, aView);
  state = sceneReducer(state, { type: "history-back" });
  assert.equal(state.currentViewId, aView);
  assert.equal(state.companionViewId, companion);
  assert.deepEqual(state.views.find((v) => v.id === aView)?.focus, anchor(a));
  assert.equal(state.views.find((v) => v.id === companion)?.scrollTop, 0);
  state = sceneReducer(state, { type: "history-forward" });
  assert.equal(state.currentViewId, companion);
  assert.equal(state.companionViewId, aView);
  // The optional viewId is forbidden by the FollowDocumentAction type. This
  // assertion documents the generated ID remains independent of DocumentId.
  assert.notEqual(companion, a.id);
});

test("open-new-view permits two slabs for one immutable revision", () => {
  const document = revision("Same", "same text");
  let state = sceneReducer(emptyScene(), { type: "open-document", document });
  const first = state.views[0];
  assert.ok(first);
  state = sceneReducer(state, {
    type: "open-new-view",
    document,
    role: "peripheral",
  });
  assert.equal(state.views.length, 2);
  assert.equal(state.views[0].document.revisionId, state.views[1].document.revisionId);
  assert.notEqual(state.views[0].id, state.views[1].id);
  assert.equal(state.currentViewId, first.id);
});

test("replace-document preserves slab context and drops stale focus", () => {
  const oldDocument = revision("Editable", "old words"),
    nextDocument = { ...revision("Editable", "new words"), id: oldDocument.id, sequence: 2 };
  let state = sceneReducer(emptyScene(), {
    type: "open-document",
    document: oldDocument,
    focus: anchor(oldDocument),
  });
  const view = state.views[0];
  assert.ok(view);
  state = sceneReducer(state, {
    type: "update-view",
    viewId: view.id,
    patch: { scrollTop: 420, position: { x: 50, y: 12, z: -30 } },
  });
  state = sceneReducer(state, { type: "replace-document", viewId: view.id, document: nextDocument });
  const replaced = state.views.find((candidate) => candidate.id === view.id);
  assert.ok(replaced);
  assert.equal(replaced.id, view.id);
  assert.equal(replaced.scrollTop, 420);
  assert.deepEqual(replaced.position, { x: 50, y: 12, z: -30 });
  assert.equal(replaced.focus, null);
});

test("camera reducer clamps every component to finite bounds", () => {
  const state = sceneReducer(emptyScene(), {
    type: "camera",
    patch: {
      position: { x: Number.POSITIVE_INFINITY, y: -99999, z: Number.NaN },
      rotation: { x: 999, y: -999 },
      zoom: Number.POSITIVE_INFINITY,
    },
  });
  assert.ok(state.camera.position.x < 1e5);
  assert.ok(Number.isFinite(state.camera.position.x));
  assert.ok(Number.isFinite(state.camera.position.y));
  assert.ok(Number.isFinite(state.camera.position.z));
  assert.ok(Math.abs(state.camera.rotation.x) <= 48);
  assert.ok(Math.abs(state.camera.rotation.y) <= 48);
  assert.ok(state.camera.zoom >= 0.55 && state.camera.zoom <= 1.8);
});

test("closing a historical role does not resurrect its view during back", () => {
  const a = revision("A", "aa"), b = revision("B", "bb");
  let state = sceneReducer(emptyScene(), { type: "open-document", document: a });
  state = sceneReducer(state, { type: "follow", document: b });
  const bView = state.companionViewId;
  assert.ok(bView);
  state = sceneReducer(state, { type: "close-view", viewId: bView });
  state = sceneReducer(state, { type: "history-back" });
  assert.equal(state.views.some((view) => view.id === bView), false);
  assert.equal(state.currentViewId, state.views[0]?.id ?? null);
  assert.equal(state.companionViewId, null);
});


test("navigation keeps two papers apart and focus restores a readable camera without losing context", () => {
  const a = revision("Source", "source words"), b = revision("Companion", "companion words");
  let state = sceneReducer(emptyScene(), { type: "open-document", document: a });
  const source = state.views[0];
  assert.ok(source);
  state = sceneReducer(state, { type: "follow", document: b });
  const companion = state.views.find(view => view.id === state.companionViewId)!;
  assert.ok(Math.abs(companion.position.x - source.position.x) > 620, "reading papers must not overlap");
  assert.ok(state.camera.position.x > source.position.x && state.camera.position.x < companion.position.x);
  state = sceneReducer(state, { type: "camera", patch: { position: { x: -300, y: 150, z: 80 }, rotation: { x: 24, y: -32 }, zoom: .6 } });
  const currentId = state.currentViewId;
  state = sceneReducer(state, { type: "focus-view", viewId: companion.id });
  assert.deepEqual(state.camera.position, companion.position);
  assert.deepEqual(state.camera.rotation, { x: 0, y: 0 });
  assert.equal(state.camera.zoom, 1);
  assert.equal(state.currentViewId, currentId, "camera focus does not silently promote a document");
  assert.equal(state.views.length, 2);
});
