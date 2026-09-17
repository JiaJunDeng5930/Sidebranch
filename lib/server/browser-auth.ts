import { getChatGPTUser } from "../../app/chatgpt-auth";
import { authorizeIdentity } from "./owner-auth";
import type { RuntimeEnv } from "./env";
export async function authorizeBrowser(env: RuntimeEnv) {
  return authorizeIdentity(env, await getChatGPTUser());
}
