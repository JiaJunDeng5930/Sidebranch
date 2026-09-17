import { ZodError } from "zod";
import { DomainError } from "../domain/model";
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
      { error: { code: error.code, message: error.message } },
      error.status,
    );
  if (error instanceof ZodError)
    return json(
      {
        error: {
          code: "INVALID_INPUT",
          message: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        },
      },
      400,
    );
  console.error(
    "Sidebranch request failed",
    error instanceof Error ? error.message : "unknown error",
  );
  return json(
    { error: { code: "INTERNAL_ERROR", message: "操作未完成，请稍后重试。" } },
    500,
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
