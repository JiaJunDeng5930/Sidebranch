import type { CSSProperties } from "react";
import type { ConnectionRelation } from "../domain/model";

const alphaColor = (hex: string, alpha: number): string => {
  const normalized = hex.replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgb(${red} ${green} ${blue} / ${alpha})`;
};

export const readerPalette = {
  canvas: "#E5DFD4",
  raised: "#EEEAE2",
  shelf: "#D5CBBA",
  paper: {
    current: "#FFFEFA",
    companion: "#F8F5EF",
  },
  text: "#24272A",
  muted: "#5D605D",
  link: "#075780",
  rule: "#D2CBBF",
  controlBorder: "#80796D",
  identity: {
    current: "#A44312",
    companion: "#545F65",
  },
  focus: {
    paper: "#174A70",
    chrome: "#D7EDFF",
  },
  chrome: {
    bg: "#171C23",
    panel: "#202832",
    input: "#161C23",
    text: "#F1EDE4",
    muted: "#B9BDC3",
    dim: "#AAB2BD",
    border: "#7D8793",
    hover: "#35404D",
  },
  action: {
    base: "#D39E6D",
    hover: "#E1B081",
    ink: "#171C23",
  },
  danger: {
    chrome: "#F0A59B",
    paper: "#963121",
  },
  overlap: "#62676C",
  selection: "#B8D7EE",
  shadow: "#433A2F",
  backdrop: "#080B0F",
  state: {
    shadow: {
      soft: 0.1,
      medium: 0.18,
      strong: 0.28,
    },
    backdrop: 0.78,
    signal: {
      range: 0.16,
      rangeHover: 0.2,
      rangeSelected: 0.26,
      beam: 0.3,
      beamSelected: 0.44,
      beamProxy: 0.24,
      label: 0.08,
    },
    focus: 0.15,
    rule: {
      soft: 0.14,
      faint: 0.08,
    },
    text: {
      soft: 0.04,
      faint: 0.06,
      border: 0.18,
      tint: 0.07,
    },
    action: {
      soft: 0.08,
      faint: 0.1,
    },
    identity: {
      soft: 0.1,
    },
    focusStates: {
      selected: 0.22,
      hover: 0.16,
    },
  },
} as const;

export type RelationAppearance = {
  readonly signal: string;
  readonly ink: string;
  readonly symbol: string;
  readonly state: {
    readonly signal: {
      readonly range: number;
      readonly rangeHover: number;
      readonly rangeSelected: number;
      readonly beam: number;
      readonly beamSelected: number;
      readonly beamProxy: number;
      readonly label: number;
    };
  };
};

const relationAppearances = {
  reference: {
    signal: "#C07800",
    ink: "#804200",
    symbol: "“”",
    state: readerPalette.state,
  },
  explanation: {
    signal: "#007EB8",
    ink: "#075780",
    symbol: "=",
    state: readerPalette.state,
  },
  question: {
    signal: "#9858C6",
    ink: "#68388E",
    symbol: "?",
    state: readerPalette.state,
  },
  contrast: {
    signal: "#D54A31",
    ink: "#963121",
    symbol: "≠",
    state: readerPalette.state,
  },
  continuation: {
    signal: "#2D9254",
    ink: "#23663D",
    symbol: "→",
    state: readerPalette.state,
  },
} satisfies Record<ConnectionRelation, RelationAppearance>;

export const relationAppearance = (
  relation: ConnectionRelation,
): RelationAppearance => relationAppearances[relation];

type ReaderPaletteStyle = CSSProperties & Record<`--sb-${string}`, string>;

export const readerPaletteStyle = {
  "--sb-canvas": readerPalette.canvas,
  "--sb-raised": readerPalette.raised,
  "--sb-shelf": readerPalette.shelf,
  "--sb-paper-current": readerPalette.paper.current,
  "--sb-paper-companion": readerPalette.paper.companion,
  "--sb-text": readerPalette.text,
  "--sb-muted": readerPalette.muted,
  "--sb-link": readerPalette.link,
  "--sb-rule": readerPalette.rule,
  "--sb-control-border": readerPalette.controlBorder,
  "--sb-identity-current": readerPalette.identity.current,
  "--sb-identity-companion": readerPalette.identity.companion,
  "--sb-focus-paper": readerPalette.focus.paper,
  "--sb-focus-chrome": readerPalette.focus.chrome,
  "--sb-chrome-bg": readerPalette.chrome.bg,
  "--sb-chrome-panel": readerPalette.chrome.panel,
  "--sb-chrome-input": readerPalette.chrome.input,
  "--sb-chrome-text": readerPalette.chrome.text,
  "--sb-chrome-muted": readerPalette.chrome.muted,
  "--sb-chrome-dim": readerPalette.chrome.dim,
  "--sb-chrome-border": readerPalette.chrome.border,
  "--sb-chrome-line": alphaColor(readerPalette.chrome.border, 0.24),
  "--sb-chrome-hover": readerPalette.chrome.hover,
  "--sb-action": readerPalette.action.base,
  "--sb-action-hover": readerPalette.action.hover,
  "--sb-action-ink": readerPalette.action.ink,
  "--sb-danger-chrome": readerPalette.danger.chrome,
  "--sb-danger-paper": readerPalette.danger.paper,
  "--sb-overlap": readerPalette.overlap,
  "--sb-selection": readerPalette.selection,
  "--sb-shadow": readerPalette.shadow,
  "--sb-backdrop": readerPalette.backdrop,
  "--sb-shadow-soft": alphaColor(
    readerPalette.shadow,
    readerPalette.state.shadow.soft,
  ),
  "--sb-shadow-medium": alphaColor(
    readerPalette.shadow,
    readerPalette.state.shadow.medium,
  ),
  "--sb-shadow-strong": alphaColor(
    readerPalette.shadow,
    readerPalette.state.shadow.strong,
  ),
  "--sb-backdrop-layer": alphaColor(
    readerPalette.backdrop,
    readerPalette.state.backdrop,
  ),
  "--sb-rule-soft": alphaColor(readerPalette.rule, readerPalette.state.rule.soft),
  "--sb-rule-faint": alphaColor(readerPalette.rule, readerPalette.state.rule.faint),
  "--sb-text-soft": alphaColor(readerPalette.text, readerPalette.state.text.soft),
  "--sb-text-faint": alphaColor(readerPalette.text, readerPalette.state.text.faint),
  "--sb-text-border": alphaColor(readerPalette.text, readerPalette.state.text.border),
  "--sb-text-tint": alphaColor(readerPalette.text, readerPalette.state.text.tint),
  "--sb-action-soft": alphaColor(readerPalette.action.base, readerPalette.state.action.soft),
  "--sb-action-faint": alphaColor(readerPalette.action.base, readerPalette.state.action.faint),
  "--sb-focus-soft": alphaColor(readerPalette.focus.paper, readerPalette.state.focus),
  "--sb-focus-selected": alphaColor(
    readerPalette.focus.paper,
    readerPalette.state.focusStates.selected,
  ),
  "--sb-focus-hover": alphaColor(
    readerPalette.focus.paper,
    readerPalette.state.focusStates.hover,
  ),
  "--sb-identity-current-soft": alphaColor(
    readerPalette.identity.current,
    readerPalette.state.identity.soft,
  ),
  "--sb-identity-companion-soft": alphaColor(
    readerPalette.identity.companion,
    readerPalette.state.identity.soft,
  ),
} as ReaderPaletteStyle;

export type RelationCssStyle = CSSProperties & {
  "--relation-signal": string;
  "--relation-ink": string;
  "--relation-symbol": string;
  "--relation-range-alpha": string;
  "--relation-range-hover-alpha": string;
  "--relation-range-selected-alpha": string;
  "--relation-beam-alpha": string;
  "--relation-beam-selected-alpha": string;
  "--relation-beam-proxy-alpha": string;
  "--relation-label-alpha": string;
};

/** CSS custom properties for a relation; all five relations are checked above. */
export function relationStyle(relation: ConnectionRelation): RelationCssStyle {
  const appearance = relationAppearance(relation);
  return {
    "--relation-signal": appearance.signal,
    "--relation-ink": appearance.ink,
    "--relation-symbol": JSON.stringify(appearance.symbol),
    "--relation-range-alpha": `${appearance.state.signal.range}`,
    "--relation-range-hover-alpha": `${appearance.state.signal.rangeHover}`,
    "--relation-range-selected-alpha": `${appearance.state.signal.rangeSelected}`,
    "--relation-beam-alpha": `${appearance.state.signal.beam}`,
    "--relation-beam-selected-alpha": `${appearance.state.signal.beamSelected}`,
    "--relation-beam-proxy-alpha": `${appearance.state.signal.beamProxy}`,
    "--relation-label-alpha": `${appearance.state.signal.label * 100}%`,
  };
}
