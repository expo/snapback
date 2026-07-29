import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = path.resolve(here, "..");
const sql = await readFile(
  path.join(work, "supabase", "evolution", "20260729042000_add_estimate_points.sql"),
  "utf8"
);
const projectId = "llp0102-linear-supabase-w3";
const container = execFileSync("docker", [
  "ps",
  "--filter", `name=supabase_db_${projectId}`,
  "--format", "{{.Names}}"
], { encoding: "utf8" }).trim();

if (container !== `supabase_db_${projectId}`) {
  throw new Error(`exact database container unavailable: ${container || "none"}`);
}

execFileSync("docker", [
  "exec", "-i", container,
  "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"
], {
  input: sql,
  encoding: "utf8",
  stdio: ["pipe", "pipe", "pipe"]
});

console.log(JSON.stringify({
  ok: true,
  projectId,
  migration: "supabase/evolution/20260729042000_add_estimate_points.sql"
}));
