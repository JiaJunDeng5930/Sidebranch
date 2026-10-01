import type { ChatGPTUser } from "../../app/chatgpt-auth";
import { DomainError } from "../domain/model";
import type { RuntimeEnv } from "./env";
const ownerProof: unique symbol = Symbol("Owner");
export const READ_SCOPE = "documents:read" as const;
export const WRITE_SCOPE = "documents:write" as const;
export type DocumentScope = typeof READ_SCOPE | typeof WRITE_SCOPE;
export const FULL_SCOPES: readonly DocumentScope[] = [READ_SCOPE, WRITE_SCOPE];
export type Owner = {
  readonly userId: string;
  readonly scopes: readonly DocumentScope[];
  readonly [ownerProof]: true;
};
export function hasScope(owner: Owner, scope: DocumentScope): boolean {
  return owner.scopes.includes(scope);
}
export function requireScope(owner: Owner, scope: DocumentScope): void {
  if (!hasScope(owner, scope))
    throw new DomainError(
      "INSUFFICIENT_SCOPE",
      `Document access requires ${scope}.`,
      403,
    );
}
function makeOwner(userId: string, scopes: readonly DocumentScope[]): Owner {
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
