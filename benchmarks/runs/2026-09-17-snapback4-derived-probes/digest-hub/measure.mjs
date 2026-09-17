import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { rmSync } from "node:fs";
const binary = process.env.SB;
const CHATS = Number(process.env.CHATS ?? 1000), PER = 99, IN_PERIOD = 5, READ = Number(process.env.READ ?? 0);
rmSync(".snapback4", { recursive: true, force: true });
const server = spawn(binary, ["dev", "--port", "0", "--no-watch", "--hold-schedules"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
const exited = once(server, "exit"); let output = "";
const api = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("not ready " + output)), 60000); const on = (d) => { output += d; const m = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); resolve(m[0]); } }; server.stdout.on("data", on); server.stderr.on("data", on); });
const post = async (path, body, persona = "alice") => (await fetch(`${api}${path}`, { method: "POST", headers: { "x-snapback-persona": persona, "content-type": "application/json" }, body: JSON.stringify(body) })).json();
const now = Date.now(), periodStart = now - 3_600_000, periodEnd = now + 60_000;
try {
  const rows = [{ table: "profiles", row: { id: "prof-hub", principal: "dev:hub" } }];
  for (let c = 0; c < CHATS; c++) {
    const id = `c${String(c).padStart(4, "0")}`;
    rows.push({ table: "conversations", row: { id, title: id } });
    rows.push({ table: "members", row: { id: `${id}-hub`, conversationId: id, principal: "dev:hub", readOrdinal: READ } });
    rows.push({ table: "members", row: { id: `${id}-peer`, conversationId: id, principal: `dev:peer${c}`, readOrdinal: 0 } });
    for (let o = 1; o <= PER; o++) {
      const inPeriod = o > PER - IN_PERIOD;                              // the newest 5 fall inside the period
      rows.push({ table: "messages", row: { id: `${id}-m${String(o).padStart(3, "0")}`, conversationId: id, senderId: `dev:peer${c}`, ordinal: o, body: "coffee", tombstone: false, at: inPeriod ? now - 60_000 * (PER - o + 1) : now - 86_400_000 * 3 - o * 1000, expiresAt: null } });
    }
  }
  const t0 = performance.now();
  for (let i = 0; i < rows.length; i += 20000) { const s = await post("/seed", rows.slice(i, i + 20000)); if (s.seeded === undefined) throw new Error(JSON.stringify(s).slice(0, 400)); }
  console.log(`seeded ${rows.length} rows in ${(performance.now() - t0).toFixed(0)} ms; hub in ${CHATS} chats, ${PER} messages each, ${IN_PERIOD} in the period, hub readOrdinal=${READ}`);
} finally { server.kill(); await exited; }
for (const job of ["digestByOrdinal", "digestByTime"]) {
  const t0 = performance.now(); let out;
  try { out = execFileSync(binary, ["run", job, JSON.stringify({ periodStart, periodEnd })], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { out = (e.stdout ?? "") + (e.stderr ?? ""); }
  console.log(`${job}: ${(performance.now() - t0).toFixed(0)} ms → ${out.replace(/\s+/g, " ").slice(0, 420)}`);
}
console.log(execFileSync(binary, ["doctor"], { cwd: process.cwd(), encoding: "utf8" }).split("\n").filter((l) => /job|effects/.test(l)).join("\n"));
