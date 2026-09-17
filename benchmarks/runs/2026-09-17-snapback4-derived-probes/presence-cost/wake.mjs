// Do commits wake held polls that have nothing to receive? 49 connected principals who are NOT members of the room written to.
import { spawn } from "node:child_process";
import { once } from "node:events";
const binary = process.env.SB; const N = Number(process.env.N ?? 150);
const server = spawn(binary, ["dev", "--port", "0", "--no-watch", "--memory", "--hold-schedules"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
const exited = once(server, "exit"); let output = "";
const api = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("not ready " + output)), 240000); const on = (d) => { output += d; const m = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); resolve(m[0]); } }; server.stdout.on("data", on); server.stderr.on("data", on); });
const name = (i) => `p${String(i).padStart(2, "0")}`;
const post = async (path, body, persona) => (await fetch(`${api}${path}`, { method: "POST", headers: { "x-snapback-persona": persona, "content-type": "application/json" }, body: JSON.stringify(body) })).json();
let stop = false; const ctls = []; let answers = 0, emptyAnswers = 0;
const hold = (persona) => (async () => { let since = 0; const ctl = new AbortController(); ctls.push(ctl);
  while (!stop) { try { const r = await (await fetch(`${api}/changes?since=${since}&wait=25&heartbeat=1`, { headers: { "x-snapback-persona": persona }, signal: ctl.signal })).json(); answers++; const n = Object.values(r.tables ?? {}).reduce((a, t) => a + (Array.isArray(t) ? t.length : Object.keys(t ?? {}).length), 0); if (n === 0) emptyAnswers++; since = r.seq ?? since; } catch { if (stop) return; await new Promise((r) => setTimeout(r, 50)); } } })();
const stats = (xs) => { const s = [...xs].sort((a, b) => a - b); return { p50: s[Math.floor(s.length * 0.5)], p95: s[Math.floor(s.length * 0.95)] }; };
let wid = 0;
const run = async (label) => { const times = []; const a0 = answers, e0 = emptyAnswers; for (let i = 0; i < N + 10; i++) { const t0 = performance.now(); const r = await post(`/m/sendQuiet`, { id: `w${++wid}-${Date.now()}`, args: { roomId: "solo", body: `m${i}` } }, name(0)); const ms = performance.now() - t0; if (r.state !== "sent") throw new Error(JSON.stringify(r).slice(0, 300)); if (i >= 10) times.push(ms); }
  await new Promise((r) => setTimeout(r, 300)); const { p50, p95 } = stats(times); console.log(`${label.padEnd(52)} p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms  poll answers=${answers - a0} (empty=${emptyAnswers - e0}) for ${N + 10} commits`); };
try {
  const rows = [{ table: "rooms", row: { id: "solo", title: "solo" } }, { table: "members", row: { id: "m-solo", roomId: "solo", principal: `dev:${name(0)}` } }];
  const s = await post("/seed", rows, name(0)); if (s.seeded === undefined) throw new Error(JSON.stringify(s));
  await run("p00 writes its own room; nobody else connected");
  for (let i = 1; i < 50; i++) hold(name(i));           // 49 principals with NO membership anywhere
  await new Promise((r) => setTimeout(r, 1500));
  await run("p00 writes its own room; 49 UNRELATED polls held");
} finally { stop = true; for (const c of ctls) c.abort(); server.kill(); await exited; }
