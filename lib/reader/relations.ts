import type { ConnectionRelation } from "../domain/model";

export const relationNames: Readonly<Record<ConnectionRelation, string>> = {
  reference: "引用",
  explanation: "解释",
  question: "提问",
  contrast: "对照",
  continuation: "延伸",
};
export const relationColors: Readonly<Record<ConnectionRelation, string>> = {
  reference: "#d5a05c",
  explanation: "#6cb8b1",
  question: "#b891cf",
  contrast: "#e07a70",
  continuation: "#a4b36d",
};

/** The same relationship on light paper needs ink, not its luminous stage color. */
export const relationInkColors: Readonly<Record<ConnectionRelation, string>> = {
  reference: "#9a5c1f",
  explanation: "#1f716d",
  question: "#73548c",
  contrast: "#a23d3d",
  continuation: "#5c6e24",
};
