# Performance baseline, before the spatial-reader rebuild

## v3 measurements, 2026-09-19 — 60 Hz gate remains open

These are observations from the managed Chromium browser, not a 60 fps claim.
The current code keeps persistent document membership separate from mounted
bodies, updates the camera without React dispatch per pointer move, and caches
anchor geometry. Long-task absence alone is not smoothness.

| Workload                                                                         | Duration | Frame p95 / p99 | Double-rAF proxy p95 | Tasks >50ms |
| -------------------------------------------------------------------------------- | -------: | --------------: | -------------------: | ----------: |
| 1,000-section Markdown; 40 native scroll inputs; tilted paper                    |    6.54s |   33.3 / 33.4ms |               33.3ms |           0 |
| 120-document space, one mounted short body; 8 pan/orbit drags of 24 points       |    6.92s |   50.0 / 66.6ms |               73.8ms |           0 |
| Same visible scene; transparent QA input layer freezes the camera                |    4.32s |   33.4 / 33.4ms |               50.9ms |           0 |
| Camera after direct transform writes, bounded beam updates and no moving shadows |    6.83s |   50.1 / 83.3ms |               69.7ms |           0 |

The renderer sample had 329 frame samples and three mounted chunks. Native
selection at section 990 mapped to the exact source slice [189798,189809).
The space sample had 72 DOM elements and one mounted document; all 120 documents
remained reachable through metadata folds. The control uses the same input path
and visible content; differing automated drag durations mean it is a diagnostic
comparison, not a hardware-normalized benchmark.

The last camera changes remove concrete unnecessary work but do **not** establish
a frame-rate improvement. A subsequent four-orbit diagnostic captured three long
animation frames of 75.1, 159.6 and 111.4ms, with zero blocking duration and no
reported long script. Their render-start-to-paint times were approximately 0.5,
1.0 and 2.1ms, while presentation followed paint by 110.4, 184.8 and 84.3ms.
This points to substantial scheduling/presentation delay in this environment;
it does not prove the application meets its target on a user's device.

The required p95 ≤20ms / p99 ≤33ms gate remains **unmet**. Real touch-device and
representative desktop measurements, including presentation/compositing work,
remain necessary. No v3 production deployment was made. QA telemetry, the
transparent control layer and synthetic documents are excluded from production.

## Historical baseline

Measured 2026-09-17 in the managed browser, production-built reader in the isolated QA host. This is a browser benchmark, not a claim about every user's hardware/network.

Fixture: 1,000 Markdown sections generated identically by the browser QA scenario: one heading, two paragraphs, bold text, inline code and an external link per section. The original renderer mounted 15,095 DOM elements, including 9,000 source spans, for the whole document.

- Initial open: a 577 ms longest main-thread task; 688 ms total blocking time since harness startup.
- After selecting text and filling the question composer: longest task 618 ms; accumulated blocking time 1,817 ms.
- Largest observed animation-frame interval during the scenario: 683.3 ms.

The measurements use `PerformanceObserver` long-task entries and animation-frame intervals from `tests/ui-performance.ts`. They demonstrate long synchronous work on the interaction path. The replacement must keep parsing outside ordinary input/camera updates, bound mounted text, and measure the same fixture after integration.

Structural defects visible in source: `Passage` reparses Markdown when its owning reader updates; `open_document` includes a catalogue and issues per-connection/per-question follow-up queries. Exact query counts and revised service budgets belong to the service benchmark.

## Renderer correction, 2026-09-18

The standalone renderer harness now uses exactly `longMarkdown(1000)` from the
shared benchmark fixture, a native 660 px document scroller, and the same managed
browser telemetry. It is separate from the complete workspace benchmark.

- At the beginning: 345 DOM nodes / 191 source spans / one mounted chunk.
- Jump directly to section 990: 490 DOM nodes / two chunks, zero tasks over 50 ms,
  52.7 ms double-animation-frame input-to-paint sample.
- Scroll upward by 1,800 px after navigation: sections 983–985 visible; no snap
  back to the old focus and no long task.
- Native selection across bold and inline code maps exactly to source [115,134).
  Filling the question field and applying a CSS3D transform produced no long task;
  sampled input-to-paint intervals were 27.8–29.6 ms.
- Warm initial reload: no long task. A first cold load in the new browser session
  did record a 552 ms task, so these results do not establish a cold-start budget
  or universal performance across devices. Complete workspace and host checks
  must be recorded separately.

The rejected intermediate virtualizer mounted all 12 chunks on a far focus,
recreating 9,000 source spans and a 655 ms task. The corrected implementation
keeps nonadjacent source chunks in source order with measured spacers. Highlights
and scene beams share the checked `sourceRanges` projection; highlighting never
replaces React-owned text nodes.

## Complete workspace, 2026-09-18

The isolated workspace contained 260 benchmark documents, three 1,000-section
Markdown documents and 80 connections, plus the reading/import QA documents.
All catalogue pages reached the UI. Following connection 80 positioned both
long-document views around section 80; the first version of this check exposed
and fixed a parent scroll-restoration effect overriding a newly mounted focus.

A mixed two-document rotation/scroll/import sample mounted 3,069 DOM nodes and
395 source spans. It recorded one 63 ms long task and input-to-paint samples
17.9–51.1 ms; it includes import and catalogue refresh and is not a pure camera
benchmark. A subsequent isolated rotation sample had no >50 ms task,
23.0/33.6 ms input-to-paint and a 33.4 ms 95th-percentile frame interval (49.9 ms
maximum). These observations demonstrate improvement from the old 577–618 ms
blocking path, but do **not** establish a consistent 60 fps budget or smoothness
on every device. Cold initialization also remains a separate cost.

Only distinct unopened revisions receive related previews. Offscreen-to-offscreen
connections are omitted from the geometry unless focused; all remain available
in the relation catalogue. Native text selection, exact-source highlighting and
current/companion document bodies remain active. No continuous idle render loop
is used. Production does not include the QA fixture or telemetry.
