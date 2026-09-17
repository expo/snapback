import { spawn } from "node:child_process";
import { once } from "node:events";
const binary = process.env.SB;
const server = spawn(binary, ["dev", "--port", "0", "--no-watch", "--memory"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
const exited = once(server, "exit"); let output = "";
const api = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("not ready " + output)), 60000); const on = (d) => { output += d; const m = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); resolve(m[0]); } }; server.stdout.on("data", on); server.stderr.on("data", on); });
const post = async (path, body, persona = "alice") => (await fetch(`${api}${path}`, { method: "POST", headers: { "x-snapback-persona": persona, "content-type": "application/json" }, body: JSON.stringify(body) })).json();
try {
  const s = await post("/seed", [{ table: "posts", row: { id: "p1", authorId: "dev:alice", at: Date.now() - 1000 } }]); if (s.seeded === undefined) throw new Error(JSON.stringify(s));
  let n = 0; const m = (op, args, who) => post(`/m/${op}`, { id: `w${++n}-${Date.now()}`, args }, who);
  console.log("bob likes      →", JSON.stringify(await m("setLike", { postId: "p1", liked: true }, "bob")).slice(0, 200));
  console.log("alice likes    →", JSON.stringify(await m("setLike", { postId: "p1", liked: true }, "alice")).slice(0, 200));
  console.log("bob forges 999 →", JSON.stringify(await m("forge", { postId: "p1", score: 999 }, "bob")).slice(0, 300));
  console.log("bob forges 2   →", JSON.stringify(await m("forge", { postId: "p1", score: 2 }, "bob")).slice(0, 200));
  console.log("bob unlikes    →", JSON.stringify(await m("setLike", { postId: "p1", liked: false }, "bob")).slice(0, 200));
} finally { server.kill(); await exited; }
