// LLP 3000.007.001 §7 gate 2 measured AT THE DEVICE: the pinned workload (the Clique scale fixture's recorded like
// stream, unmodified; a device acquiring at the "# checkpoint 50%" marker) through the real wasm device in Node,
// counting the `posts` rows the device HOLDS beyond its acquisition horizon afterwards.
// Usage: SB=<snapback4 binary> PKG=<snapback4 npm package dir> FIXTURE=<built scale fixture dir> node gate2-device.mjs
import { spawn } from "node:child_process"; import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const { SB, PKG, FIXTURE: FIX } = process.env; if (!SB || !PKG || !FIX) throw new Error("SB=, PKG= and FIXTURE= are required");
const { createLocalClient } = await import(join(PKG, "dist/local.js")); const { memoryPersistence, webDevice } = await import(join(PKG, "dist/web.js"));
const wasm = readFileSync(join(PKG, "dist/wasm/snapback4_device_bg.wasm"));
const Tc = Date.parse("2026-01-02T00:27:36Z");
const rows = n => readFileSync(join(FIX, `${n}.jsonl`), "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
const posts = [...rows("posts"), ...rows("replies")].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
const likes = rows("likes").sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
const atOf = new Map(posts.map(p => [p.id, p.at]));
const schema = `use personas alice, bob

table posts:
  authorId: principal
  text: text <=500 ?
  at: time
  score: int default 0
  by byTime: at, id
  immutable authorId, at
  public 'posts are public'
  insert <- .authorId = viewer
  update <- allow
  sync public last 2000 by byTime

mutation like(postId: posts):
  p = posts[postId] ! else POST_NOT_FOUND
  update posts[p.id] { score: p.score + 1 }

query timeline(c: cursor ?):
  return posts after c last 3 by byTime { id, score }
`;
const dir = mkdtempSync(join(tmpdir(), "colgate2dev-")); mkdirSync(join(dir, "snapback")); writeFileSync(join(dir, "snapback/schema.q"), schema);
const server = spawn(SB, ["dev", "--port", "0", "--no-watch", "--memory", "--hold-schedules"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
const exited = once(server, "exit"); let out = ""; server.stderr.on("data", d => out += d);
const url = await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("not ready: " + out)), 300000); server.stdout.on("data", d => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); res(m[0]); } }); server.on("exit", () => rej(new Error("exited: " + out))); });
const post = async (path, body, persona) => (await fetch(`${url}${path}`, { method: "POST", headers: { "x-snapback-persona": persona, "content-type": "application/json" }, body: JSON.stringify(body) })).json();
const seed = async (list) => { for (let i = 0; i < list.length; i += 1000) { const s = await post("/seed", list.slice(i, i + 1000).map(p => ({ table: "posts", row: { id: p.id, authorId: p.authorId, text: p.text ?? null, at: p.at, score: 0 } })), "alice"); if (s.seeded === undefined) throw new Error("seed: " + JSON.stringify(s).slice(0, 300)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const heldIds = (persist) => { const ids = new Set(); for (const [, store] of persist.stores) for (const [, c] of store) if (c.s === "r" && c.v != null) { const k = JSON.parse(c.k); if (k[0] === "posts") ids.add(k[1]); } return ids; };
try {
  const before = posts.filter(p => p.at <= Tc), afterPosts = posts.filter(p => p.at > Tc);
  await seed(before);
  const persist = memoryPersistence();
  const bob = await createLocalClient({ url, persona: "bob", device: webDevice({ wasm, persist }), waitSeconds: 1 });
  await bob.query({ kind: "query", name: "timeline" }, { c: null });
  const acquired = heldIds(persist); const horizon = Math.min(...[...acquired].map(id => atOf.get(id)));
  console.log(`seeded ${before.length}; the device acquired ${acquired.size}; horizon ${new Date(horizon).toISOString()}`);
  await seed(afterPosts);
  const window = likes.filter(l => l.at > Tc && atOf.has(l.postId)); let failed = 0;
  for (const l of window) { const r = await post("/m/like", { id: l.id, args: { postId: l.postId } }, "alice"); if (r.seq === undefined) failed++; }
  // let the device follow the log until what it holds stops changing
  let last = -1, stable = 0; const t0 = Date.now();
  while (stable < 4 && Date.now() - t0 < 240000) { await bob.sync?.(); await sleep(750); const n = heldIds(persist).size; if (n === last) stable++; else { stable = 0; last = n; } }
  const held = heldIds(persist); let beyond = 0, fresh = 0, inWindow = 0;
  for (const id of held) { const at = atOf.get(id); if (at > Tc) fresh++; else if (acquired.has(id)) inWindow++; else beyond++; }
  const likedBeyond = new Set(window.map(l => l.postId).filter(id => atOf.get(id) <= Tc && !acquired.has(id))).size;
  console.log(`likes replayed: ${window.length} (failed ${failed}); distinct liked posts beyond the horizon: ${likedBeyond}`);
  console.log(`device holds ${held.size} posts rows = acquired ${inWindow} + created after acquisition ${fresh} + BEYOND ITS HORIZON ${beyond}`);
  console.log(`rows gained beyond the horizon, at the device: ${beyond} = ${(100 * beyond / acquired.size).toFixed(1)}% of the ${acquired.size} acquired — gate: 10%`);
  await bob.close();
} finally { server.kill(); await exited; try { rmSync(dir, { recursive: true, force: true }); } catch {} }
