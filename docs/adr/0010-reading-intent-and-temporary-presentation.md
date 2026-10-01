# Reading intent and temporary presentation

Date: 2026-10-01

Status: accepted; supersedes ADR 0007's fixed occurrence geometry and camera-fit
opening policy, and ADR 0009's stable reading pose and complete comparison
framing policy. Their identity, cache independence, shared geometry and native
interaction requirements remain accepted.

## Context

Fixed poses, preserved paper proportions, complete comparison frames and
readable text cannot all be guaranteed for arbitrary endpoints in a finite
viewport. Fitting distant papers together protects their frames by shrinking
the passages the reader needs to compare. Increasing intrinsic type does not
resolve this conflict across distances and host sizes.

Saved placement expresses the user's spatial memory. It is not a requirement
that every reading action leave the displayed paper at that position. Treating
these as the same state made reading depend on manual camera arrangement.
[Xanadu's reading plane](https://xanadu.com/XanaduSpace/btf.htm) provides the
precedent: bring related content close enough to read while retaining its
surrounding context, rather than inheriting physical-space limits unchanged.

## Decision and reasons

Preserve immutable document, revision and passage identities, user placements,
drafts, selections and independent scroll positions. Derive temporary reading
presentation from the current reading intent. Navigation does not save those
temporary poses as user placements; an explicit drag saves the moved paper.
Returning through history restores the earlier intent, exact range, scroll
position, selected relation and camera while retaining later manual placements.
This separation permits useful reading without erasing spatial memory.

When constraints conflict, exact related ranges and readable text take priority
over showing complete paper frames or keeping their displayed poses fixed.
The projected body-font design floor is 16.5 screen pixels. Browser acceptance
allows rounding down to 16 pixels, measured from actual rendered geometry.
Reduce exposed content before reducing this reading scale. Geometry follows
intent and available viewport space, never whether a body is resident in cache.
Native scrolling provides the rest of each document without replacing its
anchored source text with a detached excerpt.

Wide containers place the related ranges beside each other. Narrow containers
stack a cropped companion above the primary paper; both ranges remain readable
and independently scrollable. In extremely short containers, collapse the
companion to an identifiable context paper and expose one readable endpoint.
Focusing the companion exchanges which endpoint receives reading space. This
fallback explicitly gives up simultaneous readability of both endpoints rather
than pretending two thumbnails satisfy comparison. Earlier documents remain
identifiable context where height permits; below 300 pixels of viewport height,
previous-reading context yields its reserved space to the body.

Following A's passage to B makes B primary and A its companion. Continuing to C
keeps B as companion and A as identifiable prior context. Camera, poses and
paper dimensions change in one coordinated transition so their origin remains
understandable. Reduced-motion users receive the final arrangement immediately.
A return restores the previous reading location and relation. A late AI answer
becomes available without reorganizing the current reading, selection or draft;
explicitly reading it gives it a place in the same space. No separate reading
mode or window-management surface is introduced.

Narrow-screen observation showed a trapezoidal connection band crossing prose
when an endpoint spanned multiple lines. Place connection bands behind papers
and let the existing depth masks hide their interior portions, leaving bands
visible between or outside papers; text highlights express the exact endpoints
without covering the content the reader needs to compare.

## Consequences and verification boundary

Complete-paper framing is no longer the relation-navigation acceptance gate.
The release gate is the A → B → C → A reading task in
[rebuild acceptance](../rebuild-acceptance.md), including distant endpoints,
long passages, narrow and short containers, exact-range visibility and restored
scroll. Static geometry checks alone cannot establish that the transition is
understandable or that the reader can continue without arranging the camera.
Screenshots must cover relation, continuation and return states.

[CSS3DRenderer](https://threejs.org/docs/pages/CSS3DRenderer.html) supports only
100% browser and display zoom. Acceptance must record that environment and use
the actual website and embedded container dimensions. Camera zoom does not
establish support for other browser or display zoom settings. This decision
records requirements, not successful browser validation or deployment.
