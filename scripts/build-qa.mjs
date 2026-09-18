import { build, mergeConfig } from "vite";
import config from "../vite.app.config.ts";
import { readFile, writeFile } from "node:fs/promises";
const rendererOnly = process.argv[2] === "renderer";
const output = rendererOnly ? ".qa-build/renderer" : ".qa-build";
await build(
  mergeConfig(config, {
    configFile: false,
    build: {
      outDir: output,
      lib: {
        entry: rendererOnly
          ? "tests/renderer-harness.tsx"
          : "tests/ui-harness.tsx",
      },
    },
  }),
);
const [js, css] = await Promise.all([
  readFile(`${output}/reader.js`, "utf8"),
  readFile(`${output}/reader.css`, "utf8"),
]);
await writeFile(
  `${output}/reader.html`,
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${css}</style></head><body><div id="root"></div><script>${js.replaceAll("</script", "<\\/script")}</script></body></html>`,
);
