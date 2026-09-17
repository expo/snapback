import { spawn } from "node:child_process";
import { once } from "node:events";
async function world(hiddenNotes) {
  const server = spawn(process.env.SB, ["dev", "--port", "0", "--no-watch", "--memory"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(server, "exit"); let output = "";
  const api = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("not ready " + output)), 30000); const on = (d) => { output += d; const m = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); resolve(m[0]); } }; server.stdout.on("data", on); server.stderr.on("data", on); });
  try {
    const post = async (path, body) => (await fetch(`${api}${path}`, { method: "POST", headers: { "x-snapback-persona": "alice", "content-type": "application/json" }, body: JSON.stringify(body) })).json();
    const rows = [];
    for (const r of ["r1", "r2"]) { rows.push({ table: "members", row: { id: `${r}-alice`, roomId: r, principal: "dev:alice" } }); for (let m = 0; m < 5; m++) rows.push({ table: "messages", row: { id: `${r}-m${m}`, roomId: r, body: `hello ${m}`, at: 1000 + m } }); }
    rows.push({ table: "notes", row: { id: "n-alice", ownerId: "dev:alice", body: "zz alice note" } });
    for (let i = 0; i < hiddenNotes; i++) rows.push({ table: "notes", row: { id: `n-bob-${String(i).padStart(5, "0")}`, ownerId: "dev:bob", body: `aa bob note ${String(i).padStart(5, "0")}` } });
    for (let i = 0; i < rows.length; i += 20000) { const s = await post("/seed", rows.slice(i, i + 20000)); if (s.seeded === undefined) throw new Error(JSON.stringify(s)); }
    const out = {};
    for (const op of ["mergeAlone", "mergeThenNonUniform", "nonUniformThenMerge"]) {
      const v = await post(`/q/${op}`, { args: { c: null } });
      out[op] = { complete: v.complete, cut: v.cut, next: v.next ? "PRESENT" : "absent", n: v.data?.n };
    }
    return out;
  } finally { server.kill(); await exited; }
}
for (const hidden of [0, 9000]) {
  const o = await world(hidden);
  console.log(`--- world with ${hidden} of bob's notes hidden from alice (they sort before alice's one note):`);
  for (const [op, r] of Object.entries(o)) console.log(`  ${op.padEnd(22)} complete=${String(r.complete).padEnd(5)} cut=${String(r.cut).padEnd(5)} next=${r.next}  n=${r.n ?? "-"}`);
}
