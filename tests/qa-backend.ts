import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import { DocumentStore } from "../lib/server/document-store";
import { authorizeIdentity } from "../lib/server/owner-auth";
import type { RuntimeEnv } from "../lib/server/env";
export async function qaBackend() {
  const require = createRequire(import.meta.url),
    wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
  const { Miniflare } = wranglerRequire("miniflare");
  const mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    d1Databases: ["DB"],
    r2Buckets: ["BUCKET"],
    compatibilityDate: "2026-05-15",
  });
  const env: RuntimeEnv = {
    DB: await mf.getD1Database("DB"),
    BUCKET: await mf.getR2Bucket("BUCKET"),
    SITE_ORIGIN: "http://terminal.local:4173",
    OWNER_USER_ID: "qa-owner",
  };
  for (const file of (await readdir("drizzle"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    for (const sql of (await readFile(`drizzle/${file}`, "utf8")).split(
      "--> statement-breakpoint",
    ))
      if (sql.trim()) await env.DB.prepare(sql).run();
  }
  const store = new DocumentStore(
    env,
    await authorizeIdentity(env, {
      userId: "qa-owner",
      email: "qa@example.invalid",
    }),
  );
  const a = (
    await store.execute("write", {
      path: "/essays/reading.md",
      title: "阅读是一种相遇",
      content:
        "一篇文章从来不只属于它自己。它回应一个问题，引用另一个声音，又成为后来思考的起点。\n\n## 当文字相互连接\n\n我们习惯从第一页读到最后一页。但理解往往发生在**两份文档之间**：一个解释照亮了原文，一个反例改变了判断。\n\n让这些关系留在文字之间。\n\n## 保留思考的来处\n\n在这里，每一次修改都是一个新版本。连接记得当时的文字，你可以随时回到它产生的语境。\n\n> 读到一个值得追问的地方，就从那里开始。\n\n选中文字，写下你的问题。回答拥有独立的文档，随后再决定它与哪些文字相连。",
    })
  ).document;
  const b = (
    await store.execute("write", {
      path: "/notes/connections.md",
      title: "连接让语境可见",
      content:
        "阅读一段解释时，我们常常需要同时看见它所回应的原文。并排阅读保留了这两处文字，让它们之间的关系变得可见。\n\n## 精确的两端\n\n每条连接都有两个明确的端点：某个版本中的一段文字，以及另一份文档中的一段文字。\n\n原文修改后，连接继续指向原来的版本。文字相同并不保证意思相同；是否连接新的版本，由阅读和写作的人决定。\n\n## 一个独立的回答\n\n问题与回答之间可以建立关系，回答也可以连接更多文章。它们不必被放进同一棵对话树。",
    })
  ).document;
  const quote = "两份文档之间",
    start = a.content.indexOf(quote),
    q2 = "并排阅读保留了这两处文字",
    s2 = b.content.indexOf(q2);
  await store.execute("link", {
    from: { revisionId: a.revisionId, start, end: start + quote.length, quote },
    to: { revisionId: b.revisionId, start: s2, end: s2 + q2.length, quote: q2 },
    relation: "explanation",
    label: "连接如何保留语境",
  });
  return { store, dispose: () => mf.dispose() };
}
