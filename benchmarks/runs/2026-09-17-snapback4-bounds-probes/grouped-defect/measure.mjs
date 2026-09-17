import { spawn } from "node:child_process";
import { once } from "node:events";
const server = spawn(process.env.SB, ["dev", "--port", "0", "--no-watch", "--memory"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
const exited = once(server, "exit"); let output = "";
const api = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("not ready " + output)), 30000); const on = (d) => { output += d; const m = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); resolve(m[0]); } }; server.stdout.on("data", on); server.stderr.on("data", on); });
try {
  const post = async (path, body) => (await fetch(`${api}${path}`, { method: "POST", headers: { "x-snapback-persona": "alice", "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  const rows = [];
  for (let g = 0; g < 10; g++) { const r = `room${g}`; rows.push({ table: "members", row: { id: `${r}-alice`, roomId: r, principal: "dev:alice" } });
    for (let m = 0; m < 6; m++) rows.push({ table: "messages", row: { id: `${r}-m${m}`, roomId: r, body: g < 4 ? `coffee ${m}` : `tea ${m}`, at: 1_700_000_000_000 + m } }); }
  const s = await post("/seed", rows); if (s.seeded === undefined) throw new Error(JSON.stringify(s));
  for (const [op, args] of [["v1", { q: "cof", c: null }], ["v2", { c: null }], ["v3", { q: "cof", c: null }], ["v4", { c: null }]]) {
    const v = await post(`/q/${op}`, { args, meter: true });
    console.log(`${op}: rows=${v.data?.length} complete=${v.complete} cut=${v.cut} next=${v.next ?? null} examined=${v.meter?.examined}`);
  }
} finally { server.kill(); await exited; }
