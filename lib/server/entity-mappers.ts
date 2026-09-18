import { z } from "zod";
import {
  AnchorId,
  AssetId,
  ConnectionId,
  Content,
  DocumentId,
  DocumentFormat,
  DomainError,
  Format,
  Instant,
  Path,
  PositiveInt,
  QuestionId,
  RevisionId,
  type Anchor,
  type Connection,
  type DocumentRevision,
  type DocumentSummary,
  type Question,
} from "../domain/model";
import type {
  AnchorEntity,
  AnswerAssociation,
  ConnectionEntity,
  DocumentAtRevision,
  DocumentEntity,
  QuestionEntity,
  RevisionEntity,
} from "../domain/entities";

const documentFields = {
  id: z.string(),
  path: z.string(),
  title: z.string(),
  asset_id: z.string().nullable(),
  archived: z.union([z.number().int(), z.boolean()]),
  created_at: z.string(),
  revision_id: z.string(),
  sequence: z.number().int().positive(),
  parent_id: z.string().nullable(),
  format: Format,
  updated_at: z.string(),
};

/** Rows selected for metadata projections and history pages. */
export const SummaryRow = z.object(documentFields);

/** Rows selected when content is explicitly requested. */
export const RevisionRow = SummaryRow.extend({
  content: z.string(),
  head_revision_id: z.string(),
});

/** Rows selected by literal search; content stays an implementation detail. */
export const SearchRow = SummaryRow.extend({ content: z.string() });

const AnchorRow = z.object({
  id: z.string(),
  revision_id: z.string(),
  document_id: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  quote: z.string().min(1),
});

const ConnectionRow = z.object({
  id: z.string(),
  from_id: z.string(),
  from_revision_id: z.string(),
  from_document_id: z.string(),
  from_start: z.number().int().nonnegative(),
  from_end: z.number().int().positive(),
  from_quote: z.string().min(1),
  to_id: z.string(),
  to_revision_id: z.string(),
  to_document_id: z.string(),
  to_start: z.number().int().nonnegative(),
  to_end: z.number().int().positive(),
  to_quote: z.string().min(1),
  relation: z.enum([
    "reference",
    "explanation",
    "question",
    "contrast",
    "continuation",
  ]),
  label: z.string(),
  created_at: z.string(),
});

const QuestionJoinRow = z.object({
  q_id: z.string(),
  q_body: z.string(),
  q_created_at: z.string(),
  anchor_id: z.string(),
  anchor_revision_id: z.string(),
  anchor_document_id: z.string(),
  anchor_start: z.number().int().nonnegative(),
  anchor_end: z.number().int().positive(),
  anchor_quote: z.string().min(1),
  answer_document_id: z.string().nullable(),
  question_page_count: z.number().int().nonnegative(),
});

function stored<T>(schema: z.ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value);
  } catch {
    throw new DomainError(
      "DATA_CORRUPTION",
      "Stored document data is invalid.",
      500,
    );
  }
}

function validDocument(
  row: z.infer<typeof SummaryRow>,
  currentRevisionId: string,
): DocumentEntity {
  try {
    return {
      id: DocumentId.parse(row.id),
      path: Path.parse(row.path),
      title: row.title,
      assetId: row.asset_id ? AssetId.parse(row.asset_id) : null,
      archived: row.archived === true || row.archived === 1,
      createdAt: Instant.parse(row.created_at),
      currentRevisionId: RevisionId.parse(currentRevisionId),
    };
  } catch {
    throw new DomainError(
      "DATA_CORRUPTION",
      "Stored document data is invalid.",
      500,
    );
  }
}

function validRevision(
  row: z.infer<typeof RevisionRow>,
  documentId: DocumentId,
): RevisionEntity {
  try {
    return {
      id: RevisionId.parse(row.revision_id),
      documentId,
      sequence: PositiveInt.parse(row.sequence),
      parentId: row.parent_id ? RevisionId.parse(row.parent_id) : null,
      content: Content.parse(row.content),
      format: DocumentFormat.parse(row.format),
      createdAt: Instant.parse(row.updated_at),
    };
  } catch {
    throw new DomainError(
      "DATA_CORRUPTION",
      "Stored revision data is invalid.",
      500,
    );
  }
}

/** Map a content-bearing row to the document identity plus immutable revision. */
export function documentAtRevisionFromRow(value: unknown): DocumentAtRevision {
  const row = stored(RevisionRow, value);
  const document = validDocument(row, row.head_revision_id);
  const revision = validRevision(row, document.id);
  return {
    document,
    revision,
    isCurrent: revision.id === document.currentRevisionId,
  };
}

export function searchRowFromValue(value: unknown): z.infer<typeof SearchRow> {
  return stored(SearchRow, value);
}

function revisionMetadataFromSummaryRow(
  value: unknown,
  currentRevisionId?: RevisionId,
): {
  document: DocumentEntity;
  revisionId: RevisionId;
  sequence: PositiveInt;
  parentId: RevisionId | null;
  format: DocumentFormat;
  createdAt: Instant;
} {
  const row = stored(SummaryRow, value);
  const document = validDocument(
    row,
    currentRevisionId ?? RevisionId.parse(row.revision_id),
  );
  try {
    return {
      document,
      revisionId: RevisionId.parse(row.revision_id),
      sequence: PositiveInt.parse(row.sequence),
      parentId: row.parent_id ? RevisionId.parse(row.parent_id) : null,
      format: DocumentFormat.parse(row.format),
      createdAt: Instant.parse(row.updated_at),
    };
  } catch {
    throw new DomainError(
      "DATA_CORRUPTION",
      "Stored revision data is invalid.",
      500,
    );
  }
}

export function documentSummaryFromRow(value: unknown): DocumentSummary {
  const mapped = revisionMetadataFromSummaryRow(value);
  return {
    id: mapped.document.id,
    path: mapped.document.path,
    title: mapped.document.title,
    revisionId: mapped.revisionId,
    sequence: mapped.sequence,
    format: mapped.format,
    createdAt: mapped.document.createdAt,
    updatedAt: mapped.createdAt,
    assetId: mapped.document.assetId,
    archived: mapped.document.archived,
  };
}

export function documentRevisionFromEntity(
  snapshot: DocumentAtRevision,
): DocumentRevision {
  return {
    id: snapshot.document.id,
    path: snapshot.document.path,
    title: snapshot.document.title,
    revisionId: snapshot.revision.id,
    sequence: snapshot.revision.sequence,
    format: snapshot.revision.format,
    createdAt: snapshot.document.createdAt,
    updatedAt: snapshot.revision.createdAt,
    assetId: snapshot.document.assetId,
    archived: snapshot.document.archived,
    content: snapshot.revision.content,
    parentId: snapshot.revision.parentId,
    isCurrent: snapshot.isCurrent,
  };
}

export function historyRevisionFromRow(
  value: unknown,
  currentRevisionId: RevisionId,
): Omit<DocumentRevision, "content"> {
  const mapped = revisionMetadataFromSummaryRow(value, currentRevisionId);
  return {
    id: mapped.document.id,
    path: mapped.document.path,
    title: mapped.document.title,
    revisionId: mapped.revisionId,
    sequence: mapped.sequence,
    format: mapped.format,
    createdAt: mapped.document.createdAt,
    updatedAt: mapped.createdAt,
    assetId: mapped.document.assetId,
    archived: mapped.document.archived,
    parentId: mapped.parentId,
    isCurrent: mapped.revisionId === currentRevisionId,
  };
}

export function anchorEntityFromFields(fields: {
  id: string;
  revision_id: string;
  document_id: string;
  start: number;
  end: number;
  quote: string;
}): AnchorEntity {
  try {
    return {
      id: AnchorId.parse(fields.id),
      revisionId: RevisionId.parse(fields.revision_id),
      documentId: DocumentId.parse(fields.document_id),
      start: fields.start,
      end: fields.end,
      quote: fields.quote,
    };
  } catch {
    throw new DomainError(
      "DATA_CORRUPTION",
      "Stored anchor data is invalid.",
      500,
    );
  }
}

export function anchorEntityFromRow(value: unknown): AnchorEntity {
  return anchorEntityFromFields(stored(AnchorRow, value));
}

export function anchorFromEntity(anchor: AnchorEntity): Anchor {
  return { ...anchor };
}

export function connectionEntityFromRow(value: unknown): ConnectionEntity {
  const row = stored(ConnectionRow, value);
  try {
    return {
      id: ConnectionId.parse(row.id),
      from: anchorEntityFromFields({
        id: row.from_id,
        revision_id: row.from_revision_id,
        document_id: row.from_document_id,
        start: row.from_start,
        end: row.from_end,
        quote: row.from_quote,
      }),
      to: anchorEntityFromFields({
        id: row.to_id,
        revision_id: row.to_revision_id,
        document_id: row.to_document_id,
        start: row.to_start,
        end: row.to_end,
        quote: row.to_quote,
      }),
      relation: row.relation,
      label: row.label,
      createdAt: Instant.parse(row.created_at),
    };
  } catch {
    throw new DomainError(
      "DATA_CORRUPTION",
      "Stored connection data is invalid.",
      500,
    );
  }
}

export function connectionFromEntity(connection: ConnectionEntity): Connection {
  return {
    id: connection.id,
    from: anchorFromEntity(connection.from),
    to: anchorFromEntity(connection.to),
    relation: connection.relation,
    label: connection.label,
    createdAt: connection.createdAt,
  };
}

export function questionEntitiesFromRows(
  rowsValue: unknown[],
): QuestionEntity[] {
  const groups = new Map<string, QuestionEntity>();
  for (const rowValue of rowsValue) {
    const row = stored(QuestionJoinRow, rowValue);
    let question = groups.get(row.q_id);
    if (!question) {
      question = {
        id: QuestionId.parse(row.q_id),
        anchor: anchorEntityFromFields({
          id: row.anchor_id,
          revision_id: row.anchor_revision_id,
          document_id: row.anchor_document_id,
          start: row.anchor_start,
          end: row.anchor_end,
          quote: row.anchor_quote,
        }),
        body: row.q_body,
        createdAt: Instant.parse(row.q_created_at),
        answers: [],
      };
      groups.set(row.q_id, question);
    }
    if (row.answer_document_id)
      question.answers.push({
        questionId: question.id,
        documentId: DocumentId.parse(row.answer_document_id),
      });
  }
  return [...groups.values()];
}

export function questionFromEntity(question: QuestionEntity): Question {
  return {
    id: question.id,
    anchor: anchorFromEntity(question.anchor),
    body: question.body,
    createdAt: question.createdAt,
    answers: question.answers.map(
      (answer: AnswerAssociation) => answer.documentId,
    ),
  };
}
