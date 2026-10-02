# Parser-derived selection boundaries

Date: 2026-10-02

Status: accepted

## Context

Markdown AST text positions cover a source interval, but its displayed value can omit quote prefixes, list indentation and code padding inside that interval. An affine projection therefore moves selection endpoints into removed syntax. At a displayed boundary between source fragments, the preceding character ends before the following character begins. One offset cannot describe both selection directions.

## Decision and reasons

Derive display atoms from the same micromark token positions and GFM extensions used by the Markdown parser. Use its character decoder to preserve the renderer's entity semantics. Maintain separate start and end boundary maps: native selection starts follow the next displayed character, while ends follow the preceding character. Inverse projection uses the same checked maps so removed syntax alone never highlights adjacent letters.

Require exact equality between the assembled token text and the HAST text before attaching coordinates. Unknown or generated text fails closed rather than receiving a plausible substring match. The final flow-code newline added by HAST has zero source width, which keeps quotations and restored highlights within actual code content.

Normalize HAST display text from CRLF and CR to LF before checking token equality. Browser HTML parsing normalizes those newlines in server-rendered HTML, while client React text nodes otherwise retain them. Canonical display text avoids different selection coordinates between these rendering paths without changing the original source or its UTF-16 offsets.

## Consequences and verification boundary

Each bounded Markdown chunk incurs one additional token parse when its source or reference context changes. Identity text avoids serialized boundary arrays. The parser input includes shared reference definitions, while selectable coordinates remain confined to the visible chunk. Native selection still relies on the existing revision, permission, source-surrogate and virtualization checks; token mapping does not replace those checks.
