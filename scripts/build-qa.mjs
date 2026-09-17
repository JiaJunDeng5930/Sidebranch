import { build, mergeConfig } from "vite";
import config from "../vite.app.config.ts";
import { readFile, writeFile } from "node:fs/promises";
await build(
  mergeConfig(config, {
    configFile: false,
    build: { outDir: ".qa-build", lib: { entry: "tests/ui-harness.tsx" } },
  }),
);
const [js, css] = await Promise.all([
  readFile(".qa-build/reader.js", "utf8"),
  readFile(".qa-build/reader.css", "utf8"),
]);
await writeFile(
  ".qa-build/reader.html",
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${css}</style></head><body><div id="root"></div><script>${js.replaceAll("</script", "<\\/script")}</script></body></html>`,
);
