import { spawn } from "node:child_process";
import { once } from "node:events";
const server = spawn(process.env.SB, ["dev", "--port", "0", "--no-watch", "--memory"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
const exited = once(server, "exit"); let output = "";
const api = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("not ready " + output)), 180000); const on = (d) => { output += d; const m = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); resolve(m[0]); } }; server.stdout.on("data", on); server.stderr.on("data", on); });
try {
  const post = async (path, body) => (await fetch(`${api}${path}`, { method: "POST", headers: { "x-snapback-persona": "alice", "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  const rows = [];
  for (const r of ["r1", "r2"]) { rows.push({ table: "members", row: { id: `${r}-alice`, roomId: r, principal: "dev:alice" } }); for (let m = 0; m < 5; m++) rows.push({ table: "messages", row: { id: `${r}-m${m}`, roomId: r, body: `hello ${m}`, at: 1000 + m * 10 + (r === "r2" ? 5 : 0) } }); }
  const s = await post("/seed", rows); if (s.seeded === undefined) throw new Error(JSON.stringify(s));
  console.log("10 messages in 2 rooms; page size 4; more rows remain after every first page");
  for (const [op, args] of [["plain", { c: null }], ["grouped", { c: null }], ["groupedDirect", { roomId: "r1", c: null }], ["both", { c: null }]]) {
    const v = await post(`/q/${op}`, { args, meter: true });
    const n = Array.isArray(v.data) ? v.data.length : (v.data?.rows?.length ?? v.data?.page?.length ?? v.data?.page?.rows?.length ?? "?");
    console.log(`  ${op.padEnd(14)} complete=${String(v.complete).padEnd(5)} cut=${String(v.cut).padEnd(5)} next=${v.next ? "PRESENT" : "absent "}  top-level items=${n}  ${v.error ? JSON.stringify(v.error) : ""}`);
  }
} finally { server.kill(); await exited; }
