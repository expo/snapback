import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const status = JSON.parse(execFileSync("bunx", ["supabase", "status", "-o", "json"], { encoding: "utf8" }));
if (!status.API_URL || !status.ANON_KEY) throw new Error("Start the local Supabase stack first");
const path = ".env.local";
let env = "";
try { env = readFileSync(path, "utf8"); } catch (error) {
  if (error.code !== "ENOENT") throw error;
}
env = env.replace(/^VITE_SUPABASE_(URL|ANON_KEY)=.*\r?\n/gm, "").trimEnd();
writeFileSync(path, `${env ? `${env}\n` : ""}VITE_SUPABASE_URL=${status.API_URL}\nVITE_SUPABASE_ANON_KEY=${status.ANON_KEY}\n`, { mode: 0o600 });
console.log("Wrote local Supabase URL and anon key to ignored .env.local");
