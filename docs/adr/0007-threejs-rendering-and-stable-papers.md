# Three.js rendering and stable paper geometry

Date: 2026-09-20

Status: accepted; supersedes the CSS triangle renderer, per-line band mouths,
and distance-dependent folded geometry in ADR 0006. ADR 0010 supersedes the
fixed geometry and camera-fit opening policy below; identity, cache-independent
geometry and shared rendering/picking remain accepted.

## Context

Changing a retained paper from its readable size to 205 × 116 when its text left
the cache made navigation change the apparent document arrangement. Joining each
text line separately also left visible gaps through a connected quoted passage.
The custom CSS matrices, triangle leaves and ray intersections had become a
second rendering engine whose depth and gesture behavior needed separate proofs.
Native DOM text remains necessary for selection, scrolling and existing actions.

## Decision and reasons

Use one Three.js perspective camera for CSS3D paper objects, WebGL paper masks and
connected passage meshes. Convert serializable domain coordinates at the camera
adapter; Three owns mutable transforms, camera controls, projection and picking.
This preserves stored views while eliminating the parallel matrix and ray engine.

A transparent canvas above the native paper DOM requires an explicit depth-only
paper pass before drawing bands. Merely placing two renderers above each other
cannot hide a band behind a paper. Paper masks therefore have color writes off
and depth writes on; bands retain that depth buffer. Masks and native papers have
the same square, opaque 600 × 780 geometry and front-face behavior. Raycasting
uses those same masks and meshes so an intervening paper also wins hit testing.

Superseded in part by [ADR 0010](0010-reading-intent-and-temporary-presentation.md):
the original policy kept each occurrence at fixed geometry and opened it by
fitting the camera. Reading presentation now permits temporary poses and cropped
geometry chosen for readable ranges. Cache admission still changes only the
interior: payload residency must never choose paper dimensions or placement.
Separate admission and eviction thresholds retain text near boundaries; focus
and native selection pin content. Document and revision identity remain stable.

One source anchor owns one continuous passage mouth, including line spacing.
Separate anchors are never merged by visual proximity. Partial, unavailable and
unmapped source ranges retain explicit status; they do not invent source text.
Mesh endpoints remain in paper-local coordinates until the renderer applies the
paper pose, so moving the paper cannot leave a detached connection behind.

OrbitControls attaches only to a background hit element. Primary drag pans;
modified or secondary drag orbits. Document selection and ordinary wheel
scrolling remain native. Pinch and Alt-wheel anywhere inside the scene instead
change camera distance around the pointer: allowing browser zoom over document
text would violate CSS3DRenderer's 100% browser-zoom requirement. Paper grips use
a frozen camera-facing plane through the original grabbed point. One immutable
view draft owns each gesture; cancellation restores it and successful completion
commits one checkpoint.

React owns paper contents through portals; the renderer owns the portal shells,
transforms and lifetime. Camera frames do not rerender the React document tree or
measure native ranges. Rendering is requested only when camera, geometry, content
or viewport changes, and disposal releases controls, listeners and GPU resources.

## Verification boundary

Projection and interaction tests cover the coordinate bridge, gesture drafts,
fit and payload hysteresis. Combined DOM/WebGL depth, native selection and
collection-scale frame behavior require browser observations. Website and
embedded App builds must both be checked because the App embeds its generated
reader HTML. Browser zoom other than 100% remains a CSS3DRenderer limitation;
scene zoom uses camera distance and keeps the browser viewport unchanged.
