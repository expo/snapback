import { spawn } from "node:child_process"; import { once } from "node:events";
const server = spawn(process.env.SB, ["dev", "--port", "0", "--no-watch", "--memory"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
const exited = once(server, "exit"); let out = "";
const api = await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("not ready " + out)), 240000); const on = (d) => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); res(m[0]); } }; server.stdout.on("data", on); server.stderr.on("data", on); });
try { const r = await (await fetch(`${api}/m/likeBlind`, { method: "POST", headers: { "x-snapback-persona": "alice", "content-type": "application/json" }, body: JSON.stringify({ id: "w1", args: { postId: "no-such-post" } }) })).json(); console.log(JSON.stringify(r).slice(0, 300)); }
finally { server.kill(); await exited; }
