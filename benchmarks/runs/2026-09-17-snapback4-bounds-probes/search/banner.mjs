import { spawn } from "node:child_process";
import { once } from "node:events";
const server = spawn(process.env.SB, ["dev", "--port", "0", "--no-watch", "--memory"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
const exited = once(server, "exit"); let output = "";
const api = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("not ready " + output)), 30000); const on = (d) => { output += d; const m = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); resolve(m[0]); } }; server.stdout.on("data", on); server.stderr.on("data", on); });
const post = async (path, body) => (await fetch(`${api}${path}`, { method: "POST", headers: { "x-snapback-persona": "alice", "content-type": "application/json" }, body: JSON.stringify(body) })).json();
const rows = [];
for (let g = 0; g < 600; g++) { const r = `r${String(g).padStart(5, "0")}`; rows.push({ table: "members", row: { id: `${r}-a`, roomId: r, principal: "dev:alice" } }); for (let m = 0; m < 25; m++) rows.push({ table: "messages", row: { id: `${r}-m${m}`, roomId: r, body: `coffee ${m}`, at: 1_700_000_000_000 + m * 1000 + g } }); }
await post("/seed", rows);
const before = output.length;
const v = await post("/q/everywhere", { args: { q: "cof", c: null } });
await new Promise((r) => setTimeout(r, 500));
console.log("answer:", JSON.stringify({ rows: v.data.length, complete: v.complete, cut: v.cut, next: v.next ?? null, meter: v.meter }));
console.log("--- dev output after the cut read ---"); console.log(output.slice(before) || "(nothing printed)");
console.log("--- dev startup banner ---"); console.log(output.slice(0, before).split("\n").slice(0, 25).join("\n"));
server.kill(); await exited;
