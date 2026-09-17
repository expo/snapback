// Ruling 32's required measurement: what does one durable effect row per CONNECTED recipient cost a send?
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { rmSync } from "node:fs";
const binary = process.env.SB; const N = Number(process.env.N ?? 150), MEMBERS = 50;
rmSync(".snapback4", { recursive: true, force: true });
const server = spawn(binary, ["dev", "--port", "0", "--no-watch", "--hold-schedules", "--hold-effects"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
const exited = once(server, "exit"); let output = "";
const api = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("not ready " + output)), 240000); const on = (d) => { output += d; const m = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); resolve(m[0]); } }; server.stdout.on("data", on); server.stderr.on("data", on); });
const name = (i) => `p${String(i).padStart(2, "0")}`;
const post = async (path, body, persona) => (await fetch(`${api}${path}`, { method: "POST", headers: { "x-snapback-persona": persona, "content-type": "application/json" }, body: JSON.stringify(body) })).json();
const get = async (path, persona, signal) => (await fetch(`${api}${path}`, { headers: { "x-snapback-persona": persona }, signal })).json();
let stop = false; const polls = [];
const hold = (persona) => (async () => { let since = 0; const ctl = new AbortController(); polls.push(ctl);
  while (!stop) { try { const r = await get(`/changes?since=${since}&wait=25&heartbeat=1`, persona, ctl.signal); since = r.watermark ?? r.seq ?? r.head ?? since; } catch { if (stop) return; await new Promise((r) => setTimeout(r, 50)); } } })();
const stats = (xs) => { const s = [...xs].sort((a, b) => a - b); return { p50: s[Math.floor(s.length * 0.5)], p95: s[Math.floor(s.length * 0.95)] }; };
let wid = 0;
const run = async (label, op) => { const times = []; for (let i = 0; i < N + 10; i++) { const t0 = performance.now(); const r = await post(`/m/${op}`, { id: `w${++wid}-${Date.now()}`, args: { roomId: "room", body: `m${i}` } }, name(0)); const ms = performance.now() - t0; if (r.state !== "sent") throw new Error(JSON.stringify(r).slice(0, 300)); if (i >= 10) times.push(ms); }
  const { p50, p95 } = stats(times); const eff = await get("/effects", name(0)).catch(() => null); const count = Array.isArray(eff) ? eff.length : (eff?.effects?.length ?? eff?.total ?? "?");
  console.log(`${label.padEnd(44)} p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms  effects listed=${count}`); return p50; };
try {
  const rows = [{ table: "rooms", row: { id: "room", title: "room" } }];
  for (let i = 0; i < MEMBERS; i++) rows.push({ table: "members", row: { id: `m-${name(i)}`, roomId: "room", principal: `dev:${name(i)}` } });
  const s = await post("/seed", rows, name(0)); if (s.seeded === undefined) throw new Error(JSON.stringify(s));
  const sample = await get("/changes?since=0&wait=0", name(1)); console.log("changes keys:", Object.keys(sample).join(","));
  const a = await run("sendQuiet   (no effects; nobody connected)", "sendQuiet");
  const b = await run("send        (49 offline -> 49 effects/msg)", "send");
  for (let i = 1; i < MEMBERS; i++) hold(name(i));
  await new Promise((r) => setTimeout(r, 1500));
  const c0 = await run("sendQuiet   (49 connected; polls wake+re-poll)", "sendQuiet");
  const c = await run("send        (49 connected -> 0 effects/msg)", "send");
  const d = await run("sendAlways  (49 connected -> 49 effects/msg)", "sendAlways");
  console.log(`marginal cost of 49 effect rows at commit: offline case ${(b - a).toFixed(2)} ms/send (${((b - a) / 49 * 1000).toFixed(0)} us/row); connected case ${(d - c).toFixed(2)} ms/send (${((d - c) / 49 * 1000).toFixed(0)} us/row)`);
} finally { stop = true; for (const c of polls) c.abort(); server.kill(); await exited; }
console.log(execFileSync(binary, ["doctor"], { cwd: process.cwd(), encoding: "utf8" }).split("\n").filter((l) => /storage|effects/.test(l)).join("\n"));
