import { z } from "zod";
import {
  AnchorInput,
  Content,
  ConnectionId,
  DocumentId,
  Format,
  Locator,
  Path,
  PathPrefix,
  QuestionId,
  RevisionId,
  type Anchor,
  type Connection,
  type DocumentRevision,
  type DocumentSummary,
  type OpenDocumentResult,
  type Question,
  type ReadingView,
  type RequiredLocator,
} from "./model";
import {
  AnchorSchema,
  ConnectionSchema,
  DocumentRevisionSchema,
  DocumentSummarySchema,
  OpenDocumentResultSchema,
  QuestionSchema,
  ReadingViewSchema,
} from "./protocol";

const locateShape = {
  documentId: DocumentId.optional(),
  path: Path.optional(),
};
const locateObject = () => z.object(locateShape).strict();

export const commandSchemas = {
  ls: z
    .object({
      prefix: PathPrefix.default("/" as z.infer<typeof PathPrefix>),
      limit: z.number().int().min(1).max(200).default(100),
      offset: z.number().int().min(0).max(100_000).default(0),
      cursor: z.string().max(2_000).optional(),
      archived: z.boolean().default(false),
    })
    .strict(),
  cat: locateObject().extend({ revisionId: RevisionId.optional() }),
  grep: z
    .object({
      query: z.string().min(1).max(200),
      prefix: PathPrefix.default("/" as z.infer<typeof PathPrefix>),
      limit: z.number().int().min(1).max(100).default(50),
      cursor: z.string().max(2_000).optional(),
    })
    .strict(),
  write: z
    .object({
      path: Path,
      title: z.string().min(1).max(200),
      content: Content,
      format: Format.default("markdown"),
    })
    .strict(),
  edit: locateObject()
    .extend({
      expectedRevisionId: RevisionId,
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
      expectedText: z.string().max(400_000),
      replacement: Content,
    })
    .strict(),
  mv: locateObject().extend({ newPath: Path }),
  archive: locateObject().extend({ archived: z.boolean() }),
  history: locateObject()
    .extend({
      limit: z.number().int().min(1).max(100).default(30),
      cursor: z.string().max(2_000).optional(),
    })
    .strict(),
  link: z
    .object({
      from: AnchorInput,
      to: AnchorInput,
      relation: z
        .enum([
          "reference",
          "explanation",
          "question",
          "contrast",
          "continuation",
        ])
        .default("reference"),
      label: z.string().max(200).default(""),
    })
    .strict(),
  unlink: z.object({ connectionId: ConnectionId }).strict(),
  ask: z
    .object({
      anchor: AnchorInput,
      body: z.string().trim().min(1).max(10_000),
    })
    .strict(),
  questions: z
    .object({
      documentId: DocumentId.optional(),
      unanswered: z.boolean().default(false),
      limit: z.number().int().min(1).max(100).default(50),
      cursor: z.string().max(2_000).optional(),
    })
    .strict(),
  answer: z
    .object({ questionId: QuestionId, documentId: DocumentId })
    .strict(),
  open_document: z
    .object({
      ...locateShape,
      revisionId: RevisionId.optional(),
      connectionsCursor: z.string().max(2_000).optional(),
      questionsCursor: z.string().max(2_000).optional(),
      connectionsLimit: z.number().int().min(1).max(200).default(200),
      questionsLimit: z.number().int().min(1).max(100).default(100),
    })
    .strict(),
  import_file: z
    .object({
      path: Path,
      title: z.string().min(1).max(200).optional(),
      mime: z.enum(["text/plain", "text/markdown", "application/pdf"]),
      base64: z.string().min(1).max(14_000_000),
    })
    .strict(),
} satisfies Record<string, z.AnyZodObject>;

export type CommandName = keyof typeof commandSchemas;
type RawInput<K extends CommandName> = z.input<(typeof commandSchemas)[K]>;
type RawOutput<K extends CommandName> = z.output<(typeof commandSchemas)[K]>;
type WithRequiredLocator<T> = Omit<T, "documentId" | "path"> & RequiredLocator;
type WithOptionalLocator<T> = Omit<T, "documentId" | "path"> &
  (RequiredLocator | { documentId?: never; path?: never });
type LocatorCommand = "cat" | "edit" | "mv" | "archive" | "history";
export type CommandInput<K extends CommandName> = K extends LocatorCommand
  ? WithRequiredLocator<RawInput<K>>
  : K extends "open_document"
    ? WithOptionalLocator<RawInput<K>>
    : RawInput<K>;
export type ParsedInput<K extends CommandName> = K extends LocatorCommand
  ? WithRequiredLocator<RawOutput<K>>
  : K extends "open_document"
    ? WithOptionalLocator<RawOutput<K>>
    : RawOutput<K>;

export interface CommandResults {
  ls: {
    documents: DocumentSummary[];
    nextOffset: number | null;
    nextCursor: string | null;
  };
  cat: { document: DocumentRevision };
  grep: {
    matches: {
      document: DocumentSummary;
      excerpt: string;
      start: number;
      end: number;
    }[];
    nextCursor: string | null;
  };
  write: { document: DocumentRevision };
  edit: { document: DocumentRevision };
  mv: { document: DocumentRevision };
  archive: { document: DocumentRevision };
  history: {
    revisions: Omit<DocumentRevision, "content">[];
    nextCursor: string | null;
  };
  link: { connection: Connection };
  unlink: { removed: boolean };
  ask: { question: Question };
  questions: { questions: Question[]; nextCursor: string | null };
  answer: { question: Question };
  open_document: OpenDocumentResult;
  import_file: { document: DocumentRevision };
}

export const commandDescriptions: Record<CommandName, string> = {
  ls: "List metadata by absolute path prefix with keyset pagination. Same persistent space across conversations. No shell execution.",
  cat: "Read a document by documentId OR absolute path; optionally read an immutable revision. Content offsets use JavaScript UTF-16 code units.",
  grep: "Search literal case-sensitive text in current document titles, paths and contents. Returns exact UTF-16 content offsets and a continuation cursor.",
  write:
    "Create an independent document at a unique path. TXT, Markdown, imported source and AI answers are all documents. Does not create a question or connection.",
  edit: "Replace exactly [start,end) UTF-16 code units. Requires expectedRevisionId and matching expectedText; stale writes fail. Insert with start=end and empty expectedText. A new immutable revision is created.",
  mv: "Rename or move a document path. Stable document ID and existing connections remain intact.",
  archive:
    "Archive or restore a document. History and connections remain readable. No permanent deletion.",
  history:
    "List immutable revision metadata. Use cat or open_document with a revisionId to read historical content.",
  link: "Create an independent bidirectional passage connection. Supply exact revision IDs, UTF-16 ranges and quotes for both ends. Choose meaningful passages; do not infer links merely from creating a document.",
  unlink:
    "Remove a connection without changing either document or its revision history.",
  ask: "Save a question about an exact passage. The App UI sends the saved question to the current ChatGPT conversation. This tool does not call a model or create an answer.",
  questions:
    "List saved questions and their answer-document IDs with continuation pagination.",
  answer:
    "Associate an existing independent document with a question as its answer. First write the document; separately use link for the relevant passages.",
  open_document:
    "Open a document and batched connected passages. With no locator, open the most recently updated active document or return status empty. The catalogue is loaded independently with ls.",
  import_file:
    "Import UTF-8 TXT, Markdown or a PDF as base64 (max 10 MiB). Preserves the original file and creates an ordinary editable document. PDFs need a text layer; scanned PDFs require OCR before import.",
};

export const readOnlyCommands = new Set<CommandName>([
  "ls",
  "cat",
  "grep",
  "history",
  "questions",
  "open_document",
]);

function locatorValue(value: { documentId?: unknown; path?: unknown }): RequiredLocator {
  // Parse the complete object through the exclusive union.  Choosing one
  // truthy field would silently accept a malformed payload containing both
  // locators and would make the static XOR contract meaningless at runtime.
  return Locator.parse({
    documentId: value.documentId,
    path: value.path,
  });
}

function optionalLocatorValue(value: {
  documentId?: unknown;
  path?: unknown;
}): RequiredLocator | Record<string, never> {
  if (value.documentId !== undefined || value.path !== undefined)
    return locatorValue(value);
  return {};
}

/** Decode an unknown transport payload and normalize locator unions. */
export function parseCommandInput<K extends CommandName>(
  name: K,
  args: unknown,
): ParsedInput<K> {
  const parsed = commandSchemas[name].parse(args) as RawOutput<K>;
  if ((["cat", "edit", "mv", "archive", "history"] as string[]).includes(name))
    return { ...parsed, ...locatorValue(parsed as RawOutput<K> & { documentId?: unknown; path?: unknown }) } as ParsedInput<K>;
  if (name === "open_document")
    return {
      ...parsed,
      ...optionalLocatorValue(parsed as RawOutput<K> & { documentId?: unknown; path?: unknown }),
    } as ParsedInput<K>;
  return parsed as ParsedInput<K>;
}

export const commandResultSchemas = {
  ls: z.object({
    documents: z.array(DocumentSummarySchema),
    nextOffset: z.number().int().nonnegative().nullable(),
    nextCursor: z.string().nullable(),
  }).strict(),
  cat: z.object({ document: DocumentRevisionSchema }).strict(),
  grep: z.object({
    matches: z.array(
      z.object({
        document: DocumentSummarySchema,
        excerpt: z.string(),
        start: z.number().int(),
        end: z.number().int(),
      }),
    ),
    nextCursor: z.string().nullable(),
  }).strict(),
  write: z.object({ document: DocumentRevisionSchema }).strict(),
  edit: z.object({ document: DocumentRevisionSchema }).strict(),
  mv: z.object({ document: DocumentRevisionSchema }).strict(),
  archive: z.object({ document: DocumentRevisionSchema }).strict(),
  history: z.object({
    revisions: z.array(DocumentRevisionSchema.omit({ content: true })),
    nextCursor: z.string().nullable(),
  }).strict(),
  link: z.object({ connection: ConnectionSchema }).strict(),
  unlink: z.object({ removed: z.boolean() }).strict(),
  ask: z.object({ question: QuestionSchema }).strict(),
  questions: z.object({
    questions: z.array(QuestionSchema),
    nextCursor: z.string().nullable(),
  }).strict(),
  answer: z.object({ question: QuestionSchema }).strict(),
  open_document: OpenDocumentResultSchema,
  import_file: z.object({ document: DocumentRevisionSchema }).strict(),
} satisfies { [K in CommandName]: z.ZodTypeAny };

/** Validate every service result before it crosses an HTTP/MCP boundary. */
export function parseCommandResult<K extends CommandName>(
  name: K,
  result: unknown,
): CommandResults[K] {
  return commandResultSchemas[name].parse(result) as CommandResults[K];
}

// Keep protocol imports used in this module's public type surface.
export type { Anchor, Connection, ReadingView };
export { AnchorSchema, ReadingViewSchema };
