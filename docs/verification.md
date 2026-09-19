# v3 local verification — not released

Checked on 2026-09-19 in the managed preview and isolated Miniflare D1/R2.
The acceptance requirements remain in [rebuild-acceptance.md](rebuild-acceptance.md).
The original v2 record is available in Git history; its overview/window workflows
are not acceptance evidence for this version.

## Observed browser behavior

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

The warm 60 Hz frame gate has **not** passed. Long-document scrolling has no
observed >50ms task in the latest sample, but frame p95 is approximately 33ms.
Camera pan/orbit still records approximately 50ms p95 in the managed environment.
The frozen-scene control is approximately 33ms; detailed samples and presentation
waits are recorded in [performance-baseline.md](performance-baseline.md). Reduced
motion is implemented, but physical touch, representative hardware and all
network interruption combinations have not been certified.

Actual ChatGPT account authorization, consent inside the live host, production
owner-login and host attachment download URLs have not been observed end to end.
The official local AppBridge proves protocol interaction, not those deployment
facts. No v3 publishing or production authentication changes were performed.
