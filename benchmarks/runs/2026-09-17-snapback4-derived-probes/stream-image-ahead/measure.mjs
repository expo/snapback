// Does a stream page carry a row image NEWER than the page's own watermark?
import { spawn } from "node:child_process"; import { once } from "node:events";
const server = spawn(process.env.SB, ["dev", "--port", "0", "--no-watch", "--memory", "--hold-schedules"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
const exited = once(server, "exit"); let out = "";
const api = await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("not ready " + out)), 240000); const on = (d) => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); res(m[0]); } }; server.stdout.on("data", on); server.stderr.on("data", on); });
const post = async (path, body, persona) => (await fetch(`${api}${path}`, { method: "POST", headers: { "x-snapback-persona": persona, "content-type": "application/json" }, body: JSON.stringify(body) })).json();
try {
  const seeded = await post("/seed", [{ table: "counters", row: { id: "c1", n: 0 } }], "alice"); if (seeded.seeded === undefined) throw new Error(JSON.stringify(seeded));
  const snap = await post("/sync", { from: 0, limit: 100, after: null, stream: false, pending: [] }, "alice");
  console.log("alice acquires      → watermark", snap.watermark, "image n =", (snap.events ?? []).filter((e) => e.table === "counters").map((e) => e.data?.n).join(","));
  const b = await post("/m/bump", { id: "bob-1", args: { counterId: "c1" } }, "bob");      // another principal's commit
  const a = await post("/m/bump", { id: "alice-1", args: { counterId: "c1" } }, "alice");  // this device's own, still-unacknowledged write
  console.log("bob bump seq", b.seq, "→ n", b.result?.n, "| alice bump seq", a.seq, "→ n", a.result?.n);
  const page = await post("/sync", { from: snap.watermark, limit: 1, after: null, stream: true, pending: ["alice-1"] }, "alice");
  const ev = (page.events ?? []).filter((e) => e.table === "counters");
  console.log(`page(limit 1) from ${snap.watermark} → watermark ${page.watermark}, more=${page.more}, acks=${JSON.stringify(page.acks ?? page.acknowledged ?? null)}, events: ${ev.map((e) => `seq ${e.seq} put n=${e.data?.n}`).join("; ")}`);
  console.log(page.watermark < a.seq && ev.some((e) => e.data?.n === a.result?.n) ? "CONFIRMED: the page ends BEFORE alice's commit, does not acknowledge it, yet its image already includes it → replaying alice's pending bump on this image shows n = " + (a.result.n + 1) : "not reproduced: " + JSON.stringify(page).slice(0, 400));
} finally { server.kill(); await exited; }
