import type {
  ConnectionId,
  Connection,
  DocumentId,
  DocumentSummary,
  RevisionId,
} from "../domain/model";
import type { NeighborhoodNode } from "../domain/space";
import type { ReadingPosition } from "./attention";

/** A reader's knowledge of one neighborhood; loading is not a domain fact. */
export type NeighborhoodKnowledge =
  | { readonly kind: "idle" }
  | {
      readonly kind: "loading";
      readonly centerRevisionId: RevisionId;
      readonly nodes: readonly NeighborhoodNode[];
    }
  | {
      readonly kind: "partial";
      readonly centerRevisionId: RevisionId;
      readonly nodes: readonly NeighborhoodNode[];
      readonly nextCursor: string;
    }
  | {
      readonly kind: "complete";
      readonly centerRevisionId: RevisionId;
      readonly nodes: readonly NeighborhoodNode[];
    }
  | {
      readonly kind: "failed";
      readonly centerRevisionId: RevisionId;
      readonly nodes: readonly NeighborhoodNode[];
      readonly message: string;
    };

export interface DocumentTarget {
  readonly documentId: DocumentId;
  readonly revisionId: RevisionId;
  readonly focus: ReadingPosition["focus"];
}

export interface EdgeLeaf {
  readonly document: DocumentSummary;
  readonly target: DocumentTarget;
  readonly sequence: number;
  readonly band: "direct" | "second" | "other" | "archive";
  readonly connectionId: ConnectionId | null;
  readonly alternatives: readonly {
    readonly revisionId: RevisionId;
    readonly sequence: number;
  }[];
}

/**
 * The scene can prove a follow only from the exact connection currently in
 * its loaded set.  A neighborhood node's connectionId is useful evidence for
 * discovery, but a distance-two proof (or a stale/missing detail row) must
 * remain an exact-target comparison.
 */
export type EdgeActivation =
  | { readonly kind: "follow"; readonly connectionId: ConnectionId }
  | { readonly kind: "compare"; readonly target: DocumentTarget };

function endpointIsTarget(
  endpoint: Connection["from"],
  target: DocumentTarget,
): boolean {
  return (
    endpoint.documentId === target.documentId &&
    endpoint.revisionId === target.revisionId
  );
}

function connectionJoinsTarget(
  connection: Connection,
  currentRevisionId: RevisionId,
  target: DocumentTarget,
): boolean {
  return (
    (connection.from.revisionId === currentRevisionId &&
      endpointIsTarget(connection.to, target)) ||
    (connection.to.revisionId === currentRevisionId &&
      endpointIsTarget(connection.from, target))
  );
}

/**
 * Resolve every edge entry through the same semantic boundary.  A connection
 * id only authorizes follow when its loaded endpoints join the current exact
 * revision to the leaf's exact target revision.  The fallback deliberately
 * keeps the target revision so missing detail and second-hop evidence remain
 * reachable without fabricating a direct connection.
 */
export function resolveEdgeActivation(
  leaf: Pick<EdgeLeaf, "connectionId" | "target">,
  currentRevisionId: RevisionId | null,
  connections: readonly Connection[],
): EdgeActivation {
  if (leaf.connectionId && currentRevisionId) {
    const connection = connections.find(
      (candidate) => candidate.id === leaf.connectionId,
    );
    if (
      connection &&
      connectionJoinsTarget(connection, currentRevisionId, leaf.target)
    ) {
      return { kind: "follow", connectionId: connection.id };
    }
  }
  return { kind: "compare", target: leaf.target };
}

type RelationCandidate = {
  readonly node: NeighborhoodNode;
};

const BAND_ORDER: Readonly<Record<EdgeLeaf["band"], number>> = {
  direct: 0,
  second: 1,
  other: 2,
  archive: 3,
};

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareMetadata(
  left: DocumentSummary,
  right: DocumentSummary,
): number {
  return (
    compareText(left.title, right.title) ||
    compareText(left.path, right.path) ||
    compareText(left.id, right.id)
  );
}

function relationNodes(
  knowledge: NeighborhoodKnowledge,
): readonly NeighborhoodNode[] {
  switch (knowledge.kind) {
    case "idle":
      return [];
    case "loading":
    case "partial":
    case "complete":
    case "failed":
      return knowledge.nodes;
  }
  return [];
}

function compareCandidates(
  left: RelationCandidate,
  right: RelationCandidate,
): number {
  const leftNode = left.node;
  const rightNode = right.node;
  const distance = leftNode.distance - rightNode.distance;
  if (distance !== 0) return distance;

  // When a connection can target both a historical and the current revision,
  // keep the current visible revision as the primary leaf.  The shortest
  // graph distance still wins before this preference is considered.
  const leftCurrent = Number(
    leftNode.revisionId === leftNode.document.revisionId,
  );
  const rightCurrent = Number(
    rightNode.revisionId === rightNode.document.revisionId,
  );
  if (leftCurrent !== rightCurrent) return rightCurrent - leftCurrent;

  const sequence = rightNode.sequence - leftNode.sequence;
  if (sequence !== 0) return sequence;
  return (
    compareText(leftNode.revisionId, rightNode.revisionId) ||
    compareText(leftNode.connectionId, rightNode.connectionId)
  );
}

function compareAlternatives(
  left: { readonly revisionId: RevisionId; readonly sequence: number },
  right: { readonly revisionId: RevisionId; readonly sequence: number },
  currentRevisionId: RevisionId,
): number {
  const leftCurrent = Number(left.revisionId === currentRevisionId);
  const rightCurrent = Number(right.revisionId === currentRevisionId);
  if (leftCurrent !== rightCurrent) return rightCurrent - leftCurrent;
  return (
    right.sequence - left.sequence ||
    compareText(left.revisionId, right.revisionId)
  );
}

function makeAlternatives(
  document: DocumentSummary,
  selected: NeighborhoodNode,
  candidates: readonly RelationCandidate[],
): readonly { readonly revisionId: RevisionId; readonly sequence: number }[] {
  const byRevision = new Map<
    RevisionId,
    { revisionId: RevisionId; sequence: number }
  >();

  // The latest metadata is the only source of the current revision when the
  // selected relationship points at an older immutable revision.
  if (document.revisionId !== selected.revisionId) {
    byRevision.set(document.revisionId, {
      revisionId: document.revisionId,
      sequence: document.sequence,
    });
  }

  for (const candidate of candidates) {
    if (candidate.node.revisionId === selected.revisionId) continue;
    const previous = byRevision.get(candidate.node.revisionId);
    if (!previous || candidate.node.sequence > previous.sequence) {
      byRevision.set(candidate.node.revisionId, {
        revisionId: candidate.node.revisionId,
        sequence: candidate.node.sequence,
      });
    }
  }

  return [...byRevision.values()].sort((left, right) =>
    compareAlternatives(left, right, document.revisionId),
  );
}

function makeRelationLeaf(
  document: DocumentSummary,
  candidates: readonly RelationCandidate[],
): EdgeLeaf {
  const selected = [...candidates].sort(compareCandidates)[0].node;
  return {
    document,
    target: {
      documentId: document.id,
      revisionId: selected.revisionId,
      focus: null,
    },
    sequence: selected.sequence,
    band: selected.distance === 1 ? "direct" : "second",
    connectionId: selected.connectionId,
    alternatives: makeAlternatives(document, selected, candidates),
  };
}

function makeOtherLeaf(
  document: DocumentSummary,
  band: "other" | "archive",
): EdgeLeaf {
  return {
    document,
    target: {
      documentId: document.id,
      revisionId: document.revisionId,
      focus: null,
    },
    sequence: document.sequence,
    band,
    connectionId: null,
    alternatives: [],
  };
}

/**
 * Project catalogue metadata into one navigable leaf per Document.  Relation
 * knowledge is deliberately additive: partial/loading/failed pages can only
 * move returned nodes inward; every unproven document remains in the outer
 * bands until a later page proves otherwise.
 */
export function projectSpaceEdges(
  documents: readonly DocumentSummary[],
  knowledge: NeighborhoodKnowledge,
  excludedPositions: readonly ReadingPosition[],
): readonly EdgeLeaf[] {
  const excluded = new Set(
    excludedPositions.map((position) => position.documentId),
  );
  const byDocument = new Map<DocumentId, RelationCandidate[]>();
  for (const node of relationNodes(knowledge)) {
    const candidates = byDocument.get(node.document.id) ?? [];
    candidates.push({ node });
    byDocument.set(node.document.id, candidates);
  }

  const seen = new Set<DocumentId>();
  const leaves: EdgeLeaf[] = [];
  for (const document of documents) {
    if (excluded.has(document.id) || seen.has(document.id)) continue;
    seen.add(document.id);
    const candidates = byDocument.get(document.id);
    if (candidates?.length) {
      leaves.push(makeRelationLeaf(document, candidates));
    } else {
      leaves.push(
        makeOtherLeaf(document, document.archived ? "archive" : "other"),
      );
    }
  }

  leaves.sort(
    (left, right) =>
      BAND_ORDER[left.band] - BAND_ORDER[right.band] ||
      compareMetadata(left.document, right.document),
  );
  return leaves;
}
