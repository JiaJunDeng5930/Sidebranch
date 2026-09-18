# Renderer performance evidence

The current browser measurements, fixture definition, baseline, and limitations are
recorded in [docs/performance-baseline.md](../docs/performance-baseline.md).
The earlier SSR proxy used a superseded chunk size and is not a browser result.

The renderer uses 4,096 UTF-16 code unit target chunks, measured spacers, and a
viewport window. Far navigation mounts the target without mounting every preceding
chunk. CSS highlights and spatial connections share validated source-to-DOM ranges.
