import { z } from "zod";
import { DomainError, Path } from "../domain/model";
import type { RuntimeEnv } from "./env";

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const IMPORT_MIMES = [
  "text/plain",
  "text/markdown",
  "application/pdf",
] as const;
/**
 * The Apps reference specifies a temporary HTTPS URL but does not promise a
 * stable hostname.  The current ChatGPT web fileParams payload uses this
 * exact host; keep it exact rather than trusting every `*.oaiusercontent.com`
 * subdomain.  Operators can replace this default with the exact origin(s)
 * observed for their deployment through MCP_FILE_DOWNLOAD_ORIGINS.
 */
export const DEFAULT_FILE_DOWNLOAD_ORIGIN = "https://files.oaiusercontent.com";
const ImportMime = z.enum(IMPORT_MIMES);

/**
 * The Apps fileParams contract uses a top-level object with these snake_case
 * fields.  Keep the raw shape exported because the pinned MCP SDK accepts
 * object shapes for schema registration, while the strict schema below is the
 * actual decoder used by the handler.
 */
export const downloadableFileShape = {
  file_id: z.string().min(1).max(512),
  download_url: z.string().url().max(4096),
  file_name: z.string().min(1).max(200).optional(),
  mime_type: z.string().min(1).max(200).optional(),
} satisfies z.ZodRawShape;
export const downloadableFileSchema = z
  .object(downloadableFileShape)
  .strict();

export const importFileInputShape = {
  path: Path,
  title: z.string().min(1).max(200).optional(),
  mime: ImportMime.optional(),
  base64: z.string().min(1).max(14_000_000).optional(),
  file: z.object(downloadableFileShape).strict().optional(),
} satisfies z.ZodRawShape;

export const importFileInputSchema = z
  .object(importFileInputShape)
  .strict()
  .superRefine((value, ctx) => {
    if (Boolean(value.base64) === Boolean(value.file))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["base64"],
        message: "Provide exactly one of base64 or file.",
      });
    if (value.base64 && !value.mime)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mime"],
        message: "mime is required for base64 imports.",
      });
  });

export type ImportFileInput = z.infer<typeof importFileInputSchema>;
export const FILE_PARAMS_META = ["file"];

function isPrivateHostname(hostname: string): boolean {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    value === "localhost" ||
    value.endsWith(".localhost") ||
    value.endsWith(".local") ||
    value.endsWith(".internal")
  )
    return true;
  if (/^\d+(?:\.\d+){3}$/.test(value)) {
    const octets = value.split(".").map(Number);
    const [first, second, third] = octets;
    return (
      octets.some((octet) => octet > 255) ||
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && (second === 0 || second === 168)) ||
      (first === 198 && (second === 18 || second === 19)) ||
      (first === 203 && second === 0 && third === 113) ||
      first >= 224
    );
  }
  return (
    value === "::" ||
    value === "::1" ||
    value.startsWith("::ffff:") ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe80") ||
    value.startsWith("ff")
  );
}

function allowedOrigins(env: RuntimeEnv): Set<string> {
  const origins = new Set<string>();
  const configured = env.MCP_FILE_DOWNLOAD_ORIGINS?.trim();
  const values = configured
    ? configured.split(",")
    : [env.SITE_ORIGIN, DEFAULT_FILE_DOWNLOAD_ORIGIN];
  for (const value of values
    .map((origin) => origin.trim())
    .filter(Boolean)) {
    try {
      const url = new URL(value);
      if (
        !isPrivateHostname(url.hostname) &&
        !url.username &&
        !url.password &&
        !url.pathname.replace(/\/$/, "") &&
        !url.search &&
        !url.hash
      )
        origins.add(url.origin);
    } catch {
      // A malformed allow-list entry must not become a fetch target.
    }
  }
  return origins;
}

function checkedUrl(raw: string, env: RuntimeEnv): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DomainError("INVALID_FILE_URL", "文件下载地址无效。");
  }
  if (
    url.protocol !== "https:" ||
    isPrivateHostname(url.hostname) ||
    url.username ||
    url.password ||
    !allowedOrigins(env).has(url.origin)
  )
    throw new DomainError(
      "FILE_URL_DENIED",
      "文件下载地址不在允许的安全来源内。",
      400,
    );
  return url;
}

async function readBounded(response: Response): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_IMPORT_BYTES)
    throw new DomainError("FILE_TOO_LARGE", "文件超过 10 MiB 限制。", 413);
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMPORT_BYTES)
      throw new DomainError("FILE_TOO_LARGE", "文件超过 10 MiB 限制。", 413);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMPORT_BYTES) {
        await reader.cancel();
        throw new DomainError("FILE_TOO_LARGE", "文件超过 10 MiB 限制。", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchFile(
  rawUrl: string,
  env: RuntimeEnv,
  redirects = 0,
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  if (redirects > 2)
    throw new DomainError("FILE_REDIRECT_LIMIT", "文件下载重定向次数过多。");
  const url = checkedUrl(rawUrl, env);
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new DomainError("FILE_DOWNLOAD_FAILED", "文件下载失败，请检查文件链接。", 502);
  }
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location)
      throw new DomainError("FILE_REDIRECT_INVALID", "文件下载重定向缺少地址。");
    return fetchFile(new URL(location, url).toString(), env, redirects + 1);
  }
  if (!response.ok)
    throw new DomainError(
      "FILE_DOWNLOAD_FAILED",
      "文件下载服务返回了错误。",
      502,
    );
  return {
    bytes: await readBounded(response),
    contentType: response.headers.get("content-type")?.split(";", 1)[0] ?? null,
  };
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

function basename(value: string): string {
  return value.split("/").pop() ?? "import";
}

function titleFromName(value: string): string {
  return basename(value).replace(/\.[^.]+$/, "");
}

function resolveMime(
  requested: string | undefined,
  fileMime: string | undefined,
  responseMime: string | null,
  bytes: Uint8Array,
): (typeof IMPORT_MIMES)[number] {
  const detected = (requested ?? fileMime ?? responseMime)
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (detected === "application/pdf" || bytes[0] === 0x25 && bytes[1] === 0x50)
    return "application/pdf";
  if (detected === "text/markdown") return "text/markdown";
  if (detected === "text/plain" || !detected) return "text/plain";
  throw new DomainError("UNSUPPORTED_FILE_TYPE", "只支持 TXT、Markdown 或 PDF 文件。");
}

export async function normalizeImportFileInput(
  raw: unknown,
  env: RuntimeEnv,
): Promise<{
  path: z.infer<typeof Path>;
  title?: string;
  mime: (typeof IMPORT_MIMES)[number];
  base64: string;
}> {
  const input = importFileInputSchema.parse(raw);
  if (input.base64) {
    if (!input.mime)
      throw new DomainError("INVALID_FILE_TYPE", "base64 导入缺少文件类型。");
    return { path: input.path, title: input.title, mime: input.mime, base64: input.base64 };
  }
  const file = input.file;
  if (!file) throw new DomainError("INVALID_FILE_INPUT", "缺少文件内容。");
  const downloaded = await fetchFile(file.download_url, env);
  const mime = resolveMime(input.mime, file.mime_type, downloaded.contentType, downloaded.bytes);
  const title = input.title ?? (file.file_name ? titleFromName(file.file_name) : undefined);
  return {
    path: input.path,
    title,
    mime,
    base64: base64(downloaded.bytes),
  };
}
