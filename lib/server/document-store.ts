import { z } from "zod";
import {
  AnchorId,
  AssetId,
  ConnectionId,
  Content,
  DomainError,
  DocumentId,
  Instant,
  PositiveInt,
  QuestionId,
  RevisionId,
  applyEdit,
  validateAnchorInput,
  type Anchor,
  type AnchorInput,
  type Connection,
  type DocumentRevision,
  type DocumentSummary,
  type OpenDocumentResult,
  type Question,
  type RequiredLocator,
  type DocumentPath,
} from "../domain/model";
import type {
  NewAnchorEntity,
  AssetEntity,
  ConnectionEntity,
  DocumentAtRevision,
  DocumentEntity,
  QuestionEntity,
  RevisionEntity,
} from "../domain/entities";
import type {
  ParsedInput,
  CommandName,
  CommandResults,
} from "../domain/commands";
import { parseCommandInput, parseCommandResult } from "../domain/commands";
import type { Owner } from "./owner-auth";
import type { RuntimeEnv } from "./env";
import { importFile } from "./import-file";
import {
  anchorEntityFromRow,
  anchorFromEntity,
  connectionEntityFromRow,
  connectionFromEntity,
  documentAtRevisionFromRow,
  documentRevisionFromEntity,
  documentSummaryFromRow,
  historyRevisionFromRow,
  questionEntitiesFromRows,
  questionFromEntity,
  searchRowFromValue,
} from "./entity-mappers";

type CursorKind = "ls" | "grep" | "connections" | "questions" | "history";

/*
 * Cursors are untrusted wire data.  Keeping a schema for every cursor kind
 * means malformed or cross-command cursors fail with INVALID_CURSOR before a
 * value can reach a SQL bind parameter.  The payload deliberately contains
 * every input that affects a keyset query, so a cursor cannot silently skip
 * rows when it is replayed for another search or filter.
 */
const CursorPayloadSchema = z.discriminatedUnion("kind", [
  z
    .object({
      v: z.literal(1),
      kind: z.literal("ls"),
      prefix: z.string().min(1).max(500),
      archived: z.boolean(),
      updatedAt: z.string().min(1),
      id: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      v: z.literal(1),
      kind: z.literal("grep"),
      prefix: z.string().min(1).max(500),
      query: z.string().min(1).max(200),
      path: z.string().min(2).max(500),
      id: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      v: z.literal(1),
      kind: z.literal("connections"),
      documentId: z.string().uuid(),
      createdAt: z.string().min(1),
      id: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      v: z.literal(1),
      kind: z.literal("questions"),
      documentId: z.string().uuid().nullable(),
      unanswered: z.boolean(),
      createdAt: z.string().min(1),
      id: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      v: z.literal(1),
      kind: z.literal("history"),
      documentId: z.string().uuid(),
      sequence: z.number().int().positive(),
    })
    .strict(),
]);
type CursorPayload = z.infer<typeof CursorPayloadSchema>;

const SEARCH_PAGE_SIZE = 25;
const MAX_RELATION_PAGE = 200;
const now = () => new Date().toISOString();

function encodeCursor(payload: CursorPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

type CursorOf<K extends CursorKind> = Extract<CursorPayload, { kind: K }>;

function decodeCursor<K extends CursorKind>(
  value: string | undefined,
  kind: K,
): CursorOf<K> | null {
  if (!value) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const payload = CursorPayloadSchema.parse(
      JSON.parse(new TextDecoder().decode(bytes)) as unknown,
    );
    if (payload.kind !== kind) throw new Error("cursor kind");
    return payload as CursorOf<K>;
  } catch {
    throw new DomainError(
      "INVALID_CURSOR",
      "The continuation cursor is invalid.",
    );
  }
}

function pathUpperBound(prefix: string): string | null {
  const points = Array.from(prefix);
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const point = points[i].codePointAt(0)!;
    if (point < 0x10ffff)
      return points.slice(0, i).join("") + String.fromCodePoint(point + 1);
  }
  return null;
}

function escapedPathPrefix(prefix: string): string {
  return prefix.replace(/[\\%_]/g, "\\$&") + "%";
}

function locatorSql(locator: RequiredLocator): {
  clause: string;
  value: string;
} {
  if (locator.documentId !== undefined)
    return { clause: "d.id=?", value: locator.documentId };
  if (locator.path !== undefined)
    return { clause: "d.path=?", value: locator.path };
  throw new DomainError("INVALID_LOCATOR", "Supply documentId or path.");
}

/** Narrow an input command's static XOR locator into the domain locator. */
function requiredLocator(value: {
  documentId?: DocumentId;
  path?: DocumentPath;
}): RequiredLocator {
  if (value.documentId !== undefined) return { documentId: value.documentId };
  if (value.path !== undefined) return { path: value.path };
  throw new DomainError("INVALID_LOCATOR", "Supply documentId or path.");
}

function cursorAfterDescending(
  cursor: CursorPayload | null,
  column: string,
  idColumn: string,
): { sql: string; values: string[] } {
  if (!cursor) return { sql: "", values: [] };
  if (cursor.kind !== "connections" && cursor.kind !== "questions")
    throw new DomainError(
      "INVALID_CURSOR",
      "The continuation cursor is invalid.",
    );
  return {
    sql: " AND (" + column + "<? OR (" + column + "=? AND " + idColumn + "<?))",
    values: [cursor.createdAt, cursor.createdAt, cursor.id],
  };
}

export class DocumentStore {
  constructor(
    readonly env: RuntimeEnv,
    readonly owner: Owner,
  ) {}

  private get db() {
    return this.env.DB;
  }

  private async readSummary(
    locator: RequiredLocator,
  ): Promise<DocumentSummary> {
    const located = locatorSql(locator);
    const row = await this.db
      .prepare(
        "SELECT d.id,d.path,d.title,d.asset_id,d.archived,d.created_at," +
          "r.id AS revision_id,r.sequence,r.parent_id,r.format,r.created_at AS updated_at " +
          "FROM documents d JOIN revisions r ON r.document_id=d.id " +
          "WHERE " +
          located.clause +
          " AND " +
          this.latestClause("r", "d") +
          " LIMIT 1",
      )
      .bind(located.value)
      .first<unknown>();
    if (!row) throw new DomainError("NOT_FOUND", "Document not found.", 404);
    return documentSummaryFromRow(row);
  }

  private latestClause(revisionAlias: string, documentAlias: string): string {
    return (
      revisionAlias +
      ".sequence=(SELECT MAX(rr.sequence) FROM revisions rr WHERE rr.document_id=" +
      documentAlias +
      ".id)"
    );
  }

  private async readLatestActive(): Promise<DocumentRevision | null> {
    const row = await this.db
      .prepare(
        "SELECT d.id,d.path,d.title,d.asset_id,d.archived,d.created_at," +
          "r.id AS revision_id,r.sequence,r.parent_id,r.content,r.format," +
          "r.created_at AS updated_at," +
          "(SELECT h.id FROM revisions h WHERE h.document_id=d.id " +
          "ORDER BY h.sequence DESC LIMIT 1) AS head_revision_id " +
          "FROM documents d JOIN revisions r ON r.document_id=d.id " +
          "WHERE d.archived=0 AND " +
          this.latestClause("r", "d") +
          " ORDER BY r.created_at DESC,d.id DESC LIMIT 1",
      )
      .first<unknown>();
    return row
      ? documentRevisionFromEntity(documentAtRevisionFromRow(row))
      : null;
  }

  async list(a: ParsedInput<"ls">): Promise<CommandResults["ls"]> {
    const cursor = decodeCursor(a.cursor, "ls");
    if (cursor && a.offset > 0)
      throw new DomainError(
        "INVALID_CURSOR",
        "Use cursor or offset, not both.",
      );
    if (
      cursor &&
      (cursor.kind !== "ls" ||
        cursor.prefix !== a.prefix ||
        cursor.archived !== a.archived)
    )
      throw new DomainError(
        "INVALID_CURSOR",
        "The continuation cursor does not match this list.",
      );
    const upper = pathUpperBound(a.prefix);
    const where = [
      "d.archived=?",
      "d.path COLLATE BINARY>=?",
      ...(upper ? ["d.path COLLATE BINARY<?"] : ["d.path LIKE ? ESCAPE '\\'"]),
      this.latestClause("r", "d"),
    ];
    const values: unknown[] = [
      a.archived ? 1 : 0,
      a.prefix,
      ...(upper ? [upper] : [escapedPathPrefix(a.prefix)]),
    ];
    if (cursor) {
      where.push("(r.created_at<? OR (r.created_at=? AND d.id<?))");
      values.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }
    const rows = await this.db
      .prepare(
        "SELECT d.id,d.path,d.title,d.asset_id,d.archived,d.created_at," +
          "r.id AS revision_id,r.sequence,r.parent_id,r.format,r.created_at AS updated_at " +
          "FROM documents d JOIN revisions r ON r.document_id=d.id WHERE " +
          where.join(" AND ") +
          " ORDER BY r.created_at DESC,d.id DESC LIMIT ? OFFSET ?",
      )
      .bind(...values, a.limit + 1, cursor ? 0 : a.offset)
      .all<unknown>();
    const documents = rows.results
      .slice(0, a.limit)
      .map(documentSummaryFromRow);
    const hasMore = rows.results.length > a.limit;
    const last = documents.at(-1);
    return {
      documents,
      nextOffset: !cursor && hasMore ? a.offset + a.limit : null,
      nextCursor:
        hasMore && last
          ? encodeCursor({
              v: 1,
              kind: "ls",
              prefix: a.prefix,
              archived: a.archived,
              updatedAt: last.updatedAt,
              id: last.id,
            })
          : null,
    };
  }

  private async readLocatedEntity(
    locator: RequiredLocator,
    revisionId?: RevisionId,
  ): Promise<DocumentAtRevision> {
    const located = locatorSql(locator);
    const revisionClause = revisionId ? "r.id=?" : this.latestClause("r", "d");
    const values = revisionId ? [located.value, revisionId] : [located.value];
    const row = await this.db
      .prepare(
        "SELECT d.id,d.path,d.title,d.asset_id,d.archived,d.created_at," +
          "r.id AS revision_id,r.sequence,r.parent_id,r.content,r.format," +
          "r.created_at AS updated_at," +
          "(SELECT h.id FROM revisions h WHERE h.document_id=d.id " +
          "ORDER BY h.sequence DESC LIMIT 1) AS head_revision_id " +
          "FROM documents d JOIN revisions r ON r.document_id=d.id " +
          "WHERE " +
          located.clause +
          " AND " +
          revisionClause +
          " LIMIT 1",
      )
      .bind(...values)
      .first<unknown>();
    if (!row)
      throw new DomainError(
        "NOT_FOUND",
        "Document or revision not found.",
        404,
      );
    return documentAtRevisionFromRow(row);
  }

  private async readLocated(
    locator: RequiredLocator,
    revisionId?: RevisionId,
  ): Promise<DocumentRevision> {
    return documentRevisionFromEntity(
      await this.readLocatedEntity(locator, revisionId),
    );
  }

  async read(
    a: RequiredLocator & { revisionId?: RevisionId },
  ): Promise<DocumentRevision> {
    return this.readLocated(a, a.revisionId);
  }

  private insertDocumentEntity(document: DocumentEntity) {
    return this.db
      .prepare(
        "INSERT INTO documents(id,path,title,asset_id,created_at) VALUES(?,?,?,?,?)",
      )
      .bind(
        document.id,
        document.path,
        document.title,
        document.assetId,
        document.createdAt,
      );
  }

  private insertRevisionEntity(revision: RevisionEntity) {
    return this.db
      .prepare(
        "INSERT INTO revisions(id,document_id,sequence,parent_id,content,format,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .bind(
        revision.id,
        revision.documentId,
        revision.sequence,
        revision.parentId,
        revision.content,
        revision.format,
        revision.createdAt,
      );
  }

  async write(
    a: ParsedInput<"write">,
    assetId: AssetId | null = null,
  ): Promise<DocumentRevision> {
    const createdAt = Instant.parse(now());
    const document: DocumentEntity = {
      id: DocumentId.parse(crypto.randomUUID()),
      path: a.path,
      title: a.title,
      assetId,
      archived: false,
      createdAt,
      currentRevisionId: RevisionId.parse(crypto.randomUUID()),
    };
    const revision: RevisionEntity = {
      id: document.currentRevisionId,
      documentId: document.id,
      sequence: PositiveInt.parse(1),
      parentId: null,
      content: Content.parse(a.content),
      format: a.format,
      createdAt: document.createdAt,
    };
    try {
      await this.db.batch([
        this.insertDocumentEntity(document),
        this.insertRevisionEntity(revision),
      ]);
    } catch (error) {
      if (String(error).toUpperCase().includes("UNIQUE"))
        throw new DomainError(
          "PATH_EXISTS",
          "A document already exists at this path.",
          409,
        );
      throw error;
    }
    return this.read({ documentId: document.id });
  }

  /** Persist an imported asset and its first document revision in one D1 batch. */
  async persistImported(
    a: ParsedInput<"write">,
    asset: AssetEntity,
  ): Promise<DocumentId> {
    const createdAt = Instant.parse(now());
    const document: DocumentEntity = {
      id: DocumentId.parse(crypto.randomUUID()),
      path: a.path,
      title: a.title,
      assetId: asset.id,
      archived: false,
      createdAt,
      currentRevisionId: RevisionId.parse(crypto.randomUUID()),
    };
    const revision: RevisionEntity = {
      id: document.currentRevisionId,
      documentId: document.id,
      sequence: PositiveInt.parse(1),
      parentId: null,
      content: Content.parse(a.content),
      format: a.format,
      createdAt: document.createdAt,
    };
    try {
      await this.db.batch([
        this.db
          .prepare(
            "INSERT INTO assets(id,key,name,mime,bytes,created_at) VALUES(?,?,?,?,?,?)",
          )
          .bind(
            asset.id,
            asset.key,
            asset.name,
            asset.mime,
            asset.bytes,
            asset.createdAt,
          ),
        this.insertDocumentEntity(document),
        this.insertRevisionEntity(revision),
      ]);
    } catch (error) {
      if (String(error).toUpperCase().includes("UNIQUE"))
        throw new DomainError(
          "PATH_EXISTS",
          "A document already exists at this path.",
          409,
        );
      throw error;
    }
    return document.id;
  }

  async edit(a: ParsedInput<"edit">): Promise<DocumentRevision> {
    const locator = requiredLocator(a);
    const snapshot = await this.readLocatedEntity(locator);
    const { document, revision } = snapshot;
    if (document.currentRevisionId !== a.expectedRevisionId)
      throw new DomainError(
        "REVISION_CONFLICT",
        "The document changed. Read the current revision before editing.",
        409,
      );
    const content = applyEdit(
      revision.content,
      a.start,
      a.end,
      a.expectedText,
      a.replacement,
    );
    const nextRevision: RevisionEntity = {
      id: RevisionId.parse(crypto.randomUUID()),
      documentId: document.id,
      sequence: PositiveInt.parse(revision.sequence + 1),
      parentId: revision.id,
      content: Content.parse(content),
      format: revision.format,
      createdAt: Instant.parse(now()),
    };
    try {
      const result = await this.db
        .prepare(
          "INSERT INTO revisions(id,document_id,sequence,parent_id,content,format,created_at) " +
            "SELECT ?,?,?,?,?,?,? WHERE " +
            "(SELECT id FROM revisions WHERE document_id=? ORDER BY sequence DESC LIMIT 1)=?",
        )
        .bind(
          nextRevision.id,
          nextRevision.documentId,
          nextRevision.sequence,
          nextRevision.parentId,
          nextRevision.content,
          nextRevision.format,
          nextRevision.createdAt,
          nextRevision.documentId,
          a.expectedRevisionId,
        )
        .run();
      if (!result.meta.changes)
        throw new DomainError(
          "REVISION_CONFLICT",
          "The document changed. Read it again before editing.",
          409,
        );
    } catch (error) {
      if (String(error).toUpperCase().includes("UNIQUE"))
        throw new DomainError(
          "REVISION_CONFLICT",
          "The document changed. Read it again before editing.",
          409,
        );
      throw error;
    }
    return this.read({ documentId: document.id, revisionId: nextRevision.id });
  }

  async move(a: ParsedInput<"mv">): Promise<DocumentRevision> {
    const locator = requiredLocator(a);
    const { document } = await this.readLocatedEntity(locator);
    try {
      await this.db
        .prepare("UPDATE documents SET path=? WHERE id=?")
        .bind(a.newPath, document.id)
        .run();
    } catch (error) {
      if (String(error).toUpperCase().includes("UNIQUE"))
        throw new DomainError(
          "PATH_EXISTS",
          "A document already exists at this path.",
          409,
        );
      throw error;
    }
    return this.read({ documentId: document.id });
  }

  async archive(a: ParsedInput<"archive">): Promise<DocumentRevision> {
    const locator = requiredLocator(a);
    const { document } = await this.readLocatedEntity(locator);
    await this.db
      .prepare("UPDATE documents SET archived=? WHERE id=?")
      .bind(a.archived ? 1 : 0, document.id)
      .run();
    return this.read({ documentId: document.id });
  }

  async history(a: ParsedInput<"history">): Promise<CommandResults["history"]> {
    const locator = requiredLocator(a);
    const doc = await this.readSummary(locator);
    const cursor = decodeCursor(a.cursor, "history");
    if (cursor && (cursor.kind !== "history" || cursor.documentId !== doc.id))
      throw new DomainError(
        "INVALID_CURSOR",
        "The continuation cursor does not match this history.",
      );
    const where = ["d.id=?"];
    const values: unknown[] = [doc.id];
    if (cursor) {
      where.push("r.sequence<?");
      values.push(cursor.sequence);
    }
    const rows = await this.db
      .prepare(
        "SELECT d.id,d.path,d.title,d.asset_id,d.archived,d.created_at," +
          "r.id AS revision_id,r.sequence,r.parent_id,r.format,r.created_at AS updated_at " +
          "FROM documents d JOIN revisions r ON r.document_id=d.id WHERE " +
          where.join(" AND ") +
          " ORDER BY r.sequence DESC LIMIT ?",
      )
      .bind(...values, a.limit + 1)
      .all<unknown>();
    const revisions = rows.results
      .slice(0, a.limit)
      .map((row) => historyRevisionFromRow(row, doc.revisionId));
    const last = revisions.at(-1);
    return {
      revisions,
      nextCursor:
        rows.results.length > a.limit && last
          ? encodeCursor({
              v: 1,
              kind: "history",
              documentId: doc.id,
              sequence: last.sequence,
            })
          : null,
    };
  }

  async grep(a: ParsedInput<"grep">): Promise<CommandResults["grep"]> {
    const cursor = decodeCursor(a.cursor, "grep");
    if (cursor && cursor.kind !== "grep")
      throw new DomainError(
        "INVALID_CURSOR",
        "The continuation cursor is invalid.",
      );
    if (cursor && cursor.prefix !== a.prefix)
      throw new DomainError(
        "INVALID_CURSOR",
        "The continuation cursor does not match this search.",
      );
    const upper = pathUpperBound(a.prefix);
    const where = [
      "d.archived=0",
      "d.path COLLATE BINARY>=?",
      ...(upper ? ["d.path COLLATE BINARY<?"] : ["d.path LIKE ? ESCAPE '\\'"]),
      this.latestClause("r", "d"),
    ];
    const values: unknown[] = [
      a.prefix,
      ...(upper ? [upper] : [escapedPathPrefix(a.prefix)]),
    ];
    if (cursor && cursor.query !== a.query)
      throw new DomainError(
        "INVALID_CURSOR",
        "The continuation cursor does not match this search.",
      );
    if (cursor) {
      where.push(
        "(d.path COLLATE BINARY>? OR (d.path COLLATE BINARY=? AND d.id COLLATE BINARY>?))",
      );
      values.push(cursor.path, cursor.path, cursor.id);
    }
    const rows = await this.db
      .prepare(
        "SELECT d.id,d.path,d.title,d.asset_id,d.archived,d.created_at," +
          "r.id AS revision_id,r.sequence,r.parent_id,r.content,r.format," +
          "r.created_at AS updated_at " +
          "FROM documents d JOIN revisions r ON r.document_id=d.id WHERE " +
          where.join(" AND ") +
          " ORDER BY d.path COLLATE BINARY ASC,d.id COLLATE BINARY ASC LIMIT ?",
      )
      .bind(...values, SEARCH_PAGE_SIZE + 1)
      .all<unknown>();
    const matches: CommandResults["grep"]["matches"] = [];
    let processed = 0;
    let nextCursor: string | null = null;
    for (const rowValue of rows.results.slice(0, SEARCH_PAGE_SIZE)) {
      const row = searchRowFromValue(rowValue);
      processed += 1;
      const metadataMatch =
        row.title.includes(a.query) || row.path.includes(a.query);
      const start = row.content.indexOf(a.query);
      if (metadataMatch || start >= 0) {
        const document = documentSummaryFromRow(row);
        const end = start < 0 ? -1 : start + a.query.length;
        matches.push({
          document,
          excerpt:
            start < 0
              ? row.content.slice(0, 180)
              : row.content.slice(Math.max(0, start - 60), start + 180),
          start,
          end,
        });
      }
      if (matches.length >= a.limit) {
        nextCursor =
          processed < rows.results.length
            ? encodeCursor({
                v: 1,
                kind: "grep",
                prefix: a.prefix,
                query: a.query,
                path: row.path,
                id: row.id,
              })
            : null;
        break;
      }
    }
    if (matches.length > a.limit) matches.length = a.limit;
    if (
      nextCursor === null &&
      processed === SEARCH_PAGE_SIZE &&
      rows.results.length > SEARCH_PAGE_SIZE
    ) {
      const lastRow = searchRowFromValue(rows.results[SEARCH_PAGE_SIZE - 1]);
      nextCursor = encodeCursor({
        v: 1,
        kind: "grep",
        prefix: a.prefix,
        query: a.query,
        path: lastRow.path,
        id: lastRow.id,
      });
    }
    return { matches, nextCursor };
  }

  private async anchor(input: AnchorInput): Promise<NewAnchorEntity> {
    const row = await this.db
      .prepare("SELECT document_id,content FROM revisions WHERE id=?")
      .bind(input.revisionId)
      .first<{ document_id: string; content: string }>();
    if (!row)
      throw new DomainError("NOT_FOUND", "Anchor revision not found.", 404);
    const valid = validateAnchorInput(row.content, input);
    return {
      ...valid,
      id: AnchorId.parse(crypto.randomUUID()),
      documentId: DocumentId.parse(row.document_id),
    };
  }

  private insertAnchor(a: NewAnchorEntity) {
    return this.db
      .prepare(
        "INSERT INTO anchors(id,revision_id,start,end,quote) VALUES(?,?,?,?,?)",
      )
      .bind(a.id, a.revisionId, a.start, a.end, a.quote);
  }

  async link(a: ParsedInput<"link">): Promise<Connection> {
    const from = await this.anchor(a.from);
    const to = await this.anchor(a.to);
    const connection: ConnectionEntity = {
      id: ConnectionId.parse(crypto.randomUUID()),
      from,
      to,
      relation: a.relation,
      label: a.label,
      createdAt: Instant.parse(now()),
    };
    await this.db.batch([
      this.insertAnchor(from),
      this.insertAnchor(to),
      this.db
        .prepare(
          "INSERT INTO connections(id,from_id,to_id,relation,label,created_at) VALUES(?,?,?,?,?,?)",
        )
        .bind(
          connection.id,
          from.id,
          to.id,
          connection.relation,
          connection.label,
          connection.createdAt,
        ),
    ]);
    return connectionFromEntity(connection);
  }

  async getAnchor(id: string): Promise<Anchor> {
    const row = await this.db
      .prepare(
        "SELECT a.id,a.revision_id,r.document_id,a.start,a.end,a.quote " +
          "FROM anchors a JOIN revisions r ON r.id=a.revision_id WHERE a.id=?",
      )
      .bind(id)
      .first<unknown>();
    if (!row) throw new DomainError("NOT_FOUND", "Anchor not found.", 404);
    return anchorFromEntity(anchorEntityFromRow(row));
  }

  private async connectionPage(
    documentId: DocumentId,
    limit: number,
    rawCursor?: string,
  ): Promise<{ connections: Connection[]; nextCursor: string | null }> {
    const cursor = decodeCursor(rawCursor, "connections");
    if (cursor && cursor.documentId !== documentId)
      throw new DomainError(
        "INVALID_CURSOR",
        "The continuation cursor does not match this document.",
      );
    const after = cursorAfterDescending(cursor, "x.created_at", "x.id");
    const union =
      "SELECT c.id,c.from_id,rf.id AS from_revision_id,rf.document_id AS from_document_id," +
      "af.start AS from_start,af.end AS from_end,af.quote AS from_quote," +
      "c.to_id,rt.id AS to_revision_id,rt.document_id AS to_document_id," +
      "at.start AS to_start,at.end AS to_end,at.quote AS to_quote," +
      "c.relation,c.label,c.created_at " +
      "FROM connections c " +
      "JOIN anchors af ON af.id=c.from_id JOIN revisions rf ON rf.id=af.revision_id " +
      "JOIN anchors at ON at.id=c.to_id JOIN revisions rt ON rt.id=at.revision_id " +
      "WHERE rf.document_id=? " +
      "UNION ALL " +
      "SELECT c.id,c.from_id,rf.id,rf.document_id,af.start,af.end,af.quote," +
      "c.to_id,rt.id,rt.document_id,at.start,at.end,at.quote," +
      "c.relation,c.label,c.created_at " +
      "FROM connections c " +
      "JOIN anchors af ON af.id=c.from_id JOIN revisions rf ON rf.id=af.revision_id " +
      "JOIN anchors at ON at.id=c.to_id JOIN revisions rt ON rt.id=at.revision_id " +
      "WHERE rt.document_id=? AND rf.document_id<>?";
    const rows = await this.db
      .prepare(
        "SELECT * FROM (" +
          union +
          ") AS x WHERE 1=1" +
          after.sql +
          " ORDER BY x.created_at DESC,x.id DESC LIMIT ?",
      )
      .bind(documentId, documentId, documentId, ...after.values, limit + 1)
      .all<unknown>();
    const connections = rows.results
      .slice(0, limit)
      .map(connectionEntityFromRow)
      .map(connectionFromEntity);
    const last = connections.at(-1);
    return {
      connections,
      nextCursor:
        rows.results.length > limit && last
          ? encodeCursor({
              v: 1,
              kind: "connections",
              documentId,
              createdAt: last.createdAt,
              id: last.id,
            })
          : null,
    };
  }

  async connections(documentId: DocumentId): Promise<Connection[]> {
    const connections: Connection[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.connectionPage(
        documentId,
        MAX_RELATION_PAGE,
        cursor,
      );
      connections.push(...page.connections);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return connections;
  }

  private async questionRows(
    documentId: DocumentId | null,
    unanswered: boolean,
    limit: number,
    rawCursor?: string,
    questionId?: QuestionId,
  ): Promise<{ rows: unknown[]; hasMore: boolean }> {
    const cursor = decodeCursor(rawCursor, "questions");
    if (
      cursor &&
      (cursor.documentId !== documentId || cursor.unanswered !== unanswered)
    )
      throw new DomainError(
        "INVALID_CURSOR",
        "The continuation cursor does not match this question query.",
      );
    const page =
      "SELECT q.id,q.created_at FROM questions q " +
      "JOIN anchors a0 ON a0.id=q.anchor_id " +
      "JOIN revisions r0 ON r0.id=a0.revision_id " +
      "WHERE " +
      (documentId ? "r0.document_id=?" : "1=1") +
      (unanswered
        ? " AND NOT EXISTS (SELECT 1 FROM answers ans0 WHERE ans0.question_id=q.id)"
        : "") +
      (questionId ? " AND q.id=?" : "") +
      (cursor ? " AND (q.created_at<? OR (q.created_at=? AND q.id<?))" : "") +
      " ORDER BY q.created_at DESC,q.id DESC LIMIT ?";
    const pageValues: unknown[] = [];
    if (documentId) pageValues.push(documentId);
    if (questionId) pageValues.push(questionId);
    if (cursor) pageValues.push(cursor.createdAt, cursor.createdAt, cursor.id);
    pageValues.push(limit + 1);
    // The outer projection expands each selected question to all answer rows.
    const query =
      "WITH page_questions AS (" +
      page +
      ") " +
      "SELECT q.id AS q_id,q.body AS q_body,q.created_at AS q_created_at," +
      "a.id AS anchor_id,a.revision_id AS anchor_revision_id,r.document_id AS anchor_document_id," +
      "a.start AS anchor_start,a.end AS anchor_end,a.quote AS anchor_quote," +
      "ans.document_id AS answer_document_id," +
      "(SELECT COUNT(*) FROM page_questions) AS question_page_count " +
      "FROM page_questions pq JOIN questions q ON q.id=pq.id " +
      "JOIN anchors a ON a.id=q.anchor_id JOIN revisions r ON r.id=a.revision_id " +
      "LEFT JOIN answers ans ON ans.question_id=q.id " +
      "ORDER BY q.created_at DESC,q.id DESC";
    // The page count is carried on every outer row, so answer fan-out cannot
    // make one question look like several paginated questions.
    const rows = (
      await this.db
        .prepare(query)
        .bind(...pageValues)
        .all<unknown>()
    ).results;
    const first = rows[0];
    const pageCount =
      first &&
      typeof first === "object" &&
      first !== null &&
      "question_page_count" in first
        ? Number(
            (first as { question_page_count: unknown }).question_page_count,
          )
        : 0;
    return { rows, hasMore: pageCount > limit };
  }

  private async questionPage(
    documentId: DocumentId | null,
    unanswered: boolean,
    limit: number,
    rawCursor?: string,
  ): Promise<{ questions: Question[]; nextCursor: string | null }> {
    const page = await this.questionRows(
      documentId,
      unanswered,
      limit,
      rawCursor,
    );
    const questions = questionEntitiesFromRows(page.rows)
      .slice(0, limit)
      .map(questionFromEntity);
    const last = questions.at(-1);
    return {
      questions,
      nextCursor:
        page.hasMore && last
          ? encodeCursor({
              v: 1,
              kind: "questions",
              documentId,
              unanswered,
              createdAt: last.createdAt,
              id: last.id,
            })
          : null,
    };
  }

  private async questionEntity(id: QuestionId): Promise<QuestionEntity> {
    const page = await this.questionRows(null, false, 1, undefined, id);
    const question = questionEntitiesFromRows(page.rows)[0];
    if (!question)
      throw new DomainError("NOT_FOUND", "Question not found.", 404);
    return question;
  }

  async question(id: QuestionId): Promise<Question> {
    return questionFromEntity(await this.questionEntity(id));
  }

  async questions(
    a: ParsedInput<"questions">,
  ): Promise<CommandResults["questions"]> {
    return this.questionPage(
      a.documentId ?? null,
      a.unanswered,
      a.limit,
      a.cursor,
    );
  }

  async answer(a: ParsedInput<"answer">): Promise<Question> {
    await this.questionEntity(a.questionId);
    await this.readSummary({ documentId: a.documentId });
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO answers(question_id,document_id) VALUES(?,?)",
      )
      .bind(a.questionId, a.documentId)
      .run();
    return questionFromEntity(await this.questionEntity(a.questionId));
  }

  /**
   * Remove one connection and collect anchors that belonged only to it.
   *
   * Anchors are immutable, but they are not documents: an anchor can be
   * shared by several connections or by a saved question.  The endpoint
   * lookup happens before the write, and all deletes then run in one D1 batch
   * so a failed cleanup cannot leave a half-removed connection.
   */
  async unlink(connectionId: ConnectionId): Promise<boolean> {
    const row = await this.db
      .prepare("SELECT from_id,to_id FROM connections WHERE id=?")
      .bind(connectionId)
      .first<{ from_id: string; to_id: string }>();
    if (!row) return false;
    const anchorIds = [...new Set([row.from_id, row.to_id])];
    const statements: D1PreparedStatement[] = [
      this.db.prepare("DELETE FROM connections WHERE id=?").bind(connectionId),
    ];
    for (const anchorId of anchorIds)
      statements.push(
        this.db
          .prepare(
            "DELETE FROM anchors WHERE id=? " +
              "AND NOT EXISTS(SELECT 1 FROM connections WHERE from_id=? OR to_id=?) " +
              "AND NOT EXISTS(SELECT 1 FROM questions WHERE anchor_id=?)",
          )
          .bind(anchorId, anchorId, anchorId, anchorId),
      );
    const result = await this.db.batch(statements);
    return Boolean(result[0]?.meta.changes);
  }

  async ask(a: ParsedInput<"ask">): Promise<Question> {
    const anchor = await this.anchor(a.anchor);
    const id = QuestionId.parse(crypto.randomUUID());
    const createdAt = Instant.parse(now());
    await this.db.batch([
      this.insertAnchor(anchor),
      this.db
        .prepare(
          "INSERT INTO questions(id,anchor_id,body,created_at) VALUES(?,?,?,?)",
        )
        .bind(id, anchor.id, a.body, createdAt),
    ]);
    return questionFromEntity(await this.questionEntity(id));
  }

  async open(a: ParsedInput<"open_document">): Promise<OpenDocumentResult> {
    let document: DocumentRevision | null;
    if (a.documentId || a.path) {
      const locator = requiredLocator(a);
      document = await this.read({ ...locator, revisionId: a.revisionId });
    } else {
      document = await this.readLatestActive();
    }
    if (!document) return { status: "empty" };
    const [connections, questions] = await Promise.all([
      this.connectionPage(
        document.id,
        Math.min(a.connectionsLimit, MAX_RELATION_PAGE),
        a.connectionsCursor,
      ),
      this.questionPage(
        document.id,
        false,
        a.questionsLimit,
        a.questionsCursor,
      ),
    ]);
    return {
      status: "ready",
      view: {
        document,
        connections: connections.connections,
        questions: questions.questions,
        connectionsNextCursor: connections.nextCursor,
        questionsNextCursor: questions.nextCursor,
      },
    };
  }

  async execute<K extends CommandName>(
    name: K,
    args: unknown,
  ): Promise<CommandResults[K]> {
    const input = parseCommandInput(name, args);
    let result: unknown;
    switch (name) {
      case "ls":
        result = await this.list(input as ParsedInput<"ls">);
        break;
      case "cat":
        result = { document: await this.read(input as ParsedInput<"cat">) };
        break;
      case "grep":
        result = await this.grep(input as ParsedInput<"grep">);
        break;
      case "write":
        result = { document: await this.write(input as ParsedInput<"write">) };
        break;
      case "edit":
        result = { document: await this.edit(input as ParsedInput<"edit">) };
        break;
      case "mv":
        result = { document: await this.move(input as ParsedInput<"mv">) };
        break;
      case "archive":
        result = {
          document: await this.archive(input as ParsedInput<"archive">),
        };
        break;
      case "history":
        result = await this.history(input as ParsedInput<"history">);
        break;
      case "link":
        result = { connection: await this.link(input as ParsedInput<"link">) };
        break;
      case "unlink": {
        const removed = await this.unlink(
          (input as ParsedInput<"unlink">).connectionId,
        );
        result = { removed };
        break;
      }
      case "ask":
        result = { question: await this.ask(input as ParsedInput<"ask">) };
        break;
      case "questions":
        result = await this.questions(input as ParsedInput<"questions">);
        break;
      case "answer":
        result = {
          question: await this.answer(input as ParsedInput<"answer">),
        };
        break;
      case "open_document":
        result = await this.open(input as ParsedInput<"open_document">);
        break;
      case "import_file":
        result = {
          document: await importFile(this, input as ParsedInput<"import_file">),
        };
        break;
      default:
        throw new DomainError("UNKNOWN_COMMAND", "Unknown command.");
    }
    return parseCommandResult(name, result);
  }
}
