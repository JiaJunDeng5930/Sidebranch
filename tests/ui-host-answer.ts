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
  const content = `## 为什么要区分文档与阅读位置？\n\n文档保存文字与版本；阅读位置记录此刻读到的段落、滚动和焦点。\n\n所有文档都属于同一个空间。旁读把另一份文字呈现到身边；继续读它时，原文退为周边的返回叶，仍保留原来的阅读位置。\n\n这份回答回应了「${question.anchor.quote}」。回答本身是一份独立文档，与问题的关系、与原文的文字连接分别建立。`;
  const { document } = await client.invoke("write", {
    path: `/qa-answers/${Date.now()}-${Math.random().toString(36).slice(2)}.md`,
    title: "文档与阅读位置，各自保存什么？",
    content,
  });
  await client.invoke("answer", {
    questionId: question.id,
    documentId: document.id,
  });
  const quote = "文档保存文字与版本；阅读位置记录此刻读到的段落、滚动和焦点。";
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
  return client.invoke("open_document", {
    documentId: document.id,
    answerFor: question.id,
  });
}
