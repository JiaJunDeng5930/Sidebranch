import { z } from "zod";
import { AnchorInput, DocumentId, Path, RevisionId } from "../domain/model";

export const ReaderContextSchema = z
  .object({
    document: z
      .object({
        documentId: DocumentId,
        revisionId: RevisionId,
        title: z.string(),
        path: Path,
      })
      .strict()
      .nullable(),
    selection: AnchorInput.extend({ documentId: DocumentId })
      .strict()
      .refine((value) => value.start < value.end)
      .nullable(),
  })
  .strict();

export type ReaderContext = z.infer<typeof ReaderContextSchema>;

export function readerContextKey(context: ReaderContext): string {
  return JSON.stringify(ReaderContextSchema.parse(context));
}

export function readerContextText(context: ReaderContext): string {
  const parts = context.document
    ? [
        `当前阅读文档：${context.document.title}（${context.document.path}）`,
        `文档 ID：${context.document.documentId}`,
        `版本 ID：${context.document.revisionId}`,
      ]
    : ["当前没有聚焦的阅读文档。"];
  if (context.selection)
    parts.push(
      `选区文档 ID：${context.selection.documentId}`,
      `选区版本 ID：${context.selection.revisionId}`,
      ...(context.selection.reader
        ? [
            `阅读模型版本：${context.selection.reader.version}`,
            `阅读模型选区片段（有序；start/end 为节点内 UTF-16 偏移）：${JSON.stringify(context.selection.reader.fragments)}`,
            `来源包络 UTF-16 范围：${context.selection.start}–${context.selection.end}`,
            "来源包络原文：",
            context.selection.quote,
          ]
        : [
            `选区 UTF-16 范围：${context.selection.start}–${context.selection.end}`,
          ]),
      "选中文字：",
      context.selection.reader?.preview ?? context.selection.quote,
    );
  return parts.join("\n");
}
