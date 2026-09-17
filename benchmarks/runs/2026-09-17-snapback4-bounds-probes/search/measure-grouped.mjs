import { spawn } from "node:child_process";
import { once } from "node:events";
const binary = process.env.SB; const PER_CHAT = 30;
const sizes = (process.env.SIZES ?? "100,1000").split(",").map(Number);
function seedFor({ chats, hitChats }) {
  const rows = []; const room = (g) => `r${String(g).padStart(5, "0")}`;
  const stride = Math.max(1, Math.floor(chats / hitChats));
  for (let g = 0; g < chats; g++) {
    rows.push({ table: "members", row: { id: `${room(g)}-alice`, roomId: room(g), principal: "dev:alice" } });
    const isHit = hitChats >= chats ? true : (g % stride === 0 && g / stride < hitChats);
    for (let m = 0; m < PER_CHAT; m++) rows.push({ table: "messages", row: { id: `${room(g)}-m${String(m).padStart(3, "0")}`, roomId: room(g), body: (isHit && m < 24) ? `coffee time number ${m}` : `tea break number ${m}`, at: 1_700_000_000_000 + m * 1000 + g } });
  }
  return rows;
}
async function withServer(fn) {
  const server = spawn(binary, ["dev", "--port", "0", "--no-watch", "--memory"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(server, "exit"); let output = "";
  const api = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("not ready " + output)), 30000); const on = (d) => { output += d; const m = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); resolve(m[0]); } }; server.stdout.on("data", on); server.stderr.on("data", on); });
  try { return await fn(api); } finally { server.kill(); await exited; }
}
for (const [dist, hitOf] of [["dense", (n) => n], ["sparse5", () => 5], ["sparse50", () => 50]]) for (const chats of sizes) await withServer(async (api) => {
  const post = async (path, body) => (await fetch(`${api}${path}`, { method: "POST", headers: { "x-snapback-persona": "alice", "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  const seed = seedFor({ chats, hitChats: hitOf(chats) });
  for (let i = 0; i < seed.length; i += 20000) { const s = await post("/seed", seed.slice(i, i + 20000)); if (s.seeded === undefined) throw new Error(JSON.stringify(s)); }
  let c = null, requests = 0, groups = 0, hits = 0, examinedTotal = 0, maxExamined = 0, shapes = [];
  const t0 = performance.now();
  for (;;) {
    const v = await post("/q/grouped", { args: { q: "cof", c }, meter: true }); requests++;
    if (v.denied || !Array.isArray(v.data)) { console.log("UNEXPECTED", JSON.stringify(v).slice(0, 600)); break; }
    groups += v.data.length; for (const g of v.data) hits += (Array.isArray(g.hits) ? g.hits.length : (g.hits?.data?.length ?? 0));
    examinedTotal += v.meter.examined; maxExamined = Math.max(maxExamined, v.meter.examined);
    shapes.push(`${v.data.length}g/${v.meter.examined}ex/${v.complete ? "C" : "c"}${v.cut ? ":" + v.cut : ""}${v.next ? "+" : "."}`);
    if (!v.next) break; c = v.next; if (requests > 200) { console.log("runaway"); break; }
  }
  console.log(`${dist.padEnd(8)} chats=${String(chats).padStart(4)} grouped(one cursor): requests=${requests} groups=${groups} hitsShown=${hits} examinedTotal=${examinedTotal} maxExaminedPerRequest=${maxExamined} wallMs=${(performance.now() - t0).toFixed(0)}`);
  console.log(`   pages: ${shapes.slice(0, 12).join(" ")}${shapes.length > 12 ? " …" : ""}`);
});
