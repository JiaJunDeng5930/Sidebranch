"use client";
import React, { memo, useCallback, useMemo } from "react";
import type {
  AnchorInput,
  Connection,
  ConnectionId,
  DocumentRevision,
} from "../../lib/domain/model";
import { relationColors } from "../../lib/reader/relations";
import { Passage } from "./passage";

/** Text geometry depends on the immutable revision and its anchors, not camera or composer state. */
export const DocumentPassage = memo(function DocumentPassage({
  document,
  focus,
  connections,
  onSelectText,
  onActivateConnection,
  onGeometryChange,
}: {
  document: DocumentRevision;
  focus: AnchorInput | null;
  connections: readonly Connection[];
  onSelectText: (
    anchor: AnchorInput,
    document: DocumentRevision,
    rect: DOMRect,
  ) => void;
  onActivateConnection: (id: ConnectionId) => void;
  onGeometryChange: () => void;
}) {
  const marks = useMemo(
    () =>
      connections.flatMap((connection) =>
        [connection.from, connection.to]
          .filter((anchor) => anchor.revisionId === document.revisionId)
          .map((anchor) => ({
            id: connection.id,
            anchor,
            color: relationColors[connection.relation],
          })),
      ),
    [connections, document.revisionId],
  );
  const onSelect = useCallback(
    (anchor: AnchorInput, rect: DOMRect) =>
      onSelectText(anchor, document, rect),
    [document, onSelectText],
  );
  const onActivateMark = useCallback(
    (id: string) => {
      const connection = connections.find((item) => item.id === id);
      if (connection) onActivateConnection(connection.id);
    },
    [connections, onActivateConnection],
  );
  return (
    <Passage
      doc={document}
      focus={focus}
      marks={marks}
      onSelect={onSelect}
      onActivateMark={onActivateMark}
      onGeometryChange={onGeometryChange}
    />
  );
});
