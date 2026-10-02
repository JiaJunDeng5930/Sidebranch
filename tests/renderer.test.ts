import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedTextOffsets } from "../lib/domain/text-offsets";
import {
  createRenderPlan,
  RendererMappingError,
} from "../lib/reader/render-markdown";
import {
  DocumentMarkdownChunk,
  sourceSpansPlugin,
} from "../components/reader/document-markdown";
import {
  focusChunkIndexes,
  selectionCorridor,
} from "../components/reader/document-virtualizer";
import { RevisionId } from "../lib/domain/model";

type TestTree = {
  children: Array<{ properties: Record<string, unknown> }>;
};

test("render plans preserve source offsets while bounding markdown chunks", () => {
  const source = Array.from(
    { length: 80 },
    (_, index) =>
      `## Section ${index}\n\nA [link](https://example.test/${index}) &amp; text.\n\n`,
  ).join("");
  const plan = createRenderPlan(source, "markdown", 1_024);
  assert.ok(plan.chunks.length > 1);
  assert.equal(plan.chunks.map((chunk) => chunk.source).join(""), source);
  assert.equal(plan.chunks[0].range.start, 0);
  assert.equal(plan.chunks.at(-1)?.range.end, source.length);
  for (let index = 1; index < plan.chunks.length; index++)
    assert.equal(
      plan.chunks[index - 1].range.end,
      plan.chunks[index].range.start,
    );
});

test("fenced code is never split from its closing fence", () => {
  const paragraphs = Array.from(
    { length: 12 },
    (_, index) => `Paragraph ${index}.`,
  ).join("\n\n");
  const source = paragraphs + "\n\n```ts\nconst answer = 42;\n\n```\n\nAfter.";
  const plan = createRenderPlan(source, "markdown", 1_024);
  const codeChunk = plan.chunks.find((chunk) =>
    chunk.source.includes("const answer"),
  );
  assert.ok(codeChunk);
  assert.match(codeChunk.source, /```ts[\s\S]*```/);
});

test("fence type, length and info text determine the closing fence", () => {
  const prefix = Array.from(
    { length: 80 },
    (_, index) => `Paragraph ${index} before the fence.`,
  ).join("\n\n");
  const source =
    prefix + "\n\n````ts\ninside\n```\n~~~~\nstill code\n````\n\nafter";
  const plan = createRenderPlan(source, "markdown", 1_024);
  const codeChunk = plan.chunks.find((chunk) =>
    chunk.source.includes("inside"),
  );
  assert.ok(codeChunk);
  assert.match(codeChunk.source, /````ts[\s\S]*```\n~~~~\nstill code\n````/);
  assert.equal(
    codeChunk.source.includes("still code"),
    true,
    "a shorter/different fence must not end the block",
  );
  assert.equal(plan.chunks.map((chunk) => chunk.source).join(""), source);
});

test("very long structural blocks stay parser units above the soft target", () => {
  const fence =
    "```md\n" +
    Array.from({ length: 300 }, (_, index) => `line ${index}\n\n`).join("") +
    "```\n\nAfter.";
  const table =
    "| left | right |\n| --- | --- |\n" +
    Array.from(
      { length: 180 },
      (_, index) => `| ${index} | ${"value ".repeat(8)}|\n`,
    ).join("") +
    "\nAfter.";
  for (const [source, marker] of [
    [fence, "line 179"],
    [table, "| 179 |"],
  ] as const) {
    const plan = createRenderPlan(source, "markdown");
    const block = plan.chunks.find((chunk) => chunk.source.includes(marker));
    assert.ok(block);
    assert.ok(block.source.length > 2_048);
    assert.equal(plan.chunks.map((chunk) => chunk.source).join(""), source);
    assert.equal(
      source.slice(block.range.start, block.range.end),
      block.source,
    );
  }
});

test("CRLF fenced code closes without corrupting source ranges", () => {
  const prefix = Array.from(
    { length: 80 },
    (_, index) => `Paragraph ${index} before the fence.`,
  ).join("\r\n\r\n");
  const source =
    prefix + "\r\n\r\n```ts\r\nconst answer = 42;\r\n```\r\n\r\nAfter.";
  const plan = createRenderPlan(source, "markdown", 1_024);
  const codeChunk = plan.chunks.find((chunk) =>
    chunk.source.includes("const answer"),
  );
  assert.ok(codeChunk);
  assert.match(codeChunk.source, /```ts\r\nconst answer = 42;\r\n```/);
  assert.equal(plan.chunks.map((chunk) => chunk.source).join(""), source);
  assert.equal(
    plan.chunks.every(
      (chunk) =>
        source.slice(chunk.range.start, chunk.range.end) === chunk.source,
    ),
    true,
  );
});

test("blank lines inside lists and block quotes stay in one chunk past 4096", () => {
  const trailing = Array.from(
    { length: 100 },
    (_, index) => `Trailing paragraph ${index}.`,
  ).join("\n\n");
  const listSource =
    `- first ${"a".repeat(3_000)}\n\n` +
    `  continuation ${"b".repeat(2_000)}\n\n` +
    `- second list item\n\n${trailing}`;
  const listPlan = createRenderPlan(listSource, "markdown", 4_096);
  assert.ok(listPlan.chunks.length > 1);
  const listChunk = listPlan.chunks.find((chunk) =>
    chunk.source.includes("continuation"),
  );
  assert.ok(listChunk);
  assert.ok(listChunk.source.length > 4_096);
  assert.match(listChunk.source, /- first [\s\S]*- second list item/);
  assert.equal(
    listPlan.chunks.map((chunk) => chunk.source).join(""),
    listSource,
  );

  const quoteSource =
    `> first ${"c".repeat(3_000)}\n\n` +
    `> second ${"d".repeat(2_000)}\n\n${trailing}`;
  const quotePlan = createRenderPlan(quoteSource, "markdown", 4_096);
  assert.ok(quotePlan.chunks.length > 1);
  const quoteChunk = quotePlan.chunks.find((chunk) =>
    chunk.source.includes("> second"),
  );
  assert.ok(quoteChunk);
  assert.ok(quoteChunk.source.length > 4_096);
  assert.match(quoteChunk.source, /> first [\s\S]*> second/);
  assert.equal(
    quotePlan.chunks.map((chunk) => chunk.source).join(""),
    quoteSource,
  );
});

test("reference definitions are parser context across bounded chunks", () => {
  const source =
    "A [linked passage][source] appears before its definition.\n\n" +
    Array.from(
      { length: 180 },
      (_, index) => `Filler paragraph ${index} ${"x".repeat(30)}.`,
    ).join("\n\n") +
    "\n\n[source]: https://example.test/reference";
  const plan = createRenderPlan(source, "markdown", 4_096);
  assert.ok(plan.chunks.length > 2);
  const linkChunk = plan.chunks.find((chunk) =>
    chunk.source.includes("linked passage"),
  );
  const definitionChunk = plan.chunks.find((chunk) =>
    chunk.source.includes("[source]:"),
  );
  assert.ok(linkChunk);
  assert.ok(definitionChunk);
  assert.notEqual(linkChunk.index, definitionChunk.index);
  assert.doesNotMatch(linkChunk.source, /\[source\]:/);
  assert.deepEqual(linkChunk.referenceDefinitions, [
    "[source]: https://example.test/reference",
  ]);
  const html = renderToStaticMarkup(
    React.createElement(DocumentMarkdownChunk, {
      source: linkChunk.source,
      sourceStart: linkChunk.range.start,
      sourceEnd: linkChunk.range.end,
      chunkIndex: linkChunk.index,
      referenceDefinitions: linkChunk.referenceDefinitions,
    }),
  );
  assert.match(html, /<a href="https:\/\/example\.test\/reference"/);
  assert.match(
    html,
    new RegExp(`data-source-start="${source.indexOf("linked passage")}"`),
  );
  assert.doesNotMatch(html, /\[source\]:/);
  assert.equal(plan.chunks.map((chunk) => chunk.source).join(""), source);
});

test("source spans retain exact maps for entities, escapes, links and code", () => {
  const tree = {
    type: "element",
    tagName: "p",
    position: { start: { offset: 0 }, end: { offset: 22 } },
    children: [
      {
        type: "text",
        value: "A & B * C",
        position: { start: { offset: 0 }, end: { offset: 14 } },
      },
    ],
  } as unknown as TestTree;
  const source = "A &amp; B \\* C";
  const transformer = sourceSpansPlugin(source)() as (tree: TestTree) => void;
  transformer(tree);
  const span = tree.children[0];
  assert.equal(span.properties["data-source-start"], 0);
  assert.deepEqual(
    JSON.parse(String(span.properties["data-source-start-map"])),
    [0, 1, 2, 7, 8, 9, 10, 12, 13, 14],
  );
  assert.deepEqual(
    JSON.parse(String(span.properties["data-source-end-map"])),
    [0, 1, 2, 7, 8, 9, 10, 12, 13, 14],
  );
});

test("unknown rendered transformations are rejected instead of guessed", () => {
  const tree = {
    type: "element",
    tagName: "p",
    children: [
      {
        type: "text",
        value: "rendered",
        position: { start: { offset: 0 }, end: { offset: 4 } },
      },
    ],
  } as unknown as TestTree;
  const transformer = sourceSpansPlugin("raw")() as (tree: TestTree) => void;
  transformer(tree);
  assert.equal(
    tree.children[0].properties["data-source-map-state"],
    "unmapped",
  );
  assert.ok(new RendererMappingError("boundary"));
});

test("Markdown semantics stay native while source spans cover GFM blocks", () => {
  const source =
    "# Heading [link](https://example.test)\n\n" +
    "```ts\nconst value = &amp;\n```\n\n" +
    "| left | right |\n| --- | --- |\n| A | B |";
  const html = renderToStaticMarkup(
    React.createElement(DocumentMarkdownChunk, {
      source,
      sourceStart: 20,
      sourceEnd: 20 + source.length,
      chunkIndex: 0,
    }),
  );
  assert.match(html, /<h1>/);
  assert.match(html, /<a href="https:\/\/example\.test"/);
  assert.match(html, /<table>/);
  assert.match(html, /data-source-start="[0-9]+"/);
  assert.match(html, /data-source-end="[0-9]+"/);
  assert.match(html, /const value = &amp;/);
});

type MappedSelection = readonly [number, number, number, number, string];

function renderedSpan(source: string, text: string, baseOffset: number) {
  const html = renderToStaticMarkup(
    React.createElement(DocumentMarkdownChunk, {
      source,
      sourceStart: baseOffset,
      sourceEnd: baseOffset + source.length,
      chunkIndex: 0,
    }),
  );
  const encodedText = renderToStaticMarkup(
    React.createElement("span", null, text),
  ).slice(6, -7);
  const span = Array.from(
    html.matchAll(/<span\b([^>]*)>([^<]*)<\/span>/g),
  ).find((match) => match[2] === encodedText);
  assert.ok(span, `Rendered text has no source span: ${JSON.stringify(text)}`);
  const attributes = Object.fromEntries(
    Array.from(span[1].matchAll(/([\w-]+)="([^"]*)"/g), (match) => [
      match[1],
      match[2],
    ]),
  );
  assert.notEqual(attributes["data-source-map-state"], "unmapped");
  assert.equal(attributes["data-source-map"], undefined);
  const start = Number(attributes["data-source-start"]);
  const end = Number(attributes["data-source-end"]);
  assert.ok(Number.isInteger(start) && Number.isInteger(end));
  assert.ok(start >= baseOffset && end <= baseOffset + source.length);
  const boundaryMap = (attribute: string): number[] => {
    const encoded = attributes[attribute];
    if (encoded === undefined) {
      assert.equal(
        end - start,
        text.length,
        "Identity span must preserve length",
      );
      return Array.from({ length: text.length + 1 }, (_, index) => index);
    }
    const map: unknown = JSON.parse(encoded.replaceAll("&quot;", '"'));
    assert.ok(Array.isArray(map));
    assert.equal(map.length, text.length + 1);
    for (let index = 0; index < map.length; index++) {
      assert.ok(Number.isInteger(map[index]));
      assert.ok(map[index] >= 0 && map[index] <= end - start);
      if (index > 0) assert.ok(map[index] >= map[index - 1]);
    }
    return map;
  };
  assert.equal(
    attributes["data-source-start-map"] === undefined,
    attributes["data-source-end-map"] === undefined,
    "Nonidentity spans must provide both boundary maps",
  );
  return {
    start,
    end,
    startMap: boundaryMap("data-source-start-map"),
    endMap: boundaryMap("data-source-end-map"),
  };
}

const selectionFixtures: Array<{
  name: string;
  source: string;
  text: string;
  selections: MappedSelection[];
  canonicalEnd?: number;
}> = [
  {
    name: "blockquote continuation",
    source: "> alpha\n> beta",
    text: "alpha\nbeta",
    selections: [
      [0, 5, 2, 7, "alpha"],
      [5, 6, 7, 8, "\n"],
      [6, 10, 10, 14, "beta"],
      [0, 10, 2, 14, "alpha\n> beta"],
    ],
  },
  {
    name: "tight list continuation",
    source: "- alpha\n  beta",
    text: "alpha\nbeta",
    selections: [
      [0, 5, 2, 7, "alpha"],
      [5, 6, 7, 8, "\n"],
      [6, 10, 10, 14, "beta"],
    ],
  },
  {
    name: "nested quote and list",
    source: "> - alpha\n>   beta",
    text: "alpha\nbeta",
    selections: [
      [0, 5, 4, 9, "alpha"],
      [5, 6, 9, 10, "\n"],
      [6, 10, 14, 18, "beta"],
    ],
  },
  {
    name: "duplicate words retain parser positions",
    source: "> same\n> same",
    text: "same\nsame",
    selections: [
      [0, 4, 2, 6, "same"],
      [5, 9, 9, 13, "same"],
    ],
  },
  {
    name: "CRLF continuation",
    source: "> alpha\r\n> beta",
    text: "alpha\nbeta",
    selections: [
      [5, 6, 7, 9, "\r\n"],
      [6, 10, 11, 15, "beta"],
    ],
  },
  {
    name: "indented code",
    source: "    alpha\n    beta",
    text: "alpha\nbeta\n",
    selections: [
      [0, 5, 4, 9, "alpha"],
      [5, 6, 9, 10, "\n"],
      [6, 10, 14, 18, "beta"],
      [6, 11, 14, 18, "beta"],
    ],
    canonicalEnd: 18,
  },
  {
    name: "tab-indented code",
    source: "\talpha\n\tbeta",
    text: "alpha\nbeta\n",
    selections: [
      [0, 5, 1, 6, "alpha"],
      [6, 10, 8, 12, "beta"],
      [6, 11, 8, 12, "beta"],
    ],
    canonicalEnd: 12,
  },
  {
    name: "fenced code in blockquote",
    source: "> ```\n> alpha\n> beta\n> ```",
    text: "alpha\nbeta\n",
    selections: [
      [0, 5, 8, 13, "alpha"],
      [5, 6, 13, 14, "\n"],
      [6, 10, 16, 20, "beta"],
      [6, 11, 16, 20, "beta"],
    ],
    canonicalEnd: 20,
  },
  {
    name: "inline code padding",
    source: "` alpha `",
    text: "alpha",
    selections: [[0, 5, 2, 7, "alpha"]],
  },
  {
    name: "inline code normalized line ending",
    source: "`alpha\r\nbeta`",
    text: "alpha beta",
    selections: [
      [0, 5, 1, 6, "alpha"],
      [5, 6, 6, 8, "\r\n"],
      [6, 10, 8, 12, "beta"],
    ],
  },
  {
    name: "escapes and named references",
    source: "A &amp; B \\* C",
    text: "A & B * C",
    selections: [
      [2, 3, 2, 7, "&amp;"],
      [6, 7, 10, 12, "\\*"],
    ],
  },
  {
    name: "numeric control reference",
    source: "&#128;",
    text: "\ufffd",
    selections: [[0, 1, 0, 6, "&#128;"]],
  },
  {
    name: "numeric emoji reference",
    source: "&#x1F600;",
    text: "😀",
    selections: [[0, 2, 0, 9, "&#x1F600;"]],
  },
];

for (const fixture of selectionFixtures) {
  test(`real Markdown selection boundaries: ${fixture.name}`, () => {
    const baseOffset = 37;
    const span = renderedSpan(fixture.source, fixture.text, baseOffset);
    for (const [
      from,
      to,
      expectedStart,
      expectedEnd,
      expectedQuote,
    ] of fixture.selections) {
      const start = span.start + span.startMap[from];
      const end = span.start + span.endMap[to];
      assert.deepEqual(
        [start, end],
        [baseOffset + expectedStart, baseOffset + expectedEnd],
      );
      assert.equal(
        fixture.source.slice(start - baseOffset, end - baseOffset),
        expectedQuote,
      );
    }
    if (fixture.canonicalEnd !== undefined) {
      assert.equal(
        span.start + span.startMap.at(-1)!,
        baseOffset + fixture.canonicalEnd,
      );
      assert.equal(
        span.start + span.endMap.at(-1)!,
        baseOffset + fixture.canonicalEnd,
      );
    }
  });
}

test("large-source planning work scales linearly", () => {
  const source = Array.from(
    { length: 1_000 },
    (_, index) => `## Section ${index}\n\n${"content ".repeat(18)}\n\n`,
  ).join("");
  const started = performance.now();
  const plan = createRenderPlan(source, "markdown");
  const elapsed = performance.now() - started;
  assert.equal(plan.chunks.map((chunk) => chunk.source).join(""), source);
  assert.ok(plan.chunks.length > 1);
  // This is a regression guard for accidental quadratic source scans; CI may
  // run on slower hardware, so the bound is intentionally generous.
  assert.ok(elapsed < 1_000, `render-plan scan took ${elapsed.toFixed(1)}ms`);
  assert.ok(plan.chunks.length < 100, "chunk count must stay bounded");
  assert.deepEqual(
    renderedTextOffsets("x &amp; y", "x & y"),
    [0, 1, 2, 7, 8, 9],
  );
});

test("focus projection touches only the source chunks containing the anchor", () => {
  const plan = createRenderPlan(
    Array.from(
      { length: 8 },
      (_, index) => `part-${index} ${"x".repeat(500)}\n\n`,
    ).join(""),
    "text",
    1_024,
  );
  const [first, second, third] = plan.chunks;
  assert.ok(first && second && third);
  const revisionId = RevisionId.parse("11111111-1111-4111-8111-111111111111");
  assert.deepEqual(
    focusChunkIndexes(plan.chunks, {
      revisionId,
      start: second.range.start,
      end: second.range.end,
      quote: second.source,
    }),
    [1],
  );
  assert.deepEqual(
    focusChunkIndexes(plan.chunks, {
      revisionId,
      start: first.range.end - 1,
      end: third.range.start + 1,
      quote: plan.chunks
        .slice(0, 3)
        .map((chunk) => chunk.source)
        .join("")
        .slice(-3),
    }),
    [0, 1, 2],
  );
});

test("selection corridor remains contiguous and reports the bounded tail", () => {
  assert.deepEqual(selectionCorridor(4, 8), {
    indexes: [4, 5, 6, 7, 8],
    exceeded: false,
  });
  assert.deepEqual(selectionCorridor(20, 1, 4), {
    indexes: [17, 18, 19, 20],
    exceeded: true,
  });
  assert.deepEqual(selectionCorridor(null, null), {
    indexes: [],
    exceeded: false,
  });
});
