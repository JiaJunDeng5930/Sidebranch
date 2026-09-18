# Performance baseline, before the spatial-reader rebuild

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
