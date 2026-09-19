# Range reading verification

Date: 2026-09-19

Status: local verification complete. Results below belong to this change;
the earlier 62-test and performance baseline does not validate it.

The user subsequently rejected this interface as unusable. These results only
establish the specific behaviors and measurements recorded below; they are not
a usability acceptance. The resulting presentation decisions are recorded in
[ADR 0003](adr/0003-reading-usability-before-spatial-detail.md).

The reference evidence is in [Xanadu research](research/xanadu/README.md). This
record concerns the local implementation, not deployment or production accounts.

## Reproducible material

The real Reader QA harness at `/__qa` provides **Load reading fixture**. It seeds
four synthetic documents under `/qa/reading/` without duplicating an existing
complete fixture:

- `center.md`: the current argument, with a multiline range shared by two links
  and another connected passage later in the document.
- `source.md`: supporting original material.
- `objection.md`: an objection connected to the same central passage.
- `follow-up.md`: further explanation, including a reversed link to the material.

This checks overlapping relationships and continuation from a companion using
actual immutable revision anchors. **Load stress fixture** remains available for
long documents, many neighbors and a larger set of passage connections.

## Automated checks

The final integrated suite passed **73/73** with `pnpm test` using local Miniflare
workers (`/tmp/sidebranch-range-complete-tests.log`). TypeScript and ESLint passed
with empty logs (`/tmp/sidebranch-range-complete-{tsc,lint}.log`).
The production website, App UI, Reader QA, spatial QA and renderer QA builds
passed (`/tmp/sidebranch-range-r5-{build,qa,space,renderer}.log`).

## Browser observations

The local Codex in-app browser exercised actual DOM selection, rendering,
navigation and the isolated MCP App bridge. These are not production-account
or deployment checks.

- At 1280 × 720 CSS pixels and DPR 2, the current and companion sheets settled
  at scales 1 and 0.88. The four-link fixture rendered four bands with exactly
  one selected band and caption. The earlier duplicate selected key/path and
  stale SVG artifacts were corrected.
- Choosing a relationship closes the contextual menu. Escape closes it and
  returns focus to the entry. Compact-only endpoint controls are absent on the
  desktop layout.
- Following the reversed relationship from the companion material makes that
  material current and shows the further explanation alongside it. History
  returns to the preceding argument/material pair and selected relationship.
- Native dragging across highlighted text creates a text selection without
  following a link. In the App UI, selecting a passage, asking a question,
  receiving the synthetic host answer and opening that answer as a companion
  all preserve the current source document.
- In the 390-pixel Reader iframe, the first endpoint switch works. Both mounted
  sheets occupy the same grid position; only one is visible and focus moves
  into that sheet. Returning displays the original current sheet. Passage
  highlights remain, while cross-page geometry is absent from this single-page
  layout. One history-back action after switching there and back removes the
  relationship selection, confirming that endpoint visibility did not add
  history. The previous ineffective first click and second-screen placement
  were reproduced and corrected.
- The stress fixture exposed inaccurate deep alignment after virtual chunk
  heights changed. After correction, following relationship 1 and then 80 shows
  section 80 on both sheets, with the selected band resolved as exact. Scrolling
  only the current sheet changes its scrollTop from 25917.5 to 26754.5, while
  the companion remains at 25919. Camera panning does not pull it back. History
  back restores relationship 1 and its companion; forward restores relationship
  80 and scrollTop values 26754.5 / 25919.

## Performance sample

The real Reader contained 267 documents: the default two, four reading fixtures,
one synthetic answer and 260 stress documents. Two 1,000-section documents were
displayed together, with 180 current-document relationships accessible through
the relation menu. Drawing remained capped at 48 bands.

Before the final deep-alignment correction, one 5-second sample included eight
alternating keyboard camera pans. The page
remained visible throughout, at **1009 × 755 CSS pixels, DPR 2**:

| Measurement | Observed value |
| --- | --- |
| Actual elapsed time | 5001.9 ms |
| rAF callbacks / intervals | 294 / 293 |
| Frame interval p50 / p95 / p99 / maximum | 16.7 / 17.6 / 33.4 / 66.7 ms |
| Double-rAF input proxy | 37 samples; p50 22.5 ms; p95 77.2 ms; maximum 89.8 ms |
| Long tasks over 50 ms | 0 |
| Mounted document bodies / chunks | 2 / 4 |
| DOM elements / source spans | 1650 / 380 |

A separate four-pan check kept range measurement counters unchanged at 23
batches and 742 measurements. This verifies cache reuse for that camera-only
path, not absence of layout work in every interaction.

After the final correction, a second eight-pan sample with both long documents
at the deep relationship ran for 5001.9 ms at **683 × 837 CSS pixels, DPR 2**,
remaining visible throughout. It recorded 300 callbacks / 299 intervals, frame
p50 / p95 / p99 / maximum of **16.7 / 17.2 / 17.6 / 17.6 ms**, and no long tasks.
The 16 input-proxy samples had p50 21.9 ms and p95 / maximum 32.8 ms. Two document
bodies, six chunks, 1907 DOM elements and 560 source spans were mounted.
These differently sized samples are observations, not a controlled before/after
performance comparison.

The double-rAF value is
an input proxy, not INP or a display-latency measurement. This short local sample
does not establish performance on lower-powered devices or in ChatGPT itself;
the App test host's outer performance panel does not instrument its App iframe.
