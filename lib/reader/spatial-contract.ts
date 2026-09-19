import type {
  AnchorInput,
  Connection,
  ConnectionId,
  DocumentId,
  DocumentRevision,
  DocumentSummary,
  RevisionId,
} from "../domain/model";
import type { DocumentTarget, NeighborhoodKnowledge } from "./space-index";
import { relationNames } from "./relations";
import type {
  CameraPose,
  ReadingPosition,
  SurfaceRole,
} from "./attention";

/** A front-end occurrence of a revision on the reading plane.
 *
 * This is deliberately separate from `RevisionId`: the same immutable
 * revision may be rendered in both ends of an internal connection, and each
 * occurrence owns its DOM ranges, scroll position, and geometry cache.
 */
export type SurfaceInstanceId = string & {
  readonly __surfaceInstanceId: unique symbol;
};

let nextSurfaceInstance = 0;

/** Construct an occurrence id at a Reader/navigation boundary. */
export function createSurfaceInstanceId(prefix = "surface"): SurfaceInstanceId {
  nextSurfaceInstance =
    nextSurfaceInstance >= Number.MAX_SAFE_INTEGER ? 1 : nextSurfaceInstance + 1;
  return `${prefix}-${nextSurfaceInstance.toString(36)}` as SurfaceInstanceId;
}

/** Brand a stable id received from an existing Reader occurrence. */
export function surfaceInstanceId(value: string): SurfaceInstanceId {
  if (!value.trim()) throw new Error("A surface instance id cannot be empty");
  return value as SurfaceInstanceId;
}

export type ConnectionEndpoint = "from" | "to";

/** The source of a connection activation, including the exact page occurrence. */
export type ConnectionActivationOrigin =
  | {
      readonly kind: "surface";
      readonly surfaceId: SurfaceInstanceId;
      readonly endpoint: ConnectionEndpoint;
    }
  | { readonly kind: "bridge" };

/** Shared activation payload for text, bridge, paper-edge, and preview UI. */
export interface ConnectionActivation {
  readonly connectionId: ConnectionId;
  readonly origin: ConnectionActivationOrigin;
}

/** A target surface passed through the scene without losing occurrence identity. */
export interface ReadingSurface {
  readonly surfaceId: SurfaceInstanceId;
  readonly position: ReadingPosition;
  readonly document: DocumentRevision;
}

export interface ReturnLeaf {
  readonly position: ReadingPosition;
  readonly document: DocumentSummary;
  readonly historyIndex: number;
}

export interface PendingSurface {
  readonly target: DocumentTarget;
  readonly title: string;
  readonly error: string | null;
}

export type AnchorCoverage = "complete" | "partial" | "unmounted" | "unmapped";

export interface MissingAnchorSpan {
  readonly start: number;
  readonly end: number;
}

/** The actual DOM ranges and source coverage for one occurrence. */
export interface ResolvedAnchor {
  readonly ranges: readonly Range[];
  readonly coverage: AnchorCoverage;
  readonly missing: readonly MissingAnchorSpan[];
}

/** Passage methods consumed by Scene geometry and hit testing. */
export interface PassageHandle {
  resolveAnchor(anchor: AnchorInput): ResolvedAnchor;
  firstVisibleSourceOffset(): number | null;
}

/** One occurrence registers only its own DOM/range state. */
export interface DocumentRenderContext {
  registerPassage(handle: PassageHandle | null): void;
  onGeometryChange(): void;
}

export type PresentationRequest =
  | {
      readonly id: number;
      readonly kind: "align-ranges";
      readonly surfaces: readonly SurfaceInstanceId[];
    }
  | { readonly id: number; readonly kind: "restore" }
  | { readonly id: number; readonly kind: "layout" };

export interface RelationNavigationState {
  /** Complete stable sequence for the current revision, beyond beam budget. */
  readonly items: readonly RelationNavigationItem[];
  readonly current: RelationNavigationItem | null;
  readonly ordinal: number | null;
  readonly total: number;
  readonly canPrevious: boolean;
  readonly canNext: boolean;
  readonly loading: boolean;
  readonly error: string | null;
}

export interface RelationNavigationItem {
  readonly connectionId: ConnectionId;
  readonly endpoint: ConnectionEndpoint;
  readonly anchor: AnchorInput;
  readonly relation: Connection["relation"];
  readonly label: string;
}

/** Keep paper controls and Passage choices textually identical. */
export function formatConnectionLabel(
  connection: Connection,
  endpoint: ConnectionEndpoint,
): string {
  const counterpart = endpoint === "from" ? connection.to : connection.from;
  return `${relationNames[connection.relation]} · ${connection.label || counterpart.quote}`;
}

/** Stable sequence shared by paper controls and Passage context menus. */
export function relationNavigationItems(
  connections: readonly Connection[],
  revisionId: RevisionId,
): readonly RelationNavigationItem[] {
  const items: RelationNavigationItem[] = [];
  for (const connection of connections) {
    for (const endpoint of ["from", "to"] as const) {
      const anchor = connection[endpoint];
      if (anchor.revisionId !== revisionId) continue;
      items.push({
        connectionId: connection.id,
        endpoint,
        anchor: { ...anchor },
        relation: connection.relation,
        label: formatConnectionLabel(connection, endpoint),
      });
    }
  }
  return items.sort((left, right) =>
    left.anchor.start - right.anchor.start ||
    left.anchor.end - right.anchor.end ||
    (String(left.connectionId) < String(right.connectionId)
      ? -1
      : String(left.connectionId) > String(right.connectionId)
        ? 1
        : 0) ||
    (left.endpoint === right.endpoint ? 0 : left.endpoint === "from" ? -1 : 1),
  );
}

export interface SpatialCatalogueState {
  readonly activeComplete: boolean;
  readonly archivedComplete: boolean;
  readonly loading: boolean;
}

/** The complete data contract consumed by SpatialScene. */
export interface SpatialSceneProps<RenderedDocument = unknown> {
  readonly current: ReadingSurface | null;
  readonly companion: ReadingSurface | null;
  readonly previous: ReturnLeaf | null;
  readonly camera: CameraPose;
  readonly documents: readonly DocumentSummary[];
  readonly catalogue: SpatialCatalogueState;
  readonly neighborhood: NeighborhoodKnowledge;
  readonly connections: readonly Connection[];
  /** Read-only derivation from attention; no parallel session source. */
  readonly selectedConnectionId: ConnectionId | null;
  readonly pending: PendingSurface | null;
  readonly onReadBeside: (target: DocumentTarget) => void;
  readonly onPromote: () => void;
  readonly onReturnToCurrent: () => void;
  readonly onFollow: (activation: ConnectionActivation) => void;
  readonly onStepConnection: (direction: -1 | 1) => void;
  readonly relationNavigation: RelationNavigationState;
  /** Scene is the single owner of motion, focus scrolling, and restore policy. */
  readonly presentation: PresentationRequest;
  readonly onHistory: (index: number) => void;
  readonly onScroll: (
    surfaceId: SurfaceInstanceId,
    scrollTop: number,
    presentationId: number,
  ) => void;
  readonly onCameraCheckpoint: (pose: CameraPose) => void;
  readonly renderDocument: (
    surface: ReadingSurface,
    role: SurfaceRole,
    context: DocumentRenderContext,
  ) => RenderedDocument;
  /** Presentation-owned slot for the document's existing action menu. */
  readonly renderDocumentMenu?: (
    surface: ReadingSurface,
    role: SurfaceRole,
  ) => RenderedDocument;
  readonly loadPreview: (
    target: DocumentTarget,
  ) => Promise<DocumentRevision | null>;
}

export type SurfacePositionTarget = Pick<
  ReadingPosition,
  "documentId" | "revisionId" | "focus" | "scrollTop"
> & { readonly surfaceId: SurfaceInstanceId };

export type DocumentIdentity = {
  readonly documentId: DocumentId;
  readonly revisionId: RevisionId;
};
