import { build } from "vite";
import { readFile, writeFile } from "node:fs/promises";
await build({ configFile: "vite.app.config.ts" });
const [js, css] = await Promise.all([
  readFile(".app-build/reader.js", "utf8"),
  readFile(".app-build/reader.css", "utf8"),
]);
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Xanadu Sidebranch</title><style>${css.replaceAll("</style", "<\\/style")}</style></head><body><div id="root"></div><script>${js.replaceAll("</script", "<\\/script")}</script></body></html>`;
await writeFile(".app-build/reader.html", html);
