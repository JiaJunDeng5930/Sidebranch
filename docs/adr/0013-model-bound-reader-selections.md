# Model-bound reader selections

Date: 2026-10-02

Status: accepted; supersedes ADR 0012's use of raw offsets as primary selection identity

## Context

A second tokenization of Markdown cannot provide a source character for every rendered character. Generated image labels and footnote content have semantic provenance, and renderer-added text can have zero-width parser positions. Rejecting these selections leaves valid body selections without positions. Distinct selections inside transformed text can also share the same source interval.

## Decision and reasons

Make the immutable reader model's ordered node identities and local UTF-16 ranges authoritative for reader selections. Build this model through the same parse and text transforms that produce the rendered body. Every selectable body text node and nontext atom receives a model binding; missing bindings or mismatched rendered text are programmer invariant violations. Within this owned body DOM, every positive native selection has model positions, including generated text and element-container boundaries.

Keep browser-selected display text as the selector preview. Keep the canonical raw start, end and quote as an explicit source provenance envelope: direct text projects exactly, while transformed or generated content projects to its semantic origin. The envelope is an immutable source slice, not a claim that the selected display characters occur literally in that slice. Raw-only anchors retain their existing source semantics.

Persist the reader selector additively with the anchor and publish that complete anchor through reader context. On restoration, validate the selector and provenance against the fetched immutable revision. Restore exact fragments by node identity and local offsets, mounting their chunks across virtual gaps. Geometry identity includes selector version and ordered fragments, so selections sharing a source envelope remain distinct.

## Consequences and verification boundary

Source provenance remains available for revision validation, coarse viewport hints and source-only tool anchors. Precise reader selection, highlight restoration and geometry use the model coordinates without quote search or a second parser. Source-only ranges do not acquire invented rendered character offsets. These invariants require renderer and native DOM selection coverage; type checking alone does not establish browser behavior or persistence round trips.
