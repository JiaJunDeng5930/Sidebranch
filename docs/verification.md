# v3 local verification — not released

This is the pre-range-surface baseline. The subsequent implementation has its
own [range reading verification record](range-reading-verification.md); the
results below must not be applied to that changed reader.

Checked on 2026-09-19 in the managed preview, then continued locally in the
Codex in-app browser and isolated Miniflare D1/R2. No production release was made.
The acceptance requirements remain in [rebuild-acceptance.md](rebuild-acceptance.md).
The original v2 record is available in Git history; its overview/window workflows
are not acceptance evidence for this version.

## Local continuation

- Edge folds and the return entry stay in viewport coordinates during large
  native camera pans. In the complete stress fixture, the 102-item fan reaches
  its final page; selecting a distant long document opens that exact revision
  beside the current document and restores a readable camera framing.
- Explicit promotion and the return fold restore the expected current and
  companion document identities. The desktop return fold exposes a narrow edge
  until hover/focus; in the 390px layout, edge entries follow the reading bodies
  and remain reachable by scrolling without covering the text.
- Native selection in the official AppBridge sends the exact selected text with
  a synthetic question. An unsent second draft blocks host navigation; discarding
  it resumes the deferred target. Two separately created answers to one question
  retain independent entries and do not change the current document.
- Answer arrival uses the compact top-bar count. In the final 390px AppBridge
  build, arrival clears the matching waiting message. Escape preserves unread
  answers and restores launcher focus; “全部稍后阅读” clears the current unread
  count while retaining the records. Successful preview focuses the companion
  reading surface without scrolling it or promoting it to current.
- The final full test run passed 62/62, including 15 Reader session tests.
  TypeScript and ESLint checks passed, as did `pnpm build`, `pnpm build:qa`,
  `pnpm build:qa space` and `pnpm build:qa renderer`. No dependencies changed.
  Branded operation identities and discriminated states constrain late results;
  tests exercise ownership, cancellation, retries and supersession. These checks
  are distinct from the browser interaction evidence above.

## Earlier cloud browser observations

- Real Reader and the spatial fixture contain no catalogue sidebar or overview
  switch. Metadata folds retain all documents; current and companion are the only
  mounted reading bodies. The 120-document fixture contains 101 direct neighbors,
  unconnected documents and archived documents.
- A related leaf opens a companion. Explicit promotion creates a return leaf;
  returning restores both document identities. A desktop hit-test defect in the
  transparent camera plane was reproduced and fixed. Toolbar history now steps
  through companion changes; the return leaf separately finds the last current
  document.
- Connection lines resolve exact revision-bound source ranges on both papers.
  A cancelled measurement frame previously left their geometry stale after a
  companion mounted; cleanup now clears its scheduling token. Short connection
  captions fit the paper gap and reveal their full label on hover/focus.
- Native selection in the official AppBridge harness saved a question and sent
  it to the host. The host separately created a document, associated it as an
  answer and added a passage connection. Verified `answerFor` reported arrival
  without changing current reading. An ordinary host navigation while a new
  question draft was being edited was deferred.
- The 101-neighbor fan reaches its last page. Hovering a partly exposed long-title
  leaf brings forward its complete title without loading a body. An unconnected
  document can become a companion without a fabricated beam.
- A 390px iframe retains sequential current/companion reading and return actions.
  A 360px-high desktop container now has a 360px viewport and a 332px paper, with
  native internal scrolling instead of clipped controls. These are width/height
  checks with browser input, not physical touch-device certification.
- Plain stage drag pans; Shift stage drag rotates. Exact source selection was
  checked independently in a tilted, 1,000-section document, including a far
  section and mixed Markdown spans. No source identity is inferred from visual
  text that cannot be mapped safely.

## Automated evidence

Strict types and meaningful service/session/renderer tests cover immutable
revisions, exact UTF-16 anchors, concurrent edits, independent questions/answers/
connections, file retention and PDF extraction, authorization and OAuth scopes,
MCP schemas, metadata and revision-neighborhood pagination, attention history,
and bounded source mapping. The final gate result is recorded with the commit.
These checks do not replace the browser observations above.

## Outstanding gates

The local warm workload samples now pass the frame gate: p95 17.6–17.9ms,
p99 18.5–18.7ms, with no observed >50ms tasks for one/two long-document camera
movement and two-document scrolling. Exact workloads, counts, measurement scope
and the earlier failed cloud samples are preserved in
[performance-baseline.md](performance-baseline.md). Physical touch, cold starts,
representative hardware, actual ChatGPT iframe performance and all network
interruption combinations remain unverified. Reduced motion is implemented;
its presence is not a substitute for those device checks.

Actual ChatGPT account authorization, consent inside the live host, production
owner-login and host attachment download URLs have not been observed end to end.
The official local AppBridge proves protocol interaction, not those deployment
facts. No v3 publishing or production authentication changes were performed.
