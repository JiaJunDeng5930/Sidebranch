import {
  parseCommandInput,
  type CommandResults,
} from "../domain/commands";
import type { OpenDocumentResult } from "../domain/model";
import type { ReaderClient } from "./reader-client";

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
  open: (view: OpenDocumentResult) => void,
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
      properties: {
        documentId: { type: "string" },
        path: { type: "string" },
        revisionId: { type: "string" },
        connectionsCursor: { type: "string" },
        questionsCursor: { type: "string" },
        connectionsLimit: { type: "number" },
        questionsLimit: { type: "number" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(raw: unknown): Promise<CommandResults["open_document"]> {
      const input = parseCommandInput("open_document", raw);
      const result = await client.invoke("open_document", input);
      open(result);
      return result;
    },
  };
  try {
    Promise.resolve(
      context.registerTool(tool, { signal: lifecycle.signal }),
    ).catch((error: unknown) => {
      console.error("WebMCP open_document registration failed", error);
    });
  } catch (error) {
    console.error("WebMCP open_document registration failed", error);
  }
  return () => lifecycle.abort();
}
