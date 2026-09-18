import { z } from "zod";
import {
  AnchorId,
  AssetId,
  ConnectionId,
  DocumentId,
  Format,
  Path,
  QuestionId,
  RevisionId,
  type Anchor,
  type Connection,
  type DocumentRevision,
  type DocumentSummary,
  type Question,
  type ReadingView,
} from "./model";

export const DocumentSummarySchema = z
  .object({
    id: DocumentId,
    path: Path,
    title: z.string(),
    revisionId: RevisionId,
    sequence: z.number().int().positive(),
    format: Format,
    createdAt: z.string(),
    updatedAt: z.string(),
    assetId: AssetId.nullable(),
    archived: z.boolean(),
  })
  .strict();

export const DocumentRevisionSchema = DocumentSummarySchema.extend({
  content: z.string(),
  parentId: RevisionId.nullable(),
  isCurrent: z.boolean(),
});

export const AnchorSchema = z
  .object({
    id: AnchorId,
    revisionId: RevisionId,
    documentId: DocumentId,
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    quote: z.string().min(1),
  })
  .strict();

export const ConnectionSchema = z
  .object({
    id: ConnectionId,
    from: AnchorSchema,
    to: AnchorSchema,
    relation: z.enum([
      "reference",
      "explanation",
      "question",
      "contrast",
      "continuation",
    ]),
    label: z.string(),
    createdAt: z.string(),
  })
  .strict();

export const QuestionSchema = z
  .object({
    id: QuestionId,
    anchor: AnchorSchema,
    body: z.string(),
    createdAt: z.string(),
    answers: z.array(DocumentId),
  })
  .strict();

export const ReadingViewSchema = z
  .object({
    document: DocumentRevisionSchema,
    connections: z.array(ConnectionSchema),
    questions: z.array(QuestionSchema),
    connectionsNextCursor: z.string().nullable(),
    questionsNextCursor: z.string().nullable(),
  })
  .strict();

export const OpenDocumentResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("empty") }).strict(),
  z.object({ status: z.literal("ready"), view: ReadingViewSchema }).strict(),
]);

export type ProtocolDocumentSummary = z.infer<typeof DocumentSummarySchema>;
export type ProtocolDocumentRevision = z.infer<typeof DocumentRevisionSchema>;
export type ProtocolAnchor = z.infer<typeof AnchorSchema>;
export type ProtocolConnection = z.infer<typeof ConnectionSchema>;
export type ProtocolQuestion = z.infer<typeof QuestionSchema>;

// These assignments keep the schemas aligned with the public wire interfaces.
export function assertProtocolTypes(
  summary: ProtocolDocumentSummary,
  revision: ProtocolDocumentRevision,
  anchor: ProtocolAnchor,
  connection: ProtocolConnection,
  question: ProtocolQuestion,
): [DocumentSummary, DocumentRevision, Anchor, Connection, Question] {
  return [summary, revision, anchor, connection, question];
}

export type ProtocolReadingView = z.infer<typeof ReadingViewSchema>;
export type ProtocolOpenDocumentResult = z.infer<
  typeof OpenDocumentResultSchema
>;

// Keep the structural contract visible to consumers without runtime casts.
export function asReadingView(view: ProtocolReadingView): ReadingView {
  return view;
}
