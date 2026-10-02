"use client";
import React, { memo, useMemo } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import type { SourceOffset } from "../../lib/reader/render-markdown";
import {
  createReaderChunkModel,
  type ReaderChunkModel,
} from "../../lib/reader/document-model";

export interface DocumentMarkdownChunkProps {
  source: string;
  sourceStart: number;
  sourceEnd: number;
  chunkIndex: number;
  referenceDefinitions?: readonly string[];
  model?: ReaderChunkModel;
}
export type DocumentTextChunkProps = DocumentMarkdownChunkProps;
function Chunk({
  source,
  sourceStart,
  sourceEnd,
  chunkIndex,
  referenceDefinitions,
  model,
  plain,
}: DocumentMarkdownChunkProps & { plain?: boolean }) {
  const chunk = useMemo(
    () =>
      model ??
      createReaderChunkModel(
        {
          source,
          range: {
            start: sourceStart as SourceOffset,
            end: sourceEnd as SourceOffset,
          },
          index: chunkIndex,
          referenceDefinitions,
        },
        plain ? "text" : "markdown",
      ),
    [
      model,
      source,
      sourceStart,
      sourceEnd,
      chunkIndex,
      referenceDefinitions,
      plain,
    ],
  );
  return (
    <div
      className={plain ? "document-chunk plain-text" : "document-chunk"}
      style={plain ? undefined : { display: "flow-root" }}
      data-document-chunk-index={chunkIndex}
      data-source-chunk-start={sourceStart}
      data-source-chunk-end={sourceEnd}
    >
      {toJsxRuntime(chunk.tree, { Fragment, jsx, jsxs })}
    </div>
  );
}
export const DocumentMarkdownChunk = memo(function DocumentMarkdownChunk(
  props: DocumentMarkdownChunkProps,
) {
  return <Chunk {...props} />;
});
export const DocumentTextChunk = memo(function DocumentTextChunk(
  props: DocumentTextChunkProps,
) {
  return <Chunk {...props} plain />;
});
