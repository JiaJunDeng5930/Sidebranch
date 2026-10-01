import { DocumentStore } from "../lib/server/document-store";
import type { AnchorInput, DocumentRevision } from "../lib/domain/model";

export const readingFixturePrefix = "/qa/reading/";

const readingPrelude = [
  "阅读一份材料之前，我们先辨认它在回答什么问题，以及这些话是在什么情况下写下的。作者的判断可能来自观察，也可能来自推测。把两者分清，才能知道后面的说明补充了哪一步，而不是因为解释写得流畅，就把尚未证明的结论当成事实。",
  "田野笔记保存的是某次观察留下的痕迹。天气、地点、参与者和记录时间，都可能影响一段话的含义。我们引用其中一句话时，也需要保留这些条件。文档的版本固定了当时写下的内容，但一句话能够支持多大的结论，仍然需要读者逐项检查。",
  "相同的文字出现在另一篇文章里，未必承担相同的作用。它可能是直接引用，也可能是作者准备反驳的意见。辨认出处之后，还要查看它前后的论述，确认引用有没有改变原来的限定条件。理解关系的第一步，是说清双方各自正在主张什么。",
  "解释与原文放在一起，并不意味着两者已经达成一致。解释可以补充一个遗漏的步骤，也可以提出一种暂时的理解。我们沿着关系继续阅读时，应当检验它回应的是原句中的哪个问题，并寻找能把原文与解释连接起来的具体证据，而非只看语气是否相近。",
  "异议值得留下，因为它常常指出结论成立所需的条件。一个观察在某种情境中可靠，换一个时间或对象就可能失效。面对这样的分歧，我们不急着选出唯一答案，而是把双方对条件的描述并列起来，找出真正不同的地方，再决定需要补充什么材料。",
  "核对一项判断，可以先区分可以重查的观察、从观察推出的结论，以及作者尚未说明的假设。每一步都有不同的检验方式。观察要与记录对照，推论要检查中间理由，假设则需要新的材料。只要其中一步仍然未知，就应当让这个空缺继续显露出来。",
  "对照阅读的范围也需要有边界。我们关心的可能只是原文中的一句话和说明中的一个段落，不必要求整篇文章同时展开。围绕这些文字读清上下文，再决定是否继续向前，能够减少无关内容带来的干扰，也让下一次提问仍然接在明确的问题之上。",
  "新的说明可以改变我们对材料的理解，却不应当抹去先前的证据。形成暂时结论时，写清哪些观察依然成立，哪些判断因为条件变化需要调整。这样后来出现的回答才有可检查的依据，读者也能区分已经确认的事实、合理的解释和仍待验证的可能性。",
  "回到原文，是为了重新审视产生问题的地方。读过解释和异议之后，同一句话也许会显露出先前没有注意到的限制。保留那次阅读的文字范围、版本和上下文，使我们能够把新的认识放回旧的证据中检查，让继续阅读成为思考的展开，而不是换一份材料就重新开始。",
].join("\n\n");

const documents = [
  {
    key: "source",
    path: `${readingFixturePrefix}source.md`,
    title: "原始材料",
    content: `# 原始材料

${readingPrelude}

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

${readingPrelude}

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

${readingPrelude}

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
