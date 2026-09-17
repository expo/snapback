import { spawn } from "node:child_process";
import { once } from "node:events";
const CHATS = Number(process.env.CHATS ?? 9000);
const hitAt = new Set((process.env.HITS ?? "4100,8500,8950").split(",").map(Number));
const server = spawn(process.env.SB, ["dev", "--port", "0", "--no-watch", "--memory"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
const exited = once(server, "exit"); let output = "";
const api = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("not ready " + output)), 30000); const on = (d) => { output += d; const m = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); resolve(m[0]); } }; server.stdout.on("data", on); server.stderr.on("data", on); });
try {
  const post = async (path, body) => (await fetch(`${api}${path}`, { method: "POST", headers: { "x-snapback-persona": "alice", "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  const rows = []; const room = (g) => `r${String(g).padStart(5, "0")}`;
  for (let g = 0; g < CHATS; g++) {
    rows.push({ table: "members", row: { id: `${room(g)}-alice`, roomId: room(g), principal: "dev:alice" } });
    const n = hitAt.has(g) ? 5 : 1;
    for (let m = 0; m < n; m++) rows.push({ table: "messages", row: { id: `${room(g)}-m${m}`, roomId: room(g), body: hitAt.has(g) ? `coffee number ${m}` : `tea`, at: 1_700_000_000_000 + m } });
  }
  for (let i = 0; i < rows.length; i += 20000) { const s = await post("/seed", rows.slice(i, i + 20000)); if (s.seeded === undefined) throw new Error(JSON.stringify(s)); }
  let c = null, requests = 0; const found = [];
  for (;;) {
    const v = await post("/q/grouped", { args: { q: "cof", c }, meter: true }); requests++;
    if (v.denied || !Array.isArray(v.data)) { console.log("UNEXPECTED", JSON.stringify(v).slice(0, 400)); break; }
    found.push(...v.data.map((g) => g.roomId));
    console.log(`request ${requests}: groups=${v.data.length} complete=${v.complete} cut=${v.cut} next=${v.next ? "yes" : "no"} examined=${v.meter.examined} idx=${v.meter.indexEntries}`);
    if (!v.next) break; c = v.next; if (requests > 40) { console.log("runaway"); break; }
  }
  console.log(`${CHATS} chats, hits in chats ${[...hitAt].join(", ")}: found ${JSON.stringify(found)} in ${requests} requests`);
} finally { server.kill(); await exited; }
