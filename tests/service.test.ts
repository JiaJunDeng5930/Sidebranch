import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { DocumentStore } from "../lib/server/document-store";
import { importFile } from "../lib/server/import-file";
import { authorizeIdentity } from "../lib/server/owner-auth";
import {
  AnchorId,
  ConnectionId,
  DocumentId,
  QuestionId,
  RevisionId,
  Path,
  validateAnchor,
  applyEdit,
} from "../lib/domain/model";
import type { DocumentRevision } from "../lib/domain/model";
import type { RuntimeEnv } from "../lib/server/env";

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare } = wranglerRequire("miniflare") as {
  Miniflare: new (options: Record<string, unknown>) => {
    getD1Database(name: string): Promise<D1Database>;
    getR2Bucket(name: string): Promise<R2Bucket>;
    dispose(): Promise<void>;
  };
};

let mf: InstanceType<typeof Miniflare>;
let env: RuntimeEnv;
let store: DocumentStore;

async function applyMigrations(db: D1Database): Promise<void> {
  const root = join(process.cwd(), "drizzle");
  const files = (await readdir(root))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = await readFile(join(root, file), "utf8");
    for (const statement of sql.split("--> statement-breakpoint"))
      if (statement.trim()) await db.prepare(statement).run();
  }
}

function uuid<T>(schema: { parse(value: string): T }): T {
  return schema.parse(crypto.randomUUID());
}

before(async () => {
  const dbName = `DB_SERVICE_${crypto.randomUUID().replaceAll("-", "")}`;
  const bucketName = `BUCKET_SERVICE_${crypto.randomUUID().replaceAll("-", "")}`;
  mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    d1Databases: [dbName],
    r2Buckets: [bucketName],
    compatibilityDate: "2026-05-15",
  });
  env = {
    DB: await mf.getD1Database(dbName),
    BUCKET: await mf.getR2Bucket(bucketName),
    SITE_ORIGIN: "https://service.test",
    OWNER_BOOTSTRAP_EMAIL: "owner@example.test",
  };
  await applyMigrations(env.DB);
  store = new DocumentStore(
    env,
    await authorizeIdentity(env, {
      userId: "service-owner",
      email: "owner@example.test",
    }),
  );
});

after(async () => {
  await mf.dispose();
});

test("open returns an explicit empty union before the first document", async () => {
  const result = await store.execute("open_document", {});
  assert.deepEqual(result, { status: "empty" });
});

test("locators and UTF-16 anchors stay checked at the domain boundary", async () => {
  const content = "汉字😀 and punctuation?!";
  const revisionId = uuid(RevisionId);
  validateAnchor(content, {
    revisionId,
    start: 2,
    end: 4,
    quote: "😀",
  });
  assert.throws(
    () => validateAnchor(content, { revisionId, start: 2, end: 3, quote: "\ud83d" }),
    /surrogate/,
  );
  assert.equal(applyEdit(content, 0, 2, "汉字", "文字"), "文字😀 and punctuation?!");
  assert.throws(() => applyEdit(content, 3, 3, "", "x"), /surrogate/);

  const document = (
    await store.execute("write", {
      path: "/contracts/locator.md",
      title: "Locator",
      content,
    })
  ).document;
  await assert.rejects(
    () =>
      store.execute("cat", {
        documentId: document.id,
        path: document.path,
      } as never),
    /Invalid input|locator/i,
  );
});

test("ls is metadata-only and continues through a large catalogue", async () => {
  const inserts: D1PreparedStatement[] = [];
  for (let i = 0; i < 205; i += 1) {
    const id = uuid(DocumentId);
    const revisionId = uuid(RevisionId);
    const createdAt = `2028-01-01T00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z`;
    inserts.push(
      env.DB.prepare(
        "INSERT INTO documents(id,path,title,created_at) VALUES(?,?,?,?)",
      ).bind(id, `/catalogue/${String(i).padStart(3, "0")}.md`, `Catalogue ${i}`, createdAt),
      env.DB.prepare(
        "INSERT INTO revisions(id,document_id,sequence,parent_id,content,format,created_at) VALUES(?,?,1,NULL,?,?,?)",
      ).bind(revisionId, id, `body ${i}`, "markdown", createdAt),
    );
    if (inserts.length >= 40) {
      await env.DB.batch(inserts.splice(0));
    }
  }
  if (inserts.length) await env.DB.batch(inserts);

  const paths: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await store.execute("ls", {
      prefix: "/catalogue/",
      limit: 37,
      ...(cursor ? { cursor } : {}),
    });
    assert.ok(page.documents.every((doc) => !Object.hasOwn(doc, "content")));
    paths.push(...page.documents.map((doc) => doc.path));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(paths.length, 205);
  assert.equal(new Set(paths).size, 205);
});

test("Unicode path keysets are stable and search cursors bind the query", async () => {
  const rows: D1PreparedStatement[] = [];
  for (const [index, path] of [
    "/中文/甲.md",
    "/中文/乙.md",
    "/中文/😀.md",
    "/中文/é.md",
  ].entries()) {
    const id = uuid(DocumentId);
    const revisionId = uuid(RevisionId);
    const createdAt = `2040-01-01T00:00:${String(index).padStart(2, "0")}.000Z`;
    rows.push(
      env.DB.prepare(
        "INSERT INTO documents(id,path,title,created_at) VALUES(?,?,?,?)",
      ).bind(id, path, path, createdAt),
      env.DB.prepare(
        "INSERT INTO revisions(id,document_id,sequence,parent_id,content,format,created_at) VALUES(?,?,1,NULL,?,?,?)",
      ).bind(revisionId, id, `content ${index}`, "markdown", createdAt),
    );
  }
  const maxCodePointPath = "/max/\u{10ffff}";
  {
    const id = uuid(DocumentId);
    const revisionId = uuid(RevisionId);
    rows.push(
      env.DB.prepare(
        "INSERT INTO documents(id,path,title,created_at) VALUES(?,?,?,?)",
      ).bind(id, maxCodePointPath, "Maximum code point", "2040-01-01T00:01:00.000Z"),
      env.DB.prepare(
        "INSERT INTO revisions(id,document_id,sequence,parent_id,content,format,created_at) VALUES(?,?,1,NULL,?,?,?)",
      ).bind(revisionId, id, "max code point", "markdown", "2040-01-01T00:01:00.000Z"),
    );
  }
  for (let index = 0; index < 26; index += 1) {
    const id = uuid(DocumentId);
    const revisionId = uuid(RevisionId);
    const createdAt = `2041-01-01T00:00:${String(index).padStart(2, "0")}.000Z`;
    rows.push(
      env.DB.prepare(
        "INSERT INTO documents(id,path,title,created_at) VALUES(?,?,?,?)",
      ).bind(id, `/keyset/${String(index).padStart(2, "0")}.md`, `Keyset ${index}`, createdAt),
      env.DB.prepare(
        "INSERT INTO revisions(id,document_id,sequence,parent_id,content,format,created_at) VALUES(?,?,1,NULL,?,?,?)",
      ).bind(revisionId, id, `needle ${index}`, "markdown", createdAt),
    );
  }
  await env.DB.batch(rows);

  const paths: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await store.execute("ls", {
      prefix: "/中文/",
      limit: 2,
      ...(cursor ? { cursor } : {}),
    });
    paths.push(...page.documents.map((document) => document.path));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.deepEqual(new Set(paths), new Set([
    "/中文/甲.md",
    "/中文/乙.md",
    "/中文/😀.md",
    "/中文/é.md",
  ]));
  const maxCodePointPage = await store.execute("ls", {
    prefix: maxCodePointPath,
    limit: 2,
  });
  assert.deepEqual(maxCodePointPage.documents.map((document) => document.path), [
    maxCodePointPath,
  ]);

  const first = await store.execute("grep", {
    prefix: "/keyset/",
    query: "needle",
    limit: 1,
  });
  assert.ok(first.nextCursor);
  await assert.rejects(
    store.execute("grep", {
      prefix: "/keyset/",
      query: "other",
      limit: 1,
      cursor: first.nextCursor!,
    }),
    /cursor/i,
  );
});

async function seedRelations(document: { id: DocumentId; revisionId: RevisionId }) {
  const target = (
    await store.execute("write", {
      path: "/relations/target.md",
      title: "Target",
      content: "target",
    })
  ).document;
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < 121; i += 1) {
    const fromId = uuid(AnchorId);
    const toId = uuid(AnchorId);
    const connectionId = uuid(ConnectionId);
    const createdAt = new Date(Date.UTC(2029, 0, 1, 0, 0, i)).toISOString();
    statements.push(
      env.DB.prepare(
        "INSERT INTO anchors(id,revision_id,start,end,quote) VALUES(?,?,?,?,?)",
      ).bind(fromId, document.revisionId, 0, 2, "汉字"),
      env.DB.prepare(
        "INSERT INTO anchors(id,revision_id,start,end,quote) VALUES(?,?,?,?,?)",
      ).bind(toId, target.revisionId, 0, 6, "target"),
      env.DB.prepare(
        "INSERT INTO connections(id,from_id,to_id,relation,label,created_at) VALUES(?,?,?,?,?,?)",
      ).bind(connectionId, fromId, toId, "reference", `link ${i}`, createdAt),
    );
    if (statements.length >= 30) await env.DB.batch(statements.splice(0));
  }
  if (statements.length) await env.DB.batch(statements);

  const questionStatements: D1PreparedStatement[] = [];
  const questionIds: QuestionId[] = [];
  for (let i = 0; i < 105; i += 1) {
    const anchorId = uuid(AnchorId);
    const questionId = uuid(QuestionId);
    questionIds.push(questionId);
    const createdAt = new Date(Date.UTC(2030, 0, 1, 0, 0, i)).toISOString();
    questionStatements.push(
      env.DB.prepare(
        "INSERT INTO anchors(id,revision_id,start,end,quote) VALUES(?,?,?,?,?)",
      ).bind(anchorId, document.revisionId, 0, 2, "汉字"),
      env.DB.prepare(
        "INSERT INTO questions(id,anchor_id,body,created_at) VALUES(?,?,?,?)",
      ).bind(questionId, anchorId, `question ${i}`, createdAt),
    );
    if (questionStatements.length >= 40)
      await env.DB.batch(questionStatements.splice(0));
  }
  if (questionStatements.length) await env.DB.batch(questionStatements);
  await env.DB.prepare("INSERT INTO answers(question_id,document_id) VALUES(?,?)")
    .bind(questionIds[0], target.id)
    .run();
  return { target, questionIds };
}

test("open pages connections and questions with fixed query count", async () => {
  const source = (
    await store.execute("write", {
      path: "/relations/source.md",
      title: "Source",
      content: "汉字 source",
    })
  ).document;
  await seedRelations(source);

  const count = { prepare: 0 };
  const countedDb = {
    prepare(query: string) {
      count.prepare += 1;
      return env.DB.prepare(query);
    },
    batch(statements: D1PreparedStatement[]) {
      return env.DB.batch(statements);
    },
  } as unknown as D1Database;
  const counted = new DocumentStore({ ...env, DB: countedDb }, store.owner);
  const first = await counted.execute("open_document", {
    documentId: source.id,
    connectionsLimit: 100,
    questionsLimit: 100,
  });
  assert.equal(first.status, "ready");
  if (first.status !== "ready") return;
  assert.equal(first.view.connections.length, 100);
  assert.equal(first.view.questions.length, 100);
  assert.ok(first.view.connectionsNextCursor);
  assert.ok(first.view.questionsNextCursor);
  assert.equal(count.prepare, 3);

  const next = await counted.execute("open_document", {
    documentId: source.id,
    connectionsCursor: first.view.connectionsNextCursor!,
    questionsCursor: first.view.questionsNextCursor!,
    connectionsLimit: 100,
    questionsLimit: 100,
  });
  assert.equal(next.status, "ready");
  if (next.status !== "ready") return;
  assert.equal(next.view.connections.length, 21);
  assert.equal(next.view.questions.length, 5);
  assert.equal(next.view.connectionsNextCursor, null);
  assert.equal(next.view.questionsNextCursor, null);
  assert.equal(count.prepare, 6);
});

test("an import keeps committed bytes when the response read fails", async () => {
  class ReadFailureStore extends DocumentStore {
    override async read(): Promise<DocumentRevision> {
      throw new Error("response serialization failed");
    }
  }
  const failing = new ReadFailureStore(env, store.owner);
  const path = Path.parse("/imports/postcommit.txt");
  await assert.rejects(
    () =>
      importFile(failing, {
        path,
        mime: "text/plain",
        base64: Buffer.from("committed bytes").toString("base64"),
      }),
    /response serialization failed/,
  );
  const row = await env.DB.prepare(
    "SELECT id,key FROM assets WHERE name=? ORDER BY created_at DESC LIMIT 1",
  ).bind("postcommit.txt").first<{ id: string; key: string }>();
  assert.ok(row);
  assert.ok(await env.BUCKET.get(row.key));
  assert.ok(
    await env.DB.prepare("SELECT id FROM documents WHERE path=?")
      .bind(path)
      .first(),
  );
});

test("unlink cleans only connection-owned anchors", async () => {
  const source = (
    await store.execute("write", {
      path: "/unlink/source.md",
      title: "Unlink source",
      content: "source",
    })
  ).document;
  const target = (
    await store.execute("write", {
      path: "/unlink/target.md",
      title: "Unlink target",
      content: "target",
    })
  ).document;
  const connection = (
    await store.execute("link", {
      from: {
        revisionId: source.revisionId,
        start: 0,
        end: 6,
        quote: "source",
      },
      to: {
        revisionId: target.revisionId,
        start: 0,
        end: 6,
        quote: "target",
      },
    })
  ).connection;
  const endpointIds = [connection.from.id, connection.to.id];
  assert.equal(
    (await store.execute("unlink", { connectionId: connection.id })).removed,
    true,
  );
  const remaining = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM anchors WHERE id IN (?,?)",
  ).bind(...endpointIds).first<{ count: number }>();
  assert.equal(remaining?.count, 0);
});
