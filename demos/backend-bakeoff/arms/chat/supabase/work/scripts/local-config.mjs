import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceWork = path.resolve(here, "..");
const projectWork = process.env.SUPABASE_PROJECT_DIR
  ? path.resolve(process.env.SUPABASE_PROJECT_DIR)
  : sourceWork;
const cli = path.join(sourceWork, "node_modules", ".bin", "supabase");

export function localConfig() {
  const output = execFileSync(cli, ["status", "-o", "env"], {
    cwd: projectWork,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const values = {};
  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)="(.*)"$/.exec(line.trim());
    if (match) values[match[1]] = match[2];
  }
  for (const name of ["API_URL", "ANON_KEY", "SERVICE_ROLE_KEY", "DB_URL"]) {
    if (!values[name]) throw new Error(`Supabase local status omitted ${name}`);
  }
  return {
    apiUrl: values.API_URL,
    anonKey: values.ANON_KEY,
    serviceRoleKey: values.SERVICE_ROLE_KEY,
    dbUrl: values.DB_URL
  };
}
