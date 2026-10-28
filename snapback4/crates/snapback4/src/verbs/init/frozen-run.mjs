// API signatures: snapback4 guide api proof | client | auth | generated
// Frozen source uses its saved API. Inline users are adapted for legacy file readers.
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const cwd = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
if (!pkg.scripts?.["client:calls:frozen"]) throw Error("No day-one client:calls was present at capture; add a business client before claiming frozen-client coverage.");
let temporary;
const env = { ...process.env };
try {
  if (env.CALLS_USERS?.trimStart().startsWith("{")) {
    const users = JSON.parse(env.CALLS_USERS);
    if (!users || Array.isArray(users) || Object.values(users).some(batch => !Array.isArray(batch))) throw Error("CALLS_USERS must be a role-to-account-arrays object");
    temporary = await mkdtemp(join(tmpdir(), "snapback4-v1-users-"));
    env.CALLS_USERS = join(temporary, "users.json");
    await writeFile(env.CALLS_USERS, JSON.stringify(users), {mode:0o600});
  }
  if (env.CALLS_USERS && !temporary) env.CALLS_USERS = resolve(process.env.INIT_CWD ?? process.cwd(), env.CALLS_USERS);
  const child = spawn("npm", ["run", "--silent", "client:calls:frozen"], {cwd,env,stdio:"inherit"});
  const signals = ["SIGTERM", "SIGINT"];
  const forward = signal => { try { child.kill(signal); } catch {} };
  const handlers = signals.map(signal => {const fn=()=>forward(signal);process.on(signal,fn);return fn;});
  try {
    const result = await new Promise((resolve,reject)=>{child.once("error",reject);child.once("exit",(code,signal)=>resolve({code,signal}));});
    process.exitCode = result.code ?? 1;
  } finally { signals.forEach((signal,i)=>process.off(signal,handlers[i])); }
} finally { if (temporary) await rm(temporary,{recursive:true,force:true}); }
