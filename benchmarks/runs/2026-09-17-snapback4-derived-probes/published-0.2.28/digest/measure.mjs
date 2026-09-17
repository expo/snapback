import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
const binary = process.env.SB;
const server = spawn(binary, ["dev", "--port", "0", "--no-watch", "--hold-schedules"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
const exited = once(server, "exit"); let output = "";
const api = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("not ready " + output)), 60000); const on = (d) => { output += d; const m = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); resolve(m[0]); } }; server.stdout.on("data", on); server.stderr.on("data", on); });
const post = async (path, body, persona = "alice") => (await fetch(`${api}${path}`, { method: "POST", headers: { "x-snapback-persona": persona, "content-type": "application/json" }, body: JSON.stringify(body) })).json();
let periodStart, periodEnd;
try {
  const now = Date.now(); periodStart = now - 3_600_000; periodEnd = now + 60_000;
  const rows = [];
  for (const p of ["alice", "bob", "carol"]) rows.push({ table: "profiles", row: { id: `prof-${p}`, principal: `dev:${p}` } });
  // c1: alice+bob ; c2: alice+bob+carol ; c3: carol alone with bob (private to alice's digest)
  const conv = (id, title, people, read) => { rows.push({ table: "conversations", row: { id, title } }); people.forEach((p, i) => rows.push({ table: "members", row: { id: `${id}-${p}`, conversationId: id, principal: `dev:${p}`, readOrdinal: read[i] } })); };
  conv("c1", "one", ["alice", "bob"], [2, 0]);
  conv("c2", "two", ["alice", "bob", "carol"], [0, 0, 5]);
  conv("c3", "three", ["bob", "carol"], [0, 0]);
  const msg = (c, ordinal, sender, extra = {}) => rows.push({ table: "messages", row: { id: `${c}-m${ordinal}`, conversationId: c, senderId: `dev:${sender}`, ordinal, body: `m${ordinal}`, tombstone: false, at: now - 60_000 * (10 - ordinal), expiresAt: null, ...extra } });
  // c1: 5 from bob; alice read 2 -> 3 unread, one of them tombstoned, one expired -> alice unread 1
  msg("c1", 1, "bob"); msg("c1", 2, "bob"); msg("c1", 3, "bob"); msg("c1", 4, "bob", { tombstone: true }); msg("c1", 5, "bob", { expiresAt: now - 1000 });
  // c2: 4 msgs: 2 by alice (own), 2 by carol; alice read 0 -> alice unread 2; carol read 5 -> 0; bob unread 4
  msg("c2", 1, "alice"); msg("c2", 2, "carol"); msg("c2", 3, "alice"); msg("c2", 4, "carol");
  // c3: private to bob+carol: 3 by carol -> bob unread 3; one older than the period
  msg("c3", 1, "carol", { at: now - 7_200_000 }); msg("c3", 2, "carol"); msg("c3", 3, "carol");
  const s = await post("/seed", rows); if (s.seeded === undefined) throw new Error(JSON.stringify(s));
  for (const p of ["alice", "bob", "carol"]) { const v = await post("/q/inbox", { args: { periodStart, periodEnd }, meter: true }, p); console.log(p, "inbox:", JSON.stringify(v.data), `complete=${v.complete} examined=${v.meter?.examined}`); }
} finally { server.kill(); await exited; }
const run = execFileSync(binary, ["run", "digest", JSON.stringify({ periodStart, periodEnd })], { cwd: process.cwd(), encoding: "utf8" });
console.log("run:", run.trim().slice(0, 800));
console.log(execFileSync(binary, ["doctor"], { cwd: process.cwd(), encoding: "utf8" }).slice(0, 3000));
