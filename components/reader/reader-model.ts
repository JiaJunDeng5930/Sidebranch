import {
  AnchorInput,
  validateAnchor,
  type DocumentRevision,
  type OpenDocumentResult,
  type Question,
} from "../../lib/domain/model";

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

export function answerArrival(result: OpenDocumentResult): Question | null {
  return isReady(result) ? (result.arrival?.question ?? null) : null;
}
