import { env } from "cloudflare:workers";
export interface RuntimeEnv {
  DB: D1Database;
  BUCKET: R2Bucket;
  SITE_ORIGIN: string;
  OWNER_USER_ID?: string;
  OWNER_BOOTSTRAP_EMAIL?: string;
  /** Comma-separated exact HTTPS origins replacing the default file hosts. */
  MCP_FILE_DOWNLOAD_ORIGINS?: string;
}
export function runtime(): RuntimeEnv {
  return env as unknown as RuntimeEnv;
}
