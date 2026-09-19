# Reading intent ownership and viewport edges

Date: 2026-09-19

Status: accepted

## Context

Documents belong to the persistent space even when their bodies are not mounted.
The current document and optional companion are reading positions, while edge
folds provide access to the remaining members. Putting both under the camera
transform allowed a valid pan to remove every navigation entry from the viewport.

A neighborhood proof and a passage connection also serve different purposes.
A two-hop neighbor can be reached through a connection that does not touch the
current revision. Treating that connection as a directly followable passage made
some visible leaves inert.

Reading operations cross asynchronous boundaries. The user can revise a question,
change the current document, or start a new edit before an earlier response
returns. A successful response establishes a fact about the operation that was
submitted; it does not establish ownership of the current interface.

## Decisions

The reading plane and viewport edges use separate coordinate systems. The camera
transforms the reading plane. Fold roots, their bounded fans, and the return leaf
remain reachable at the viewport edges and retain their own paper depth. This
preserves both spatial movement and access to the complete document space.
Intentional navigation frames its target for reading. History retains the prior
camera position so returning restores the actual reading context.

A leaf always identifies an exact document revision. It follows a passage only
when the available connection directly relates the current revision to that
target. Otherwise it requests ordinary comparison with that exact revision.
Graph distance does not fabricate a direct passage connection. An expanded fan
owns a frozen member sequence and the center revision that gave the sequence its
meaning; changing that center invalidates the presentation.

Asynchronous reading operations carry the identity of the intent or draft they
serve. Result handling distinguishes recording a completed durable operation
from changing the active presentation. A stale result may enrich document data,
but cannot close a different draft, mark another question as sent, or replace a
newer reading intent. A navigation result must still satisfy reading protection
when it is applied, even if protection was absent when loading started.

Deferred navigation retains its target and failure state so retry acts on the
same intent. A newer explicit navigation supersedes an older deferred intent.
Question saving and host delivery remain separate operations: retrying delivery
must reuse the saved question instead of creating a second one.

Answer arrival records availability without taking over reading. A compact
unread count opens the existing activity dialog instead of placing answer cards
over the papers. Closing the dialog does not acknowledge arrivals; an explicit
later action acknowledges only its current snapshot. Successful preview hands
focus to the loaded companion, while an ordinary close restores the launcher.
This keeps arrival, acknowledgment, comparison and promotion separate actions.

## Consequences

The domain entities, server commands, owner authentication and document membership
remain unchanged. No document window registry or persistent navigation sidebar is
needed. The implementation can bound mounted bodies and fan leaves independently
of the size of the persistent space.

Types express operation ownership and the valid draft/navigation states. Focused
tests cover asynchronous ordering and navigation semantics; browser checks cover
hit regions, selection, viewport sizing and rendering performance. Source-level
correctness does not establish a frame-rate claim or real ChatGPT authentication.
