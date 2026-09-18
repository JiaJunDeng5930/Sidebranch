import { z } from "zod";
import { DomainError } from "../domain/model";
import type { RuntimeEnv } from "./env";
import {
  sha256,
  randomToken,
  scopeString,
  FULL_SCOPES,
  type OAuthScope,
  type Owner,
} from "./owner-auth";
export const OAUTH_SCOPE = scopeString(FULL_SCOPES);
const SUPPORTED_SCOPES = new Set<OAuthScope>(FULL_SCOPES);
function normalizeScope(raw: string | null | undefined): OAuthScope[] {
  const requested = [...new Set((raw ?? OAUTH_SCOPE).split(/\s+/).filter(Boolean))];
  if (!requested.length || requested.some((scope) => !SUPPORTED_SCOPES.has(scope as OAuthScope)))
    throw new DomainError("INVALID_SCOPE", "Unsupported scope.");
  return requested as OAuthScope[];
}
function isSubset(requested: readonly OAuthScope[], granted: readonly OAuthScope[]): boolean {
  return requested.every((scope) => granted.includes(scope));
}
const redirectUri = z
  .string()
  .url()
  .max(1000)
  .refine((value) => {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      u.hostname === "chatgpt.com" &&
      !u.username &&
      !u.password &&
      !u.hash &&
      (u.pathname === "/connector_platform_oauth_redirect" ||
        /^\/connector\/oauth\/[a-zA-Z0-9_-]+$/.test(u.pathname) ||
        /^\/aip\/[a-zA-Z0-9_-]+\/oauth\/callback$/.test(u.pathname))
    );
  }, "Only official ChatGPT OAuth callback URLs are accepted.");
export function authorizationMetadata(env: RuntimeEnv) {
  return {
    issuer: env.SITE_ORIGIN,
    authorization_endpoint: env.SITE_ORIGIN + "/oauth/authorize",
    token_endpoint: env.SITE_ORIGIN + "/oauth/token",
    registration_endpoint: env.SITE_ORIGIN + "/oauth/register",
    revocation_endpoint: env.SITE_ORIGIN + "/oauth/revoke",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: OAUTH_SCOPE.split(" "),
    authorization_response_iss_parameter_supported: true,
  };
}
export function resourceMetadata(env: RuntimeEnv) {
  return {
    resource: env.SITE_ORIGIN + "/api/mcp",
    authorization_servers: [env.SITE_ORIGIN],
    scopes_supported: OAUTH_SCOPE.split(" "),
    resource_name: "Xanadu Sidebranch",
  };
}
export function challenge(env: RuntimeEnv) {
  return `Bearer resource_metadata="${env.SITE_ORIGIN}/.well-known/oauth-protected-resource", scope="${OAUTH_SCOPE}"`;
}
export async function registerClient(env: RuntimeEnv, raw: unknown) {
  const a = z
    .object({
      redirect_uris: z.array(redirectUri).min(1).max(5),
      client_name: z.string().max(100).optional(),
      token_endpoint_auth_method: z.literal("none").optional(),
      grant_types: z
        .array(z.enum(["authorization_code", "refresh_token"]))
        .optional(),
      response_types: z.array(z.literal("code")).optional(),
    })
    .parse(raw);
  // Bounded anonymous registration; unused registrations expire after 24 hours.
  await env.DB.prepare(
    "DELETE FROM oauth_clients WHERE created_at<? AND NOT EXISTS(SELECT 1 FROM oauth_tokens t WHERE t.client_id=oauth_clients.id AND t.expires_at>?)",
  )
    .bind(Date.now() - 86400000, Date.now())
    .run();
  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM oauth_clients",
  ).first<{ n: number }>();
  if ((count?.n ?? 0) >= 256)
    throw new DomainError(
      "RATE_LIMIT",
      "Too many client registrations. Try later.",
      429,
    );
  const id = randomToken();
  await env.DB.prepare(
    "INSERT INTO oauth_clients(id,redirect_uris,name,created_at) VALUES(?,?,?,?)",
  )
    .bind(
      id,
      JSON.stringify(a.redirect_uris),
      a.client_name ?? "ChatGPT",
      Date.now(),
    )
    .run();
  return {
    client_id: id,
    client_name: a.client_name ?? "ChatGPT",
    redirect_uris: a.redirect_uris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  };
}
const authInput = z.object({
  client_id: z.string().min(1).max(200),
  redirect_uri: redirectUri,
  response_type: z.literal("code"),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal("S256"),
  state: z.string().min(1).max(2000),
  resource: z.string().url(),
  scope: z.string().optional(),
});
export async function authorizationRequest(
  env: RuntimeEnv,
  owner: Owner,
  raw: unknown,
) {
  const a = authInput.parse(raw);
  if (a.resource !== env.SITE_ORIGIN + "/api/mcp")
    throw new DomainError(
      "INVALID_RESOURCE",
      "OAuth resource does not match this server.",
    );
  const scope = normalizeScope(a.scope);
  const client = await env.DB.prepare(
    "SELECT redirect_uris,name FROM oauth_clients WHERE id=?",
  )
    .bind(a.client_id)
    .first<{ redirect_uris: string; name: string }>();
  if (
    !client ||
    !(JSON.parse(client.redirect_uris) as string[]).includes(a.redirect_uri)
  )
    throw new DomainError(
      "INVALID_CLIENT",
      "OAuth client or redirect URI is invalid.",
    );
  await env.DB.prepare("DELETE FROM oauth_requests WHERE expires_at<?")
    .bind(Date.now())
    .run();
  const id = randomToken();
  await env.DB.prepare(
    "INSERT INTO oauth_requests(id,user_id,client_id,redirect_uri,challenge,state,resource,scope,expires_at) VALUES(?,?,?,?,?,?,?,?,?)",
  )
    .bind(
      id,
      owner.userId,
      a.client_id,
      a.redirect_uri,
      a.code_challenge,
      a.state,
      a.resource,
      scopeString(scope),
      Date.now() + 600000,
    )
    .run();
  return { id, clientName: client.name, scope: scopeString(scope) };
}
type AuthorizationRow = {
  user_id: string;
  client_id: string;
  redirect_uri: string;
  challenge: string;
  state: string;
  resource: string;
  scope: string;
  expires_at: number;
};
export async function consent(
  env: RuntimeEnv,
  owner: Owner,
  id: string,
  allow: boolean,
) {
  const req = await env.DB.prepare(
    "DELETE FROM oauth_requests WHERE id=? AND user_id=? AND expires_at>? RETURNING *",
  )
    .bind(id, owner.userId, Date.now())
    .first<AuthorizationRow>();
  if (!req)
    throw new DomainError("INVALID_REQUEST", "授权请求已过期，请重新连接。");
  const target = new URL(req.redirect_uri);
  target.searchParams.set("state", req.state);
  target.searchParams.set("iss", env.SITE_ORIGIN);
  if (!allow) {
    target.searchParams.set("error", "access_denied");
    return target.toString();
  }
  const code = randomToken();
  await env.DB.prepare(
    "INSERT INTO oauth_codes(hash,user_id,client_id,redirect_uri,challenge,resource,scope,expires_at) VALUES(?,?,?,?,?,?,?,?)",
  )
    .bind(
      await sha256(code),
      owner.userId,
      req.client_id,
      req.redirect_uri,
      req.challenge,
      req.resource,
      req.scope,
      Date.now() + 120000,
    )
    .run();
  target.searchParams.set("code", code);
  return target.toString();
}
type TokenRow = {
  hash: string;
  user_id: string;
  client_id: string;
  resource: string;
  scope: string;
  family: string;
  expires_at: number;
  consumed: number;
};
async function issueTokens(
  env: RuntimeEnv,
  userId: string,
  clientId: string,
  resource: string,
  scopes: readonly OAuthScope[],
  family = randomToken(),
) {
  const access = randomToken(),
    refresh = randomToken();
  const accessHash = await sha256(access),
    refreshHash = await sha256(refresh);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO oauth_tokens(hash,user_id,client_id,resource,scope,kind,family,expires_at) VALUES(?,?,?,?,?,'access',?,?)",
    ).bind(
      accessHash,
      userId,
      clientId,
      resource,
      scopeString(scopes),
      family,
      Date.now() + 3600000,
    ),
    env.DB.prepare(
      "INSERT INTO oauth_tokens(hash,user_id,client_id,resource,scope,kind,family,expires_at) VALUES(?,?,?,?,?,'refresh',?,?)",
    ).bind(
      refreshHash,
      userId,
      clientId,
      resource,
      scopeString(scopes),
      family,
      Date.now() + 30 * 86400000,
    ),
  ]);
  return {
    access_token: access,
    refresh_token: refresh,
    token_type: "Bearer",
    expires_in: 3600,
    scope: scopeString(scopes),
  };
}
export async function exchangeToken(env: RuntimeEnv, params: URLSearchParams) {
  const clientId = params.get("client_id"),
    resource = params.get("resource");
  if (!clientId || resource !== env.SITE_ORIGIN + "/api/mcp")
    throw new DomainError(
      "invalid_target",
      "Missing client_id or mismatched resource.",
    );
  const pinned =
    env.OWNER_USER_ID ||
    (
      await env.DB.prepare(
        "SELECT user_id FROM owner WHERE singleton=1",
      ).first<{ user_id: string }>()
    )?.user_id;
  await env.DB.prepare("DELETE FROM oauth_codes WHERE expires_at<?")
    .bind(Date.now())
    .run();
  await env.DB.prepare("DELETE FROM oauth_tokens WHERE expires_at<?")
    .bind(Date.now())
    .run();
  if (params.get("grant_type") === "authorization_code") {
    const code = params.get("code"),
      verifier = params.get("code_verifier");
    if (!code || !verifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier))
      throw new DomainError(
        "invalid_grant",
        "Code or PKCE verifier is missing.",
      );
    const row = await env.DB.prepare(
      "DELETE FROM oauth_codes WHERE hash=? AND client_id=? AND resource=? AND redirect_uri=? AND challenge=? AND expires_at>? AND user_id=? RETURNING *",
    )
      .bind(
        await sha256(code),
        clientId,
        resource,
        params.get("redirect_uri"),
        await sha256(verifier),
        Date.now(),
        pinned ?? "",
      )
      .first<AuthorizationRow>();
    if (!row)
      throw new DomainError(
        "invalid_grant",
        "Authorization code, PKCE verifier or redirect URI is invalid.",
      );
    const granted = normalizeScope(row.scope);
    const requested = params.get("scope");
    if (requested && !isSubset(normalizeScope(requested), granted))
      throw new DomainError("invalid_scope", "Requested scope exceeds the grant.");
    return issueTokens(env, row.user_id, clientId, resource, granted);
  }
  if (params.get("grant_type") === "refresh_token") {
    const refresh = params.get("refresh_token");
    if (!refresh)
      throw new DomainError("invalid_grant", "Refresh token is missing.");
    const hash = await sha256(refresh);
    const old = await env.DB.prepare(
      "SELECT * FROM oauth_tokens WHERE hash=? AND kind='refresh' AND client_id=? AND resource=? AND user_id=? AND expires_at>?",
    )
      .bind(hash, clientId, resource, pinned ?? "", Date.now())
      .first<TokenRow>();
    if (!old)
      throw new DomainError("invalid_grant", "Refresh token is invalid.");
    const granted = normalizeScope(old.scope),
      requested = params.get("scope");
    if (requested && !isSubset(normalizeScope(requested), granted))
      throw new DomainError("invalid_scope", "Requested scope exceeds the grant.");
    const used = await env.DB.prepare(
      "UPDATE oauth_tokens SET consumed=1 WHERE hash=? AND consumed=0 RETURNING hash",
    )
      .bind(hash)
      .first();
    if (!used) {
      await env.DB.prepare("DELETE FROM oauth_tokens WHERE family=?")
        .bind(old.family)
        .run();
      throw new DomainError(
        "invalid_grant",
        "Refresh token reuse detected; reconnect.",
      );
    }
    await env.DB.prepare(
      "DELETE FROM oauth_tokens WHERE family=? AND kind='access'",
    )
      .bind(old.family)
      .run();
    return issueTokens(env, old.user_id, clientId, resource, granted, old.family);
  }
  throw new DomainError("unsupported_grant_type", "Unsupported OAuth grant.");
}
export async function revokeToken(env: RuntimeEnv, token: string) {
  const row = await env.DB.prepare(
    "SELECT family FROM oauth_tokens WHERE hash=?",
  )
    .bind(await sha256(token))
    .first<{ family: string }>();
  if (row)
    await env.DB.prepare("DELETE FROM oauth_tokens WHERE family=?")
      .bind(row.family)
      .run();
}
