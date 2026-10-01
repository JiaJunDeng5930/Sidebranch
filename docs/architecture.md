# Xanadu Sidebranch

Decision rationale: [reading intent ownership and viewport edges](adr/0001-reading-intents-and-viewport-edges.md).

A single-owner document space hosted on ChatGPT Sites (Cloudflare Worker, D1, R2), shared by the website and a ChatGPT MCP App. No model API or external database is required. The owner delegated visual decisions: parallel pages and visible passage connections from Project Xanadu, an ink-colored spatial desk with warm paper, restrained typography, no decorative animation or generated artwork.

## Entities and invariants

- A Document has a stable ID and a unique absolute path. Imported files and AI-written documents use this same entity.
- A Revision is immutable document content with a monotonically increasing sequence. Updating requires the exact previous revision ID. Concurrent writes cannot silently replace one another.
- An Asset stores immutable uploaded bytes in R2; an imported document may reference its original asset. PDF text becomes ordinary editable document content. Scanned PDFs without extractable text are rejected with an explanation; no OCR is claimed.
- An Anchor identifies a nonempty UTF-16 range in one immutable revision and records its exact text. Offsets are explicit to match JavaScript DOM text selection. An anchor cannot be assigned to another revision. Editing never silently reinterprets the connection's meaning.
- A Connection joins two anchors and has a relation and label. Connections are bidirectional for navigation; their optional relation preserves direction. They exist independently of questions and documents.
- A Question contains the user's words and references an anchor. An Answer associates a question with an independently existing document. Creating an answer does not automatically create a connection; the AI chooses the relevant passages explicitly.
- Reading state (current document, comparison document, scroll) belongs to each browser or App instance. Different conversations share documents but do not overwrite one another's current document.

## Reading entities

`DocumentEntity`, `RevisionEntity`, `AssetEntity`, `AnchorEntity`, `ConnectionEntity`, `QuestionEntity` and `AnswerAssociationEntity` are the persistence model. Row mappers reconstruct them at the database boundary. `NewAnchorEntity` requires a checked immutable revision slice; stored anchors and newly validated anchors are distinct types.

A `ReadingPosition` identifies one document revision, an optional exact passage and a scroll offset. `AttentionState` owns the current position, optional companion, camera checkpoint and lightweight navigation history. There is no open-file membership: every document belongs to the space, including those whose text is not mounted. Activating a folded leaf requests companion reading; promoting that companion changes the current position and leaves a return leaf. History restores positions, versions and scroll without retaining old DOM or document bodies. The reader session owns data, bounded revision cache, drafts and asynchronous requests; it does not mirror attention or navigation history. Editor create/edit/rename states encode their different required inputs. Asynchronous results are gated by request generation and target identity.

The paper field presents the current document and at most one readable companion. Other documents remain projected as peripheral folded sheets. Explicit stack activation fans a bounded, stable window of leaves; paging can reach every indexed document. Hover reveals identity without loading a body or navigating. The neighborhood projection follows real connections between immutable revisions: another revision of the same document does not imply a graph edge. Unknown distances remain unknown while metadata or graph pages load. Alternative versions retain their own identities.

Blank-space dragging pans; Shift-dragging orbits. Shift-wheel pans horizontally, while Ctrl/pinch wheel zooms the camera only over the stage. Native document scrolling, browser zoom and text selection keep ownership over text. The camera writes transforms through one on-demand animation frame and checkpoints only at rest. Exact source ranges supply both highlights and connection geometry; camera-only changes project cached geometry without re-reading text ranges. Narrow containers preserve the same reading actions with sequential papers. There is no overview mode or permanent document sidebar.

An ordinary AI `open_document` explicitly requests a new current document. Supplying `answerFor` instead announces an answer; the service first verifies the independent answer association. Arrival never discards a selection or draft. Explicit host navigation during composing, editing or native selection is offered for acceptance instead of stealing the reading position.

Immutable Markdown plans are memoized. Long content mounts visible chunks, selected chunks and nonadjacent focused chunks, with measured spacers. Revision caching is bounded by entry and character budgets. Camera geometry is scheduled on demand rather than in an idle animation loop. These mechanisms are not a universal frame-rate guarantee; measurements and limits are recorded separately.

This implementation follows Xanadu's visible, bidirectional passage connections and separate documents. It does not claim true transclusion or shared source identity merely because two passages contain the same text.

## Boundaries

All commands and their results validate untrusted input with authoritative Zod schemas, then operate through one authorized service. Required document locators are an exclusive ID/path union. Metadata listing and keyset pagination do not load document bodies; connection and question pages use bounded database query counts. Branded identifiers distinguish entities at compile time. D1 uniqueness, foreign keys, immutable-row triggers and compare-and-swap writes enforce persistent invariants. There is no shell interpreter behind the filesystem-like tool names.

Sites' dispatch authenticates browser users. The configured owner is pinned by the Site-specific user ID. Initial binding, when needed, requires the exact owner email obtained from the Sites owner record and trusted dispatch identity. Other accounts fail closed. Emails are never accepted from request bodies. Native MCP requests use the same trusted Sites identity and owner check. Discovery and the public App resource remain available without document access; resolving a document store requires owner authorization, and each tool checks its document read or write permission. Platform authentication replaces the former self-issued bearer tokens; historical OAuth tables remain untouched. Remote file references use exact HTTPS origin allowlists, reject private addresses and unapproved redirects, and apply time/size limits. Browser writes require a same-origin request. No document data is embedded in public HTML or the App resource.

## Verification

Static checks cover entity identities, command schemas and handlers. Integration tests exercise stale concurrent edits, immutable history, invalid and Unicode anchors, independent answers/connections, anonymous and non-owner denial, PKCE, code replay and resource binding. Browser checks cover reading, parallel navigation, editing and mobile layout. A host bridge contract test covers App initialization, tool calls and follow-up messages; the actual ChatGPT host must also complete connection and render the App before claiming end-to-end host verification. See [release verification](verification.md) for the checks actually performed.
