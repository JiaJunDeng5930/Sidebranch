import {
  DocumentId,
  RevisionId,
  AnchorId,
  ConnectionId,
  QuestionId,
  AssetId,
  Path,
  DomainError,
  validateAnchor,
  applyEdit,
  type DocumentRevision,
  type DocumentSummary,
  type AnchorInput,
  type Anchor,
  type Connection,
  type Question,
  type ReadingView,
} from "../domain/model";
import type {
  ParsedInput,
  CommandName,
  CommandResults,
} from "../domain/commands";
import { commandSchemas } from "../domain/commands";
import type { Owner } from "./owner-auth";
import type { RuntimeEnv } from "./env";
import { importFile } from "./import-file";
type Row = {
  id: string;
  path: string;
  title: string;
  asset_id: string | null;
  archived: number;
  created_at: string;
  revision_id: string;
  sequence: number;
  parent_id: string | null;
  content: string;
  format: "markdown" | "text";
  updated_at: string;
};
const selectDocument = `SELECT d.*,r.id AS revision_id,r.sequence,r.parent_id,r.content,r.format,r.created_at AS updated_at FROM documents d JOIN revisions r ON r.document_id=d.id`;
const latest = `r.sequence=(SELECT MAX(rr.sequence) FROM revisions rr WHERE rr.document_id=d.id)`;
const now = () => new Date().toISOString();
function summary(row: Row): DocumentSummary {
  return {
    id: DocumentId.parse(row.id),
    path: Path.parse(row.path),
    title: row.title,
    assetId: row.asset_id ? AssetId.parse(row.asset_id) : null,
    archived: !!row.archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revisionId: RevisionId.parse(row.revision_id),
    sequence: row.sequence,
    format: row.format,
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
  async list(a: ParsedInput<"ls">): Promise<CommandResults["ls"]> {
    const rows = await this.db
      .prepare(
        `${selectDocument} WHERE ${latest} AND d.archived=? AND substr(d.path,1,?)=? ORDER BY r.created_at DESC,d.id LIMIT ? OFFSET ?`,
      )
      .bind(
        a.archived ? 1 : 0,
        a.prefix.length,
        a.prefix,
        a.limit + 1,
        a.offset,
      )
      .all<Row>();
    return {
      documents: rows.results.slice(0, a.limit).map(summary),
      nextOffset: rows.results.length > a.limit ? a.offset + a.limit : null,
    };
  }
  async read(a: {
    documentId?: DocumentId;
    path?: string;
    revisionId?: RevisionId;
  }): Promise<DocumentRevision> {
    if (Boolean(a.documentId) === Boolean(a.path))
      throw new DomainError(
        "LOCATOR_REQUIRED",
        "Specify exactly one of documentId or path.",
      );
    const row = await this.db
      .prepare(
        `${selectDocument} WHERE ${a.documentId ? "d.id=?" : "d.path=?"} AND ${a.revisionId ? "r.id=?" : latest}`,
      )
      .bind(
        ...[a.documentId || a.path, ...(a.revisionId ? [a.revisionId] : [])],
      )
      .first<Row>();
    if (!row)
      throw new DomainError(
        "NOT_FOUND",
        "Document or revision not found.",
        404,
      );
    const head = await this.db
      .prepare(
        "SELECT id FROM revisions WHERE document_id=? ORDER BY sequence DESC LIMIT 1",
      )
      .bind(row.id)
      .first<{ id: string }>();
    return {
      ...summary(row),
      content: row.content,
      parentId: row.parent_id ? RevisionId.parse(row.parent_id) : null,
      isCurrent: head?.id === row.revision_id,
    };
  }
  async write(
    a: ParsedInput<"write">,
    assetId: AssetId | null = null,
  ): Promise<DocumentRevision> {
    const id = DocumentId.parse(crypto.randomUUID()),
      revisionId = crypto.randomUUID(),
      createdAt = now();
    try {
      await this.db.batch([
        this.db
          .prepare(
            "INSERT INTO documents(id,path,title,asset_id,created_at) VALUES(?,?,?,?,?)",
          )
          .bind(id, a.path, a.title, assetId, createdAt),
        this.db
          .prepare(
            "INSERT INTO revisions(id,document_id,sequence,parent_id,content,format,created_at) VALUES(?,?,1,NULL,?,?,?)",
          )
          .bind(revisionId, id, a.content, a.format, createdAt),
      ]);
    } catch (error) {
      if (String(error).includes("UNIQUE"))
        throw new DomainError(
          "PATH_EXISTS",
          "A document already exists at this path.",
          409,
        );
      throw error;
    }
    return this.read({ documentId: id });
  }
  async edit(a: ParsedInput<"edit">): Promise<DocumentRevision> {
    const doc = await this.read(a);
    if (doc.revisionId !== a.expectedRevisionId)
      throw new DomainError(
        "REVISION_CONFLICT",
        "The document changed. Read the current revision before editing.",
        409,
      );
    const content = applyEdit(
      doc.content,
      a.start,
      a.end,
      a.expectedText,
      a.replacement,
    );
    const revisionId = RevisionId.parse(crypto.randomUUID());
    try {
      const result = await this.db
        .prepare(
          `INSERT INTO revisions(id,document_id,sequence,parent_id,content,format,created_at) SELECT ?,?,?,?,?,?,? WHERE (SELECT id FROM revisions WHERE document_id=? ORDER BY sequence DESC LIMIT 1)=?`,
        )
        .bind(
          revisionId,
          doc.id,
          doc.sequence + 1,
          doc.revisionId,
          content,
          doc.format,
          now(),
          doc.id,
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
      if (String(error).includes("UNIQUE"))
        throw new DomainError(
          "REVISION_CONFLICT",
          "The document changed. Read it again before editing.",
          409,
        );
      throw error;
    }
    return this.read({ documentId: doc.id, revisionId });
  }
  async move(a: ParsedInput<"mv">): Promise<DocumentRevision> {
    const doc = await this.read(a);
    try {
      await this.db
        .prepare("UPDATE documents SET path=? WHERE id=?")
        .bind(a.newPath, doc.id)
        .run();
    } catch (error) {
      if (String(error).includes("UNIQUE"))
        throw new DomainError(
          "PATH_EXISTS",
          "A document already exists at this path.",
          409,
        );
      throw error;
    }
    return this.read({ documentId: doc.id });
  }
  async archive(a: ParsedInput<"archive">): Promise<DocumentRevision> {
    const doc = await this.read(a);
    await this.db
      .prepare("UPDATE documents SET archived=? WHERE id=?")
      .bind(a.archived ? 1 : 0, doc.id)
      .run();
    return this.read({ documentId: doc.id });
  }
  async history(a: ParsedInput<"history">): Promise<CommandResults["history"]> {
    const doc = await this.read(a);
    const rows = await this.db
      .prepare(
        `${selectDocument} WHERE d.id=? ORDER BY r.sequence DESC LIMIT ?`,
      )
      .bind(doc.id, a.limit)
      .all<Row>();
    return {
      revisions: rows.results.map((r) => ({
        ...summary(r),
        parentId: r.parent_id ? RevisionId.parse(r.parent_id) : null,
        isCurrent: r.revision_id === doc.revisionId,
      })),
    };
  }
  async grep(a: ParsedInput<"grep">): Promise<CommandResults["grep"]> {
    const rows = await this.db
      .prepare(
        `${selectDocument} WHERE ${latest} AND d.archived=0 AND substr(d.path,1,?)=? AND (instr(lower(r.content),lower(?))>0 OR instr(lower(d.title),lower(?))>0 OR instr(lower(d.path),lower(?))>0) ORDER BY r.created_at DESC LIMIT ?`,
      )
      .bind(a.prefix.length, a.prefix, a.query, a.query, a.query, a.limit)
      .all<Row>();
    return {
      matches: rows.results.map((r) => {
        // SQLite lower() folds ASCII only. Preserve UTF-16 offsets for all other text.
        const fold = (text: string) =>
          text.replace(/[A-Z]/g, (c) => c.toLowerCase());
        const start = fold(r.content).indexOf(fold(a.query));
        return {
          document: summary(r),
          excerpt: r.content.slice(
            Math.max(0, start - 60),
            Math.max(0, start) + 180,
          ),
          start,
          end: start < 0 ? -1 : start + a.query.length,
        };
      }),
    };
  }
  private async anchor(a: AnchorInput): Promise<Anchor> {
    const rev = await this.db
      .prepare("SELECT document_id,content FROM revisions WHERE id=?")
      .bind(a.revisionId)
      .first<{ document_id: string; content: string }>();
    if (!rev)
      throw new DomainError("NOT_FOUND", "Anchor revision not found.", 404);
    validateAnchor(rev.content, a);
    return {
      ...a,
      id: AnchorId.parse(crypto.randomUUID()),
      documentId: DocumentId.parse(rev.document_id),
    };
  }
  private insertAnchor(a: Anchor) {
    return this.db
      .prepare(
        "INSERT INTO anchors(id,revision_id,start,end,quote) VALUES(?,?,?,?,?)",
      )
      .bind(a.id, a.revisionId, a.start, a.end, a.quote);
  }
  async link(a: ParsedInput<"link">): Promise<Connection> {
    const from = await this.anchor(a.from),
      to = await this.anchor(a.to);
    const c: Connection = {
      id: ConnectionId.parse(crypto.randomUUID()),
      from,
      to,
      relation: a.relation,
      label: a.label,
      createdAt: now(),
    };
    await this.db.batch([
      this.insertAnchor(from),
      this.insertAnchor(to),
      this.db
        .prepare(
          "INSERT INTO connections(id,from_id,to_id,relation,label,created_at) VALUES(?,?,?,?,?,?)",
        )
        .bind(c.id, from.id, to.id, c.relation, c.label, c.createdAt),
    ]);
    return c;
  }
  async getAnchor(id: string): Promise<Anchor> {
    const a = await this.db
      .prepare(
        "SELECT a.*,r.document_id FROM anchors a JOIN revisions r ON r.id=a.revision_id WHERE a.id=?",
      )
      .bind(id)
      .first<{
        id: string;
        revision_id: string;
        document_id: string;
        start: number;
        end: number;
        quote: string;
      }>();
    if (!a) throw new DomainError("NOT_FOUND", "Anchor not found.", 404);
    return {
      id: AnchorId.parse(a.id),
      revisionId: RevisionId.parse(a.revision_id),
      documentId: DocumentId.parse(a.document_id),
      start: a.start,
      end: a.end,
      quote: a.quote,
    };
  }
  async connections(documentId: DocumentId): Promise<Connection[]> {
    const rows = await this.db
      .prepare(
        "SELECT c.* FROM connections c JOIN anchors a ON a.id=c.from_id JOIN anchors b ON b.id=c.to_id JOIN revisions ra ON ra.id=a.revision_id JOIN revisions rb ON rb.id=b.revision_id WHERE ra.document_id=? OR rb.document_id=? ORDER BY c.created_at DESC LIMIT 200",
      )
      .bind(documentId, documentId)
      .all<{
        id: string;
        from_id: string;
        to_id: string;
        relation: Connection["relation"];
        label: string;
        created_at: string;
      }>();
    return Promise.all(
      rows.results.map(async (c) => ({
        id: ConnectionId.parse(c.id),
        from: await this.getAnchor(c.from_id),
        to: await this.getAnchor(c.to_id),
        relation: c.relation,
        label: c.label,
        createdAt: c.created_at,
      })),
    );
  }
  async ask(a: ParsedInput<"ask">): Promise<Question> {
    const anchor = await this.anchor(a.anchor),
      id = QuestionId.parse(crypto.randomUUID()),
      createdAt = now();
    await this.db.batch([
      this.insertAnchor(anchor),
      this.db
        .prepare(
          "INSERT INTO questions(id,anchor_id,body,created_at) VALUES(?,?,?,?)",
        )
        .bind(id, anchor.id, a.body, createdAt),
    ]);
    return { id, anchor, body: a.body, createdAt, answers: [] };
  }
  async question(id: QuestionId): Promise<Question> {
    const q = await this.db
      .prepare("SELECT * FROM questions WHERE id=?")
      .bind(id)
      .first<{
        id: string;
        anchor_id: string;
        body: string;
        created_at: string;
      }>();
    if (!q) throw new DomainError("NOT_FOUND", "Question not found.", 404);
    const answers = await this.db
      .prepare("SELECT document_id FROM answers WHERE question_id=?")
      .bind(id)
      .all<{ document_id: string }>();
    return {
      id,
      anchor: await this.getAnchor(q.anchor_id),
      body: q.body,
      createdAt: q.created_at,
      answers: answers.results.map((a) => DocumentId.parse(a.document_id)),
    };
  }
  async questions(a: ParsedInput<"questions">): Promise<Question[]> {
    const rows = await this.db
      .prepare(
        `SELECT q.id FROM questions q JOIN anchors a ON a.id=q.anchor_id JOIN revisions r ON r.id=a.revision_id WHERE (? IS NULL OR r.document_id=?) ${a.unanswered ? "AND NOT EXISTS (SELECT 1 FROM answers ans WHERE ans.question_id=q.id)" : ""} ORDER BY q.created_at DESC LIMIT ?`,
      )
      .bind(a.documentId ?? null, a.documentId ?? null, a.limit)
      .all<{ id: string }>();
    return Promise.all(
      rows.results.map((q) => this.question(QuestionId.parse(q.id))),
    );
  }
  async answer(a: ParsedInput<"answer">): Promise<Question> {
    await this.question(a.questionId);
    await this.read({ documentId: a.documentId });
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO answers(question_id,document_id) VALUES(?,?)",
      )
      .bind(a.questionId, a.documentId)
      .run();
    return this.question(a.questionId);
  }
  async open(a: ParsedInput<"open_document">): Promise<ReadingView> {
    const list = await this.list({
      prefix: "/",
      limit: 200,
      offset: 0,
      archived: false,
    });
    const target =
      a.documentId || a.path ? a : { documentId: list.documents[0]?.id };
    if (!target.documentId && !target.path)
      throw new DomainError(
        "EMPTY_SPACE",
        "Create or import your first document.",
        404,
      );
    const document = await this.read(target);
    const [connections, questions] = await Promise.all([
      this.connections(document.id),
      this.questions({
        documentId: document.id,
        unanswered: false,
        limit: 100,
      }),
    ]);
    return { document, connections, questions, documents: list.documents };
  }
  async execute<K extends CommandName>(
    name: K,
    args: unknown,
  ): Promise<CommandResults[K]> {
    const handlers: {
      [N in CommandName]: (input: ParsedInput<N>) => Promise<CommandResults[N]>;
    } = {
      ls: (a) => this.list(a),
      cat: async (a) => ({ document: await this.read(a) }),
      grep: (a) => this.grep(a),
      write: async (a) => ({ document: await this.write(a) }),
      edit: async (a) => ({ document: await this.edit(a) }),
      mv: async (a) => ({ document: await this.move(a) }),
      archive: async (a) => ({ document: await this.archive(a) }),
      history: (a) => this.history(a),
      link: async (a) => ({ connection: await this.link(a) }),
      unlink: async (a) => ({
        removed: !!(
          await this.db
            .prepare("DELETE FROM connections WHERE id=?")
            .bind(a.connectionId)
            .run()
        ).meta.changes,
      }),
      ask: async (a) => ({ question: await this.ask(a) }),
      questions: async (a) => ({ questions: await this.questions(a) }),
      answer: async (a) => ({ question: await this.answer(a) }),
      open_document: (a) => this.open(a),
      import_file: async (a) => ({ document: await importFile(this, a) }),
    };
    return handlers[name](commandSchemas[name].parse(args) as ParsedInput<K>);
  }
}
