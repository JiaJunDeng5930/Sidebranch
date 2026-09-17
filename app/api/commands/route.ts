import { z } from "zod";
import { runtime } from "../../../lib/server/env";
import { authorizeBrowser } from "../../../lib/server/browser-auth";
import { DocumentStore } from "../../../lib/server/document-store";
import {
  boundedJson,
  json,
  sameOrigin,
  failure,
} from "../../../lib/server/http";
import { commandSchemas, type CommandName } from "../../../lib/domain/commands";
export async function POST(req: Request) {
  try {
    const env = runtime();
    sameOrigin(req, env.SITE_ORIGIN);
    const owner = await authorizeBrowser(env);
    const body = z
      .object({
        name: z.string().refine((n) => Object.hasOwn(commandSchemas, n)),
        args: z.unknown(),
      })
      .parse(await boundedJson(req, 15_000_000));
    return json(
      await new DocumentStore(env, owner).execute(
        body.name as CommandName,
        body.args,
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
