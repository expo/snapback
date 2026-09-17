import { spawn } from "node:child_process";
import { once } from "node:events";
const server = spawn(process.env.SB, ["dev", "--port", "0", "--no-watch", "--memory"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
const exited = once(server, "exit"); let output = "";
const api = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("not ready " + output)), 30000); const on = (d) => { output += d; const m = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); resolve(m[0]); } }; server.stdout.on("data", on); server.stderr.on("data", on); });
try {
  const post = async (path, body) => (await fetch(`${api}${path}`, { method: "POST", headers: { "x-snapback-persona": "alice", "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  // SAME lane, two rows at the same `at` (legal: the index is not unique), plus one older row; second lane empty
  const rows = [
    { table: "msgs", row: { id: "r1-100-a", roomId: "r1", at: 100, body: "first at 100" } },
    { table: "msgs", row: { id: "r1-100-b", roomId: "r1", at: 100, body: "second at 100" } },
    { table: "msgs", row: { id: "r1-090", roomId: "r1", at: 90, body: "at 90" } },
  ];
  const s = await post("/seed", rows); if (s.seeded === undefined) throw new Error(JSON.stringify(s));
  let c = null; const seen = [];
  for (let i = 0; i < 6; i++) {
    const v = await post("/q/feed", { args: { a: "r1", b: "r2", c } });
    if (v.denied) { console.log("DENIED", JSON.stringify(v.denied)); break; }
    seen.push(...v.data.map((r) => r.id));
    console.log(`page ${i + 1}: ${JSON.stringify(v.data.map((r) => r.id))} complete=${v.complete} next=${v.next ? "yes" : "no"}`);
    if (!v.next) break; c = v.next;
  }
  console.log(`walk returned ${seen.length} of 3; missing: ${JSON.stringify(["r1-100-a", "r1-100-b", "r1-090"].filter((id) => !seen.includes(id)))}`);
} finally { server.kill(); await exited; }
