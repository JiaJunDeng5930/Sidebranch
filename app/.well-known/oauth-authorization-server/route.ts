import { runtime } from "../../../lib/server/env";
import { authorizationMetadata } from "../../../lib/server/oauth";
import { json } from "../../../lib/server/http";
export function GET() {
  return json(authorizationMetadata(runtime()));
}
