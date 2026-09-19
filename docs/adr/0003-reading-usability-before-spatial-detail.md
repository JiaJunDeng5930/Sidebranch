# Reading usability before spatial detail

Date: 2026-09-19

Status: accepted

## Context

The range renderer passed behavioral checks while its interface remained hard
to use. Duplicate identity rows consumed reading space. Two narrow columns
persisted after they ceased to be readable. Connection captions covered prose,
and hundreds of distant documents collapsed into an unrecognizable edge stack.
The delivered QA page also exposed test controls and an arbitrary stress
document. Those checks established particular behaviors, not product usability.

The primary Xanadu evidence requires readable connected passages with retained
spatial context. It does not require repeated toolbars, permanently visible
crossing bands, or two complete pages at every window width. The user's folded
edges and lack of a directory sidebar remain constraints.

## Decisions

Paper identity has one presentation owner in the spatial scene. Application
document actions are supplied to that row; the source renderer keeps the
document's actual headings and content. Paths and versions remain available
without another permanent metadata block.

Framing follows available reading width. Two readable papers fit together only
when the container can accommodate them and their spatial margins. Otherwise a
single readable occurrence and a visible counterpart fold preserve the same
attention and connection. Switching the exposed endpoint changes presentation;
explicit continuation and history keep their existing meanings. Short content
does not require a screen-sized blank sheet.

The framing plan owns the geometry of exposed occurrences. Reading-line
alignment belongs to paired presentation: aligning a visible companion against
a hidden current occurrence can move the only readable paper out of view. In
single-page presentation both occurrences retain centered geometry; exposure,
focus and their independent scroll positions determine which one is read.

Connection identity and geometry remain independent of drawing prominence.
Selected or deliberately previewed relationships receive the visible band;
other relationships remain discoverable from their passages. Visibility masks
protect unrelated prose. A caption needs an unoccupied place outside reading
rectangles; absent that place, the contextual action retains the information.
An offscreen navigation affordance cannot impersonate a measured text range.

Fold grouping is level of detail over the complete document space. It must
retain useful titles and access to every group. A persistent compact search
action and discoverable camera restoration complement direct spatial reading.
Visible fold slots reserve space outside the paper. Group pagination changes
the level of detail, not document membership in the space.

Selection first exposes a small contextual action. The question composer opens
only on request and derives from the existing selection and request states.
Draft protection, source provenance and asynchronous attention guards are
retained. First-time writing starts with title and content, with filesystem
location available as secondary information.

## Consequences

Layout, passive overlays and interaction ownership must be evaluated together
in the actual Reader at narrow, intermediate and wide container widths. Native
selection, deep range alignment, independent scrolling and history remain
necessary checks. Passing them alone does not establish that the interface is
clear or comfortable to read.

The normal local product route is the review surface. QA fixtures, instrumentation
and fixed viewport controls remain internal validation tools. Production login
and publishing are separate from this local usability work.
