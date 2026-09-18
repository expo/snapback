// Grader finding d-05 (0.2.27): a recipient whose only client holds a live poll; a guarded push is sent to them.
// 0.2.28: nothing recorded (a held poll counted as connected). 0.2.29 (ruling 32, lane W15a): the push is recorded
// at commit and deferred, cancelled only by a poll arriving after the commit. Observed through `snapback4 doctor`.
// Usage: SB=/path/to/snapback4 PKG=/path/to/snapback4/package node measure.mjs
import { spawn, execFileSync } from "node:child_process"; import { once } from "node:events"; import { join } from "node:path";
const { SB, PKG } = process.env; if (!SB || !PKG) throw new Error("SB= and PKG= are required");
const { createClient } = await import(join(PKG, "dist/client.js"));
const server = spawn(SB, ["dev", "--port", "0", "--no-watch", "--hold-schedules"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
const exited = once(server, "exit"); let out = "";
const url = await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("not ready " + out)), 300000); server.stdout.on("data", d => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); res(m[0]); } }); });
const post = async (path, body, persona) => (await fetch(`${url}${path}`, { method: "POST", headers: { "x-snapback-persona": persona, "content-type": "application/json" }, body: JSON.stringify(body) })).json();
const sleep = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.error("probe timed out"); process.exit(2); }, 150000).unref();
let doctor = "";
try {
  // bob's only client: an online client holding a live query's change poll
  const bob = createClient({ url, persona: "bob" });
  const sub = bob.observe({ kind: "query", name: "latest" }, {});
  const unsub = sub.subscribe(() => {});
  await sleep(1500);
  const online = await post("/q/latest", { args: {} }, "alice"); if (online.code) throw new Error(JSON.stringify(online));
  const w = await post("/m/push", { id: "push-1", args: { p: "dev:bob" } }, "alice");
  console.log("alice push(bob) while bob holds a poll:", w.state ?? w.code, "seq", w.seq);
  await sleep(500);
  unsub();
} finally {
  server.kill("SIGTERM"); await exited;
  doctor = execFileSync(SB, ["doctor"], { cwd: process.cwd(), encoding: "utf8" });
}
const line = doctor.split("\n").find(l => /^\s*effects/.test(l)) ?? "(doctor prints no effects line: nothing was recorded)";
console.log("doctor:", line.trim());
process.exit(0);
