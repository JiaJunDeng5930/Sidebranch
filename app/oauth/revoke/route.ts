import { runtime } from "../../../lib/server/env";
import { revokeToken } from "../../../lib/server/oauth";
import { boundedBody, json, failure } from "../../../lib/server/http";
export async function POST(req: Request) {
  try {
    const p = new URLSearchParams(
      new TextDecoder().decode(await boundedBody(req, 8192)),
    );
    await revokeToken(runtime(), p.get("token") ?? "");
    return json({});
  } catch (e) {
    return failure(e);
  }
}
