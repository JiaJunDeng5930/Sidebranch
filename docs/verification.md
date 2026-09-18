# Release verification

Rebuild checked on 2026-09-18 in the local managed preview and isolated Miniflare
D1/R2. This record distinguishes evidence from remaining acceptance work.

- TypeScript strict checking, ESLint and the production Worker/App build pass.
- All 49 tests pass. They exercise concurrent exact edits, immutable versions,
  checked UTF-16 anchors, independent questions/answer associations/connections,
  original file retention and real PDF extraction, owner denial and pinning,
  OAuth PKCE/replay/resource/scope protections, MCP transport and output schemas,
  bounded metadata/relation queries, pagination, renderer source maps and scene
  and draft state transitions. They do not substitute for browser acceptance.
- Browser: TXT, Markdown and PDF file chooser imports all succeeded. The PDF
  document was opened, edited to v2, listed in immutable history, and found by
  literal full-text search. Moving the connected PDF preserved its identity and
  connection; archive/restore retained the open view and connection. The 390px reader displays native stacked papers.
- Browser: following a far connection in the 1,000-section fixture locates both
  documents around section 80. Current/companion reading, perspective overview,
  native selection, camera rotation and document scrolling were exercised.
- Official AppBridge harness: native selection saved a question and sent it to
  the host. A separately created answer document, answer association and explicit
  passage connection were returned through the host. The new answer opened with
  the source retained, and appeared immediately in the catalogue. A sent question
  shows a disabled sent state instead of a misleading resend action.
- The production route manifest and bundles contain no QA routes, fixture seeds
  or QA telemetry. All three SQL migrations are included in the packaged output.

## Limits and outstanding verification

The actual ChatGPT account connection, OAuth consent inside that host, host
attachment download URLs and the production owner-login roundtrip have not been
observed end to end. The local bridge uses the official SDK but cannot establish
those facts. Deployment does not install a custom MCP connection in the account.

The full-workspace measurements improve substantially over the old blocking
renderer, but include approximately 33ms frame intervals and a 63ms task in a
mixed interaction/import sample. A consistent 60fps performance gate has not
been demonstrated. See [performance measurements](performance-baseline.md).

Every network-recovery combination has not been exercised in the browser.
Domain invariants are covered by automated checks; no blanket claim of zero bugs
or completed acceptance is made. The
[acceptance scenarios](rebuild-acceptance.md) remain the complete target.
