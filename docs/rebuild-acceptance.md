# Rebuild acceptance scenarios

These are release requirements, not a list of completed checks. Record outcomes separately.

## Domain and persistence

1. Import UTF-8 TXT, Markdown and a PDF with a text layer. Create AI text through the same document service. All appear in a complete, paginated catalogue and are readable/editable through identical commands. A second client sees the same content.
2. Create two passage anchors and an explicit connection, then independently create a question and associate an existing answer document. None of these commands implicitly creates or deletes unrelated entities.
3. Edit a passage with an expected revision and exact old text. Existing connections retain their original endpoints; latest content and historical content remain distinguishable. Concurrent edits cannot silently overwrite each other.
4. Listing metadata does not read every document body. Opening a heavily connected document performs bounded database round trips. Search results expose valid source ranges, not approximate offsets in rendered Markdown.

## Reading and spatial interaction

5. Execute A → B → C → A using the five-document reading fixture, including a distant connection and a multi-line passage. Start by scrolling A, follow its exact passage to B, continue from B to C, then return through history to A. Document/revision identities, exact source ranges, independent scroll positions and selected relation restore. Later manual placements survive the return. Earlier A is identifiable context while reading C where height permits. The process requires no manual camera arrangement; selection and ordinary body clicks do not promote a companion or change document membership.
6. At desktop width and in a 390px embedded frame, following a relation exposes both exact related ranges inside their scrollable visible regions. Use beside presentation when width permits and cropped, stacked presentation otherwise. The body-font design target is at least 16.5 projected screen pixels; browser measurements from actual DOM dimensions or text ranges must be at least 16 pixels, allowing rounding. Complete paper frames may yield to readable content. Record screenshots of the relation, continuation with prior context, and restored reading. Other documents remain identifiable and reachable context, without a catalogue sidebar or overview mode. Stack hover reveals identity; activation fans a bounded window, and paging reaches the 100th equal-distance neighbor. Long titles are readable on hover, keyboard focus and touch.
7. Repeat the reading task in a 900 × 360 frame and separately exercise an extremely short frame that collapses the companion to an identifiable context paper. The collapsed state guarantees one readable endpoint; focusing the companion exchanges the exposed endpoint. Do not count that state as two simultaneously readable ranges. An unconnected document can be read without inventing a connection beam. A historical connection opens the exact old revision, with latest content as an explicit alternative. Offscreen endpoint indicators retain accurate source identity. Pan/orbit/zoom preserve selection, scrolling and editing. Validate website and actual ChatGPT embedded container sizes at 100% browser and display zoom, the existing CSS3DRenderer support boundary; record this environment with results.
8. Select across emphasis, entities, inline code, line breaks, GFM tables and emoji. Saved text always equals the exact revision slice. A question draft survives recoverable network/host errors without being silently sent twice.
9. Import, create, search, edit, move, inspect history and archive/restore through the website. Keyboard operation and narrow-screen reading must remain usable. Do not expose a mass of permanent toolbar actions.

## ChatGPT integration and access

10. The official App bridge receives a native selection question. An independent answer document and explicit connection subsequently delivered with verified `answerFor` appear as an identifiable arrival without changing current reading intent, camera, presentation, scroll, selection or draft. Explicitly choosing to read the answer then organizes it within the same document space. Ordinary AI navigation changes current only when no draft/selection/edit is protected, otherwise it offers an explicit acceptance action. Empty-space results use a typed union and render a usable import/create state.
11. Browser and MCP access reject anonymous/other-user requests server-side. Owner login works through Sites. OAuth registration, authorization, code exchange and refresh match the documented ChatGPT protocol. Service errors must not masquerade as wrong-account errors.
12. Public HTML and the App resource contain no private document contents, tokens or owner secrets. Development fixtures and telemetry are absent from production routes.

## Performance gates

13. Repeat the 1,000-section Markdown fixture from performance-baseline.md. Ordinary question typing, marking a passage and camera movement do not reparse the document. Mounted text must be bounded; avoid repeated long tasks on the interaction path.
14. Exercise the isolated fixture with 260 documents, three long documents, 80 passage connections and 100 additional distinct one-hop documents. Both active and archived metadata pagination reach completion. At most current and companion own body DOM; folded leaves remain metadata projections. The stationary scene has no continuous rendering loop.
15. In a warm 60Hz browser, target frame p95 ≤20ms and p99 ≤33ms with no >50ms long task during five seconds of direct manipulation. Record actual frame intervals, DOM counts and service query counts. Separate camera transforms from chunk parsing, cold start, network and production. Label the two-animation-frame input proxy accurately; it is not a measured single-frame camera write. Any unmet gate remains outstanding.
