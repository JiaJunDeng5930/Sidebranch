import { ZodError } from "zod";
import { DomainError } from "../domain/model";

const FRIENDLY_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "请先用 ChatGPT 登录。",
  OWNER_ONLY: "当前登录账号没有访问权限。",
  INSUFFICIENT_SCOPE: "当前连接只有读取权限，无法执行写入操作。",
  EMPTY_SPACE: "文档空间为空，请先导入文件或创建文档。",
  NOT_FOUND: "找不到这份文档或版本，请刷新后重试。",
  PATH_EXISTS: "这个路径已经有文档，请换一个路径。",
  REVISION_CONFLICT: "文档已经变化，请重新读取后再编辑。",
  EDIT_MISMATCH: "编辑范围与当前原文不一致，请重新读取。",
  INVALID_ANCHOR: "所选文字已变化，请重新选择。",
  INVALID_INPUT: "输入内容无法识别，请检查后重试。",
  INVALID_JSON: "请求格式无法识别，请刷新后重试。",
  TOO_LARGE: "请求或文件超过大小限制。",
  FILE_TOO_LARGE: "文件超过 10 MiB 限制。",
  INVALID_BASE64: "文件内容无法读取，请重新上传。",
  INVALID_UTF8: "TXT 和 Markdown 文件需要使用 UTF-8 编码。",
  PDF_NO_TEXT: "这个 PDF 没有可提取的文字，请先 OCR 再导入。",
  FILE_URL_DENIED: "文件下载地址不在允许的安全来源内。",
  FILE_DOWNLOAD_FAILED: "文件下载失败，请检查文件链接。",
  DATA_CORRUPTION: "文档数据暂时无法读取，请稍后重试。",
  INTERNAL_ERROR: "服务暂时不可用，请稍后重试。",
};

/** Return an actionable Chinese message without hiding already localized text. */
export function friendlyErrorMessage(
  code: string,
  message: string,
  fallback = "操作未完成，请稍后重试。",
): string {
  if (/[\u3400-\u9fff]/.test(message)) return message;
  return FRIENDLY_MESSAGES[code] ?? fallback;
}

export function json(
  data: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}
export function failure(error: unknown): Response {
  if (error instanceof DomainError)
    return json(
      {
        error: {
          code: error.code,
          message: friendlyErrorMessage(error.code, error.message),
        },
      },
      error.status,
    );
  if (error instanceof ZodError)
    return json(
      {
        error: {
          code: "INVALID_INPUT",
          message: friendlyErrorMessage(
            "INVALID_INPUT",
            error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
          ),
        },
      },
      400,
    );
  const requestId = crypto.randomUUID();
  console.error(
    "Sidebranch request failed",
    requestId,
    error instanceof Error ? error.message : "unknown error",
  );
  return json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "操作未完成，请稍后重试。",
        requestId,
      },
    },
    500,
    { "X-Request-Id": requestId },
  );
}
export async function boundedJson(
  request: Request,
  limit = 2_000_000,
): Promise<unknown> {
  const body = await boundedBody(request, limit);
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new DomainError("INVALID_JSON", "Invalid JSON request.");
  }
}
export async function boundedBody(
  request: Request,
  limit: number,
): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > limit)
    throw new DomainError("TOO_LARGE", "Request exceeds size limit.", 413);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new DomainError("TOO_LARGE", "Request exceeds size limit.", 413);
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
    offset += chunk.length;
  }
  return bytes;
}
export function sameOrigin(request: Request, origin: string): void {
  if (request.headers.get("origin") !== origin)
    throw new DomainError("ORIGIN_DENIED", "Cross-origin write denied.", 403);
}
