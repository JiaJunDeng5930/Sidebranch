import type { Plugin } from "vite";
import { readFile } from "node:fs/promises";
import { qaBackend } from "../tests/qa-backend";
import { commandSchemas, type CommandName } from "../lib/domain/commands";
/** Isolated, ephemeral fixtures for UI QA. configureServer is never part of a Worker build. */
export function qaPreview(): Plugin {
  let backend: ReturnType<typeof qaBackend> | undefined;
  return {
    name: "sidebranch-local-qa",
    configureServer(server) {
      server.httpServer?.once("close", () => {
        void backend?.then((b) => b.dispose());
      });
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split("?")[0] === "/__qa") {
          try {
            res.setHeader("Content-Type", "text/html");
            res.end(await readFile(".qa-build/reader.html", "utf8"));
          } catch {
            res.statusCode = 503;
            res.end("Run npm run build:qa first.");
          }
          return;
        }
        if (req.url === "/__qa-api") {
          try {
            backend ??= qaBackend();
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(Buffer.from(chunk));
            const input = JSON.parse(Buffer.concat(chunks).toString());
            if (!Object.hasOwn(commandSchemas, input.name))
              throw new Error("Unknown command");
            const result = await (
              await backend
            ).store.execute(input.name as CommandName, input.args);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result));
          } catch (e) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                error: { message: e instanceof Error ? e.message : String(e) },
              }),
            );
          }
          return;
        }
        next();
      });
    },
  };
}
