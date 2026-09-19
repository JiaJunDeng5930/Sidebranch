import type { Plugin } from "vite";
import { readFile } from "node:fs/promises";
import { qaBackend } from "../tests/qa-backend";
import { commandSchemas, type CommandName } from "../lib/domain/commands";
import { seedBenchmark } from "../tests/benchmark-fixture";
import { seedReadingFixture } from "../tests/reading-fixture";
/** Isolated, ephemeral fixtures for UI QA. configureServer is never part of a Worker build. */
export function qaPreview(): Plugin {
  let backend: ReturnType<typeof qaBackend> | undefined;
  let benchmark: Promise<void> | undefined;
  let readingFixture: ReturnType<typeof seedReadingFixture> | undefined;
  return {
    name: "sidebranch-local-qa",
    configureServer(server) {
      server.httpServer?.once("close", () => {
        void backend?.then((b) => b.dispose());
      });
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split("?")[0];
        if (path === "/__qa" || path === "/__renderer" || path === "/__space") {
          try {
            res.setHeader("Content-Type", "text/html");
            res.end(
              await readFile(
                path === "/__renderer"
                  ? ".qa-build/renderer/reader.html"
                  : path === "/__space"
                    ? ".qa-build/space/reader.html"
                    : ".qa-build/reader.html",
                "utf8",
              ),
            );
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
            if (input.name === "__benchmark") {
              benchmark ??= backend.then((b) => seedBenchmark(b.store));
              await benchmark;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ready: true }));
              return;
            }
            if (input.name === "__reading_fixture") {
              readingFixture ??= backend.then((b) =>
                seedReadingFixture(b.store),
              );
              const fixture = await readingFixture;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ready: true, fixture }));
              return;
            }
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
