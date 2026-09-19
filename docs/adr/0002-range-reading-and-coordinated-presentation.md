# Range reading and coordinated presentation

Date: 2026-09-19

Status: accepted

## Context

The original renderer reduced every text range to a center point and drew a
stroked curve. Increasing that stroke would still hide the beginning, ending,
line wrapping and different extent of the two passages. The primary research
distinguishes historical prototypes; its visual evidence supports range surfaces
for this project without claiming that every Xanadu prototype used one style.

Connection selection also lived separately from reading history. Following from
the companion could be rejected because the reader assumed that every action
originated in the current revision. A revision alone cannot identify a displayed
occurrence: an internal connection may require two views of the same revision.

Independent page, camera and range animations can disagree about the geometry
being shown. Reading transformed DOM bounding boxes as local text coordinates
also loses information under perspective. Repeatedly measuring every text range
while moving the camera makes this mismatch more expensive without correcting it.

## Decisions

Reading attention owns the selected relationship, its orientation and the two
reading positions. Stable surface identities distinguish displayed occurrences
from persistent revisions. Explicit activation carries its originating surface
and endpoint; the complete, validated destination is committed once after its
revisions are ready. History therefore restores the relationship with its pages
and scrolling positions. Repositioning the already selected relationship is a
presentation request, not another history entry.

Text range resolution is shared by highlighting, text activation and geometry.
Visible line fragments retain their actual boundaries. Filled surfaces connect
the independently measured extents at both ends. Missing, clipped, unmounted and
peripheral content have explicit representations; a navigation proxy never
claims to measure the original passage. This changes presentation, not the
identity or semantics of stored links, anchors or transclusions.

Local text geometry is measured in one synchronous neutral-transform batch when
layout changes, then projected using the same camera model as the papers.
Camera-only frames reuse that geometry. The temporary measurement must restore
styles before paint and cannot change selection, text or scrolling. This accepts
an occasional layout batch to avoid approximating transformed axis-aligned boxes
or measuring source ranges during every camera frame.

One presentation generation coordinates paper poses, requested range alignment,
scrolling and camera movement. Virtual chunk height changes become geometry
notifications only after their spacer DOM is committed; explicit alignment stays
eligible for correction as that layout settles. A first resolved range is not
proof that its final scroll position is known. New input takes over from the
displayed state.
Manual scrolling remains independent after explicit alignment; history restores
recorded scroll positions rather than replaying focus navigation. The compact
layout changes which occurrence is visible without changing reading roles. It
retains passage highlights and an explicit other-end action, but omits cross-page
geometry while only one page can be read.

Relationship discovery uses the complete connection data rather than the drawing
budget. A contextual paper-edge entry provides equivalent pointer and keyboard
access, including overlapping bands. Peripheral folds retain document identity
and load readable previews on demand. These choices preserve access without a
document sidebar or a permanent row of controls.

## Consequences and verification

The reading-plane projection remains a shared planar model under the camera;
this decision does not introduce independent 3D rotations for individual papers.
The DOM and geometry must use that same model throughout a transition.

Static types and controlled constructors carry occurrence and navigation facts.
Focused tests cover state transitions and independent geometric properties.
Browser checks cover range attachment, native selection, relationship menus,
compact layouts, deep virtual-document alignment and independent scrolling.
Their observations and the limits of the real-reader frame sample are recorded
in [range reading verification](../range-reading-verification.md).

This decision supersedes the old center-only connection geometry and the current
revision assumption in connection navigation. The asynchronous ownership and
viewport-edge reasoning in ADR 0001 remain applicable. Primary evidence and its
limits are recorded in `docs/research/xanadu/`, separate from implementation and
runtime verification results.
