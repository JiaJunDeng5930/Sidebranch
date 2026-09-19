import type { AttentionAction } from "./attention";
import type { DocumentId, RevisionId } from "../domain/model";
import type { ConnectionActivation, SurfaceInstanceId } from "./spatial-contract";

/** A token for work that is only valid in one reading context. */
export interface NavigationRequestToken {
  readonly context: number;
  readonly request: number;
  readonly origin?: {
    readonly surfaceId: SurfaceInstanceId;
    readonly documentId: DocumentId;
    readonly revisionId: RevisionId;
  };
  readonly activation?: ConnectionActivation;
}

/** Keep request counters finite and monotonic across a long lived session. */
export function nextRequest(value: number): number {
  return value >= Number.MAX_SAFE_INTEGER ? 1 : value + 1;
}

export function requestToken(
  context: number,
  request: number,
  metadata: Pick<NavigationRequestToken, "origin" | "activation"> = {},
): NavigationRequestToken {
  return { context, request, ...metadata };
}

export function isCurrentRequest(
  token: NavigationRequestToken,
  context: number,
  request: number,
): boolean {
  return token.context === context && token.request === request;
}

/** Actions that can make an in-flight read point at the wrong surface. */
export function changesReadingContext(action: AttentionAction): boolean {
  switch (action.type) {
    case "navigate":
    case "compare":
    case "inspect-connection":
    case "promote":
    case "return-to-current":
    case "history":
    case "replace-revision":
      return true;
    case "scroll":
    case "focus":
    case "camera":
      return false;
  }
}
