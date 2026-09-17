import { spawn } from "node:child_process";
import { once } from "node:events";
const server = spawn(process.env.SB, ["dev", "--port", "0", "--no-watch", "--memory"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
const exited = once(server, "exit"); let output = "";
const api = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("not ready " + output)), 180000); const on = (d) => { output += d; const m = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); resolve(m[0]); } }; server.stdout.on("data", on); server.stderr.on("data", on); });
try {
  const post = async (path, body) => (await fetch(`${api}${path}`, { method: "POST", headers: { "x-snapback-persona": "alice", "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  const H = 3600000, at = 500000 * H + 1234, rows = [];
  for (let h = 0; h < 30; h++) { const hourAt = 500000 - h; rows.push({ table: "hours", row: { id: `h${h}`, hourAt } }); rows.push({ table: "posts", row: { id: `p${h}`, authorId: "dev:alice", at: hourAt * H + 5, hourAt } }); }
  const s = await post("/seed", rows); if (s.seeded === undefined) throw new Error(JSON.stringify(s));
  for (const op of ["inline", "bound", "direct"]) {
    const v = await post(`/q/${op}`, { args: { at, c: null } });
    const n = Array.isArray(v.data) ? v.data.length : (v.data?.rows?.length ?? "-");
    console.log(`  ${op.padEnd(7)} ${v.complete === undefined ? "REFUSED " + JSON.stringify(v) : `rows=${n} complete=${v.complete} next=${v.next ? "yes" : "no"}`}`);
  }
} finally { server.kill(); await exited; }
