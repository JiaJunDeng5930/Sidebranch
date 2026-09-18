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
import {
  commandSchemas,
  parseCommandInput,
  parseCommandResult,
  type CommandName,
} from "../../../lib/domain/commands";

function commandName(value: string): CommandName {
  if (Object.hasOwn(commandSchemas, value)) return value as CommandName;
  throw new z.ZodError([
    {
      code: "custom",
      path: ["name"],
      message: "Unknown command.",
    },
  ]);
}
export async function POST(req: Request) {
  try {
    const env = runtime();
    sameOrigin(req, env.SITE_ORIGIN);
    const owner = await authorizeBrowser(env);
    const body = z
      .object({ name: z.string(), args: z.unknown() })
      .strict()
      .parse(await boundedJson(req, 15_000_000));
    const name = commandName(body.name);
    const args = parseCommandInput(name, body.args);
    const result = await new DocumentStore(env, owner).execute(name, args);
    return json(
      parseCommandResult(name, result),
    );
  } catch (e) {
    return failure(e);
  }
}
