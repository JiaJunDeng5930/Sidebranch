# Three-dimensional document space and direct manipulation

Date: 2026-09-20

Status: accepted; supersedes the planar placement and two-surface assumptions in ADR 0004.

## Context

The user requested a three-dimensional document space. Constraining every paper
to the same world plane and applying a common rotation did not satisfy that
requirement. The current/companion loading model also became a limit on what
could remain in the scene, and exposed that limit through side-reading and
switching buttons.

## Decision

Paper placement and camera movement describe independent three-dimensional
transforms. Their shared projection must account for depth, orientation,
occlusion and pointer interaction. Native document content remains DOM text so
selection, scrolling, editing and accessibility do not depend on a second text
renderer. CSS 3D is used as the presentation mechanism, with the same coordinate
conventions used by range geometry and gesture hit testing.

A document's membership in the space does not depend on whether its revision
payload is loaded or its text is currently rendered. Moving the reading focus
must preserve other occurrences and their placements. Distant folds are a
presentation of those occurrences, not a separate list of closed documents.

Spatial actions operate on the space, paper edges and connected passages.
The interface does not require commands for side reading, switching papers,
zooming or changing a reading mode. Content operations retain their necessary
contextual controls.

## Delivery and verification

The change is delivered as runnable vertical slices: first independent paper
depth and camera gestures, then collection-based space membership, then complete
range projection and navigation across retained occurrences. A temporary
two-surface loading adapter is allowed only in the first slice; it is not part
of the target model.

Each slice is demonstrated through the normal reader before committing. Visual
parallax and depth occlusion, direct manipulation, and retaining A and B while
following a connection to C are required evidence. Passing projection tests
alone is insufficient. Range measurements remain paper-local and cached so
moving the camera does not remeasure document text on every frame.
