import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { DocumentMarkdownChunk, DocumentTextChunk } from "../components/reader/document-markdown";
import { register } from "node:module";
// Node's DOM harness has no CSS renderer; the actual component code still runs.
register("data:text/javascript," + encodeURIComponent('export async function load(url, context, next) { if (url.endsWith(".css")) return {format:"module",source:"export default {}",shortCircuit:true}; return next(url, context); }'), import.meta.url);
const { selectionAnchor } = await import("../components/reader/passage");
import { readerRanges, sourceRanges } from "../lib/reader/render-dom";
import { createReaderDocumentModel, validateReaderSelector } from "../lib/reader/document-model";
import { AnchorInput as AnchorInputSchema, ReaderSelectorSchema, RevisionId } from "../lib/domain/model";
import type { DocumentRevision } from "../lib/domain/model";

const revisionId = RevisionId.parse("11111111-1111-4111-8111-111111111111");
function fixture(content: string, format: "markdown" | "text" = "markdown", mounted?: number[]) {
  const model = createReaderDocumentModel(content, format);
  const html = model.plan.chunks.filter((chunk) => !mounted || mounted.includes(chunk.index)).map((chunk) => renderToStaticMarkup(React.createElement(format === "markdown" ? DocumentMarkdownChunk : DocumentTextChunk, {
    source: chunk.source, sourceStart: chunk.range.start, sourceEnd: chunk.range.end,
    chunkIndex: chunk.index, referenceDefinitions: chunk.referenceDefinitions, model: model.getChunk(chunk.index),
  }))).join('<div data-source-gap-start="1" data-source-gap-end="2"></div>');
  const dom = new JSDOM(`<section data-revision-id="${revisionId}"><div data-reader-body>${html}</div></section>`);
  const root = dom.window.document.querySelector<HTMLElement>("section")!;
  const doc = { content, format, revisionId } as DocumentRevision;
  function activate() {
    for (const key of ["window", "document", "Node", "Text", "HTMLElement", "Range", "NodeFilter"] as const)
      Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
  }
  function text(value: string, occurrence = 0): Text {
    const walker = dom.window.document.createTreeWalker(root, dom.window.NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) if (node.textContent === value && occurrence-- === 0) return node as Text;
    assert.fail(`Missing rendered text ${JSON.stringify(value)}`);
  }
  function capture(range: Range, expected: string) {
    activate();
    const selection = dom.window.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
    assert.equal(selection.toString(), expected);
    const anchor = selectionAnchor(root, doc, model);
    assert.ok(anchor?.reader);
    assert.equal(anchor.reader.preview, expected);
    assert.deepEqual(ReaderSelectorSchema.parse(anchor.reader), anchor.reader);
    validateReaderSelector(model, anchor.reader);
    AnchorInputSchema.parse(anchor);
    assert.equal(anchor.quote, content.slice(anchor.start, anchor.end));
    const fresh = fixture(content, format, mounted); fresh.activate();
    const restored = readerRanges(fresh.root, anchor.reader, fresh.model);
    assert.equal(restored.map((r) => r.toString()).join(""), expected);
    assert.deepEqual(sourceRanges(fresh.root, anchor, fresh.model).map((r) => r.toString()), restored.map((r) => r.toString()));
    for (const fragment of anchor.reader.fragments) {
      const bound = fresh.root.querySelector(`[data-reader-node-id="${fragment.nodeId}"]`);
      assert.ok(bound, fragment.nodeId);
      if (model.getNode(fragment.nodeId).kind === "text")
        assert.equal(bound.textContent!.slice(fragment.start, fragment.end), model.getNode(fragment.nodeId).value.slice(fragment.start, fragment.end));
    }
    return anchor;
  }
  function coverage() {
    const walker = dom.window.document.createTreeWalker(root.querySelector("[data-reader-body]")!, dom.window.NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const owners = [];
      for (let parent = node.parentElement; parent && parent !== root; parent = parent.parentElement)
        if (parent.hasAttribute("data-reader-node-id")) owners.push(parent);
      assert.equal(owners.length, 1, `Unbound/multiply bound text ${JSON.stringify(node.textContent)}`);
      const modelNode = model.getNode(owners[0].dataset.readerNodeId!);
      assert.equal(modelNode.kind, "text");
      assert.equal(owners[0].textContent, modelNode.value);
    }
  }
  return { dom, root, model, doc, activate, text, capture, coverage };
}

const fixtures = [
  { name: "entity, emoji, and escape", source: "A &amp; &#x1F600; \\* end", text: "A & 😀 * end", from: 2, to: 8, selected: "& 😀 *" },
  { name: "padded inline code", source: "` alpha `", text: "alpha", from: 0, to: 5, selected: "alpha" },
  { name: "normalized inline code", source: "`alpha\r\nbeta`", text: "alpha beta", from: 5, to: 6, selected: " " },
  { name: "indented code", source: "    alpha\n    beta", text: "alpha\nbeta\n", from: 6, to: 10, selected: "beta" },
  { name: "fenced code generated trailing LF", source: "```\nalpha\n```", text: "alpha\n", from: 5, to: 6, selected: "\n" },
  { name: "image generated prefix", source: "![cat](cat.png)", text: "[图片：cat]", from: 0, to: 4, selected: "[图片：" },
  { name: "image alt", source: "![cat](cat.png)", text: "[图片：cat]", from: 4, to: 7, selected: "cat" },
  { name: "image closing bracket", source: "![cat](cat.png)", text: "[图片：cat]", from: 7, to: 8, selected: "]" },
  { name: "whitespace only", source: "x   y", text: "x   y", from: 1, to: 4, selected: "   " },
  { name: "CRLF text", source: "alpha\r\nbeta", format: "text" as const, text: "alpha\nbeta", from: 5, to: 6, selected: "\n" },
  { name: "footnote number", source: "Word[^a]\n\n[^a]: Note", text: "1", from: 0, to: 1, selected: "1" },
  { name: "footnote title", source: "Word[^a]\n\n[^a]: Note", text: "Footnotes", from: 0, to: 9, selected: "Footnotes" },
  { name: "footnote backreference", source: "Word[^a]\n\n[^a]: Note", text: "↩", from: 0, to: 1, selected: "↩" },
];
for (const value of fixtures) test(`native selection survives fresh render: ${value.name}`, () => {
  const f = fixture(value.source, value.format); f.coverage();
  const text = f.text(value.text), range = f.dom.window.document.createRange();
  range.setStart(text, value.from); range.setEnd(text, value.to);
  const anchor = f.capture(range, value.selected);
  assert.equal(anchor.reader!.fragments.length, 1);
  assert.deepEqual([anchor.reader!.fragments[0].start, anchor.reader!.fragments[0].end], [value.from, value.to]);
});

test("identical phrases and reversed native selection retain second occurrence", () => {
  const f = fixture("repeat\n\nrepeat"); f.coverage(); f.activate();
  const second = f.text("repeat", 1), range = f.dom.window.document.createRange(); range.selectNodeContents(second);
  const anchor = f.capture(range, "repeat");
  assert.ok(anchor.reader!.fragments[0].nodeId !== f.text("repeat").parentElement!.dataset.readerNodeId);
  f.activate(); const selection = f.dom.window.getSelection()!;
  selection.setBaseAndExtent(second, 6, second, 0);
  const reversed = selectionAnchor(f.root, f.doc, f.model);
  assert.deepEqual(reversed, anchor);
});

test("element boundaries cross formatting, GFM lists, table and blockquote", () => {
  for (const { source, selector, expected } of [
    { source: "alpha **beta** gamma", selector: "p", expected: "alpha beta gamma" },
    { source: "- alpha\n- beta", selector: "ul", expected: "alphabeta" },
    { source: "> alpha **beta**", selector: "blockquote > p", expected: "alpha beta" },
    { source: "| alpha | beta |\n| --- | --- |\n| gamma | delta |", selector: "table", expected: "alphabetagammadelta" },
  ]) {
    const f = fixture(source); f.coverage();
    const container = f.root.querySelector(selector);
    assert.ok(container);
    assert.equal(container.textContent, expected);
    const range = f.dom.window.document.createRange(); range.selectNodeContents(container);
    f.capture(range, expected);
  }
});

test("nontext atoms are selectable model positions", () => {
  for (const [source, tag] of [["alpha  \nbeta", "br"], ["---", "hr"], ["- [x] done", "input"]]) {
    const f = fixture(source); f.coverage();
    const atom = f.root.querySelector(tag)!, range = f.dom.window.document.createRange(); assert.ok(atom); range.selectNode(atom);
    const anchor = f.capture(range, "");
    assert.deepEqual(anchor.reader!.fragments.map(({ start, end }) => [start, end]), [[0, 1]]);
  }
});

test("raw HTML and unsafe URLs preserve escaped text and safe links", () => {
  const f = fixture('<b>raw</b> [bad](javascript:alert%281%29)'); f.coverage();
  assert.equal(f.root.querySelector("b"), null);
  assert.equal(f.root.querySelector("a")!.getAttribute("href"), "");
  assert.equal(f.root.textContent, "<b>raw</b> bad");
});

test("virtual gap captures only mounted visible fragments", () => {
  const source = Array.from({ length: 15 }, (_, i) => `Paragraph ${i} ${"x".repeat(700)}\n\n`).join("");
  const complete = createReaderDocumentModel(source, "markdown"), last = complete.plan.chunks.length - 1;
  assert.ok(last > 1);
  const f = fixture(source, "markdown", [0, last]); f.coverage();
  const range = f.dom.window.document.createRange(); range.selectNodeContents(f.root.querySelector("[data-reader-body]")!);
  const anchor = f.capture(range, f.root.textContent!);
  assert.ok(anchor.quote.length > anchor.reader!.preview.length);
  assert.ok(anchor.reader!.fragments.every((fragment) => fragment.nodeId.startsWith("c0:") || fragment.nodeId.startsWith(`c${last}:`)));
});

test("one code character remains selectable with a source envelope exceeding 100000", () => {
  const source = "```\n" + "x".repeat(100_101) + "\n```";
  const f = fixture(source), text = f.text("x".repeat(100_101) + "\n"), range = f.dom.window.document.createRange();
  range.setStart(text, 50_000); range.setEnd(text, 50_001);
  const anchor = f.capture(range, "x");
  assert.ok(anchor.quote.length > 100_000);
});
