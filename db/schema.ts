import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
import type {
  DocumentId,
  RevisionId,
  AnchorId,
  ConnectionId,
  QuestionId,
  AssetId,
  DocumentPath,
} from "../lib/domain/model";
export const assets = sqliteTable("assets", {
  id: text("id").primaryKey().$type<AssetId>(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  bytes: integer("bytes").notNull(),
  createdAt: text("created_at").notNull(),
});
export const documents = sqliteTable("documents", {
  id: text("id").primaryKey().$type<DocumentId>(),
  path: text("path").notNull().unique().$type<DocumentPath>(),
  title: text("title").notNull(),
  assetId: text("asset_id")
    .references(() => assets.id)
    .$type<AssetId>(),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});
export const revisions = sqliteTable(
  "revisions",
  {
    id: text("id").primaryKey().$type<RevisionId>(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id)
      .$type<DocumentId>(),
    sequence: integer("sequence").notNull(),
    parentId: text("parent_id").$type<RevisionId>(),
    content: text("content").notNull(),
    format: text("format", { enum: ["markdown", "text"] }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("revision_sequence").on(t.documentId, t.sequence),
    index("revision_document").on(t.documentId),
  ],
);
export const anchors = sqliteTable("anchors", {
  id: text("id").primaryKey().$type<AnchorId>(),
  revisionId: text("revision_id")
    .notNull()
    .references(() => revisions.id)
    .$type<RevisionId>(),
  start: integer("start").notNull(),
  end: integer("end").notNull(),
  quote: text("quote").notNull(),
});
export const connections = sqliteTable("connections", {
  id: text("id").primaryKey().$type<ConnectionId>(),
  fromId: text("from_id")
    .notNull()
    .references(() => anchors.id)
    .$type<AnchorId>(),
  toId: text("to_id")
    .notNull()
    .references(() => anchors.id)
    .$type<AnchorId>(),
  relation: text("relation", {
    enum: ["reference", "explanation", "question", "contrast", "continuation"],
  }).notNull(),
  label: text("label").notNull(),
  createdAt: text("created_at").notNull(),
});
export const questions = sqliteTable("questions", {
  id: text("id").primaryKey().$type<QuestionId>(),
  anchorId: text("anchor_id")
    .notNull()
    .references(() => anchors.id)
    .$type<AnchorId>(),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull(),
});
export const answers = sqliteTable(
  "answers",
  {
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id)
      .$type<QuestionId>(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id)
      .$type<DocumentId>(),
  },
  (t) => [uniqueIndex("answer_document").on(t.questionId, t.documentId)],
);
export const owner = sqliteTable("owner", {
  singleton: integer("singleton").primaryKey().default(1),
  userId: text("user_id").notNull().unique(),
});
export const oauthClients = sqliteTable("oauth_clients", {
  id: text("id").primaryKey(),
  redirectUris: text("redirect_uris").notNull(),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
});
export const oauthRequests = sqliteTable("oauth_requests", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  clientId: text("client_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  challenge: text("challenge").notNull(),
  state: text("state").notNull(),
  resource: text("resource").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
export const oauthCodes = sqliteTable("oauth_codes", {
  hash: text("hash").primaryKey(),
  userId: text("user_id").notNull(),
  clientId: text("client_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  challenge: text("challenge").notNull(),
  resource: text("resource").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
export const oauthTokens = sqliteTable(
  "oauth_tokens",
  {
    hash: text("hash").primaryKey(),
    userId: text("user_id").notNull(),
    clientId: text("client_id").notNull(),
    resource: text("resource").notNull(),
    kind: text("kind", { enum: ["access", "refresh"] }).notNull(),
    family: text("family").notNull(),
    consumed: integer("consumed").notNull().default(0),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("tokens_family").on(t.family)],
);
