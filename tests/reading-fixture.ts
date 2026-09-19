import { DocumentStore } from "../lib/server/document-store";
import type { AnchorInput, DocumentRevision } from "../lib/domain/model";

export const readingFixturePrefix = "/qa/reading/";

const documents = [
  {
    key: "source",
    path: `${readingFixturePrefix}source.md`,
    title: "原始材料",
    content: `# 原始材料

田野记录先写下观察，再留下没有解释的停顿。
记录显示，读者先确认来处，才知道一段材料该如何使用。

这份材料也保留一个细节：雨停之后，纸页边缘仍然潮湿。`,
  },
  {
    key: "objection",
    path: `${readingFixturePrefix}objection.md`,
    title: "异议",
    content: `# 异议

反面的观察提醒我们，来源清楚并不意味着结论已经稳固。
清楚的来源并不自动保证结论适用，尤其在情境发生变化之后。

异议保留了不确定性，逼着中心判断说明自己的边界。`,
  },
  {
    key: "followUp",
    path: `${readingFixturePrefix}follow-up.md`,
    title: "进一步说明",
    content: `# 进一步说明

若要继续阅读，可以把中心判断拆成几个可验证的小问题。
先回到原始材料，逐项核对每个问题，再写下暂时的结论。

记录每次核对的理由，才能让新的说明接上旧的证据。`,
  },
  {
    key: "question",
    path: `${readingFixturePrefix}question.md`,
    title: "待回答问题",
    content: `# 待回答问题

当情境发生变化时，原始材料中的判断还适用吗？

请先指出仍然可靠的观察，再说明需要重新核对的条件。`,
  },
  {
    key: "center",
    path: `${readingFixturePrefix}center.md`,
    title: "中心论述",
    content: `# 中心论述

阅读关系要有一个清楚的中心，先交代判断，再让证据进入视野。
一条关系只有在读者知道它从哪里来、为何存在，
然后才能决定是否跟随这段文字继续阅读。

这里还有第二个落点：当材料彼此不一致时，保留分歧比抹平分歧更有用。`,
  },
] as const;

type FixtureKey = (typeof documents)[number]["key"];
type FixtureDocuments = Record<FixtureKey, DocumentRevision>;

const anchor = (document: DocumentRevision, quote: string): AnchorInput => {
  const start = document.content.indexOf(quote);
  if (start < 0)
    throw new Error(`Reading fixture quote is missing from ${document.path}.`);
  return {
    revisionId: document.revisionId,
    start,
    end: start + quote.length,
    quote,
  };
};

export interface ReadingFixtureSeed {
  centerPath: string;
  paths: readonly string[];
  connectionCount: number;
}

/** Seed a small, stable graph used only by the local Reader/AppBridge harness. */
export async function seedReadingFixture(
  store: DocumentStore,
): Promise<ReadingFixtureSeed> {
  const existing = await store.execute("ls", {
    prefix: readingFixturePrefix,
    limit: documents.length,
  });
  const existingPaths = new Set<string>(
    existing.documents.map((document) => document.path),
  );
  const allPathsPresent = documents.every((document) =>
    existingPaths.has(document.path),
  );
  if (allPathsPresent)
    return {
      centerPath: `${readingFixturePrefix}center.md`,
      paths: documents.map((document) => document.path),
      connectionCount: 6,
    };
  if (existingPaths.size > 0)
    throw new Error(
      "The reading fixture is partially present; restart the local QA server to seed it again.",
    );

  const seeded = {} as FixtureDocuments;
  for (const document of documents) {
    const result = await store.execute("write", {
      path: document.path,
      title: document.title,
      content: document.content,
      format: "markdown",
    });
    seeded[document.key] = result.document;
  }

  // This range deliberately starts near the end of one line and ends near the
  // start of the next, so the QA selection and source mapping cross a newline.
  const centerBridge = "为何存在，\n然后才能决定";
  const centerSecond = "保留分歧比抹平分歧更有用";
  for (const relation of [
    {
      from: anchor(seeded.center, centerBridge),
      to: anchor(seeded.source, "读者先确认来处"),
      relation: "reference" as const,
      label: "原始材料支撑中心论述",
    },
    {
      from: anchor(seeded.center, centerBridge),
      to: anchor(seeded.objection, "清楚的来源并不自动保证结论适用"),
      relation: "contrast" as const,
      label: "异议指出适用边界",
    },
    {
      from: anchor(seeded.center, centerSecond),
      to: anchor(seeded.followUp, "把中心判断拆成几个可验证的小问题"),
      relation: "continuation" as const,
      label: "进一步说明行动线索",
    },
    {
      from: anchor(seeded.center, centerSecond),
      to: anchor(seeded.followUp, "记录每次核对的理由"),
      relation: "explanation" as const,
      label: "进一步说明如何保留分歧",
    },
    {
      from: anchor(seeded.center, centerBridge),
      to: anchor(seeded.question, "当情境发生变化时，原始材料中的判断还适用吗？"),
      relation: "question" as const,
      label: "把适用边界化为问题",
    },
    // Keep D as the from end and B as the to end.  Following this relation
    // from a side-read B exercises the reverse endpoint lookup.
    {
      from: anchor(seeded.followUp, "先回到原始材料"),
      to: anchor(seeded.source, "雨停之后，纸页边缘仍然潮湿"),
      relation: "continuation" as const,
      label: "沿着材料继续核对",
    },
  ])
    await store.execute("link", relation);

  return {
    centerPath: seeded.center.path,
    paths: documents.map((document) => document.path),
    connectionCount: 6,
  };
}
