"use client";
import { Reader } from "./reader";
import { browserClient } from "../../lib/client/reader-client";
export function Workspace() {
  return <Reader client={browserClient} />;
}
