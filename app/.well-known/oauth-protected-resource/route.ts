import { runtime } from "../../../lib/server/env";
import { resourceMetadata } from "../../../lib/server/oauth";
import { json } from "../../../lib/server/http";
export function GET() {
  return json(resourceMetadata(runtime()));
}
