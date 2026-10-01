import html from "../../.app-build/reader.html?raw";
import { runtime } from "../../lib/server/env";
import { authorizeBrowser } from "../../lib/server/browser-auth";
import { DocumentStore } from "../../lib/server/document-store";
import { handleMcp } from "../../lib/server/mcp-server";
import { boundedJson, failure, json } from "../../lib/server/http";
import { DomainError } from "../../lib/domain/model";

export async function POST(req: Request) {
  try {
    const env = runtime();
    const origin = req.headers.get("origin");
    if (
      origin &&
      origin !== env.SITE_ORIGIN &&
      origin !== "https://chatgpt.com"
    )
      throw new DomainError("ORIGIN_DENIED", "MCP origin denied.", 403);
    const body = await boundedJson(req.clone() as Request, 15_000_000);
    let store: Promise<DocumentStore> | undefined;
    // Discovery contains no document data; every data handler still resolves
    // this request-local authorization before receiving the document store.
    const getStore = () =>
      (store ??= authorizeBrowser(env).then(
        (owner) => new DocumentStore(env, owner),
      ));
    if (
      body !== null &&
      typeof body === "object" &&
      "method" in body &&
      body.method === "tools/call"
    )
      await getStore();
    const response = await handleMcp(req, env, html, getStore);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return failure(error);
  }
}

export function GET() {
  return json({ error: "Use Streamable HTTP POST requests." }, 405, {
    Allow: "POST",
  });
}

export function DELETE() {
  return json({ error: "Stateless MCP has no session to delete." }, 405, {
    Allow: "POST",
  });
}
