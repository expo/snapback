import { spawn } from "node:child_process";
import { once } from "node:events";
const binary = process.env.SB;
const server = spawn(binary, ["dev", "--port", "0", "--no-watch", "--memory"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
const exited = once(server, "exit"); let output = "";
const api = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("not ready " + output)), 60000); const on = (d) => { output += d; const m = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); resolve(m[0]); } }; server.stdout.on("data", on); server.stderr.on("data", on); });
const post = async (path, body, persona = "alice") => (await fetch(`${api}${path}`, { method: "POST", headers: { "x-snapback-persona": persona, "content-type": "application/json" }, body: JSON.stringify(body) })).json();
try {
  const HOUR = 3_600_000, now = Date.now(); const rows = [];
  const mk = (id, ageMin, likes) => { const at = now - ageMin * 60_000; rows.push({ table: "posts", row: { id, authorId: "dev:alice", body: id, at } }); for (let k = 0; k < likes; k++) rows.push({ table: "likes", row: { id: `${id}-l${k}`, postId: id, principal: `dev:u${k}`, postHour: Math.floor(at / HOUR), postAt: at } }); };
  mk("liked-a", 600, 5); mk("liked-b", 30, 9); mk("liked-c", 1300, 2);           // in window
  mk("old-hot", 1500, 50);                                                          // 25 h old: out of the window
  for (let i = 0; i < 12; i++) mk(`quiet-${String(i).padStart(2, "0")}`, 10 + i * 5, 0);   // in window, no likes; quiet-00 newest
  mk("old-quiet", 1600, 0);
  const s = await post("/seed", rows); if (s.seeded === undefined) throw new Error(JSON.stringify(s));
  const v = await post("/q/trending", { args: {}, meter: true });
  if (!v.data) throw new Error(JSON.stringify(v).slice(0, 500));
  console.log(v.data.map((r) => `${r.postId}:${r.score}`).join("  "));
  console.log(`rows=${v.data.length} complete=${v.complete} cut=${v.cut ?? null} examined=${v.meter.examined} probes=${v.meter.probes} steps=${v.meter.steps}`);
} finally { server.kill(); await exited; }
