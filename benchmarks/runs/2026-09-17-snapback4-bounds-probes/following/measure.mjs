import { spawn } from "node:child_process";
import { once } from "node:events";
const binary = process.env.SB;
const server = spawn(binary, ["dev", "--port", "0", "--no-watch", "--memory"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
const exited = once(server, "exit"); let output = "";
const api = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("not ready " + output)), 30000); const on = (d) => { output += d; const m = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); resolve(m[0]); } }; server.stdout.on("data", on); server.stderr.on("data", on); });
try {
  const post = async (path, body, persona) => (await fetch(`${api}${path}`, { method: "POST", headers: { "x-snapback-persona": persona, "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  const rows = [];
  const AUTHORS = 1000, POSTS = 50;
  for (let a = 0; a < AUTHORS; a++) for (let p = 0; p < POSTS; p++) rows.push({ table: "posts", row: { id: `a${String(a).padStart(4, "0")}-p${String(p).padStart(3, "0")}`, authorId: `dev:author${a}`, body: `post ${p} by ${a}`, at: 1_700_000_000_000 + p * 60_000 + a } });
  const follow = (who, n) => { for (let a = 0; a < n; a++) rows.push({ table: "follows", row: { id: `${who}-f${a}`, followerId: `dev:${who}`, followedId: `dev:author${a * Math.floor(AUTHORS / n)}` } }); };
  follow("alice", 5); follow("bob", 500); follow("carol", 1000);
  for (let i = 0; i < rows.length; i += 20000) { const s = await post("/seed", rows.slice(i, i + 20000), "alice"); if (s.seeded === undefined) throw new Error(JSON.stringify(s)); }
  const stats = async (persona, label) => {
    const times = []; let v;
    for (let n = 0; n < 63; n++) { const t0 = performance.now(); v = await post("/q/following", { args: { c: null }, meter: true }, persona); const ms = performance.now() - t0; if (n >= 3) times.push(ms); }
    times.sort((a, b) => a - b);
    const second = await post("/q/following", { args: { c: v.next }, meter: true }, persona);
    console.log(`${label.padEnd(12)} rows=${v.data.length} complete=${v.complete} next=${!!v.next} examined=${v.meter.examined} probes=${v.meter.probes} steps=${v.meter.steps} p50=${times[30].toFixed(2)}ms p95=${times[56].toFixed(2)}ms | page2 examined=${second.meter.examined} complete=${second.complete}`);
    return times[30];
  };
  const a = await stats("alice", "5 follows"); const b = await stats("bob", "500 follows"); const c = await stats("carol", "1000 follows");
  console.log(`ratio p50 500/5 = ${(b / a).toFixed(2)}x ; 1000/5 = ${(c / a).toFixed(2)}x`);
} finally { server.kill(); await exited; }
