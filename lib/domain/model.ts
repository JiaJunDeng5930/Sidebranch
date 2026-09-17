import { z } from "zod";
export const DocumentId = z.string().uuid().brand<"DocumentId">();
export const RevisionId = z.string().uuid().brand<"RevisionId">();
export const AnchorId = z.string().uuid().brand<"AnchorId">();
export const ConnectionId = z.string().uuid().brand<"ConnectionId">();
export const QuestionId = z.string().uuid().brand<"QuestionId">();
export const AssetId = z.string().uuid().brand<"AssetId">();
export type DocumentId = z.infer<typeof DocumentId>;
export type RevisionId = z.infer<typeof RevisionId>;
export type AnchorId = z.infer<typeof AnchorId>;
export type ConnectionId = z.infer<typeof ConnectionId>;
export type QuestionId = z.infer<typeof QuestionId>;
export type AssetId = z.infer<typeof AssetId>;
export const Format = z.enum(["markdown", "text"]);
export const Content = z
  .string()
  .max(400_000)
  .refine(
    (s) => new TextEncoder().encode(s).length <= 1_000_000,
    "Document text exceeds 1 MB",
  );
export const Path = z
  .string()
  .min(2)
  .max(500)
  .refine(
    (p) =>
      p.startsWith("/") &&
      !p.endsWith("/") &&
      !p.includes("//") &&
      !/[\x00-\x1f\\]/.test(p) &&
      p.split("/").every((s) => s !== "." && s !== ".."),
    "Use an absolute path without . or .. segments",
  )
  .brand<"DocumentPath">();
export type DocumentPath = z.infer<typeof Path>;
export const Locator = z
  .object({ documentId: DocumentId.optional(), path: Path.optional() })
  .refine(
    (a) => Boolean(a.documentId) !== Boolean(a.path),
    "Specify exactly one of documentId or path",
  );
export const AnchorInput = z
  .object({
    revisionId: RevisionId,
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    quote: z.string().min(1).max(100_000),
  })
  .strict();
export type AnchorInput = z.infer<typeof AnchorInput>;
export interface DocumentSummary {
  id: DocumentId;
  path: DocumentPath;
  title: string;
  revisionId: RevisionId;
  sequence: number;
  format: z.infer<typeof Format>;
  createdAt: string;
  updatedAt: string;
  assetId: AssetId | null;
  archived: boolean;
}
export interface DocumentRevision extends DocumentSummary {
  content: string;
  parentId: RevisionId | null;
  isCurrent: boolean;
}
export interface Anchor extends AnchorInput {
  id: AnchorId;
  documentId: DocumentId;
}
export interface Connection {
  id: ConnectionId;
  from: Anchor;
  to: Anchor;
  relation:
    "reference" | "explanation" | "question" | "contrast" | "continuation";
  label: string;
  createdAt: string;
}
export interface Question {
  id: QuestionId;
  anchor: Anchor;
  body: string;
  createdAt: string;
  answers: DocumentId[];
}
export interface ReadingView {
  document: DocumentRevision;
  connections: Connection[];
  questions: Question[];
  documents: DocumentSummary[];
}
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
export function validateAnchor(content: string, input: AnchorInput): void {
  const { start, end, quote } = input;
  if (
    start >= end ||
    end > content.length ||
    content.slice(start, end) !== quote
  )
    throw new DomainError(
      "INVALID_ANCHOR",
      "The selected text does not match this revision. Read the revision again.",
    );
  for (const offset of [start, end])
    if (
      offset > 0 &&
      offset < content.length &&
      /[\uD800-\uDBFF]/.test(content[offset - 1]) &&
      /[\uDC00-\uDFFF]/.test(content[offset])
    )
      throw new DomainError(
        "INVALID_ANCHOR",
        "A selection cannot split a Unicode surrogate pair.",
      );
}
export function applyEdit(
  content: string,
  start: number,
  end: number,
  expected: string,
  replacement: string,
): string {
  if (
    start > end ||
    end > content.length ||
    content.slice(start, end) !== expected
  )
    throw new DomainError(
      "EDIT_MISMATCH",
      "The edit range does not match expected text.",
    );
  for (const offset of [start, end])
    if (
      offset > 0 &&
      offset < content.length &&
      /[\uD800-\uDBFF]/.test(content[offset - 1]) &&
      /[\uDC00-\uDFFF]/.test(content[offset])
    )
      throw new DomainError(
        "EDIT_MISMATCH",
        "An edit cannot split a Unicode surrogate pair.",
      );
  return Content.parse(
    content.slice(0, start) + replacement + content.slice(end),
  );
}
