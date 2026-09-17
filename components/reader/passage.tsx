"use client";
import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { renderedTextOffsets } from "../../lib/domain/text-offsets";
import type { AnchorInput, DocumentRevision } from "../../lib/domain/model";
// Every rendered text node retains source offsets. Markdown punctuation is never guessed from DOM text.
interface SourceNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: SourceNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}
function sourceSpans(source: string, focus?: AnchorInput | null) {
  return function plugin() {
    return (tree: SourceNode) => {
      function visit(node: SourceNode) {
        if (!node.children) return;
        node.children = node.children.flatMap((child) => {
          if (
            child.type === "text" &&
            child.position?.start.offset !== undefined &&
            child.position?.end.offset !== undefined
          ) {
            const start = child.position.start.offset,
              end = child.position.end.offset,
              value = child.value ?? "",
              raw = source.slice(start, end),
              map = renderedTextOffsets(raw, value);
            if (!map) return [child];
            const boundaries = [0, value.length];
            if (focus) {
              for (const offset of [focus.start - start, focus.end - start]) {
                const index = map.findIndex((n) => n >= offset);
                if (index > 0 && index < value.length) boundaries.push(index);
              }
            }
            boundaries.sort((a, b) => a - b);
            return boundaries.slice(0, -1).flatMap((from, i) => {
              const to = boundaries[i + 1];
              if (from === to) return [];
              const absoluteStart = start + map[from],
                absoluteEnd = start + map[to],
                relative = map.slice(from, to + 1).map((n) => n - map[from]);
              return [
                {
                  type: "element",
                  tagName: "span",
                  properties: {
                    "data-source-start": absoluteStart,
                    "data-source-end": absoluteEnd,
                    ...(raw !== value
                      ? { "data-source-map": JSON.stringify(relative) }
                      : {}),
                  },
                  children: [{ type: "text", value: value.slice(from, to) }],
                },
              ];
            });
          }
          visit(child);
          return [child];
        });
      }
      visit(tree);
    };
  };
}
export function selectionAnchor(
  root: HTMLElement,
  doc: DocumentRevision,
): AnchorInput | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const r = selection.getRangeAt(0);
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer))
    return null;
  function point(node: Node, offset: number, end: boolean): number | null {
    let el: HTMLElement | null =
      node.nodeType === Node.TEXT_NODE
        ? node.parentElement
        : (node as HTMLElement);
    let span = el?.closest<HTMLElement>("[data-source-start]");
    if (!span && el) {
      const child = el.childNodes[Math.max(0, end ? offset - 1 : offset)];
      const base =
        child?.nodeType === Node.TEXT_NODE
          ? child.parentElement
          : (child as HTMLElement | undefined);
      span =
        base?.closest?.("[data-source-start]") ??
        base?.querySelector?.("[data-source-start]") ??
        null;
      if (span) return Number(span.dataset[end ? "sourceEnd" : "sourceStart"]);
    }
    if (!span) return null;
    const start = Number(span.dataset.sourceStart),
      stop = Number(span.dataset.sourceEnd);
    const prefix = document.createRange();
    prefix.selectNodeContents(span);
    try {
      prefix.setEnd(node, offset);
    } catch {
      return null;
    }
    const index = prefix.toString().length;
    const mapped = span.dataset.sourceMap;
    if (mapped) {
      const offsets = JSON.parse(mapped) as number[];
      return start + (offsets[index] ?? (end ? stop - start : 0));
    }
    return Math.min(stop, start + index);
  }
  const start = point(r.startContainer, r.startOffset, false),
    end = point(r.endContainer, r.endOffset, true);
  if (start === null || end === null || start >= end) return null;
  return {
    revisionId: doc.revisionId,
    start,
    end,
    quote: doc.content.slice(start, end),
  };
}
export function Passage({
  doc,
  onSelect,
  focus,
}: {
  doc: DocumentRevision;
  onSelect: (anchor: AnchorInput, rect: DOMRect) => void;
  focus?: AnchorInput | null;
}) {
  const currentFocus = focus?.revisionId === doc.revisionId ? focus : null;
  const plugins = useMemo(
    () => [sourceSpans(doc.content, currentFocus)],
    [doc.content, currentFocus],
  );
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root
      .querySelectorAll(".passage-focus")
      .forEach((n) => n.classList.remove("passage-focus"));
    if (focus?.revisionId !== doc.revisionId) return;
    const spans = Array.from(
      root.querySelectorAll<HTMLElement>("[data-source-start]"),
    );
    const marked = spans.filter(
      (el) =>
        Number(el.dataset.sourceStart) < focus.end &&
        Number(el.dataset.sourceEnd) > focus.start,
    );
    marked.forEach((el) => el.classList.add("passage-focus"));
    marked[0]?.scrollIntoView({ block: "center" });
  }, [focus, doc.revisionId]);
  function capture() {
    const root = ref.current;
    if (!root) return;
    const anchor = selectionAnchor(root, doc);
    if (anchor) {
      const r = window.getSelection()?.getRangeAt(0);
      if (r) onSelect(anchor, r.getBoundingClientRect());
    }
  }
  return (
    <div
      ref={ref}
      className="document-content"
      onPointerUp={capture}
      onKeyUp={(e) => {
        if (e.key === "Shift") capture();
      }}
    >
      {doc.format === "text" ? (
        <div className="plain-text">
          {currentFocus ? (
            <>
              <span data-source-start="0" data-source-end={currentFocus.start}>
                {doc.content.slice(0, currentFocus.start)}
              </span>
              <span
                data-source-start={currentFocus.start}
                data-source-end={currentFocus.end}
              >
                {doc.content.slice(currentFocus.start, currentFocus.end)}
              </span>
              <span
                data-source-start={currentFocus.end}
                data-source-end={doc.content.length}
              >
                {doc.content.slice(currentFocus.end)}
              </span>
            </>
          ) : (
            <span data-source-start="0" data-source-end={doc.content.length}>
              {doc.content}
            </span>
          )}
        </div>
      ) : (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={plugins}
          components={{
            img: ({ alt }) => (
              <span className="image-note">[图片：{alt ?? "图片"}]</span>
            ),
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            ),
          }}
        >
          {doc.content}
        </ReactMarkdown>
      )}
    </div>
  );
}
