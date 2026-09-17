import { spawn } from "node:child_process";
import { once } from "node:events";
const binary = process.env.SB;
const server = spawn(binary, ["dev", "--port", "0", "--no-watch", "--memory"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
const exited = once(server, "exit"); let output = "";
const api = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("not ready " + output)), 240000); const on = (d) => { output += d; const m = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); resolve(m[0]); } }; server.stdout.on("data", on); server.stderr.on("data", on); });
const post = async (path, body, persona = "alice") => (await fetch(`${api}${path}`, { method: "POST", headers: { "x-snapback-persona": persona, "content-type": "application/json" }, body: JSON.stringify(body) })).json();
try {
  const now = Date.now(); const at = { fresh: now - 30 * 60_000, mid: now - 10 * 3_600_000, edge: now - 23.5 * 3_600_000, old: now - 25 * 3_600_000 };
  const s = await post("/seed", Object.entries(at).map(([id, t]) => ({ table: "posts", row: { id, authorId: "dev:alice", body: id, at: Math.floor(t) } }))); if (s.seeded === undefined) throw new Error(JSON.stringify(s));
  let n = 0; const m = (op, args, who) => post(`/m/${op}`, { id: `w${++n}-${now}`, args }, who);
  const likes = { fresh: ["alice", "bob"], mid: ["alice", "bob", "carol"], edge: ["carol"], old: ["alice", "bob", "carol"] };
  for (const [postId, who] of Object.entries(likes)) for (const w of who) { const r = await m("setLike", { postId, liked: true }, w); if (r.state !== "sent") throw new Error(JSON.stringify(r)); }
  const v = await post("/q/trending", { args: { c: null }, meter: true });
  console.log("trending →", v.data.map((r) => `${r.postId}:${r.value}`).join("  "), `| complete=${v.complete} examined=${v.meter.examined}`);
  const bad = await m("forgeLike", { postId: "old", postAt: now - 60_000 }, "bob");      // bob already likes old; use a fresh pair below
  const bad2 = await m("forgeLike", { postId: "edge", postAt: now - 60_000 }, "alice");  // a false time that would move an old-ish post to the newest lane
  console.log("forge false postAt →", bad2.state, bad2.why?.code ?? "");
  const ok = await m("forgeLike", { postId: "edge", postAt: Math.floor(at.edge) }, "alice");
  console.log("forge true postAt  →", ok.state);
  const un = await m("setLike", { postId: "mid", liked: false }, "carol");
  const v2 = await post("/q/trending", { args: { c: null }, meter: true });
  console.log("after unlike+like  →", v2.data.map((r) => `${r.postId}:${r.value}`).join("  "));
} finally { server.kill(); await exited; }
