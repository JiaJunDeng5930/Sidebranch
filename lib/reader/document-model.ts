import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import { defaultUrlTransform } from "react-markdown";
import type { toJsxRuntime } from "hast-util-to-jsx-runtime";
import {
  ReaderSelectorSchema,
  type DocumentFormat,
  type ReaderSelector,
} from "../domain/model";
import { createRenderPlan, type RenderChunk, type RenderPlan, type SourceRange } from "./render-markdown";

export const READER_MODEL_VERSION = "reader-v1" as const;

type HastNode = Parameters<typeof toJsxRuntime>[0];
type HastRoot = Extract<HastNode, { type: "root" }>;
type HastElement = Extract<HastNode, { type: "element" }>;
type Origin = ReaderModelNode["origin"];

export interface ReaderModelNode {
  id: string;
  kind: "text" | "atom";
  value: string;
  length: number;
  chunkIndex: number;
  origin: { kind: "direct" | "transformed" | "generated"; start: number; end: number };
}

export interface ReaderChunkModel {
  index: number;
  range: SourceRange;
  tree: HastRoot;
  nodes: readonly ReaderModelNode[];
}

export interface ReaderDocumentModel {
  content: string;
  format: DocumentFormat;
  plan: RenderPlan;
  getChunk(index: number): ReaderChunkModel;
  getNode(nodeId: string): ReaderModelNode;
}

const STRUCTURAL_CONTAINERS = new Set([
  "table", "thead", "tbody", "tfoot", "tr", "colgroup", "ul", "ol",
]);
const BLOCK_ELEMENTS = new Set([
  "blockquote", "code", "h1", "h2", "h3", "h4", "h5", "h6", "li", "ol",
  "p", "pre", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
]);
const ATOM_ELEMENTS = new Set(["hr", "br", "input"]);
const processor = unified().use(remarkParse).use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true });

function nodeIndexes(nodeId: string): { chunk: number; node: number } {
  const match = /^c(0|[1-9][0-9]*):n(0|[1-9][0-9]*)$/.exec(nodeId);
  if (!match) throw new Error(`Invalid reader node ID: ${nodeId}`);
  const chunk = Number(match[1]), node = Number(match[2]);
  if (!Number.isSafeInteger(chunk) || !Number.isSafeInteger(node))
    throw new Error(`Reader node ID exceeds integer range: ${nodeId}`);
  return { chunk, node };
}

export function readerChunkIndex(nodeId: string): number {
  return nodeIndexes(nodeId).chunk;
}

function positionRange(node: HastNode, length: number): { start: number; end: number } | null {
  const start = node.position?.start.offset, end = node.position?.end.offset;
  return Number.isInteger(start) && Number.isInteger(end) && start! >= 0 &&
    start! < end! && end! <= length ? { start: start!, end: end! } : null;
}

export function createReaderChunkModel(chunk: RenderChunk, format: DocumentFormat): ReaderChunkModel {
  const index = chunk.index;
  if (!Number.isInteger(index) || index < 0) throw new Error(`Invalid reader chunk: ${index}`);
  const parserSource = chunk.referenceDefinitions?.length
    ? `${chunk.source}\n\n${chunk.referenceDefinitions.join("\n\n")}` : chunk.source;
  const tree: HastRoot = format === "markdown"
    ? processor.runSync(processor.parse(parserSource)) as HastRoot
    : { type: "root", children: chunk.source.length ? [{
      type: "text", value: chunk.source.replace(/\r\n?/g, "\n"),
      position: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: chunk.source.length } },
    }] : [] };
  const nodes: ReaderModelNode[] = [];
  const rootRange = { start: 0, end: chunk.source.length };

  function visit(parent: HastRoot | HastElement, inherited: { start: number; end: number }, block: { start: number; end: number } | null, link: { start: number; end: number } | null): void {
    const own = positionRange(parent, chunk.source.length);
    const semantic = own ?? inherited;
    const nextBlock = parent.type === "element" && BLOCK_ELEMENTS.has(parent.tagName) ? semantic : block;
    const nextLink = parent.type === "element" && parent.tagName === "a" ? semantic : link;
    const children: HastRoot["children"] = [];
    for (const original of parent.children) {
      let child: HastRoot["children"][number] = original;
      if (child.type === "raw") child = { type: "text", value: child.value, position: child.position };
      if (child.type === "element" && child.tagName === "img") {
        child = {
          type: "element", tagName: "span", properties: { className: ["image-note"] },
          position: child.position,
          children: [{ type: "text", value: `[图片：${child.properties.alt ?? "图片"}]`, position: child.position }],
        };
      }
      if (child.type === "text") {
        if (!child.position && /^\s*$/.test(child.value) &&
          (parent.type === "root" || STRUCTURAL_CONTAINERS.has(parent.tagName))) continue;
        const value = child.value.replace(/\r\n?/g, "\n");
        if (!value.length) continue;
        const childRange = positionRange(child, chunk.source.length);
        const local = childRange ?? semantic;
        const origin = originFor(local, childRange !== null, value);
        const model = addNode("text", value, origin);
        children.push({
          type: "element", tagName: "span", properties: propertiesFor(model, nextBlock, nextLink),
          children: [{ type: "text", value }],
        });
      } else if (child.type === "element") {
        if (child.tagName === "a") child.properties = {
          href: defaultUrlTransform(String(child.properties.href ?? "")),
          target: "_blank", rel: ["noreferrer", "noopener"],
        };
        if (ATOM_ELEMENTS.has(child.tagName)) {
          const childRange = positionRange(child, chunk.source.length);
          const model = addNode("atom", "", originFor(childRange ?? semantic, childRange !== null, null));
          Object.assign(child.properties, propertiesFor(model, nextBlock, nextLink));
        }
        visit(child, semantic, nextBlock, nextLink);
        children.push(child);
      } else children.push(child);
    }
    parent.children = children;
  }

  function originFor(local: { start: number; end: number }, positioned: boolean, value: string | null): Origin {
    // Parser-only reference definitions never become canonical coordinates:
    // positionRange excludes appended input, leaving the semantic ancestor.
    if (local.start >= local.end) throw new Error("Selectable reader node has no semantic origin");
    const start = chunk.range.start + local.start, end = chunk.range.start + local.end;
    return { kind: positioned ? value !== null && chunk.source.slice(local.start, local.end) === value ? "direct" : "transformed" : "generated", start, end };
  }
  function addNode(kind: ReaderModelNode["kind"], value: string, origin: Origin): ReaderModelNode {
    const model: ReaderModelNode = { id: `c${index}:n${nodes.length}`, kind, value, length: kind === "atom" ? 1 : value.length, chunkIndex: index, origin };
    nodes.push(model);
    return model;
  }
  function propertiesFor(model: ReaderModelNode, block: { start: number; end: number } | null, link: { start: number; end: number } | null): HastElement["properties"] {
    return {
      "data-reader-node-id": model.id,
      "data-reader-node-kind": model.kind,
      "data-reader-chunk-index": index,
      "data-reader-source-kind": model.origin.kind,
      "data-source-start": model.origin.start,
      "data-source-end": model.origin.end,
      "data-rendered-length": model.length,
      ...(block ? { "data-source-block-start": chunk.range.start + block.start, "data-source-block-end": chunk.range.start + block.end } : {}),
      ...(link ? { "data-source-link-start": chunk.range.start + link.start, "data-source-link-end": chunk.range.start + link.end } : {}),
    };
  }
  visit(tree, rootRange, null, null);
  return { index, range: chunk.range, tree, nodes };
}

export function createReaderDocumentModel(content: string, format: DocumentFormat): ReaderDocumentModel {
  const plan = createRenderPlan(content, format);
  const cache = new Map<number, ReaderChunkModel>();
  const model: ReaderDocumentModel = {
    content, format, plan,
    getChunk(index) {
      let chunk = cache.get(index);
      if (!chunk) {
        const sourceChunk = plan.chunks[index];
        if (!sourceChunk || !Number.isInteger(index)) throw new Error(`Invalid reader chunk: ${index}`);
        chunk = createReaderChunkModel(sourceChunk, format);
        cache.set(index, chunk);
      }
      return chunk;
    },
    getNode(nodeId) {
      const indexes = nodeIndexes(nodeId);
      const node = model.getChunk(indexes.chunk).nodes[indexes.node];
      if (!node || node.id !== nodeId) throw new Error(`Unknown reader node: ${nodeId}`);
      return node;
    },
  };
  return model;
}

export function validateReaderSelector(model: ReaderDocumentModel, reader: ReaderSelector): ReaderSelector {
  const checked = ReaderSelectorSchema.parse(reader);
  let previous: { chunk: number; node: number } | null = null;
  for (const fragment of checked.fragments) {
    const indexes = nodeIndexes(fragment.nodeId);
    const node = model.getNode(fragment.nodeId);
    if (fragment.end > node.length) throw new Error(`Reader fragment exceeds node: ${node.id}`);
    if (previous && (indexes.chunk < previous.chunk ||
      (indexes.chunk === previous.chunk && indexes.node <= previous.node)))
      throw new Error("Reader fragments must follow model order without repeated nodes");
    previous = indexes;
  }
  return checked;
}

export function readerSelectionText(model: ReaderDocumentModel, reader: ReaderSelector): string {
  return validateReaderSelector(model, reader).fragments.map((fragment) =>
    model.getNode(fragment.nodeId).value.slice(fragment.start, fragment.end)).join("");
}

function sourceSplitsSurrogate(content: string, offset: number): boolean {
  return offset > 0 && offset < content.length &&
    content.charCodeAt(offset - 1) >= 0xd800 && content.charCodeAt(offset - 1) <= 0xdbff &&
    content.charCodeAt(offset) >= 0xdc00 && content.charCodeAt(offset) <= 0xdfff;
}

export function sourceEnvelopeForReaderSelector(model: ReaderDocumentModel, reader: ReaderSelector): { start: number; end: number; quote: string } {
  // A provenance envelope is deliberately coarse for generated/transformed
  // text. The reader fragments, not this source interval, identify selection.
  let start = model.content.length, end = 0;
  for (const fragment of validateReaderSelector(model, reader).fragments) {
    const node = model.getNode(fragment.nodeId);
    start = Math.min(start, node.origin.start + (node.origin.kind === "direct" ? fragment.start : 0));
    end = Math.max(end, node.origin.kind === "direct" ? node.origin.start + fragment.end : node.origin.end);
  }
  if (sourceSplitsSurrogate(model.content, start)) start--;
  if (sourceSplitsSurrogate(model.content, end)) end++;
  if (start >= end || start < 0 || end > model.content.length)
    throw new Error("Reader selection has no valid source provenance envelope");
  return { start, end, quote: model.content.slice(start, end) };
}
