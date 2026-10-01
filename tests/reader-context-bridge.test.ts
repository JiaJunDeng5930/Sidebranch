import { test } from "node:test";
import assert from "node:assert/strict";
import { createReaderContextBridge } from "../app-ui/model-context";
import {
  ReaderContextSchema,
  type ReaderContext,
} from "../lib/client/reader-context";

type HostUpdate = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
};
const focusedDocument = "00000000-0000-4000-8000-000000000001";
const focusedRevision = "00000000-0000-4000-8000-000000000002";
const selectedDocument = "00000000-0000-4000-8000-000000000003";
const selectedRevision = "00000000-0000-4000-8000-000000000004";
function context(title = "Saved article"): ReaderContext {
  return ReaderContextSchema.parse({
    document: {
      documentId: focusedDocument,
      revisionId: focusedRevision,
      title,
      path: "/article.md",
    },
    selection: {
      documentId: selectedDocument,
      revisionId: selectedRevision,
      start: 2,
      end: 5,
      quote: "😀a",
    },
  });
}

test("model context carries saved focus and selection's own revision with UTF-16 offsets", async () => {
  const updates: HostUpdate[] = [];
  const host = {
    getCurrent: () => undefined,
    update: async (value: HostUpdate) => {
      updates.push(value);
      return { updateId: "local-1" };
    },
  };
  const bridge = createReaderContextBridge({
    getModelContext: () => host,
    supportsStructuredContent: () => true,
    onRestore: () => assert.fail("Unexpected restore"),
  });
  await bridge.publish(context());
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].structuredContent, context());
  const text = updates[0].content[0].text;
  for (const value of [
    "Saved article",
    focusedDocument,
    focusedRevision,
    selectedDocument,
    selectedRevision,
    "UTF-16",
    "2",
    "5",
    "😀a",
  ])
    assert.ok(text.includes(value), value);
  await bridge.publish(context());
  assert.equal(
    updates.length,
    1,
    "Unchanged semantic state must not republish",
  );
});

test("unsupported extension stays usable; text-only host receives no structured payload", async () => {
  const unsupported = createReaderContextBridge({
    getModelContext: () => undefined,
    supportsStructuredContent: () => false,
    onRestore: () => assert.fail("Unexpected restore"),
  });
  await unsupported.publish(context());
  unsupported.syncFromHost();
  const updates: HostUpdate[] = [];
  const textOnly = createReaderContextBridge({
    getModelContext: () => ({
      getCurrent: () => undefined,
      update: async (value) => {
        updates.push(value);
        return undefined;
      },
    }),
    supportsStructuredContent: () => false,
    onRestore: () => assert.fail("Unexpected restore"),
  });
  await textOnly.publish(context());
  assert.equal(updates.length, 1);
  assert.equal(Object.hasOwn(updates[0], "structuredContent"), false);
  assert.ok(updates[0].content[0].text.includes(selectedRevision));
});

test("slow model-context updates are serialized and coalesce to the newest pending state", async () => {
  const updates: HostUpdate[] = [];
  let releaseFirst!: () => void;
  const first = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let active = 0;
  const host = {
    getCurrent: () => undefined,
    update: async (value: HostUpdate) => {
      assert.equal(
        active++,
        0,
        "Concurrent host updates can overwrite newer state",
      );
      updates.push(value);
      if (updates.length === 1) await first;
      active--;
      return { updateId: `local-${updates.length}` };
    },
  };
  const bridge = createReaderContextBridge({
    getModelContext: () => host,
    supportsStructuredContent: () => true,
    onRestore: () => assert.fail("Unexpected restore"),
  });
  const one = bridge.publish(context("First"));
  const two = bridge.publish(context("Intermediate"));
  const three = bridge.publish(context("Latest"));
  assert.equal(updates.length, 1);
  releaseFirst();
  await Promise.all([one, two, three]);
  assert.equal(updates.length, 2);
  assert.deepEqual(updates[1].structuredContent, context("Latest"));
});

test("valid external context restores once and suppresses publication echoes", async () => {
  const updates: HostUpdate[] = [];
  const restored: Array<ReaderContext | null> = [];
  let current:
    | { updateId: string; structuredContent?: Record<string, unknown> }
    | null
    | undefined;
  const bridge = createReaderContextBridge({
    getModelContext: () => ({
      getCurrent: () => current,
      update: async (value) => {
        updates.push(value);
        return { updateId: "local-1" };
      },
    }),
    supportsStructuredContent: () => true,
    onRestore: (value) => {
      restored.push(value);
    },
  });
  bridge.syncFromHost();
  current = { updateId: "other-app", structuredContent: { unrelated: true } };
  bridge.syncFromHost();
  assert.equal(restored.length, 0);
  current = { updateId: "external-1", structuredContent: context() };
  bridge.syncFromHost();
  bridge.syncFromHost();
  assert.deepEqual(restored, [context()]);
  await bridge.publish(context());
  assert.equal(updates.length, 0, "Restored context must not echo to host");
  current = null;
  bridge.syncFromHost();
  bridge.syncFromHost();
  assert.deepEqual(restored, [context(), null]);
  assert.equal(updates.length, 0);
  await bridge.publish(context("User changed document"));
  assert.equal(updates.length, 1);
  current = {
    updateId: "local-1",
    structuredContent: context("User changed document"),
  };
  bridge.syncFromHost();
  assert.equal(
    restored.length,
    2,
    "Acknowledged local publication must not restore again",
  );
});
