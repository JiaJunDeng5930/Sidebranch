import { runtime } from "../../../../lib/server/env";
import { authorizeBrowser } from "../../../../lib/server/browser-auth";
import { failure } from "../../../../lib/server/http";
import { AssetId, DomainError } from "../../../../lib/domain/model";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const env = runtime();
    await authorizeBrowser(env);
    const id = AssetId.parse((await params).id);
    const asset = await env.DB.prepare(
      "SELECT key,name,mime FROM assets WHERE id=?",
    )
      .bind(id)
      .first<{ key: string; name: string; mime: string }>();
    if (!asset) throw new DomainError("NOT_FOUND", "File not found.", 404);
    const object = await env.BUCKET.get(asset.key);
    if (!object) throw new DomainError("NOT_FOUND", "File not found.", 404);
    return new Response(object.body, {
      headers: {
        "Content-Type": asset.mime,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
