import {
  AnchorInput,
  validateAnchor,
  type DocumentRevision,
  type DocumentSummary,
  type OpenDocumentResult,
  type Question,
  type RevisionId,
} from "../../lib/domain/model";
import type { ReadingPosition } from "../../lib/reader/attention";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}

export function isReady(
  result: OpenDocumentResult,
): result is Extract<OpenDocumentResult, { status: "ready" }> {
  return result.status === "ready";
}

export function makeAnchor(
  document: DocumentRevision,
  start: number,
  end: number,
): AnchorInput | null {
  if (start < 0 || end <= start || end > document.content.length) return null;
  const quote = document.content.slice(start, end);
  try {
    validateAnchor(document.content, {
      revisionId: document.revisionId,
      start,
      end,
      quote,
    });
    return { revisionId: document.revisionId, start, end, quote };
  } catch {
    return null;
  }
}

export function summaryFor(
  documents: readonly DocumentSummary[],
  position: ReadingPosition,
  cache: ReadonlyMap<RevisionId, { document: DocumentRevision }>,
): DocumentSummary | null {
  const summary = documents.find(
    (document) =>
      document.id === position.documentId &&
      document.revisionId === position.revisionId,
  );
  if (summary) return summary;
  const cached = cache.get(position.revisionId)?.document;
  if (cached) return cached;
  // A return leaf is a metadata affordance. Never invent a DocumentSummary
  // when the catalogue and bounded revision cache cannot prove its identity.
  return null;
}

export function answerArrival(result: OpenDocumentResult): Question | null {
  return isReady(result) ? (result.arrival?.question ?? null) : null;
}
