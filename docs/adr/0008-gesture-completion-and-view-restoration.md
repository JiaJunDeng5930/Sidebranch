# Gesture completion and view restoration

Date: 2026-09-20

Status: accepted

## Context

OrbitControls releases pointer capture before emitting its end event. Treating
capture loss as cancellation therefore restored the starting camera before the
completed gesture could be saved. React updates to the view prop also cancelled
drafts, although catalogue and checkpoint updates are not navigation requests.
A native click following a drag could then focus a paper and fit the camera.

## Decision and reasons

The visible scene view is authoritative within one presentation generation.
Gesture drafts derive from that view and checkpoint their completed result to
the reader. Camera completion reads the runtime camera, including any movement
after its last change notification. Checkpoint echoes and catalogue updates may
admit new paper placements; they cannot restore established camera or paper
poses. An explicit navigation or history presentation can replace the view.

Pointer release, capture loss, pointer cancellation, window blur and scene
disposal complete visible motion. Escape and explicit navigation cancellation
remain deliberate rollback operations. Terminating camera input recreates
OrbitControls because reconnecting the same instance retains its pointer state.

A pointer sequence that crosses the movement threshold cannot also focus a
paper or follow a band through its trailing click, including native text/body
drags and movements returning to their starting point. A fresh pointer-down
starts a fresh click decision, so absent trailing clicks cannot suppress the
next intentional click. Native selection remains available throughout the drag.
