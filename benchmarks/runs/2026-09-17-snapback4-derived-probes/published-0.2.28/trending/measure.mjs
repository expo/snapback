// Blind run of the PUBLISHED 0.2.28 feeds-card Trending block against an independent oracle.
import { spawn } from "node:child_process"; import { once } from "node:events";
const SB = process.env.SB, POSTS = Number(process.env.POSTS ?? 3000);
const server = spawn(SB, ["dev", "--port", "0", "--no-watch", "--memory", "--hold-schedules"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
const exited = once(server, "exit"); let out = ""; server.stderr.on("data", d => out += d);
const api = await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("not ready " + out)), 300000); server.stdout.on("data", d => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); res(m[0]); } }); });
const post = async (path, body, persona = "alice") => (await fetch(`${api}${path}`, { method: "POST", headers: { "x-snapback-persona": persona, "content-type": "application/json" }, body: JSON.stringify(body) })).json();
let seedState = 12345; const rnd = () => (seedState = (seedState * 1103515245 + 12345) % 2147483648) / 2147483648;
try {
  const now = Date.now(), H = 3600000, rows = [], counts = new Map(), ats = new Map();
  for (let i = 0; i < POSTS; i++) { const id = `p${String(i).padStart(6, "0")}`, at = now - Math.floor(rnd() * 30 * H) - 1000; ats.set(id, at); rows.push({ table: "posts", row: { id, authorId: "dev:alice", body: `post ${i}`, at } });
    const n = rnd() < 0.01 ? 50 + Math.floor(rnd() * 150) : Math.floor(rnd() * 12); counts.set(id, n);
    for (let k = 0; k < n; k++) rows.push({ table: "likes", row: { id: `l-${id}-${k}`, postId: id, principal: `dev:u${k}`, postAt: at } }); }
  const t0 = Date.now(); for (let i = 0; i < rows.length; i += 2000) { const s = await post("/seed", rows.slice(i, i + 2000)); if (s.seeded === undefined) throw new Error("seed: " + JSON.stringify(s).slice(0, 300)); }
  console.log(`seeded ${POSTS} posts, ${rows.length - POSTS} likes in ${Date.now() - t0} ms`);
  const r = await post("/q/trending", { args: { c: null }, meter: true });
  const qnow = now; // the server's `now` is a little later; the window edge tolerance below covers it
  const inWindow = [...counts.entries()].filter(([id, n]) => n > 0 && ats.get(id) > qnow - 24 * H);
  const want = inWindow.map(([, n]) => n).sort((a, b) => b - a).slice(0, 10);
  const got = (r.data ?? []).map(x => x.value);
  console.log("complete:", r.complete, "cut:", r.cut ?? null, "next:", r.next != null, "examined:", r.meter?.examined, "rows:", got.length);
  console.log("scores got :", got.join(",")); console.log("scores want:", want.join(","));
  const wrong = (r.data ?? []).filter(x => counts.get(x.postId) !== x.value || !(x.postAt > qnow - 24 * H - 5000));
  console.log("match:", JSON.stringify(got) === JSON.stringify(want), "| rows whose score or window is wrong:", wrong.length, "| in-window liked posts:", inWindow.length, "of", POSTS);
  const r2 = await post("/q/trending", { args: { c: r.next }, meter: true }); console.log("page 2 first score:", r2.data?.[0]?.value, "examined:", r2.meter?.examined, "complete:", r2.complete);
  { const seen = new Set((r.data ?? []).map(x => x.postId)); const dup = (r2.data ?? []).filter(x => seen.has(x.postId)).length; const all = [...(r.data ?? []), ...(r2.data ?? [])].map(x => x.value); const want20 = inWindow.map(([, n]) => n).sort((a, b) => b - a).slice(0, 20); console.log("pages 1+2: duplicates", dup, "| 20 scores match oracle:", JSON.stringify(all) === JSON.stringify(want20)); }
  const z = await post("/q/trendingWithZeros", { args: { c: null }, meter: true }); console.log("trendingWithZeros rows:", (z.data ?? []).length, "complete:", z.complete, "examined:", z.meter?.examined);
  // a like through the mutation moves a post, in the like's own transaction
  const target = inWindow.sort((a, b) => a[1] - b[1])[0][0]; const before = counts.get(target);
  const w = await post("/m/setLike", { id: "w1", args: { postId: target, liked: true } }, "bob"); const after = await post("/q/trending", { args: { c: null } });
  console.log(`setLike as bob on ${target} (had ${before}):`, w.state ?? w.code, "| top score still", after.data?.[0]?.value);
} finally { server.kill(); await exited; }
