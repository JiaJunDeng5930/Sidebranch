# Xanadu Sidebranch

A single-owner document space on ChatGPT Sites, with an authenticated MCP server and a ChatGPT reading App. Documents persist across conversations. A public introduction sits outside the private workspace.

- TXT, Markdown, PDF and direct text use one document model. Original uploads remain downloadable.
- Immutable revisions preserve the exact text cited by a connection. Editing uses optimistic concurrency and an exact-text check.
- Passage connections are independent, bidirectional entities. Questions reference passages; answers reference independently created documents.
- The website supports browsing, literal full-text search, editing, imports, version history, paths and archiving.
- The ChatGPT App uses the same reader. Selecting text opens a question composer; submitting saves the question and sends a user message through the MCP Apps bridge.

## Connect ChatGPT

Site: https://xanadu-sidebranch.atticusdeng.chatgpt.site

MCP endpoint: `https://xanadu-sidebranch.atticusdeng.chatgpt.site/api/mcp`

Add the endpoint as a custom MCP connection in ChatGPT with OAuth. Sign in with the Site owner's ChatGPT account and approve the document permissions. Ask ChatGPT to open Xanadu Sidebranch. `open_document` returns the interactive reading App. Creating the connection is a ChatGPT account action; deploying this repository does not automatically add it to the user's account.

## MCP operations

| Tool                         | Operation                                                              |
| ---------------------------- | ---------------------------------------------------------------------- |
| `ls`, `cat`, `grep`          | List, read and search the shared document space                        |
| `write`, `import_file`       | Create text or import base64 UTF-8 TXT / Markdown / PDF                |
| `edit`                       | Replace a UTF-16 range against an expected revision and exact old text |
| `mv`, `archive`, `history`   | Change a path, archive/restore, list revisions                         |
| `link`, `unlink`             | Create or remove a connection between two exact passages               |
| `ask`, `questions`, `answer` | Save questions, find them, associate an existing answer document       |
| `open_document`              | Display a document or historical revision in the reading App           |

Names resemble filesystem commands; no shell is executed. To answer a question: read its source, `write` an answer, call `answer` with the question and document IDs, `link` relevant passages, then `open_document`. Creating a document never implicitly creates a connection.

Offsets are zero-based UTF-16 code units, matching JavaScript string indexing and DOM selection. Ranges are half-open `[start,end)`. A change inside or around a connected passage does not transfer the connection to a different revision. Follow a connection to read its historical endpoint; choose the latest version explicitly when needed. Renaming a path retains the document's stable ID.

## Development

Requires Node 22.13+ and the package manager pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm build:app
pnpm typecheck
pnpm test
pnpm build
```

The Worker uses `DB` (D1) and `BUCKET` (R2), declared in `.openai/hosting.json`. Generated SQL lives in `drizzle/`; Sites applies it on deployment. The standalone App HTML is built into `.app-build/reader.html` and embedded in its MCP resource. It contains no document data or credentials. Deploy the Worker and static output through Sites.

Runtime configuration:

- `SITE_ORIGIN`: exact HTTPS Site origin, used for OAuth resource binding and browser Origin checks.
- `OWNER_USER_ID`: the Site-specific trusted ChatGPT user ID, preferred after the first authenticated owner visit.
- `OWNER_BOOTSTRAP_EMAIL`: initially the email from the Sites owner's record. Only a trusted Sites dispatch identity with this email can bind the single owner row. Once pinned, subsequent authorization uses the ID. This value is configured as a secret, never committed.

Sites dispatch supplies verified user headers. A standalone deployment must provide an equivalent trusted identity boundary and strip client-supplied identity headers. Browser cookies are not accepted as MCP bearer tokens. All document commands, downloads and authorization consent check the owner server-side. OAuth uses DCR, authorization code + PKCE S256, one-hour opaque access tokens and rotating refresh tokens. Only official ChatGPT callbacks are accepted.

`pnpm build:qa` builds a local browser harness for the real reader and MCP Apps host bridge. The Vite-only `/__qa` route creates an isolated, ephemeral Miniflare D1/R2 with sample reading material; it does not exist in production. Production configuration is managed through Sites separately. The harness can switch to a 390-pixel frame and an actual `AppBridge` host.

## Bounds

Files are limited to 10 MiB, PDFs to 300 pages, and extracted/editable text to 1 MB or 400,000 UTF-16 code units. PDF imports require a text layer; OCR is outside this application. The reader renders Markdown and GFM, and keeps remote image loads disabled to avoid exposing reading activity to third-party servers. On the website, a question is saved and copied for ChatGPT; automatic delivery to the current conversation is available inside the App UI. WebMCP navigation is feature-detected when supported by the browser.

See [architecture](docs/architecture.md) for the entity model and the rationale for the verification gates.
