import type { ChatGPTUser } from "../../app/chatgpt-auth";
import { DomainError } from "../domain/model";
import type { RuntimeEnv } from "./env";
const ownerProof: unique symbol = Symbol("Owner");
export type Owner = { readonly userId: string; readonly [ownerProof]: true };
export async function authorizeIdentity(
  env: RuntimeEnv,
  user: Pick<ChatGPTUser, "userId" | "email"> | null,
): Promise<Owner> {
  if (!user)
    throw new DomainError("AUTH_REQUIRED", "请先用 ChatGPT 登录。", 401);
  const pinned =
    env.OWNER_USER_ID ||
    (
      await env.DB.prepare(
        "SELECT user_id FROM owner WHERE singleton=1",
      ).first<{ user_id: string }>()
    )?.user_id;
  if (pinned) {
    if (user.userId !== pinned)
      throw new DomainError("OWNER_ONLY", "此文档空间仅向所有者开放。", 403);
  } else {
    if (
      !env.OWNER_BOOTSTRAP_EMAIL ||
      user.email.toLowerCase() !== env.OWNER_BOOTSTRAP_EMAIL.toLowerCase()
    )
      throw new DomainError("OWNER_ONLY", "此文档空间仅向所有者开放。", 403);
    await env.DB.prepare(
      "INSERT OR IGNORE INTO owner(singleton,user_id) VALUES(1,?)",
    )
      .bind(user.userId)
      .run();
    const bound = await env.DB.prepare(
      "SELECT user_id FROM owner WHERE singleton=1",
    ).first<{ user_id: string }>();
    if (bound?.user_id !== user.userId)
      throw new DomainError("OWNER_ONLY", "此文档空间仅向所有者开放。", 403);
  }
  return { userId: user.userId, [ownerProof]: true };
}
export async function sha256(value: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
export function randomToken(): string {
  return btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
export async function authorizeBearer(
  env: RuntimeEnv,
  request: Request,
): Promise<Owner> {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer "))
    throw new DomainError("AUTH_REQUIRED", "MCP authorization required.", 401);
  const token = await env.DB.prepare(
    "SELECT user_id FROM oauth_tokens WHERE hash=? AND kind='access' AND expires_at>? AND resource=?",
  )
    .bind(
      await sha256(value.slice(7)),
      Date.now(),
      env.SITE_ORIGIN + "/api/mcp",
    )
    .first<{ user_id: string }>();
  const pinned =
    env.OWNER_USER_ID ||
    (
      await env.DB.prepare(
        "SELECT user_id FROM owner WHERE singleton=1",
      ).first<{ user_id: string }>()
    )?.user_id;
  if (!token || !pinned || token.user_id !== pinned)
    throw new DomainError(
      "INVALID_TOKEN",
      "MCP token is expired or invalid.",
      401,
    );
  return { userId: token.user_id, [ownerProof]: true };
}
