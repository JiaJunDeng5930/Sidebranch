"use client";

import React, { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { renderedTextOffsets } from "../../lib/domain/text-offsets";
import { markdownSourceMapper } from "../../lib/reader/markdown-source-map";

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

function offsetRange(node: SourceNode): SourceRange | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return Number.isInteger(start) && Number.isInteger(end) && start! <= end!
    ? { start: start!, end: end! }
    : null;
}

/**
 * Attach source coordinates to every selectable text node in a HAST tree.
 * The plugin is intentionally independent of focus and marks; those states
 * are applied to already-mounted spans by Passage effects.
 */
export function sourceSpansPlugin(source: string, baseOffset = 0, parserSource = source) {
  return function sourceSpansTransformer() {
    return (tree: SourceNode) => {
      const mapping = markdownSourceMapper(parserSource, source.length);
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
            // HTML parsing normalizes newlines; client React text must use the same coordinates.
            const value = (child.value ?? "").replace(/\r\n?/g, "\n");
            child.value = value;
            const positioned =
              child.position?.start.offset !== undefined &&
              child.position?.end.offset !== undefined;

            const flow = node.tagName === "code" && !positioned;
            const localRange = offsetRange(child) ?? nextContext;
            if (!localRange || (!positioned && !flow)) return [child];
            const map = mapping(value, localRange, flow ? "flow-code" : node.tagName === "code" ? "inline-code" : "text", flow);
            const localStart = map?.start ?? localRange.start;
            const localEnd = map?.end ?? localRange.end;
            const properties: Record<string, unknown> = {
              "data-source-start": baseOffset + localStart,
              "data-source-end": baseOffset + localEnd,
              "data-source-node-start": baseOffset + (nextContext ?? localRange).start,
              "data-source-node-end": baseOffset + (nextContext ?? localRange).end,
              "data-source-rendered-length": value.length,
            };
            if (!map) properties["data-source-map-state"] = "unmapped";
            else if (map.starts.some((offset, index) => offset !== index) || map.ends.some((offset, index) => offset !== index)) {
              properties["data-source-start-map"] = JSON.stringify(map.starts);
              properties["data-source-end-map"] = JSON.stringify(map.ends);
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
    () => [sourceSpansPlugin(source, sourceStart, parserSource)],
    [source, sourceStart, parserSource],
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
            ? { "data-source-start-map": JSON.stringify(map), "data-source-end-map": JSON.stringify(map) }
            : { "data-source-map-state": "unmapped" })}
        data-source-node-start={sourceStart}
        data-source-node-end={sourceEnd}
      >
        {rendered}
      </span>
    </div>
  );
});
