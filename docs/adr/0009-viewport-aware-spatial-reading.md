# Viewport-aware spatial reading

Date: 2026-09-20

Status: accepted; supersedes ADR 0007's fixed paper height and background-only
orbit input. Browser acceptance is incomplete as detailed below.

## Context

Fitting a fixed portrait paper into a short viewport makes the text too small.
CSS3D does not clip papers at the WebGL camera's near plane, allowing the native
paper and its depth mask to disagree. Background-only camera input becomes hard
to reach when a paper fills the screen. A single-paper fit also cannot express
the intention to inspect both endpoints of a connection.

## Decisions and reasons

Paper height follows the viewport while its width and spatial pose remain
stable. Camera movement and payload residency do not resize the paper. Native
scrolling absorbs the change in available reading height. DOM layout, depth
masks, picking, and residency use the same dimensions so shortening a paper
does not detach its interaction geometry.

Use a shared visibility decision for native papers and their masks. Hide papers
that cross the near plane because CSS3D cannot reproduce partial near-plane
clipping. Exclude hidden papers from focus and picking. This trades an abrupt
visibility boundary for consistent rendering and interaction.

Keep the orbit-up basis stable across completed gestures. Allow explicit orbit
input over document content while retaining ordinary selection and scrolling.
Provide explicit camera recovery and collection framing because free spatial
navigation can leave every document outside the viewport.

Fit requested comparison papers together without changing their saved poses,
and retain both requested bodies during the comparison. De-emphasize unrelated
bands to keep the selected relation distinguishable. Framing distant papers can
reduce text size; it does not rearrange documents into a separate reading mode.

## Verification and remaining work

Type checking, lint, all 94 tests, the embedded reader build, and both complete
and spatial QA builds passed. New projection tests cover multiple tilted papers,
near-plane visibility, large collections, and short viewport text scale.

The local Chrome interaction run passed paper dragging and release stability,
modifier-wheel zoom, preserving zoom when clicking current text, right-drag
orbit over text, native scrolling, and native text selection.

That run failed its assertion that both related papers remain entirely inside
the viewport after relation navigation. It stopped before the mobile and short
viewport browser checks. The failing end-to-end path still needs diagnosis;
passing projection unit tests does not establish that navigation uses the
intended camera throughout the complete flow. Production build and embedded
App browser acceptance were not completed for this change.
