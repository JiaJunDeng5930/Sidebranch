import { extractText, getDocumentProxy } from "unpdf";
import { AssetId, Content, DomainError } from "../domain/model";
import type { ParsedInput } from "../domain/commands";
import type { DocumentStore } from "./document-store";
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export async function importFile(
  store: DocumentStore,
  input: ParsedInput<"import_file">,
) {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(input.base64), (c) => c.charCodeAt(0));
  } catch {
    throw new DomainError("INVALID_BASE64", "The file is not valid base64.");
  }
  if (bytes.length > MAX_UPLOAD_BYTES)
    throw new DomainError("TOO_LARGE", "文件上限为 10 MiB。", 413);
  let content: string;
  if (input.mime === "application/pdf") {
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
      throw new DomainError("INVALID_PDF", "文件内容不是 PDF。");
    try {
      const pdf = await getDocumentProxy(bytes.slice());
      try {
        if (pdf.numPages > 300)
          throw new DomainError("PDF_TOO_LONG", "PDF 最多支持 300 页。");
        const result = await extractText(pdf, { mergePages: false });
        content = result.text
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
      content = new TextDecoder("utf-8", { fatal: true })
        .decode(bytes)
        .replace(/^\uFEFF/, "");
    } catch {
      throw new DomainError(
        "INVALID_UTF8",
        "TXT 和 Markdown 文件需要使用 UTF-8 编码。",
      );
    }
  }
  content = Content.parse(content!);
  const assetId = AssetId.parse(crypto.randomUUID()),
    key = `originals/${assetId}`;
  const name = input.path.split("/").pop()!;
  await store.env.BUCKET.put(key, bytes, {
    httpMetadata: { contentType: input.mime },
  });
  try {
    await store.env.DB.prepare(
      "INSERT INTO assets(id,key,name,mime,bytes,created_at) VALUES(?,?,?,?,?,?)",
    )
      .bind(
        assetId,
        key,
        name,
        input.mime,
        bytes.length,
        new Date().toISOString(),
      )
      .run();
    return await store.write(
      {
        path: input.path,
        title: input.title ?? name.replace(/\.[^.]+$/, ""),
        content,
        format: input.mime === "text/plain" ? "text" : "markdown",
      },
      assetId,
    );
  } catch (error) {
    await store.env.DB.prepare(
      "DELETE FROM assets WHERE id=? AND NOT EXISTS(SELECT 1 FROM documents WHERE asset_id=?)",
    )
      .bind(assetId, assetId)
      .run();
    await store.env.BUCKET.delete(key);
    throw error;
  }
}
