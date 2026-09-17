# Release verification

Verified on 2026-09-17:

- TypeScript strict check and production Worker/App builds pass.
- Eleven integration tests pass using isolated Miniflare D1 and R2, including real PDF extraction, concurrent edits, immutable revisions, UTF-16 anchors, owner authentication, OAuth replay/resource protections and official MCP transport calls.
- Browser checks cover the public introduction, document browsing, passage connections with parallel pages, editing into a new revision, and a 390px mobile reader.
- The official MCP Apps host bridge renders the reader, calls tools, and receives a user message after native text selection and question submission.

The bridge check uses the official AppBridge in a local host harness. A connection inside the user's actual ChatGPT account still requires its OAuth flow; it is not implied by a successful harness test. Production contains no QA routes or fixture documents.
