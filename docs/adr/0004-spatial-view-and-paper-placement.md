# Spatial view and paper placement

Date: 2026-09-20

Status: accepted

## Context

Readable automatic framing became a permanent restriction on spatial work.
Layout and range alignment repeatedly rewrote paper targets; narrow containers
also disabled camera inputs and hid the companion. A drag handler alone would
therefore lose its result on the next layout update.

Document identity, revision identity, reading occurrences and camera poses
already exist. What was missing was the user's choice of spatial arrangement,
its relationship to automatic framing, and one transaction boundary for input.
Independent clamps on camera coordinates, scale and rotation also permitted
paper corners to cross the perspective plane.

## Decision

A reading snapshot owns one spatial view: reading or free arrangement. Reading
derives its camera and positions from the readable framing rule. Free arrangement
owns the camera and placement choices for its current reading occurrences.
The first spatial gesture enters free arrangement while preserving the visible
paper's screen position. Container width does not silently disable that choice.

A placement refers to a reading occurrence, not a document or its current role.
It is automatic or a manual center in the shared world plane. Layout resolves
automatic positions; it cannot overwrite a manual center. Source text, revision,
range focus and independent scroll position keep their existing responsibilities.
Screen and world coordinates remain distinct at conversion boundaries.

An active gesture owns a temporary draft. Frame updates render that draft;
completion commits one view to the current history entry. Cancellation restores
the view without rolling back unrelated scroll updates. Navigation invalidates
the old gesture and its delayed callbacks. Returning to reading is an explicit
history transition, allowing the user to return to the earlier arrangement.

The camera owns projection and inverse projection. A candidate view is valid
only when its active paper corners remain safely in front of the perspective
plane. Zoom, pan, rotation and paper placement use that shared condition. Zoom
keeps a world point under the pointer; when necessary, it reduces tilt rather
than shifting the anchor through a separate coordinate clamp.

Input ownership and geometric projection have separate implementations. The
scene assembles them and renders their results. Cached text-range measurements
remain local to a paper: moving a paper or camera changes projection, not the
underlying range measurement or document data.

## Consequences

Manual arrangements live in session history. Persisting them across sessions
would require a durable occurrence identity and restoration protocol; storing
one position per document would conflate distinct appearances of the same text.

Default narrow-screen reading retains one full-width paper. Deliberate spatial
interaction can expose both papers, with a persistent route back to reading.
Resize preserves the chosen view and reprojects it rather than silently changing
mode. Historical views restore their saved arrangement.

Validation must cover pointer anchoring, safe projection, cancellation, history,
native selection and range-band tracking together. Pure geometry checks cannot
establish that the gesture is reachable or that the displayed paper remains
comfortable to read.
