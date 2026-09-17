// What does a parked job do when it is queued again? Profile "a" is small and emits; profile "hub" parks the ordinal-seeking job.
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { rmSync } from "node:fs";
const binary = process.env.SB; const CHATS = 1000, PER = 20, IN_PERIOD = 5;
rmSync(".snapback4", { recursive: true, force: true });
const server = spawn(binary, ["dev", "--port", "0", "--no-watch", "--hold-schedules"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
const exited = once(server, "exit"); let output = "";
const api = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("not ready " + output)), 240000); const on = (d) => { output += d; const m = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); resolve(m[0]); } }; server.stdout.on("data", on); server.stderr.on("data", on); });
const post = async (path, body) => (await fetch(`${api}${path}`, { method: "POST", headers: { "x-snapback-persona": "alice", "content-type": "application/json" }, body: JSON.stringify(body) })).json();
const now = Date.now(), periodStart = now - 3_600_000, periodEnd = now + 60_000;
try {
  const rows = [{ table: "profiles", row: { id: "prof-a", principal: "dev:a" } }, { table: "profiles", row: { id: "prof-hub", principal: "dev:hub" } }];
  for (let c = 0; c < CHATS; c++) {
    const id = `c${String(c).padStart(4, "0")}`;
    rows.push({ table: "conversations", row: { id, title: id } }, { table: "members", row: { id: `${id}-hub`, conversationId: id, principal: "dev:hub", readOrdinal: 0 } });
    if (c === 0) rows.push({ table: "members", row: { id: `${id}-a`, conversationId: id, principal: "dev:a", readOrdinal: 0 } });
    for (let o = 1; o <= PER; o++) rows.push({ table: "messages", row: { id: `${id}-m${String(o).padStart(3, "0")}`, conversationId: id, senderId: `dev:peer${c}`, ordinal: o, body: "x", tombstone: false, at: o > PER - IN_PERIOD ? now - 60_000 * (PER - o + 1) : now - 86_400_000 * 3 - o * 1000, expiresAt: null } });
  }
  for (let i = 0; i < rows.length; i += 20000) { const s = await post("/seed", rows.slice(i, i + 20000)); if (s.seeded === undefined) throw new Error(JSON.stringify(s).slice(0, 300)); }
} finally { server.kill(); await exited; }
const run = (job) => { try { return execFileSync(binary, ["run", job, JSON.stringify({ periodStart, periodEnd })], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { return (e.stdout ?? "") + (e.stderr ?? ""); } };
const effects = () => execFileSync(binary, ["doctor"], { cwd: process.cwd(), encoding: "utf8" }).split("\n").filter((l) => /^\s+(job|effects)/.test(l)).join("\n");
console.log("run 1:", run("digestByOrdinal").replace(/\s+/g, " ").slice(0, 260)); console.log(effects());
console.log("run 2:", run("digestByOrdinal").replace(/\s+/g, " ").slice(0, 260)); console.log(effects());
