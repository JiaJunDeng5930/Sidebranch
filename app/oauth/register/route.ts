import { runtime } from "../../../lib/server/env";
import { registerClient } from "../../../lib/server/oauth";
import { boundedJson, json, failure } from "../../../lib/server/http";
export async function POST(req: Request) {
  try {
    return json(
      await registerClient(runtime(), await boundedJson(req, 16384)),
      201,
    );
  } catch (e) {
    return failure(e);
  }
}
