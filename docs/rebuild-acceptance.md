# Rebuild acceptance scenarios

These are release requirements, not a list of completed checks. Record outcomes separately.

## Domain and persistence

1. Import UTF-8 TXT, Markdown and a PDF with a text layer. Create AI text through the same document service. All appear in a complete, paginated catalogue and are readable/editable through identical commands. A second client sees the same content.
2. Create two passage anchors and an explicit connection, then independently create a question and associate an existing answer document. None of these commands implicitly creates or deletes unrelated entities.
3. Edit a passage with an expected revision and exact old text. Existing connections retain their original endpoints; latest content and historical content remain distinguishable. Concurrent edits cannot silently overwrite each other.
4. Listing metadata does not read every document body. Opening a heavily connected document performs bounded database round trips. Search results expose valid source ranges, not approximate offsets in rendered Markdown.

## Reading and spatial interaction

5. Open a document, scroll, follow one passage connection, and continue through another connection. All visited document views retain identity, position and independent scroll. Selecting a current view brings it into reading focus without deleting its neighbours.
6. Display several document planes with real perspective/depth and visible connections between exact ranges. Pan/zoom the workspace and return to focused reading. Gesture handling must not steal native selection or editing input.
7. The same document may have multiple views, including different revisions. Closing a view does not archive the document or delete a connection. Following a connection reveals both endpoints, including endpoints outside the currently visible range.
8. Select across emphasis, entities, inline code, line breaks, GFM tables and emoji. Saved text always equals the exact revision slice. A question draft survives recoverable network/host errors without being silently sent twice.
9. Import, create, search, edit, move, inspect history and archive/restore through the website. Keyboard operation and narrow-screen reading must remain usable. Do not expose a mass of permanent toolbar actions.

## ChatGPT integration and access

10. The official App bridge receives a native selection question. An independent answer document and explicit connection subsequently delivered by the host appear while prior reading context remains available. Empty-space results use a typed union and render a usable import/create state.
11. Browser and MCP access reject anonymous/other-user requests server-side. Owner login works through Sites. OAuth registration, authorization, code exchange and refresh match the documented ChatGPT protocol. Service errors must not masquerade as wrong-account errors.
12. Public HTML and the App resource contain no private document contents, tokens or owner secrets. Development fixtures and telemetry are absent from production routes.

## Performance gates

13. Repeat the 1,000-section Markdown fixture from performance-baseline.md. Ordinary question typing, marking a passage and camera movement do not reparse the document. Mounted text must be bounded; avoid repeated long tasks on the interaction path.
14. Exercise the isolated fixture with 260 documents, three long documents and 80 connections. Catalogue pagination reaches every document, inactive planes do not mount entire documents, and the stationary scene has no continuous rendering loop.
15. Record browser long tasks, interaction-to-paint/frame intervals, DOM counts and service query counts. Separate local measurements, network latency and production measurements. Investigate any remaining long task rather than claiming universal smoothness from one FPS number.
