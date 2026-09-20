# Viewport-aware spatial reading

Date: 2026-09-20

Status: accepted; supersedes ADR 0007's fixed paper height and background-only
orbit input.

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

The minimum reading height must accommodate the space left by host controls.
Keeping a larger minimum for an already short embedded viewport would force
the camera to shrink the text again. Compact headers and scroll padding leave
room for reading within the shorter paper.

Use a shared visibility decision for native papers and their masks. Hide papers
that cross the near plane because CSS3D cannot reproduce partial near-plane
clipping. Exclude hidden papers from focus and picking. This trades an abrupt
visibility boundary for consistent rendering and interaction.

Keep the orbit-up basis stable across completed gestures. Allow explicit orbit
input over document content while retaining ordinary selection and scrolling.
Provide explicit camera recovery and collection framing because free spatial
navigation can leave every document outside the viewport.

Document focus outlives selection actions. Clearing it while dismissing those
actions removes the origin needed for relation navigation. Escape therefore
cancels an active scene gesture or reaches the reader's foreground dismissal
handler while retaining the current document and camera.

Fit requested comparison papers together without changing their saved poses,
and retain both requested bodies during the comparison. De-emphasize unrelated
bands to keep the selected relation distinguishable. Framing distant papers can
reduce text size; it does not rearrange documents into a separate reading mode.

## Verification

The earlier pair-framing failure was measured while selection actions still
protected navigation: the relation request had not executed. Dismissing the
selection with Escape then exposed the separate focus-clearing defect.

The [browser regression](../spatial-navigation-verification.md) verifies
dismissal and completed relation navigation before measuring paper bounds. It
covers the website and embedded App, including narrow and short viewports.
