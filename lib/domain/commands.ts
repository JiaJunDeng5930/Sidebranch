import { z } from "zod";
import {
  DocumentId,
  RevisionId,
  QuestionId,
  ConnectionId,
  Path,
  Format,
  Content,
  AnchorInput,
  type DocumentSummary,
  type DocumentRevision,
  type ReadingView,
  type Connection,
  type Question,
} from "./model";
const locate = { documentId: DocumentId.optional(), path: Path.optional() };
export const commandSchemas = {
  ls: z.object({
    prefix: z.string().max(500).default("/"),
    limit: z.number().int().min(1).max(200).default(100),
    offset: z.number().int().nonnegative().default(0),
    archived: z.boolean().default(false),
  }),
  cat: z.object({ ...locate, revisionId: RevisionId.optional() }),
  grep: z.object({
    query: z.string().min(1).max(200),
    prefix: z.string().default("/"),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  write: z.object({
    path: Path,
    title: z.string().min(1).max(200),
    content: Content,
    format: Format.default("markdown"),
  }),
  edit: z.object({
    ...locate,
    expectedRevisionId: RevisionId,
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    expectedText: z.string().max(400_000),
    replacement: Content,
  }),
  mv: z.object({ ...locate, newPath: Path }),
  archive: z.object({ ...locate, archived: z.boolean() }),
  history: z.object({
    ...locate,
    limit: z.number().int().min(1).max(100).default(30),
  }),
  link: z.object({
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
  }),
  unlink: z.object({ connectionId: ConnectionId }),
  ask: z.object({
    anchor: AnchorInput,
    body: z.string().trim().min(1).max(10_000),
  }),
  questions: z.object({
    documentId: DocumentId.optional(),
    unanswered: z.boolean().default(false),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  answer: z.object({ questionId: QuestionId, documentId: DocumentId }),
  open_document: z.object({ ...locate, revisionId: RevisionId.optional() }),
  import_file: z.object({
    path: Path,
    title: z.string().min(1).max(200).optional(),
    mime: z.enum(["text/plain", "text/markdown", "application/pdf"]),
    base64: z.string().min(1).max(14_000_000),
  }),
} satisfies Record<string, z.AnyZodObject>;
export type CommandName = keyof typeof commandSchemas;
export type CommandInput<K extends CommandName> = z.input<
  (typeof commandSchemas)[K]
>;
export type ParsedInput<K extends CommandName> = z.output<
  (typeof commandSchemas)[K]
>;
export interface CommandResults {
  ls: { documents: DocumentSummary[]; nextOffset: number | null };
  cat: { document: DocumentRevision };
  grep: {
    matches: {
      document: DocumentSummary;
      excerpt: string;
      start: number;
      end: number;
    }[];
  };
  write: { document: DocumentRevision };
  edit: { document: DocumentRevision };
  mv: { document: DocumentRevision };
  archive: { document: DocumentRevision };
  history: { revisions: Omit<DocumentRevision, "content">[] };
  link: { connection: Connection };
  unlink: { removed: boolean };
  ask: { question: Question };
  questions: { questions: Question[] };
  answer: { question: Question };
  open_document: ReadingView;
  import_file: { document: DocumentRevision };
}
export const commandDescriptions: Record<CommandName, string> = {
  ls: "List documents by absolute path prefix. Same persistent space across conversations. Paginated; use nextOffset. No shell execution.",
  cat: "Read a document by documentId OR absolute path; optionally read an immutable revision. Content offsets use JavaScript UTF-16 code units.",
  grep: "Search literal text in document titles, paths and current contents. Returns revision IDs, excerpts and UTF-16 content offsets; -1 means only metadata matched.",
  write:
    "Create an independent document at a unique path. TXT, Markdown, imported source and AI answers are all documents. Does not create a question or connection.",
  edit: "Replace exactly [start,end) UTF-16 code units. Requires expectedRevisionId and matching expectedText; stale writes fail. Insert with start=end and empty expectedText. A new immutable revision is created.",
  mv: "Rename or move a document path. Stable document ID and existing connections remain intact.",
  archive:
    "Archive or restore a document. History and connections remain readable. No permanent deletion.",
  history:
    "List immutable revisions of a document. Use cat or open_document with a revisionId to read a historical version.",
  link: "Create an independent bidirectional passage connection. Supply exact revision IDs, UTF-16 ranges and quotes for both ends. Choose meaningful passages; do not infer links merely from creating a document.",
  unlink:
    "Remove a connection without changing either document or its revision history.",
  ask: "Save a question about an exact passage. The App UI sends the saved question to the current ChatGPT conversation. This tool does not call a model or create an answer.",
  questions:
    "List saved questions and their answer-document IDs, optionally unanswered or belonging to one document.",
  answer:
    "Associate an existing independent document with a question as its answer. First write the document; separately use link for the relevant passages.",
  open_document:
    "Set the current document in the ChatGPT reading App and display connected passages. With no locator, open the most recent document or an empty document space. Reading state belongs to this App instance.",
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
