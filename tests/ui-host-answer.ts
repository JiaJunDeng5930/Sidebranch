import type { ReaderClient } from "../lib/client/reader-client";
import type { Question } from "../lib/domain/model";

/** Deterministic host response for UI QA. Each operation crosses the real service boundary. */
export async function createHostAnswer(
  client: ReaderClient,
  question: Question,
) {
  const { document: source } = await client.invoke("cat", {
    documentId: question.anchor.documentId,
    revisionId: question.anchor.revisionId,
  });
  const content = `## 为什么要区分文档与阅读视图？\n\n文档保存文字与版本；阅读视图保存位置、滚动和当前焦点。\n\n同一份文档可以同时出现在两个阅读视图中，分别停留在不同段落。关闭一个视图不会删除文档，移动文档也不会改变原文。\n\n这份回答回应了「${question.anchor.quote}」。回答本身是一份独立文档，与问题的关系、与原文的文字连接分别建立。`;
  const { document } = await client.invoke("write", {
    path: `/qa-answers/${Date.now()}-${Math.random().toString(36).slice(2)}.md`,
    title: "文档与视图，各自保存什么？",
    content,
  });
  await client.invoke("answer", {
    questionId: question.id,
    documentId: document.id,
  });
  const quote = "文档保存文字与版本；阅读视图保存位置、滚动和当前焦点。";
  const start = content.indexOf(quote);
  await client.invoke("link", {
    from: {
      revisionId: source.revisionId,
      start: question.anchor.start,
      end: question.anchor.end,
      quote: question.anchor.quote,
    },
    to: {
      revisionId: document.revisionId,
      start,
      end: start + quote.length,
      quote,
    },
    relation: "explanation",
    label: "区分内容和阅读状态",
  });
  return client.invoke("open_document", { documentId: document.id });
}
