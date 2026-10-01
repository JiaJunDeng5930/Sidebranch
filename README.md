# Xanadu Sidebranch

A single-owner document space on ChatGPT Sites, with an authenticated MCP server and a ChatGPT reading App. Documents persist across conversations. A public introduction sits outside the private workspace.

- TXT, Markdown, PDF and direct text use one document model. Original uploads remain downloadable.
- Immutable revisions preserve the exact text cited by a connection. Editing uses optimistic concurrency and an exact-text check.
- Passage connections are independent, bidirectional entities. Questions reference passages; answers reference independently created documents.
- The website supports browsing, literal full-text search, editing, imports, version history, paths and archiving.
- The ChatGPT App uses the same reader. Selecting text opens a question composer; submitting saves the question and sends a user message through the MCP Apps bridge.
- Every document belongs to one three-dimensional paper space. Papers retain their own positions and reading progress while focus moves between them. Every paper keeps the same size; nearby text loads according to visibility, while distant papers retain their title and outline. Returning through reading history preserves the documents and their placements.

Drag empty space to pan; Shift/Ctrl/Meta-drag or right-drag to orbit. Scroll over empty space to pan, and pinch or Alt-scroll anywhere in the scene to zoom around the pointer. On a touch screen, one finger on empty space orbits and two fingers pan and zoom. Drag a paper edge or title to move that paper; Shift-drag its edge to change depth. Click a paper to approach it. Text selection and ordinary scrolling inside a paper remain native. Keyboard users can focus a paper edge and use the arrow keys to move it, or Shift+Up/Down to change depth. Escape cancels an active gesture.

## Connect ChatGPT

Site: https://xanadu-sidebranch.atticusdeng.chatgpt.site

MCP endpoint: `https://xanadu-sidebranch.atticusdeng.chatgpt.site/mcp`

Sites provisions the native private plugin when an MCP-capable version is published. Use its platform-authenticated connection with the Site owner's ChatGPT account. The `Reading space` entrypoint opens the reader from ChatGPT's global sidebar or the current conversation; `open_document` still opens a specific document. Plugin provisioning and the user's account installation are separate steps.

## MCP operations

| Tool                         | Operation                                                               |
| ---------------------------- | ----------------------------------------------------------------------- |
| `ls`, `cat`, `grep`          | List, read and search the shared document space                         |
| `write`, `import_file`       | Create text or import TXT / Markdown / PDF via file reference or base64 |
| `edit`                       | Replace a UTF-16 range against an expected revision and exact old text  |
| `mv`, `archive`, `history`   | Change a path, archive/restore, list revisions                          |
| `link`, `unlink`             | Create or remove a connection between two exact passages                |
| `ask`, `questions`, `answer` | Save questions, find them, associate an existing answer document        |
| `open_document`              | Display a document or historical revision in the reading App            |
| `neighborhood`               | Read a paginated, two-hop projection of real revision connections       |

Names resemble filesystem commands; no shell is executed. To answer a question: read its source, `write` an answer, call `answer` with the question and document IDs, `link` relevant passages, then call `open_document` with `documentId` and `answerFor`. This announces the answer without interrupting reading. Without `answerFor`, `open_document` explicitly requests a new current document; protected drafts and selections require accepting that navigation in the reader. Creating a document never implicitly creates a connection.

Offsets are zero-based UTF-16 code units, matching JavaScript string indexing and DOM selection. Ranges are half-open `[start,end)`. A change inside or around a connected passage does not transfer the connection to a different revision. Follow a connection to read its historical endpoint; choose the latest version explicitly when needed. Renaming a path retains the document's stable ID.

## Development

Requires Node 22.13+ and the package manager pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm build:app
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The Worker uses `DB` (D1) and `BUCKET` (R2), declared in `.openai/hosting.json`. Generated SQL lives in `drizzle/`; Sites applies it on deployment. The standalone App HTML is built into `.app-build/reader.html` and embedded in its MCP resource. It contains no document data or credentials. Deploy the Worker and static output through Sites.

Use `/space` for the normal local reading experience. First initialize the local database using the ordered migrations in [local setup](docs/local-handoff.md), then run `pnpm dev`. Local Vite serve uses the Sites development identity `seedy@sites.test` with a development-only owner bootstrap and localhost origin. Production builds do not include these development values. The normal reader's local database persists in `.wrangler/state`; the QA database is separate and ephemeral.

Runtime configuration:

- `SITE_ORIGIN`: exact HTTPS Site origin, used for reader resource metadata and browser Origin checks.
- `OWNER_USER_ID`: the Site-specific trusted ChatGPT user ID, preferred after the first authenticated owner visit.
- `OWNER_BOOTSTRAP_EMAIL`: initially the email from the Sites owner's record. Only a trusted Sites dispatch identity with this email can bind the single owner row. Once pinned, subsequent authorization uses the ID. This value is configured as a secret, never committed.

Sites dispatch supplies verified user headers. A standalone deployment must provide an equivalent trusted identity boundary and strip client-supplied identity headers. The MCP endpoint uses the same trusted platform identity and pinned-owner check as the browser. Self-issued bearer tokens and service bypass credentials do not establish a user identity. Discovery and the App HTML expose no private data; every tool invocation, document command and download checks owner access server-side. Document read/write permissions remain enforced for each tool. Historical OAuth database tables are retained without accepting their tokens. `MCP_FILE_DOWNLOAD_ORIGINS` optionally supplies comma-separated exact HTTPS origins for host attachment downloads; redirects and private network addresses remain restricted. Actual ChatGPT attachment URL compatibility must be checked with the host.

`pnpm build:qa` builds a local browser harness for the real reader and MCP Apps host bridge. The Vite-only `/__qa` route creates an isolated, ephemeral Miniflare D1/R2 with sample reading material; it does not exist in production. Production configuration is managed through Sites separately. The harness offers Auto, 390, 768, 1024 and 1440-pixel viewports and an official `AppBridge` host, and can seed an isolated stress fixture of 260 documents, three 1,000-section documents, 80 passage connections and 100 additional distinct neighboring documents. This validates the bridge contract, not installation in the actual ChatGPT account. Keep this debug interface separate from the normal product preview. `node --import tsx scripts/build-qa.mjs space` builds `/__space`, a standalone 120-document interaction specimen; the `renderer` argument builds `/__renderer` for long-text selection and scrolling measurements.

## Bounds

Files are limited to 10 MiB, PDFs to 300 pages, and extracted/editable text to 1 MB or 400,000 UTF-16 code units. PDF imports require a text layer; OCR is outside this application. The reader renders Markdown and GFM, and keeps remote image loads disabled to avoid exposing reading activity to third-party servers. On the website, a question is saved and copied for ChatGPT; automatic delivery to the current conversation is available inside the App UI. WebMCP navigation is feature-detected when supported by the browser.

See [architecture](docs/architecture.md) for the entity model and the rationale for the verification gates.
