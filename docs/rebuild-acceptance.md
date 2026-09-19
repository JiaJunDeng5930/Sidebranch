# Rebuild acceptance scenarios

These are release requirements, not a list of completed checks. Record outcomes separately.

## Domain and persistence

1. Import UTF-8 TXT, Markdown and a PDF with a text layer. Create AI text through the same document service. All appear in a complete, paginated catalogue and are readable/editable through identical commands. A second client sees the same content.
2. Create two passage anchors and an explicit connection, then independently create a question and associate an existing answer document. None of these commands implicitly creates or deletes unrelated entities.
3. Edit a passage with an expected revision and exact old text. Existing connections retain their original endpoints; latest content and historical content remain distinguishable. Concurrent edits cannot silently overwrite each other.
4. Listing metadata does not read every document body. Opening a heavily connected document performs bounded database round trips. Search results expose valid source ranges, not approximate offsets in rendered Markdown.

## Reading and spatial interaction

5. Read A, scroll, follow a passage to companion B, explicitly continue reading B, then use the return leaf. A/B revision identities, exact passages and scroll positions restore. No action opens or closes a document's membership in the space. Native selection or a body click never promotes the companion.
6. Current and companion texts remain readable within the scene container. Other documents appear as folded edge sheets. Stack hover reveals identity; activation fans a bounded window, and paging reaches the 100th equal-distance neighbor. Long titles are readable on hover, keyboard focus and touch. No catalogue sidebar or overview mode exists.
7. An unconnected document can be read beside the current one without inventing a connection beam. A historical connection opens the exact old revision, with latest content available as an explicit alternative. Following connections reveals exact endpoints, including direction indicators for text outside the mounted window. Pan/orbit/zoom do not steal selection, scrolling or editing input; all these actions remain usable in a 390px frame and a short App container.
8. Select across emphasis, entities, inline code, line breaks, GFM tables and emoji. Saved text always equals the exact revision slice. A question draft survives recoverable network/host errors without being silently sent twice.
9. Import, create, search, edit, move, inspect history and archive/restore through the website. Keyboard operation and narrow-screen reading must remain usable. Do not expose a mass of permanent toolbar actions.

## ChatGPT integration and access

10. The official App bridge receives a native selection question. An independent answer document and explicit connection subsequently delivered with verified `answerFor` appear as an arrival without changing current reading. Ordinary AI navigation changes current only when no draft/selection/edit is protected, otherwise it offers an explicit acceptance action. Empty-space results use a typed union and render a usable import/create state.
11. Browser and MCP access reject anonymous/other-user requests server-side. Owner login works through Sites. OAuth registration, authorization, code exchange and refresh match the documented ChatGPT protocol. Service errors must not masquerade as wrong-account errors.
12. Public HTML and the App resource contain no private document contents, tokens or owner secrets. Development fixtures and telemetry are absent from production routes.

## Performance gates

13. Repeat the 1,000-section Markdown fixture from performance-baseline.md. Ordinary question typing, marking a passage and camera movement do not reparse the document. Mounted text must be bounded; avoid repeated long tasks on the interaction path.
14. Exercise the isolated fixture with 260 documents, three long documents, 80 passage connections and 100 additional distinct one-hop documents. Both active and archived metadata pagination reach completion. At most current and companion own body DOM; folded leaves remain metadata projections. The stationary scene has no continuous rendering loop.
15. In a warm 60Hz browser, target frame p95 ≤20ms and p99 ≤33ms with no >50ms long task during five seconds of direct manipulation. Record actual frame intervals, DOM counts and service query counts. Separate camera transforms from chunk parsing, cold start, network and production. Label the two-animation-frame input proxy accurately; it is not a measured single-frame camera write. Any unmet gate remains outstanding.
