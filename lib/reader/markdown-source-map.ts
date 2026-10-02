import { parse, postprocess, preprocess } from "micromark";
import { gfm } from "micromark-extension-gfm";
import { decodeString } from "micromark-util-decode-string";
import { isValidRenderedTextOffsets } from "../domain/text-offsets";

type Mode = "text" | "inline-code" | "flow-code";
interface Atom { text: string; offsets: number[]; mode: Mode }
export interface MarkdownSourceMap {
  start: number;
  end: number;
  starts: number[];
  ends: number[];
}

function atomic(text: string, start: number, end: number, mode: Mode): Atom {
  return { text, mode, offsets: [...Array.from({ length: text.length }, () => start), end] };
}

/** Token positions retain container-prefix gaps that AST text positions lose. */
export function markdownSourceMapper(parserSource: string, visibleLength: number) {
  const atoms: Atom[] = [];
  const stack: string[] = [];
  const containers: { type: string; header: boolean; fenceSeen: boolean }[] = [];
  const events = postprocess(parse({ extensions: [gfm()] }).document().write(preprocess()(parserSource, undefined, true)));
  for (const [event, token, context] of events) {
    if (event === "exit") { stack.pop(); containers.pop(); continue; }
    const mode: Mode = stack.includes("codeText") ? "inline-code" : stack.some((type) => type === "codeFenced" || type === "codeIndented") ? "flow-code" : "text";
    const compound = stack.some((type) => type === "characterEscape" || type === "characterReference");
    const start = token.start.offset;
    const end = token.end.offset;
    const fenced = containers.findLast((container) => container.type === "codeFenced");
    if (token.type === "codeFencedFence" && fenced && !fenced.fenceSeen) {
      fenced.header = true;
      fenced.fenceSeen = true;
    }
    if (!compound && start < visibleLength && end <= visibleLength) {
      const raw = parserSource.slice(start, end);
      if (token.type === "characterEscape" || token.type === "characterReference") {
        atoms.push(atomic(decodeString(raw), start, end, mode));
      } else if (["data", "codeTextData", "codeFlowValue"].includes(token.type)) {
        const serialized = context.sliceSerialize(token);
        const normalized = raw.replaceAll("\0", "�");
        if (serialized === normalized) {
          atoms.push({ text: normalized, mode, offsets: Array.from({ length: normalized.length + 1 }, (_, i) => start + i) });
        } else if (token.type === "codeFlowValue" && parserSource[start - 1] === "\t" && serialized.endsWith(normalized)) {
          const padding = serialized.slice(0, serialized.length - normalized.length);
          if (/^ +$/.test(padding)) {
            atoms.push(atomic(padding, start - 1, start, mode));
            atoms.push({ text: normalized, mode, offsets: Array.from({ length: normalized.length + 1 }, (_, i) => start + i) });
          }
        }
      } else if (token.type === "lineEnding" || token.type === "lineEndingBlank") {
        const width = parserSource[start] === "\r" && parserSource[start + 1] === "\n" ? 2 : 1;
        if (mode === "flow-code" && fenced?.header) {
          fenced.header = false;
        } else if (mode !== "text" || stack.includes("paragraph")) {
          atoms.push(atomic(mode === "inline-code" ? " " : "\n", start, start + width, mode));
        }
      }
    }
    stack.push(token.type);
    containers.push({ type: token.type, header: false, fenceSeen: false });
  }
  return (value: string, range: { start: number; end: number }, mode: Mode, generated = false): MarkdownSourceMap | null => {
    const selected = atoms.filter((atom) => atom.mode === mode && atom.offsets[0] >= range.start && atom.offsets.at(-1)! <= range.end);
    if (generated) {
      if (!value.endsWith("\n")) return null;
      const body = value.slice(0, -1);
      while (selected.at(-1)?.text === "\n" && selected.map((atom) => atom.text).join("") !== body) selected.pop();
      if (selected.map((atom) => atom.text).join("") !== body || !selected.length) return null;
      const end = selected.at(-1)!.offsets.at(-1)!;
      selected.push(atomic("\n", end, end, mode));
    }
    if (!selected.length || selected.map((atom) => atom.text).join("") !== value) return null;
    const start = selected[0].offsets[0];
    const end = selected.at(-1)!.offsets.at(-1)!;
    const starts = [0];
    const ends = [0];
    for (const atom of selected) {
      starts[starts.length - 1] = atom.offsets[0] - start;
      for (let i = 1; i < atom.offsets.length; i++) {
        starts.push(atom.offsets[i] - start);
        ends.push(atom.offsets[i] - start);
      }
    }
    return isValidRenderedTextOffsets(starts, value.length, end - start) && isValidRenderedTextOffsets(ends, value.length, end - start) ? { start, end, starts, ends } : null;
  };
}
