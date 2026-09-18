import type { ConnectionRelation } from "../domain/model";

export const relationNames: Readonly<Record<ConnectionRelation, string>> = {
  reference: "引用",
  explanation: "解释",
  question: "提问",
  contrast: "对照",
  continuation: "延伸",
};
export const relationColors: Readonly<Record<ConnectionRelation, string>> = {
  reference: "#d39e6d",
  explanation: "#81afa8",
  question: "#b29aba",
  contrast: "#c98276",
  continuation: "#a6aa7b",
};
