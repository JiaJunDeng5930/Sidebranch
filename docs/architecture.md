# Xanadu Sidebranch

A single-owner document space hosted on ChatGPT Sites (Cloudflare Worker, D1, R2), shared by the website and a ChatGPT MCP App. No model API or external database is required. The owner delegated visual decisions: parallel pages and visible passage connections from Project Xanadu, a forest-green reading room, restrained typography, no decorative animation or generated artwork.

## Entities and invariants

- A Document has a stable ID and a unique absolute path. Imported files and AI-written documents use this same entity.
- A Revision is immutable document content with a monotonically increasing sequence. Updating requires the exact previous revision ID. Concurrent writes cannot silently replace one another.
- An Asset stores immutable uploaded bytes in R2; an imported document may reference its original asset. PDF text becomes ordinary editable document content. Scanned PDFs without extractable text are rejected with an explanation; no OCR is claimed.
- An Anchor identifies a nonempty UTF-16 range in one immutable revision and records its exact text. Offsets are explicit to match JavaScript DOM text selection. An anchor cannot be assigned to another revision. Editing never silently reinterprets the connection's meaning.
- A Connection joins two anchors and has a relation and label. Connections are bidirectional for navigation; their optional relation preserves direction. They exist independently of questions and documents.
- A Question contains the user's words and references an anchor. An Answer associates a question with an independently existing document. Creating an answer does not automatically create a connection; the AI chooses the relevant passages explicitly.
- Reading state (current document, comparison document, scroll) belongs to each browser or App instance. Different conversations share documents but do not overwrite one another's current document.

## Boundaries

All commands validate untrusted input with Zod, then operate through one authorized service. Branded identifiers distinguish entities at compile time. D1 uniqueness, foreign keys, immutable-row triggers and compare-and-swap writes enforce persistent invariants. There is no shell interpreter behind the filesystem-like tool names.

Sites' dispatch authenticates browser users. The configured owner is pinned by the Site-specific user ID. Initial binding, when needed, requires the exact owner email obtained from the Sites owner record and trusted dispatch identity. Other accounts fail closed. Emails are never accepted from request bodies. OAuth uses the same owner check at authorization and hashed opaque bearer tokens on each MCP call. OAuth authorization codes are short-lived, PKCE S256-bound, resource-bound, client-bound, and atomically single-use. The consent form uses a signed-in, single-use request nonce. Browser writes require a same-origin request. No document data is embedded in public HTML or the App resource.

## Verification

Static checks cover entity identities, command schemas and handlers. Integration tests exercise stale concurrent edits, immutable history, invalid and Unicode anchors, independent answers/connections, anonymous and non-owner denial, PKCE, code replay and resource binding. Browser checks cover reading, parallel navigation, editing and mobile layout. A host bridge contract test covers App initialization, tool calls and follow-up messages; the actual ChatGPT host must also complete connection and render the App before claiming end-to-end host verification. See [release verification](verification.md) for the checks actually performed.
