import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceWork = path.resolve(here, "..");
const state = JSON.parse(await readFile(path.join(sourceWork, "run-state.json"), "utf8"));
const runtime = state.runtimeProjectDir;

await rm(runtime, { recursive: true, force: true });
await mkdir(runtime, { recursive: true });
await cp(path.join(sourceWork, "supabase"), path.join(runtime, "supabase"), { recursive: true });

console.log(JSON.stringify({
  ok: true,
  sourceWork,
  runtime,
  note: "Colima cannot bind /private/tmp; only the official CLI runtime project is mirrored under /Users."
}));
