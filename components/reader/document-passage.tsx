"use client";
import React, { memo, useCallback, useMemo } from "react";
import type {
  AnchorInput,
  Connection,
  DocumentRevision,
} from "../../lib/domain/model";
import {
  formatConnectionLabel,
  relationNavigationItems,
} from "../../lib/reader/spatial-contract";
import type {
  ConnectionActivation,
  ConnectionEndpoint,
  DocumentRenderContext,
  SurfaceInstanceId,
} from "../../lib/reader/spatial-contract";
import { Passage } from "./passage";

/** Text geometry depends on the immutable revision and its anchors, not camera or composer state. */
export const DocumentPassage = memo(function DocumentPassage({
  document,
  surfaceId,
  context,
  focus,
  connections,
  onSelectText,
  onActivateConnection,
  onGeometryChange,
}: {
  document: DocumentRevision;
  /** Stable occurrence identity created by the Reader navigation boundary. */
  surfaceId: SurfaceInstanceId;
  context?: DocumentRenderContext;
  focus: AnchorInput | null;
  connections: readonly Connection[];
  onSelectText: (
    anchor: AnchorInput,
    document: DocumentRevision,
    rect: DOMRect,
  ) => void;
  onActivateConnection: (activation: ConnectionActivation) => void;
  onGeometryChange?: () => void;
}) {
  const occurrenceId = surfaceId;
  const marks = useMemo(
    () =>
      relationNavigationItems(connections, document.revisionId).flatMap(
        (item) => {
          const connection = connections.find(
            (candidate) => candidate.id === item.connectionId,
          );
          return connection
            ? [
                {
                  id: item.connectionId,
                  anchor: item.anchor,
                  endpoint: item.endpoint,
                  relation: connection.relation,
                  label: formatConnectionLabel(connection, item.endpoint),
                },
              ]
            : [];
        },
      ),
    [connections, document.revisionId],
  );
  const onSelect = useCallback(
    (anchor: AnchorInput, rect: DOMRect) =>
      onSelectText(anchor, document, rect),
    [document, onSelectText],
  );
  const onActivateMark = useCallback(
    (id: string, endpoint: ConnectionEndpoint = "from") => {
      const connection = connections.find((item) => item.id === id);
      if (!connection) return;
      onActivateConnection({
        connectionId: connection.id,
        origin: {
          kind: "surface",
          surfaceId: occurrenceId,
          endpoint,
        },
      });
    },
    [connections, occurrenceId, onActivateConnection],
  );
  return (
    <Passage
      doc={document}
      surfaceId={occurrenceId}
      context={context}
      focus={focus}
      marks={marks}
      onSelect={onSelect}
      onActivateMark={onActivateMark}
      onGeometryChange={onGeometryChange}
    />
  );
});
