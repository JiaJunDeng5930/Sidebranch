import html from "../../../.app-build/reader.html?raw";
import { runtime } from "../../../lib/server/env";
import { authorizeBearer } from "../../../lib/server/owner-auth";
import { DocumentStore } from "../../../lib/server/document-store";
import { handleMcp } from "../../../lib/server/mcp-server";
import { boundedJson, failure, json } from "../../../lib/server/http";
import { challenge } from "../../../lib/server/oauth";
import { DomainError } from "../../../lib/domain/model";
export async function POST(req: Request) {
  try {
    const env = runtime(),
      owner = await authorizeBearer(env, req);
    const origin = req.headers.get("origin");
    if (
      origin &&
      origin !== env.SITE_ORIGIN &&
      origin !== "https://chatgpt.com"
    )
      throw new DomainError("ORIGIN_DENIED", "MCP origin denied.", 403);
    const body = await boundedJson(req, 15_000_000);
    const response = await handleMcp(
      new DocumentStore(env, owner),
      req,
      body,
      html,
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (e) {
    if (e instanceof DomainError && e.status === 401)
      return json({ error: e.code }, 401, {
        "WWW-Authenticate": challenge(runtime()),
      });
    return failure(e);
  }
}
export function GET() {
  return json({ error: "Use Streamable HTTP POST requests." }, 405, {
    Allow: "POST",
    "WWW-Authenticate": challenge(runtime()),
  });
}
export function DELETE() {
  return json({ error: "Stateless MCP has no session to delete." }, 405, {
    Allow: "POST",
  });
}
