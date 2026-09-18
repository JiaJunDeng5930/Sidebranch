import type {
  AnchorId,
  AssetId,
  ConnectionId,
  DocumentId,
  DocumentPath,
  QuestionId,
  RevisionId,
  DocumentFormat,
  PositiveInt,
  ContentText,
  Instant,
  AnchorInput,
  ValidatedAnchorInput,
} from "./model";
export type { Instant };

/** The document identity and mutable metadata are separate from revisions. */
export interface DocumentEntity {
  id: DocumentId;
  path: DocumentPath;
  title: string;
  assetId: AssetId | null;
  archived: boolean;
  createdAt: Instant;
  currentRevisionId: RevisionId;
}

/** A revision is immutable and belongs to one document. */
export interface RevisionEntity {
  readonly id: RevisionId;
  readonly documentId: DocumentId;
  readonly sequence: PositiveInt;
  readonly parentId: RevisionId | null;
  readonly content: ContentText;
  readonly format: DocumentFormat;
  readonly createdAt: Instant;
}

export interface DocumentAtRevision {
  document: DocumentEntity;
  revision: RevisionEntity;
  isCurrent: boolean;
}

/**
 * A persisted anchor is an immutable value owned by its revision.  New
 * anchors are created only after `validateAnchorInput`; the persisted shape
 * intentionally does not carry that constructor-only brand because rows are
 * reconstructed from the immutable anchor table by the server mapper.
 */
export type AnchorEntity = Readonly<AnchorInput> & {
  readonly id: AnchorId;
  readonly documentId: DocumentId;
};

/** Only source-checked anchors may cross the insertion boundary. */
export type NewAnchorEntity = AnchorEntity & ValidatedAnchorInput;

export type ConnectionRelation =
  "reference" | "explanation" | "question" | "contrast" | "continuation";

export interface ConnectionEntity {
  id: ConnectionId;
  from: AnchorEntity;
  to: AnchorEntity;
  relation: ConnectionRelation;
  label: string;
  createdAt: Instant;
}

export interface AnswerAssociation {
  questionId: QuestionId;
  documentId: DocumentId;
}

export interface QuestionEntity {
  id: QuestionId;
  anchor: AnchorEntity;
  body: string;
  createdAt: Instant;
  answers: AnswerAssociation[];
}

export interface AssetEntity {
  id: AssetId;
  key: string;
  name: string;
  mime: string;
  bytes: number;
  createdAt: Instant;
}
