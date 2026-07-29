import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { localConfig } from "./local-config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = path.resolve(here, "..");
const config = localConfig();

execFileSync(process.execPath, [path.join(work, "node_modules", "vite", "bin", "vite.js"), "build"], {
  cwd: work,
  env: {
    ...process.env,
    VITE_SUPABASE_URL: config.apiUrl,
    VITE_SUPABASE_ANON_KEY: config.anonKey
  },
  stdio: "inherit"
});
