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

export const PositiveInt = z.number().int().positive().brand<"PositiveInt">();
export type PositiveInt = z.infer<typeof PositiveInt>;
export const Instant = z.string().datetime({ offset: true }).brand<"Instant">();
export type Instant = z.infer<typeof Instant>;

export const Format = z.enum(["markdown", "text"]);
export const DocumentFormat = Format;
export type DocumentFormat = z.infer<typeof DocumentFormat>;
export const Content = z
  .string()
  .max(400_000)
  .refine(
    (s) => new TextEncoder().encode(s).length <= 1_000_000,
    "Document text exceeds 1 MB",
  )
  .brand<"ContentText">();
export type ContentText = z.infer<typeof Content>;

const validPathPrefix = (p: string) =>
  p.startsWith("/") &&
  !p.includes("//") &&
  !/[\x00-\x1f\\]/.test(p) &&
  p.split("/").every((s) => s !== "." && s !== "..");
export const Path = z
  .string()
  .min(2)
  .max(500)
  .refine(
    (p) => !p.endsWith("/") && validPathPrefix(p),
    "Use an absolute path without . or .. segments",
  )
  .brand<"DocumentPath">();
export type DocumentPath = z.infer<typeof Path>;
export const PathPrefix = z
  .string()
  .min(1)
  .max(500)
  .refine(
    validPathPrefix,
    "Use an absolute path prefix without . or .. segments",
  )
  .brand<"DocumentPathPrefix">();
export type DocumentPathPrefix = z.infer<typeof PathPrefix>;

const ByDocumentId = z
  .object({ documentId: DocumentId, path: z.never().optional() })
  .strict();
const ByPath = z
  .object({ path: Path, documentId: z.never().optional() })
  .strict();
export const Locator = z.union([ByDocumentId, ByPath]);
export type RequiredLocator = z.infer<typeof Locator>;
export const OptionalOpenLocator = z.union([
  ByDocumentId,
  ByPath,
  z
    .object({ documentId: z.never().optional(), path: z.never().optional() })
    .strict(),
]);
export type OptionalOpenLocator = z.infer<typeof OptionalOpenLocator>;
export type OptionalLocator = z.infer<typeof OptionalOpenLocator>;

export const AnchorInput = z
  .object({
    revisionId: RevisionId,
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    quote: z.string().min(1).max(100_000),
  })
  .strict();
export type AnchorInput = z.infer<typeof AnchorInput>;
type ValidatedAnchorBrand = { readonly __validatedAnchor: unique symbol };
export type ValidatedAnchorInput = AnchorInput & ValidatedAnchorBrand;

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

/** Flat response projection kept for the existing renderer/MCP wire. */
export interface DocumentRevision extends DocumentSummary {
  content: string;
  parentId: RevisionId | null;
  isCurrent: boolean;
}

export interface Anchor extends AnchorInput {
  id: AnchorId;
  documentId: DocumentId;
}

export type ConnectionRelation =
  "reference" | "explanation" | "question" | "contrast" | "continuation";
export interface Connection {
  id: ConnectionId;
  from: Anchor;
  to: Anchor;
  relation: ConnectionRelation;
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
  connectionsNextCursor: string | null;
  questionsNextCursor: string | null;
}

export type OpenDocumentResult =
  { status: "empty" } | { status: "ready"; view: ReadingView };

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

function assertOffset(offset: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new DomainError(
      "INVALID_OFFSET",
      "Text offsets must be safe non-negative integers.",
    );
}

export function validateAnchor(content: string, input: AnchorInput): void {
  const { start, end, quote } = input;
  assertOffset(start);
  assertOffset(end);
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

/** The only constructor for the internal validated-anchor boundary. */
export function validateAnchorInput(
  content: string,
  input: AnchorInput,
): ValidatedAnchorInput {
  validateAnchor(content, input);
  return input as ValidatedAnchorInput;
}

export function applyEdit(
  content: string,
  start: number,
  end: number,
  expected: string,
  replacement: string,
): string {
  assertOffset(start);
  assertOffset(end);
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
