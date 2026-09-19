import { DocumentStore } from "../lib/server/document-store";
import { DocumentId, RevisionId } from "../lib/domain/model";

export function longMarkdown(sections = 1000): string {
  return Array.from(
    { length: sections },
    (_, i) =>
      `## 第 ${i + 1} 节：文档与连接\n\n文档具有稳定的身份。每次修改产生一个不可变版本，连接以具体的文字范围作为两端，保留形成时的语境。阅读位置不属于内容本身。当前文档改变时，其余文档退到周边折页，仍然属于同一个空间。\n\n这是一个包含 **加粗文字**、\`inline code\` 和 [外部引用](https://xanadu.com) 的段落，用于验证长文档中的选择、编辑与滚动。\n\n`,
  ).join("");
}

/** Used only by the isolated development backend; never seeds a published database. */
export async function seedBenchmark(store: DocumentStore) {
  const existing = await store.execute("ls", { prefix: "/benchmark/259.md" });
  if (
    existing.documents.some((document) => document.path === "/benchmark/259.md")
  )
    return;
  const db = store.env.DB;
  const ids = Array.from({ length: 260 }, () => ({
    document: DocumentId.parse(crypto.randomUUID()),
    revision: RevisionId.parse(crypto.randomUUID()),
  }));
  const large = longMarkdown();
  for (let offset = 0; offset < ids.length; offset += 25) {
    const statements = ids.slice(offset, offset + 25).flatMap((ids, local) => {
      const i = offset + local,
        at = new Date(Date.now() + i).toISOString();
      return [
        db
          .prepare(
            "INSERT INTO documents(id,path,title,created_at) VALUES(?,?,?,?)",
          )
          .bind(
            ids.document,
            `/benchmark/${String(i).padStart(3, "0")}.md`,
            i < 3 ? `长文档 ${i + 1}` : `资料 ${i + 1}`,
            at,
          ),
        db
          .prepare(
            "INSERT INTO revisions(id,document_id,sequence,parent_id,content,format,created_at) VALUES(?,?,1,NULL,?,'markdown',?)",
          )
          .bind(
            ids.revision,
            ids.document,
            i < 3 ? large : `资料 ${i + 1}。独立文档，保留自己的身份。`,
            at,
          ),
      ];
    });
    await db.batch(statements);
  }
  const quote = "文档具有稳定的身份。";
  let start = 0;
  for (let i = 0; i < 80; i++) {
    start = large.indexOf(quote, start);
    const anchor = (revisionId: RevisionId) => ({
      revisionId,
      start,
      end: start + quote.length,
      quote,
    });
    await store.execute("link", {
      from: anchor(ids[0].revision),
      to: anchor(ids[1 + (i % 2)].revision),
      relation: i % 2 ? "contrast" : "explanation",
      label: `第 ${i + 1} 处关系`,
    });
    start += quote.length;
  }
  // A crowded edge must represent distinct documents, not eighty links to
  // the same two papers. These one hundred equal-hop leaves exercise fan
  // pagination and long titles with a bounded number of mounted bodies.
  const sourceAnchorId = crypto.randomUUID();
  const sourceStart = large.indexOf(quote);
  await db
    .prepare(
      "INSERT INTO anchors(id,revision_id,start,end,quote) VALUES(?,?,?,?,?)",
    )
    .bind(
      sourceAnchorId,
      ids[0].revision,
      sourceStart,
      sourceStart + quote.length,
      quote,
    )
    .run();
  const relations = [
    "reference",
    "explanation",
    "question",
    "contrast",
    "continuation",
  ] as const;
  for (let offset = 3; offset < 103; offset += 20) {
    const statements = ids
      .slice(offset, Math.min(offset + 20, 103))
      .flatMap((id, local) => {
        const i = offset + local;
        const targetQuote = `资料 ${i + 1}`;
        const anchorId = crypto.randomUUID();
        return [
          db
            .prepare(
              "INSERT INTO anchors(id,revision_id,start,end,quote) VALUES(?,?,0,?,?)",
            )
            .bind(anchorId, id.revision, targetQuote.length, targetQuote),
          db
            .prepare(
              "INSERT INTO connections(id,from_id,to_id,relation,label,created_at) VALUES(?,?,?,?,?,?)",
            )
            .bind(
              crypto.randomUUID(),
              sourceAnchorId,
              anchorId,
              relations[i % relations.length],
              `近缘文档 ${i - 2} 的文字连接`,
              new Date().toISOString(),
            ),
          db
            .prepare("UPDATE documents SET title=? WHERE id=?")
            .bind(
              i % 11 === 0
                ? `近缘 ${String(i - 2).padStart(3, "0")} · 一个关于不可变版本、连续阅读与原文来处的很长标题 Long title without losing its identity`
                : `近缘 ${String(i - 2).padStart(3, "0")}`,
              id.document,
            ),
        ];
      });
    await db.batch(statements);
  }
}
