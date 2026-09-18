# Xanadu Sidebranch

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

A `DocumentView` is a particular open presentation of a revision, with its own `ViewId`, position, scroll and focused passage. It is not a document. Several views may show the same document or different revisions. `SceneState` owns camera and navigation history; its empty/populated union prevents an empty scene from claiming a current view. The reader session owns drafts and relation projections, not a second camera/history. Editor create/edit/rename states encode their different required inputs. Asynchronous results are gated by request generation and target identity.

The reading mode aligns current and companion papers. Overview changes the camera to a fitted perspective; blank-space dragging pans, Shift-dragging orbits and the wheel zooms. Native document scrolling and text selection retain their usual behavior. Exact source ranges supply both highlights and connection geometry. Related previews are deduplicated by revision; distant views use excerpts. On narrow screens, the same documents become a native stacked reader.

Immutable Markdown plans are memoized. Long content mounts visible chunks, selected chunks and nonadjacent focused chunks, with measured spacers. Revision caching is bounded by entry and character budgets. Camera geometry is scheduled on demand rather than in an idle animation loop. These mechanisms are not a universal frame-rate guarantee; measurements and limits are recorded separately.

This implementation follows Xanadu's visible, bidirectional passage connections and separate documents. It does not claim true transclusion or shared source identity merely because two passages contain the same text.

## Boundaries

All commands and their results validate untrusted input with authoritative Zod schemas, then operate through one authorized service. Required document locators are an exclusive ID/path union. Metadata listing and keyset pagination do not load document bodies; connection and question pages use bounded database query counts. Branded identifiers distinguish entities at compile time. D1 uniqueness, foreign keys, immutable-row triggers and compare-and-swap writes enforce persistent invariants. There is no shell interpreter behind the filesystem-like tool names.

Sites' dispatch authenticates browser users. The configured owner is pinned by the Site-specific user ID. Initial binding, when needed, requires the exact owner email obtained from the Sites owner record and trusted dispatch identity. Other accounts fail closed. Emails are never accepted from request bodies. OAuth uses the same owner check at authorization and hashed opaque bearer tokens on each MCP call. OAuth authorization codes are short-lived, PKCE S256-bound, resource-bound, client-bound, and atomically single-use. The consent form uses a signed-in, single-use request nonce. Read and write OAuth scopes are persisted and enforced for every tool. Remote file references use exact HTTPS origin allowlists, reject private addresses and unapproved redirects, and apply time/size limits. Browser writes require a same-origin request. No document data is embedded in public HTML or the App resource.

## Verification

Static checks cover entity identities, command schemas and handlers. Integration tests exercise stale concurrent edits, immutable history, invalid and Unicode anchors, independent answers/connections, anonymous and non-owner denial, PKCE, code replay and resource binding. Browser checks cover reading, parallel navigation, editing and mobile layout. A host bridge contract test covers App initialization, tool calls and follow-up messages; the actual ChatGPT host must also complete connection and render the App before claiming end-to-end host verification. See [release verification](verification.md) for the checks actually performed.
