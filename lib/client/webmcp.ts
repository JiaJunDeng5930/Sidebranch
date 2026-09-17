import type { ReaderClient } from "./reader-client";
import { commandSchemas } from "../domain/commands";
import type { ReadingView } from "../domain/model";
interface WebModelContext {
  registerTool: (
    tool: {
      name: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute: (input: unknown) => Promise<unknown>;
    },
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
}
export function registerReadingTools(
  client: ReaderClient,
  open: (view: ReadingView) => void,
): () => void {
  const context = (document as Document & { modelContext?: WebModelContext })
    .modelContext;
  if (!context) return () => {};
  const lifecycle = new AbortController();
  const tool = {
    name: "open_document",
    description:
      "Open a document in the current reading space by its document ID or absolute path.",
    inputSchema: {
      type: "object",
      properties: { documentId: { type: "string" }, path: { type: "string" } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(raw: unknown) {
      const input = commandSchemas.open_document.parse(raw);
      const view = await client.invoke("open_document", input);
      open(view);
      return {
        documentId: view.document.id,
        path: view.document.path,
        revisionId: view.document.revisionId,
      };
    },
  };
  try {
    Promise.resolve(
      context.registerTool(tool, { signal: lifecycle.signal }),
    ).catch(() => {});
  } catch {
    /* Optional browser standard; HTTP and MCP remain available. */
  }
  return () => lifecycle.abort();
}
