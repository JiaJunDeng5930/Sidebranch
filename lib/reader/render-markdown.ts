import type { AnchorInput } from "../domain/model";
import { validateAnchor } from "../domain/model";

/** A UTF-16 offset in the immutable document source. */
export type SourceOffset = number & { readonly __sourceOffset: unique symbol };

/** A UTF-16 offset in the text currently exposed by the DOM. */
export type RenderedOffset = number & {
  readonly __renderedOffset: unique symbol;
};

export interface SourceRange {
  start: SourceOffset;
  end: SourceOffset;
}

export interface RenderChunk {
  /** Stable ordinal in the immutable revision. */
  index: number;
  /** Half-open UTF-16 source range represented by this chunk. */
  range: SourceRange;
  source: string;
  /** Reference definitions appended only to the parser input, never to source. */
  referenceDefinitions?: readonly string[];
}

export interface RenderPlan {
  sourceLength: number;
  chunks: readonly RenderChunk[];
}

export class RendererMappingError extends Error {
  readonly code = "RENDERER_MAPPING_ERROR";

  constructor(message: string, readonly reason: "unmapped" | "gap" | "revision" = "unmapped") {
    super(message);
    this.name = "RendererMappingError";
  }
}

// Keep first-time Markdown parsing within a frame-sized unit. Structural
// blocks (lists, quotes, fences) still remain intact across this soft limit.
const DEFAULT_CHUNK_SIZE = 2_048;
const MAX_CHUNK_SIZE = 64 * 1024;

function sourceOffset(value: number): SourceOffset {
  return value as SourceOffset;
}

/**
 * Make a bounded render plan without changing the source representation.
 *
 * Markdown is split only after a complete block boundary (a blank line or a
 * heading boundary).  Fenced code, tables, lists and block quotes keep their
 * lines together.  A single unusually large block remains one chunk so the
 * parser never receives a syntactically different fragment.
 */
export function createRenderPlan(
  source: string,
  format: "markdown" | "text",
  maxChunkSize = DEFAULT_CHUNK_SIZE,
): RenderPlan {
  if (!Number.isInteger(maxChunkSize) || maxChunkSize < 1024)
    throw new RendererMappingError("maxChunkSize must be at least 1024");
  const boundedSize = Math.min(maxChunkSize, MAX_CHUNK_SIZE);
  if (!source.length)
    return {
      sourceLength: 0,
      chunks: [
        {
          index: 0,
          range: { start: sourceOffset(0), end: sourceOffset(0) },
          source: "",
        },
      ],
    };

  const markdownPlan =
    format === "markdown" ? markdownBoundaries(source, boundedSize) : undefined;
  const boundaries = markdownPlan
    ? markdownPlan.boundaries
    : textBoundaries(source, boundedSize);
  const chunks = boundaries.map(([start, end], index) => ({
    index,
    range: { start: sourceOffset(start), end: sourceOffset(end) },
    source: source.slice(start, end),
  }));
  return {
    sourceLength: source.length,
    chunks: markdownPlan
      ? addReferenceDefinitions(
          chunks,
          markdownPlan.lines,
          markdownPlan.references,
        )
      : chunks,
  };
}

function lineRanges(
  source: string,
): { start: number; end: number; bodyEnd: number; text: string }[] {
  const lines: { start: number; end: number; bodyEnd: number; text: string }[] =
    [];
  let start = 0;
  while (start < source.length) {
    const newline = source.indexOf("\n", start);
    const end = newline < 0 ? source.length : newline + 1;
    const bodyEnd =
      newline < 0
        ? end
        : newline > start && source[newline - 1] === "\r"
          ? newline - 1
          : newline;
    lines.push({ start, end, bodyEnd, text: source.slice(start, bodyEnd) });
    start = end;
  }
  if (source.endsWith("\n"))
    lines.push({
      start: source.length,
      end: source.length,
      bodyEnd: source.length,
      text: "",
    });
  return lines;
}

interface FenceState {
  marker: "`" | "~";
  length: number;
}

function openingFence(text: string): FenceState | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
  if (!match) return null;
  const marker = match[1][0] as "`" | "~";
  // Backtick fences cannot contain a backtick in their info string.  A line
  // that violates this rule is ordinary paragraph text, not a fence opener.
  if (marker === "`" && match[2].includes("`")) return null;
  return { marker, length: match[1].length };
}

function closesFence(text: string, fence: FenceState): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(text);
  return Boolean(
    match && match[1][0] === fence.marker && match[1].length >= fence.length,
  );
}

function isListItem(text: string): boolean {
  return /^ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]+|$)/.test(text);
}

function isIndented(text: string): boolean {
  return /^(?: {2,}|\t)\S/.test(text);
}

function isBlockquote(text: string): boolean {
  return /^ {0,3}>/.test(text);
}

function normalizeReferenceLabel(label: string): string {
  return label
    .replace(/\\([\\[\]])/g, "$1")
    .trim()
    .replace(/[ \t\r\n]+/g, " ")
    .toLowerCase();
}

interface ReferenceDefinition {
  line: number;
  source: string;
}

interface ReferenceScan {
  definitions: ReadonlyMap<string, ReferenceDefinition>;
  labelsByLine: readonly (readonly string[])[];
}

/** Scan definitions and uses once so each chunk receives only needed context. */
function scanReferences(lines: readonly { text: string }[]): ReferenceScan {
  const definitions = new Map<string, ReferenceDefinition>();
  const labelsByLine: string[][] = Array.from(
    { length: lines.length },
    () => [],
  );
  let fence: FenceState | null = null;
  for (let line = 0; line < lines.length; line += 1) {
    const text = lines[line].text;
    if (fence) {
      if (closesFence(text, fence)) fence = null;
      continue;
    }
    const opener = openingFence(text);
    if (opener) {
      fence = opener;
      continue;
    }
    const labels = new Set<string>();
    const rememberUse = (label: string) => {
      const normalized = normalizeReferenceLabel(label);
      if (!normalized) return;
      labels.add(normalized);
    };
    const definition = /^ {0,3}\[([^\]\n]+)\]:/.exec(text);
    if (definition) {
      const normalized = normalizeReferenceLabel(definition[1]);
      if (normalized && !definitions.has(normalized))
        definitions.set(normalized, { line, source: text });
    }
    const references = /!?\[([^\]\n]*)\]\[([^\]\n]*)\]/g;
    for (const match of text.matchAll(references))
      rememberUse(match[2] || match[1]);
    // Shortcut references have no second bracket: [label].  Exclude images,
    // escaped brackets, inline links and definitions so ordinary Markdown
    // punctuation does not become a false cross-chunk dependency.
    const shortcuts = /(^|[^\\!\w\]])\[([^\]\n]+)\](?![\[(:])/g;
    for (const match of text.matchAll(shortcuts)) rememberUse(match[2]);
    labelsByLine[line] = [...labels];
  }
  return { definitions, labelsByLine };
}

function addReferenceDefinitions(
  chunks: readonly RenderChunk[],
  lines: readonly { start: number; end: number }[],
  references: ReferenceScan,
): RenderChunk[] {
  let line = 0;
  return chunks.map((chunk) => {
    while (line < lines.length && lines[line].end <= chunk.range.start)
      line += 1;
    const firstLine = line;
    const labels = new Set<string>();
    while (line < lines.length && lines[line].start < chunk.range.end) {
      for (const label of references.labelsByLine[line]) labels.add(label);
      line += 1;
    }
    const definitions: string[] = [];
    for (const label of labels) {
      const definition = references.definitions.get(label);
      if (
        definition &&
        (definition.line < firstLine || definition.line >= line)
      )
        definitions.push(definition.source);
    }
    return definitions.length
      ? { ...chunk, referenceDefinitions: definitions }
      : chunk;
  });
}

function blankBoundaryIsUnsafe(
  previous: { text: string } | undefined,
  next: { text: string } | undefined,
): boolean {
  if (!previous || !next) return false;
  const previousList = isListItem(previous.text);
  const nextList = isListItem(next.text);
  // Keep sibling list items and a blank-separated continuation paragraph in
  // one parser input.  Otherwise the renderer creates separate <ul>/<ol>
  // roots or turns the continuation into a standalone paragraph.
  if (
    (previousList && (nextList || isIndented(next.text))) ||
    (nextList && (previousList || isIndented(previous.text))) ||
    (isIndented(previous.text) && isIndented(next.text))
  )
    return true;

  // A quoted blank line is represented either by neighbouring `>` lines or
  // by an empty line between quoted paragraphs.  Keep both paragraphs in one
  // chunk so the blockquote container is not silently closed at a chunk edge.
  if (isBlockquote(previous.text) && isBlockquote(next.text)) return true;
  return false;
}

function textBoundaries(
  source: string,
  maxChunkSize: number,
): [number, number][] {
  const lines = lineRanges(source);
  const boundaries: [number, number][] = [];
  let start = 0;
  let lastSafe = start;
  for (const line of lines) {
    if (line.end - start <= maxChunkSize) {
      if (/^\s*$/.test(line.text)) lastSafe = line.end;
      else if (line.text.includes("\n")) lastSafe = line.end;
      continue;
    }
    const cut = lastSafe > start ? lastSafe : line.end;
    boundaries.push([start, cut]);
    start = cut;
    lastSafe = start;
  }
  if (start < source.length || !boundaries.length)
    boundaries.push([start, source.length]);
  return boundaries;
}

interface MarkdownBoundaryPlan {
  boundaries: [number, number][];
  lines: readonly { start: number; end: number; text: string }[];
  references: ReferenceScan;
}

function markdownBoundaries(
  source: string,
  maxChunkSize: number,
): MarkdownBoundaryPlan {
  const lines = lineRanges(source);
  const boundaries: [number, number][] = [];
  let start = 0;
  let lastSafe = 0;
  let inFence: FenceState | null = null;
  const references = scanReferences(lines);
  const nextNonBlank = new Int32Array(lines.length);
  let nextNonBlankLine = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    nextNonBlank[i] = nextNonBlankLine;
    if (!/^\s*$/.test(lines[i].text)) nextNonBlankLine = i;
  }
  let previousNonBlank: { text: string } | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inFence) {
      if (closesFence(line.text, inFence)) inFence = null;
    } else {
      inFence = openingFence(line.text);
    }
    const next = lines[i + 1];
    const blank = /^\s*$/.test(line.text);
    const nextIsHeading = Boolean(
      next && /^ {0,3}#{1,6}(?:\s|$)/.test(next.text),
    );
    const unsafeBlank = blank
      ? blankBoundaryIsUnsafe(
          previousNonBlank,
          nextNonBlank[i] >= 0 ? lines[nextNonBlank[i]] : undefined,
        )
      : false;
    // A blank line is safe only outside a fenced code block and outside a
    // continued list/quote. The heading check avoids making a long run of
    // ATX sections one giant parse unit.
    if (!inFence && ((blank && !unsafeBlank) || nextIsHeading))
      lastSafe = line.end;

    if (line.end - start > maxChunkSize && lastSafe > start) {
      boundaries.push([start, lastSafe]);
      start = lastSafe;
      lastSafe = start;
    }
    if (!blank) previousNonBlank = line;
  }
  if (start < source.length || !boundaries.length)
    boundaries.push([start, source.length]);
  return { boundaries, lines, references };
}

/** Validate a source anchor before it reaches DOM geometry or mark state. */
export function assertRendererAnchor(
  content: string,
  anchor: AnchorInput,
  revisionId: string,
): asserts anchor is AnchorInput {
  if (anchor.revisionId !== revisionId)
    throw new RendererMappingError(
      `Anchor belongs to revision ${anchor.revisionId}, expected ${revisionId}`,
    );
  try {
    validateAnchor(content, anchor);
  } catch (error) {
    throw new RendererMappingError(
      error instanceof Error ? error.message : "Invalid source anchor",
    );
  }
}

export function assertSourceRange(content: string, range: SourceRange): void {
  if (
    !Number.isInteger(range.start) ||
    !Number.isInteger(range.end) ||
    range.start < 0 ||
    range.start >= range.end ||
    range.end > content.length
  )
    throw new RendererMappingError("Source range is outside the revision");
}
