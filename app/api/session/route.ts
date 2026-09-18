import { getChatGPTUser } from "../../chatgpt-auth";
import { authorizeIdentity } from "../../../lib/server/owner-auth";
import { runtime } from "../../../lib/server/env";
import { json, failure } from "../../../lib/server/http";
import { DomainError } from "../../../lib/domain/model";
export async function GET() {
  try {
    const user = await getChatGPTUser();
    if (!user)
      throw new DomainError("AUTH_REQUIRED", "请先用 ChatGPT 登录。", 401);
    await authorizeIdentity(runtime(), user);
    return json({ name: user.displayName, userId: user.userId });
  } catch (e) {
    return failure(e);
  }
}
