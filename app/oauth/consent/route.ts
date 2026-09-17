import { runtime } from "../../../lib/server/env";
import { authorizeBrowser } from "../../../lib/server/browser-auth";
import { consent } from "../../../lib/server/oauth";
import { sameOrigin, boundedBody, failure } from "../../../lib/server/http";
export async function POST(req: Request) {
  try {
    const env = runtime();
    sameOrigin(req, env.SITE_ORIGIN);
    const owner = await authorizeBrowser(env);
    const p = new URLSearchParams(
      new TextDecoder().decode(await boundedBody(req, 8192)),
    );
    return Response.redirect(
      await consent(
        env,
        owner,
        p.get("request_id") ?? "",
        p.get("decision") === "allow",
      ),
      303,
    );
  } catch (e) {
    return failure(e);
  }
}
