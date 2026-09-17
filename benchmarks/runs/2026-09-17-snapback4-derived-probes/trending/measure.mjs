import { spawn } from "node:child_process";
import { once } from "node:events";
const binary = process.env.SB;
const server = spawn(binary, ["dev", "--port", "0", "--no-watch", "--memory"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
const exited = once(server, "exit"); let output = "";
const api = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("not ready " + output)), 60000); const on = (d) => { output += d; const m = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); resolve(m[0]); } }; server.stdout.on("data", on); server.stderr.on("data", on); });
try {
  const post = async (path, body, persona = "alice") => (await fetch(`${api}${path}`, { method: "POST", headers: { "x-snapback-persona": persona, "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  const HOUR = 3_600_000, DAY = 86_400_000;
  const POSTS = Number(process.env.POSTS ?? 5000), SPAN = 30 * HOUR;
  const t0 = Date.now();
  // deterministic PRNG
  let seed = 42; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const rows = []; const oracle = [];
  for (let i = 0; i < POSTS; i++) {
    const at = t0 - Math.floor(rnd() * SPAN) - 60_000;       // up to 30 h old, none in the future
    const id = `p${String(i).padStart(6, "0")}`;
    rows.push({ table: "posts", row: { id, authorId: `dev:author${i % 200}`, body: `post ${i}`, at } });
    const hot = rnd() < 0.01; const n = hot ? 50 + Math.floor(rnd() * 150) : Math.floor(rnd() * 12);
    for (let k = 0; k < n; k++) rows.push({ table: "likes", row: { id: `${id}-l${k}`, postId: id, principal: `dev:u${k}`, postHour: Math.floor(at / HOUR), postAt: at } });
    oracle.push({ id, at, n });
  }
  const seedStart = performance.now();
  for (let i = 0; i < rows.length; i += 20000) { const s = await post("/seed", rows.slice(i, i + 20000)); if (s.seeded === undefined) throw new Error(JSON.stringify(s).slice(0, 400)); }
  console.log(`seeded ${POSTS} posts, ${rows.length - POSTS} likes in ${(performance.now() - seedStart).toFixed(0)} ms`);
  const times = []; let v;
  for (let n = 0; n < 33; n++) { const s = performance.now(); v = await post("/q/trending", { args: { c: null }, meter: true }); const ms = performance.now() - s; if (n >= 3) times.push(ms); }
  times.sort((a, b) => a - b);
  if (!v.data) throw new Error(JSON.stringify(v).slice(0, 600));
  const now = Date.now();
  const want = oracle.filter((p) => p.at > now - DAY && p.n > 0).sort((a, b) => b.n - a.n).slice(0, 10);
  const got = v.data.map((r) => ({ id: r.postId, n: r.value }));
  const wantScores = want.map((p) => p.n).join(","), gotScores = got.map((p) => p.n).join(",");
  console.log(`page1 rows=${v.data.length} complete=${v.complete} cut=${v.cut ?? null} next=${!!v.next} examined=${v.meter.examined} idx=${v.meter.indexEntries ?? v.meter.index_entries} probes=${v.meter.probes} steps=${v.meter.steps} p50=${times[15].toFixed(2)}ms p95=${times[28].toFixed(2)}ms`);
  console.log(`scores got   = ${gotScores}\nscores want  = ${wantScores}\nmatch=${gotScores === wantScores}  (in-window posts: ${oracle.filter((p) => p.at > now - DAY).length}, out-of-window: ${oracle.filter((p) => p.at <= now - DAY).length})`);
  const stale = got.filter((g) => { const o = oracle.find((p) => p.id === g.id); return !(o.at > now - DAY); });
  console.log(`out-of-window rows returned: ${stale.length}`);
  const p2 = await post("/q/trending", { args: { c: v.next }, meter: true });
  console.log(`page2 rows=${p2.data?.length} complete=${p2.complete} next=${!!p2.next} examined=${p2.meter?.examined} first=${p2.data?.[0]?.value}`);
  // freshness: one more like on the 11th post should move it
  console.log(JSON.stringify(v.meter));
} finally { server.kill(); await exited; }
