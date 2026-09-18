import { extractText, getDocumentProxy } from "unpdf";
import { AssetId, Content, DomainError, Instant } from "../domain/model";
import type { AssetEntity } from "../domain/entities";
import type { ContentText } from "../domain/model";
import type { ParsedInput } from "../domain/commands";
import type { DocumentStore } from "./document-store";
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function decodeBase64(value: string): Uint8Array {
  // atob() accepts a few non-base64 characters in some runtimes.  Validate
  // the transport representation first so malformed uploads cannot turn into
  // an empty or truncated asset.
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    ) &&
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}|[A-Za-z0-9+/]{3})$/.test(value)
  )
    throw new DomainError("INVALID_BASE64", "The file is not valid base64.");
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  } catch {
    throw new DomainError("INVALID_BASE64", "The file is not valid base64.");
  }
}

export async function importFile(
  store: DocumentStore,
  input: ParsedInput<"import_file">,
) {
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(input.base64);
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("INVALID_BASE64", "The file is not valid base64.");
  }
  if (bytes.length > MAX_UPLOAD_BYTES)
    throw new DomainError("TOO_LARGE", "文件上限为 10 MiB。", 413);
  let extracted: string;
  if (input.mime === "application/pdf") {
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
      throw new DomainError("INVALID_PDF", "文件内容不是 PDF。");
    try {
      const pdf = await getDocumentProxy(bytes.slice());
      try {
        if (pdf.numPages > 300)
          throw new DomainError("PDF_TOO_LONG", "PDF 最多支持 300 页。");
        const result = await extractText(pdf, { mergePages: false });
        extracted = result.text
          .map((page, i) => `# 第 ${i + 1} 页\n\n${page}`)
          .join("\n\n");
        if (!result.text.some((p) => p.trim()))
          throw new DomainError(
            "PDF_NO_TEXT",
            "这个 PDF 没有可提取的文字。请先 OCR，再导入。",
          );
      } finally {
        await pdf.loadingTask.destroy();
      }
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        "PDF_READ_FAILED",
        "无法读取 PDF；请确认文件完整且未加密。",
      );
    }
  } else {
    try {
      extracted = new TextDecoder("utf-8", { fatal: true })
        .decode(bytes)
        .replace(/^\uFEFF/, "");
    } catch {
      throw new DomainError(
        "INVALID_UTF8",
        "TXT 和 Markdown 文件需要使用 UTF-8 编码。",
      );
    }
  }
  const content: ContentText = Content.parse(extracted!);
  const assetId = AssetId.parse(crypto.randomUUID()),
    key = `originals/${assetId}`;
  const name = input.path.split("/").pop()!;
  const title = input.title ?? name.replace(/\.[^.]+$/, "");
  await store.env.BUCKET.put(key, bytes, {
    httpMetadata: { contentType: input.mime },
  });
  let committed = false;
  try {
    const asset: AssetEntity = {
      id: assetId,
      key,
      name,
      mime: input.mime,
      bytes: bytes.length,
      createdAt: Instant.parse(new Date().toISOString()),
    };
    const documentId = await store.persistImported(
      {
        path: input.path,
        title,
        content,
        format: input.mime === "text/plain" ? "text" : "markdown",
      },
      asset,
    );
    // From this point on the D1 batch has committed.  A response/read failure
    // must leave both the database rows and the original bytes recoverable.
    committed = true;
    return await store.read({ documentId });
  } catch (error) {
    if (!committed) {
      // Compensate only after a successful read proves that the unique asset
      // row is absent.  If the read itself fails, preserve the object because
      // the commit status is uncertain.
      try {
        const row = await store.env.DB.prepare(
          "SELECT id FROM assets WHERE id=?",
        )
          .bind(assetId)
          .first<{ id: string }>();
        if (!row) await store.env.BUCKET.delete(key);
      } catch {
        // An uncertain database read is deliberately not followed by object
        // deletion; an operator can reconcile the orphan safely.
      }
    }
    throw error;
  }
}
