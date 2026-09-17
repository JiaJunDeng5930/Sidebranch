import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
export default defineConfig({
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  build: {
    outDir: ".app-build",
    emptyOutDir: true,
    lib: {
      entry: "app-ui/main.tsx",
      formats: ["iife"],
      name: "XanaduReader",
      fileName: () => "reader.js",
      cssFileName: "reader",
    },
    cssCodeSplit: false,
    minify: true,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
