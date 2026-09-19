import type { ConnectionRelation } from "../domain/model";

export const relationNames: Readonly<Record<ConnectionRelation, string>> = {
  reference: "引用",
  explanation: "解释",
  question: "提问",
  contrast: "对照",
  continuation: "延伸",
};
