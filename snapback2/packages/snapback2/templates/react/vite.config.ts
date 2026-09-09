import { existsSync, readFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => {
  const file = fileURLToPath(new URL(".snapback/dev-url", import.meta.url));
  const url = process.env.VITE_SNAPBACK_URL ?? loadEnv(mode, process.cwd(), "VITE_").VITE_SNAPBACK_URL
    ?? (existsSync(file) ? readFileSync(file, "utf8").trim() : undefined);
  return { define: url === undefined ? {} : { "import.meta.env.VITE_SNAPBACK_URL": JSON.stringify(url) } };
});
