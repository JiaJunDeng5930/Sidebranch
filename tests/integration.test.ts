import { renderedTextOffsets } from "../lib/domain/text-offsets";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { handleMcp, APP_RESOURCE_URI } from "../lib/server/mcp-server";
import { DocumentStore } from "../lib/server/document-store";
import { authorizeIdentity } from "../lib/server/owner-auth";
import {
  RevisionId,
  Path,
  validateAnchor,
  applyEdit,
} from "../lib/domain/model";
import type { RuntimeEnv } from "../lib/server/env";
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare } = wranglerRequire("miniflare");
const mf = new Miniflare({
  modules: true,
  script: 'export default {fetch(){return new Response("ok")}}',
  d1Databases: ["DB"],
  r2Buckets: ["BUCKET"],
  compatibilityDate: "2026-05-15",
});
let env: RuntimeEnv, store: DocumentStore;
before(async () => {
  const DB = await mf.getD1Database("DB"),
    BUCKET = await mf.getR2Bucket("BUCKET");
  for (const file of (await readdir("drizzle"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = await readFile(`drizzle/${file}`, "utf8");
    for (const statement of sql.split("--> statement-breakpoint"))
      if (statement.trim()) await DB.prepare(statement).run();
  }
  env = {
    DB,
    BUCKET,
    SITE_ORIGIN: "https://sidebranch.test",
    OWNER_BOOTSTRAP_EMAIL: "owner@example.test",
  };
  store = new DocumentStore(
    env,
    await authorizeIdentity(env, {
      userId: "owner-id",
      email: "owner@example.test",
    }),
  );
});
after(async () => {
  await mf.dispose();
});
test("authorization fails closed, bootstrap pins the site-specific identity", async () => {
  await assert.rejects(() => authorizeIdentity(env, null), /登录/);
  await assert.rejects(
    () =>
      authorizeIdentity(env, { userId: "other", email: "owner@example.test" }),
    /所有者/,
  );
  assert.equal(
    (
      await authorizeIdentity(env, {
        userId: "owner-id",
        email: "changed@example.test",
      })
    ).userId,
    "owner-id",
  );
});
test("concurrent edits: exactly one wins and historical contents remain intact", async () => {
  const doc = await store.execute("write", {
    path: "/tests/concurrent.md",
    title: "Concurrent",
    content: "alpha beta",
  });
  const a = {
    documentId: doc.document.id,
    expectedRevisionId: doc.document.revisionId,
    start: 6,
    end: 10,
    expectedText: "beta",
    replacement: "gamma",
  };
  const results = await Promise.allSettled([
    store.execute("edit", a),
    store.execute("edit", { ...a, replacement: "delta" }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const old = await store.read({
    documentId: doc.document.id,
    revisionId: doc.document.revisionId,
  });
  assert.equal(old.content, "alpha beta");
  assert.equal(old.isCurrent, false);
  await assert.rejects(
    () =>
      env.DB.prepare("UPDATE revisions SET content='lost' WHERE id=?")
        .bind(old.revisionId)
        .run(),
    /Immutable revision/,
  );
  await assert.rejects(
    () =>
      env.DB.prepare("DELETE FROM revisions WHERE id=?")
        .bind(old.revisionId)
        .run(),
    /Immutable revision/,
  );
});
test("UTF-16 anchors reject wrong text, nonexistent revisions and split surrogates", async () => {
  const content = "汉字😀 and **bold**";
  const revisionId = RevisionId.parse(crypto.randomUUID());
  validateAnchor(content, { revisionId, start: 2, end: 4, quote: "😀" });
  assert.throws(
    () =>
      validateAnchor(content, {
        revisionId,
        start: 2,
        end: 3,
        quote: "\ud83d",
      }),
    /surrogate/,
  );
  assert.throws(
    () =>
      validateAnchor(content, { revisionId, start: 0, end: 2, quote: "wrong" }),
    /does not match/,
  );
  assert.throws(() => applyEdit(content, 3, 3, "", "x"), /surrogate/);
  await assert.rejects(
    () =>
      store.execute("ask", {
        anchor: { revisionId, start: 0, end: 1, quote: "x" },
        body: "Why?",
      }),
    /not found/,
  );
});
test("questions, answer documents and connections remain independent through edits and moves", async () => {
  const a = (
      await store.execute("write", {
        path: "/tests/original.md",
        title: "Original",
        content: "原文是独立文档。",
      })
    ).document,
    b = (
      await store.execute("write", {
        path: "/tests/answer.md",
        title: "Answer",
        content: "回答也可以独立存在。",
      })
    ).document;
  const from = { revisionId: a.revisionId, start: 0, end: 2, quote: "原文" },
    to = { revisionId: b.revisionId, start: 0, end: 2, quote: "回答" };
  const q = (
    await store.execute("ask", { anchor: from, body: "原文是什么意思？" })
  ).question;
  await store.execute("answer", { questionId: q.id, documentId: b.id });
  assert.deepEqual((await store.question(q.id)).answers, [b.id]);
  assert.equal((await store.connections(a.id)).length, 0);
  const c = (await store.execute("link", { from, to, relation: "explanation" }))
    .connection;
  await store.execute("edit", {
    documentId: a.id,
    expectedRevisionId: a.revisionId,
    start: 0,
    end: 2,
    expectedText: "原文",
    replacement: "新版",
  });
  await store.execute("mv", {
    documentId: a.id,
    newPath: "/moved/original.md",
  });
  const links = await store.connections(a.id);
  assert.equal(links[0].id, c.id);
  assert.equal(links[0].from.quote, "原文");
  assert.equal(
    (await store.read({ documentId: a.id, revisionId: from.revisionId }))
      .content,
    "原文是独立文档。",
  );
  await store.execute("unlink", { connectionId: c.id });
  assert.equal((await store.connections(a.id)).length, 0);
  assert.equal((await store.question(q.id)).answers.length, 1);
});
test("file imports share write/edit/search operations; originals survive", async () => {
  const d = (
    await store.execute("import_file", {
      path: "/imports/test.txt",
      mime: "text/plain",
      base64: Buffer.from("文件中的搜索目标").toString("base64"),
    })
  ).document;
  assert.ok(d.assetId);
  assert.equal(
    (await store.execute("grep", { query: "搜索目标" })).matches[0].start,
    4,
  );
  await store.execute("edit", {
    documentId: d.id,
    expectedRevisionId: d.revisionId,
    start: 0,
    end: 2,
    expectedText: "文件",
    replacement: "文本",
  });
  const source = await env.DB.prepare("SELECT key FROM assets WHERE id=?")
    .bind(d.assetId)
    .first<{ key: string }>();
  assert.equal(
    await (await env.BUCKET.get(source!.key))!.text(),
    "文件中的搜索目标",
  );
  await assert.rejects(
    () =>
      store.execute("write", {
        path: "/imports/test.txt",
        title: "Duplicate",
        content: "",
      }),
    /already exists/,
  );
  await assert.rejects(
    () =>
      store.execute("import_file", {
        path: "/imports/bad.txt",
        mime: "text/plain",
        base64: "/w==",
      }),
    /UTF-8/,
  );
});
test("PDF extraction imports real PDF bytes into the same document model", async () => {
  const bytes = await readFile("tests/fixtures/text.pdf");
  const doc = (
    await store.execute("import_file", {
      path: "/imports/paper.pdf",
      mime: "application/pdf",
      base64: bytes.toString("base64"),
    })
  ).document;
  assert.match(doc.content, /Xanadu PDF text/);
  assert.ok(doc.assetId);
});
test("path traversal and SQL wildcard search do not broaden access", async () => {
  assert.throws(() => Path.parse("/a/../b"));
  assert.throws(() => Path.parse("//a"));
  assert.equal(
    (await store.execute("grep", { query: "' OR 1=1 --" })).matches.length,
    0,
  );
  assert.equal(
    (await store.execute("ls", { prefix: "/%' OR 1=1 --" })).documents.length,
    0,
  );
});

test("MCP Streamable HTTP exposes tools, renders an App resource and executes document reads", async () => {
  async function call(method: string, params: object) {
    const body = { jsonrpc: "2.0", id: 1, method, params };
    const response = await handleMcp(
      new Request(env.SITE_ORIGIN + "/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(body),
      }),
      env,
      "<!doctype html><p>App test resource</p>",
      async () => store,
    );
    assert.equal(response.status, 200);
    return (await response.json()) as {
      result: Record<string, unknown>;
      error?: unknown;
    };
  }
  const init = await call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });
  assert.equal(
    (init.result.serverInfo as { name: string }).name,
    "Xanadu Sidebranch",
  );
  const tools = (await call("tools/list", {})).result.tools as {
    name: string;
    _meta: Record<string, unknown>;
  }[];
  assert.equal(tools.length, 17);
  assert.ok(tools.find((t) => t.name === "open_document")?._meta.ui);
  const read = await call("tools/call", { name: "ls", arguments: {} });
  assert.ok(
    (read.result.structuredContent as { documents: unknown[] }).documents
      .length > 0,
  );
  const resource = await call("resources/read", { uri: APP_RESOURCE_URI });
  assert.match(
    (resource.result.contents as { mimeType: string }[])[0].mimeType,
    /mcp-app/,
  );
});

test("Markdown rendered offsets account for entities, escapes and inline code", () => {
  assert.deepEqual(
    renderedTextOffsets("A &amp; B", "A & B"),
    [0, 1, 2, 7, 8, 9],
  );
  assert.deepEqual(renderedTextOffsets("`code`", "code"), [1, 2, 3, 4, 5]);
  assert.deepEqual(renderedTextOffsets("a\\*b", "a*b"), [0, 1, 3, 4]);
  assert.equal(renderedTextOffsets("mismatch", "different"), null);
});
