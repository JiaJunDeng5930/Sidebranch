# Semantic reader colors

Date: 2026-09-20

Status: accepted

## Context

The reader used the same bright relationship color for translucent ribbons,
small text labels and outlines. Opacity made several relationship types look
similar, while old hover and proxy selectors could override newer styles.
Passage highlights and SVG contours also filled the same text range separately.
The main prose already had strong contrast; darkening it would not repair these
problems.

## Decision

One typed palette owns reader surface colors, relationship appearances and their
state strengths. Its relationship mapping is exhaustive over the domain's
relationship kinds. A relationship has a signal fill, a darker text/outline ink
and a non-color symbol. Current and companion identity use separate appearance
roles and visible words.

Consumers obtain CSS variables from this palette. A dedicated stylesheet owns
color-state selectors; layout styles do not maintain competing color values.
Hover and selection change emphasis without changing the relationship's hue or
meaning. Keyboard focus remains independent of selection.

The source renderer owns text-range fill. The SVG range layer draws contours,
and ribbons fill only their permitted space behind opaque papers. Multiple
connections on a range keep their existing overlap semantics rather than adding
several translucent fills.

## Consequences

Changing a relationship appearance requires editing one palette entry instead
of matching separate text, ribbon and highlight tables. A new relationship kind
must receive an appearance before the mapping compiles.

Contrast is checked after compositing against each actual surface. Real-reader
checks still cover hover, selection, focus and portal/root inheritance: palette
values alone cannot prove that CSS precedence or layering is correct. Color
does not carry relationship type, paper identity or selected state by itself.
