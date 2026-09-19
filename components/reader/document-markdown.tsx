"use client";

import React, { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  isValidRenderedTextOffsets,
  renderedTextOffsets,
} from "../../lib/domain/text-offsets";
import { RendererMappingError } from "../../lib/reader/render-markdown";

interface Position {
  start: { offset?: number };
  end: { offset?: number };
}

interface SourceNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: SourceNode[];
  position?: Position;
}

interface SourceRange {
  start: number;
  end: number;
}

const BLOCK_TAGS = new Set([
  "blockquote",
  "code",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "ol",
  "p",
  "pre",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

function generatedCodeRange(
  source: string,
  context: SourceRange | null,
  rendered: string,
): { range: SourceRange; raw: string } | null {
  if (!context) return null;
  const block = source.slice(context.start, context.end);
  const opening = /^ {0,3}(`{3,}|~{3,})[^\r\n]*(?:\r\n|\r|\n|$)/.exec(block);
  if (!opening) return null;
  const bodyStart = context.start + opening[0].length;
  const closing = new RegExp(
    `^ {0,3}${opening[1][0]}{${opening[1].length},}[^\\r\\n]*(?:\\r?\\n|$)`,
    "m",
  ).exec(block.slice(opening[0].length));
  const bodyEnd = closing ? bodyStart + closing.index : context.end;
  const raw = source.slice(bodyStart, bodyEnd);
  const map = renderedTextOffsets(raw, rendered);
  return map ? { range: { start: bodyStart, end: bodyEnd }, raw } : null;
}

function offsetRange(node: SourceNode): SourceRange | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return Number.isInteger(start) && Number.isInteger(end) && start! <= end!
    ? { start: start!, end: end! }
    : null;
}

function escapedMap(map: readonly number[]): string {
  return JSON.stringify(map);
}

/**
 * Attach source coordinates to every selectable text node in a HAST tree.
 * The plugin is intentionally independent of focus and marks; those states
 * are applied to already-mounted spans by Passage effects.
 */
export function sourceSpansPlugin(source: string, baseOffset = 0) {
  return function sourceSpansTransformer() {
    return (tree: SourceNode) => {
      function visit(
        node: SourceNode,
        context: SourceRange | null,
        parentTag: string | null = null,
      ): void {
        if (!node.children) return;
        const nodeRange = offsetRange(node);
        const nextContext =
          node.type === "element" &&
          (BLOCK_TAGS.has(node.tagName ?? "") || node.tagName === "a")
            ? (nodeRange ?? context)
            : context;
        node.children = node.children.flatMap((child) => {
          if (child.type === "text") {
            const value = child.value ?? "";
            const positioned =
              child.position?.start.offset !== undefined &&
              child.position?.end.offset !== undefined;

            const generated =
              !positioned && (parentTag === "code" || parentTag === "pre")
                ? generatedCodeRange(source, context, value)
                : null;
            if (!positioned && !generated) return [child];
            const localStart = positioned
              ? child.position!.start.offset!
              : (generated?.range.start ?? context?.start ?? 0);
            const localEnd = positioned
              ? child.position!.end.offset!
              : (generated?.range.end ??
                context?.end ??
                localStart + value.length);
            const raw = generated?.raw ?? source.slice(localStart, localEnd);
            const identity = raw === value;
            const map = identity ? null : renderedTextOffsets(raw, value);
            const sourceStart = baseOffset + localStart;
            const sourceEnd = baseOffset + localEnd;
            const range = context ?? { start: localStart, end: localEnd };
            const properties: Record<string, unknown> = {
              "data-source-start": sourceStart,
              "data-source-end": sourceEnd,
              "data-source-node-start": baseOffset + range.start,
              "data-source-node-end": baseOffset + range.end,
              "data-source-rendered-length": value.length,
            };
            if (identity) {
              // Equal source and rendered text proves the affine offset map;
              // do not allocate or serialize one integer for every character.
            } else if (
              map &&
              isValidRenderedTextOffsets(map, value.length, raw.length)
            ) {
              if (
                map.some((offset) => !Number.isInteger(offset)) ||
                map[0] < 0 ||
                map[map.length - 1] > raw.length
              )
                throw new RendererMappingError("Invalid Markdown text map");
              properties["data-source-map"] = escapedMap(map);
            } else {
              // The span remains inspectable for geometry, but selectionAnchor
              // rejects it instead of guessing when Markdown produced a text
              // transformation this mapper does not know.
              properties["data-source-map-state"] = "unmapped";
            }
            return [
              {
                type: "element",
                tagName: "span",
                properties,
                children: [{ type: "text", value }],
              } satisfies SourceNode,
            ];
          }
          visit(child, nextContext, node.tagName ?? parentTag);
          return [child];
        });
      }
      visit(tree, null);
    };
  };
}

const REMARK_PLUGINS = [remarkGfm];

const markdownComponents = {
  img: ({ alt }: { alt?: string | null }) => (
    <span className="image-note">[图片：{alt ?? "图片"}]</span>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
};

export interface DocumentMarkdownChunkProps {
  source: string;
  sourceStart: number;
  sourceEnd: number;
  chunkIndex: number;
  referenceDefinitions?: readonly string[];
}

/** A memoized Markdown block. Parsing occurs only when this source chunk changes. */
export const DocumentMarkdownChunk = memo(function DocumentMarkdownChunk({
  source,
  sourceStart,
  sourceEnd,
  chunkIndex,
  referenceDefinitions,
}: DocumentMarkdownChunkProps) {
  const parserSource = useMemo(
    () =>
      referenceDefinitions?.length
        ? `${source}\n\n${referenceDefinitions.join("\n\n")}`
        : source,
    [referenceDefinitions, source],
  );
  const rehypePlugins = useMemo(
    () => [sourceSpansPlugin(source, sourceStart)],
    [source, sourceStart],
  );
  return (
    <div
      className="document-chunk"
      style={{ display: "flow-root" }}
      data-document-chunk-index={chunkIndex}
      data-source-chunk-start={sourceStart}
      data-source-chunk-end={sourceEnd}
    >
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={rehypePlugins}
        components={markdownComponents}
      >
        {parserSource}
      </ReactMarkdown>
    </div>
  );
});

export interface DocumentTextChunkProps {
  source: string;
  sourceStart: number;
  sourceEnd: number;
  chunkIndex: number;
  referenceDefinitions?: readonly string[];
}

export const DocumentTextChunk = memo(function DocumentTextChunk({
  source,
  sourceStart,
  sourceEnd,
  chunkIndex,
}: DocumentTextChunkProps) {
  const rendered = source.replace(/\r\n?/g, "\n");
  const identity = source === rendered;
  const map = identity ? null : renderedTextOffsets(source, rendered);
  return (
    <div
      className="document-chunk plain-text"
      data-document-chunk-index={chunkIndex}
      data-source-chunk-start={sourceStart}
      data-source-chunk-end={sourceEnd}
    >
      <span
        data-source-start={sourceStart}
        data-source-end={sourceEnd}
        data-source-rendered-length={rendered.length}
        {...(identity
          ? {}
          : map
            ? { "data-source-map": JSON.stringify(map) }
            : { "data-source-map-state": "unmapped" })}
        data-source-node-start={sourceStart}
        data-source-node-end={sourceEnd}
      >
        {rendered}
      </span>
    </div>
  );
});
