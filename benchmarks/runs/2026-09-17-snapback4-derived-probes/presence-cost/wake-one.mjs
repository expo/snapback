import { spawn } from "node:child_process"; import { once } from "node:events";
const server = spawn(process.env.SB, ["dev", "--port", "0", "--no-watch", "--memory", "--hold-schedules"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
const exited = once(server, "exit"); let out = "";
const api = await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("not ready " + out)), 240000); const on = (d) => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); res(m[0]); } }; server.stdout.on("data", on); server.stderr.on("data", on); });
const post = async (path, body, persona) => (await fetch(`${api}${path}`, { method: "POST", headers: { "x-snapback-persona": persona, "content-type": "application/json" }, body: JSON.stringify(body) })).json();
try {
  await post("/seed", [{ table: "rooms", row: { id: "solo", title: "solo" } }, { table: "members", row: { id: "m-solo", roomId: "solo", principal: "dev:p00" } }], "p00");
  const first = await (await fetch(`${api}/changes?since=0&wait=0`, { headers: { "x-snapback-persona": "p05" } })).json();
  const t0 = performance.now();
  const held = fetch(`${api}/changes?since=${first.seq}&wait=25&heartbeat=1`, { headers: { "x-snapback-persona": "p05" } }).then((r) => r.json());
  await new Promise((r) => setTimeout(r, 300));
  await post("/m/sendQuiet", { id: "w1", args: { roomId: "solo", body: "hello" } }, "p00");
  const answer = await held;
  console.log(`held poll of an UNRELATED principal answered after ${(performance.now() - t0).toFixed(0)} ms:`, JSON.stringify(answer).slice(0, 300));
} finally { server.kill(); await exited; }
