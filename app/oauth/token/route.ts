import { runtime } from "../../../lib/server/env";
import { exchangeToken } from "../../../lib/server/oauth";
import { boundedBody, json } from "../../../lib/server/http";
import { DomainError } from "../../../lib/domain/model";
export async function POST(req: Request) {
  try {
    return json(
      await exchangeToken(
        runtime(),
        new URLSearchParams(
          new TextDecoder().decode(await boundedBody(req, 16384)),
        ),
      ),
    );
  } catch (e) {
    return json(
      {
        error: e instanceof DomainError ? e.code : "server_error",
        error_description:
          e instanceof DomainError ? e.message : "Token exchange failed.",
      },
      e instanceof DomainError ? e.status : 500,
    );
  }
}
