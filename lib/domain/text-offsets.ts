import { decodeString } from "micromark-util-decode-string";

/**
 * Map rendered UTF-16 boundaries back to Markdown source boundaries.
 *
 * Both strings use JavaScript's UTF-16 indexing.  The returned array has one
 * entry for every rendered boundary, so its length is `rendered.length + 1`.
 * A boundary can map to the same source position when Markdown has removed a
 * delimiter.  Returning `null` is intentional: callers must not invent a
 * source position for a transformation they do not understand.
 */
export function renderedTextOffsets(
  source: string,
  rendered: string,
): number[] | null {
  if (source === rendered)
    return Array.from({ length: rendered.length + 1 }, (_, i) => i);
  function decode(raw: string, base: number) {
    let text = "";
    const offsets: number[] = [base];
    for (let i = 0; i < raw.length;) {
      let value = raw[i],
        width = 1;
      if (raw[i] === "\\" && /[!-/:-@\[-`{-~]/.test(raw[i + 1] ?? "")) {
        value = raw[i + 1];
        width = 2;
      } else if (raw[i] === "&") {
        const match = /^&(#x[\da-f]+|#\d+|[a-z][a-z\d]+);/i.exec(raw.slice(i));
        if (match) {
          const decoded = decodeString(match[0]);
          if (decoded) {
            value = decoded;
            width = match[0].length;
          }
        }
      } else if (raw[i] === "\r") {
        value = "\n";
        width = raw[i + 1] === "\n" ? 2 : 1;
      }
      text += value;
      // `value.length` is a UTF-16 length.  For a supplementary code point
      // (for example an emoji decoded from an entity), do not map the second
      // code unit to a made-up position inside the source token.  The first
      // rendered boundary stays at the token start and the final boundary is
      // the token end; validation at the document boundary rejects a source
      // surrogate split when the source itself contains one.
      if (value.length > 1 && width > 1) {
        for (let k = 1; k < value.length; k++) offsets.push(base + i);
        offsets.push(base + i + width);
      } else {
        for (let k = 1; k <= value.length; k++)
          offsets.push(base + i + (k === value.length ? width : 0));
      }
      i += width;
    }
    return { text, offsets };
  }
  const decoded = decode(source, 0);
  if (decoded.text === rendered) return decoded.offsets;
  // CommonMark inline code removes matching backtick delimiters and normalizes whitespace.
  const ticks = /^(`+)([\s\S]*)\1$/.exec(source);
  if (ticks) {
    const raw = ticks[2],
      base = ticks[1].length;
    let body = "",
      offsets = [base];
    for (let i = 0; i < raw.length;) {
      const width = raw[i] === "\r" && raw[i + 1] === "\n" ? 2 : 1;
      body += /[\r\n]/.test(raw[i]) ? " " : raw[i];
      i += width;
      offsets.push(base + i);
    }
    if (body.startsWith(" ") && body.endsWith(" ") && body.trim()) {
      body = body.slice(1, -1);
      offsets = offsets.slice(1, -1);
    }
    if (body === rendered) return offsets;
  }
  if (rendered === source + "\n")
    return [
      ...Array.from({ length: source.length + 1 }, (_, i) => i),
      source.length,
    ];
  return null;
}

/** Check the shape and monotonicity of a rendered-to-source map. */
export function isValidRenderedTextOffsets(
  offsets: readonly number[],
  renderedLength: number,
  sourceLength: number,
): boolean {
  if (
    !Number.isInteger(renderedLength) ||
    renderedLength < 0 ||
    offsets.length !== renderedLength + 1
  )
    return false;
  let previous = -1;
  for (const offset of offsets) {
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > sourceLength ||
      offset < previous
    )
      return false;
    previous = offset;
  }
  return true;
}


/** Both endpoint maps must be checked together before using either. */
export function checkedEndpointMaps(starts: string | undefined, ends: string | undefined, renderedLength: number, sourceLength: number): { starts: number[]; ends: number[] } | null {
  if (!starts || !ends) return null;
  try {
    const startMap: unknown = JSON.parse(starts);
    const endMap: unknown = JSON.parse(ends);
    if (!Array.isArray(startMap) || !Array.isArray(endMap) || !isValidRenderedTextOffsets(startMap, renderedLength, sourceLength) || !isValidRenderedTextOffsets(endMap, renderedLength, sourceLength)) return null;
    return { starts: startMap, ends: endMap };
  } catch { return null; }
}
