import { existsSync, readFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => {
  const file = fileURLToPath(new URL(".snapback/dev-url", import.meta.url));
  const owner = existsSync(file) ? readFileSync(file, "utf8").trim() : undefined;
  const url = process.env.VITE_SNAPBACK_URL ?? loadEnv(mode, process.cwd(), "VITE_").VITE_SNAPBACK_URL ?? owner;
  // An inherited variable wins the URL, which is how another project's backend
  // gets a silent vote. Say so instead of serving the wrong owner.
  if (owner !== undefined && url !== owner) {
    console.warn(`snapback2: VITE_SNAPBACK_URL=${url} overrides this project's owner at ${owner}; unset it to use the local backend.`);
  }
  return { define: url === undefined ? {} : { "import.meta.env.VITE_SNAPBACK_URL": JSON.stringify(url) } };
});
