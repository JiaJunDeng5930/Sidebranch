import { getChatGPTUser } from "../../chatgpt-auth";
import { authorizeIdentity } from "../../../lib/server/owner-auth";
import { runtime } from "../../../lib/server/env";
import { json, failure } from "../../../lib/server/http";
export async function GET() {
  try {
    const user = await getChatGPTUser();
    await authorizeIdentity(runtime(), user);
    return json({ name: user!.displayName, userId: user!.userId });
  } catch (e) {
    return failure(e);
  }
}
