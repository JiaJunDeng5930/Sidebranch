import type { ChatGPTUser } from "../../app/chatgpt-auth";
import { DomainError } from "../domain/model";
import type { RuntimeEnv } from "./env";
const ownerProof: unique symbol = Symbol("Owner");
export const READ_SCOPE = "documents:read" as const;
export const WRITE_SCOPE = "documents:write" as const;
export type OAuthScope = typeof READ_SCOPE | typeof WRITE_SCOPE;
export const FULL_SCOPES: readonly OAuthScope[] = [READ_SCOPE, WRITE_SCOPE];
export type Owner = {
  readonly userId: string;
  readonly scopes: readonly OAuthScope[];
  readonly [ownerProof]: true;
};
export function scopeString(scopes: readonly OAuthScope[]): string {
  return FULL_SCOPES.filter((scope) => scopes.includes(scope)).join(" ");
}
export function parseScopes(value: unknown): OAuthScope[] {
  const allowed = new Set<string>(FULL_SCOPES);
  return [
    ...new Set(
      String(value ?? "")
        .split(/\s+/)
        .filter(Boolean),
    ),
  ].filter((scope): scope is OAuthScope => allowed.has(scope));
}
export function hasScope(owner: Owner, scope: OAuthScope): boolean {
  return owner.scopes.includes(scope);
}
export function requireScope(owner: Owner, scope: OAuthScope): void {
  if (!hasScope(owner, scope))
    throw new DomainError(
      "INSUFFICIENT_SCOPE",
      `MCP token requires ${scope}.`,
      403,
    );
}
function makeOwner(userId: string, scopes: readonly OAuthScope[]): Owner {
  return { userId, scopes: [...scopes], [ownerProof]: true };
}
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
  return makeOwner(user.userId, FULL_SCOPES);
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
    "SELECT user_id,scope FROM oauth_tokens WHERE hash=? AND kind='access' AND expires_at>? AND resource=?",
  )
    .bind(
      await sha256(value.slice(7)),
      Date.now(),
      env.SITE_ORIGIN + "/api/mcp",
    )
    .first<{ user_id: string; scope: string }>();
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
  return makeOwner(token.user_id, parseScopes(token.scope));
}
