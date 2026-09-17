import { decodeNamedCharacterReference } from "decode-named-character-reference";
/** Map rendered UTF-16 boundaries back to Markdown source boundaries. */
export function renderedTextOffsets(
  source: string,
  rendered: string,
): number[] | null {
  if (source === rendered)
    return Array.from({ length: rendered.length + 1 }, (_, i) => i);
  function decode(raw: string, base: number) {
    let text = "",
      offsets = [base];
    for (let i = 0; i < raw.length;) {
      let value = raw[i],
        width = 1;
      if (raw[i] === "\\" && /[!-/:-@\[-`{-~]/.test(raw[i + 1] ?? "")) {
        value = raw[i + 1];
        width = 2;
      } else if (raw[i] === "&") {
        const match = /^&(#x[\da-f]+|#\d+|[a-z][a-z\d]+);/i.exec(raw.slice(i));
        if (match) {
          const entity = match[1];
          const decoded =
            entity[0] === "#"
              ? numericEntity(entity)
              : decodeNamedCharacterReference(entity);
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
      for (let k = 1; k <= value.length; k++)
        offsets.push(base + i + (k === value.length ? width : 0));
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
function numericEntity(entity: string): string | null {
  const hex = entity[1]?.toLowerCase() === "x";
  const value = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
  if (!Number.isFinite(value)) return null;
  return value === 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)
    ? "�"
    : String.fromCodePoint(value);
}
