// LLP 3000.007.001 §7 gate 2 on the published binary, with the pinned workload: the Clique scale fixture's
// recorded like stream, unmodified; a bystander device acquires at the "# checkpoint 50%" marker; count the rows
// of `posts` it is sent that lie beyond its horizon — rows it never acquired and would never have been sent
// but for the count riding on the parent row (the hand-kept `score` here; a maintained column's mirror puts
// the same image). Usage: SB=/path/to/snapback4 FIXTURE=/path/to/built/scale node gate2.mjs
//   (build the fixture with: node snapback4/fixtures/clique.mjs build --log scale --out <dir>)
import { spawn } from "node:child_process"; import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const SB = process.env.SB, FIX = process.env.FIXTURE; if (!SB || !FIX) throw new Error("SB= and FIXTURE= are required");
const Tc = Date.parse("2026-01-02T00:27:36Z"); // scale.log line 88059, "# checkpoint 50%"
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

table likes:
  postId: posts
  principal: principal
  at: time
  by byTime: at, id
  immutable postId, principal, at
  public 'likes are public'
  insert <- .principal = viewer
  sync public last 2000 by byTime

mutation like(postId: posts):
  p = posts[postId] ! else POST_NOT_FOUND
  insert likes { postId: p.id, principal: viewer, at: now }
  update posts[p.id] { score: p.score + 1 }
`;
const dir = mkdtempSync(join(tmpdir(), "colgate2-")); mkdirSync(join(dir, "snapback")); writeFileSync(join(dir, "snapback/schema.q"), schema);
const server = spawn(SB, ["dev", "--port", "0", "--no-watch", "--memory", "--hold-schedules"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
const exited = once(server, "exit"); let out = ""; server.stderr.on("data", d => out += d);
const api = await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("not ready: " + out)), 300000); server.stdout.on("data", d => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); res(m[0]); } }); server.on("exit", () => rej(new Error("exited: " + out))); });
const post = async (path, body, persona) => (await fetch(`${api}${path}`, { method: "POST", headers: { "x-snapback-persona": persona, "content-type": "application/json" }, body: JSON.stringify(body) })).json();
const seed = async (list) => { for (let i = 0; i < list.length; i += 1000) { const s = await post("/seed", list.slice(i, i + 1000).map(p => ({ table: "posts", row: { id: p.id, authorId: p.authorId, text: p.text ?? null, at: p.at, score: 0 } })), "alice"); if (s.seeded === undefined) throw new Error("seed: " + JSON.stringify(s).slice(0, 300)); } };
try {
  const before = posts.filter(p => p.at <= Tc), afterPosts = posts.filter(p => p.at > Tc);
  await seed(before);
  // the bystander acquires at the checkpoint
  const held = new Map(); let after = null, watermark = 0;
  for (;;) { const page = await post("/sync", { from: 0, limit: 1000, after, stream: false, pending: [] }, "bob"); if (page.code) throw new Error("snapshot: " + JSON.stringify(page).slice(0, 300)); for (const e of page.events ?? []) if (e.table === "posts") held.set(e.id ?? e.data?.id, true); watermark = page.watermark; after = page.next ?? null; if (after === null) break; }
  const heldAts = [...held.keys()].map(id => atOf.get(id)).sort((a, b) => a - b); const horizon = heldAts[0];
  console.log(`seeded ${before.length} rows at or before the checkpoint; the device acquired ${held.size}; horizon ${new Date(horizon).toISOString()}`);
  await seed(afterPosts);
  const window = likes.filter(l => l.at > Tc && atOf.has(l.postId)); let failed = 0;
  for (const l of window) { const r = await post("/m/like", { id: l.id, args: { postId: l.postId } }, "alice"); if (r.seq === undefined) { failed++; if (failed < 3) console.error("like failed", JSON.stringify(r).slice(0, 200)); } }
  // follow the log from the acquisition watermark
  const sent = new Map(); let cursor = watermark, pages = 0, bytes = 0;
  for (;;) { const r = await fetch(`${api}/sync`, { method: "POST", headers: { "x-snapback-persona": "bob", "content-type": "application/json" }, body: JSON.stringify({ from: cursor, limit: 2000, after: null, stream: true, pending: [] }) }); const text = await r.text(); const page = JSON.parse(text); if (page.code) throw new Error("stream: " + text.slice(0, 300)); bytes += Buffer.byteLength(text); pages++; const ev = page.events ?? []; for (const e of ev) if (e.table === "posts" && (e.kind ?? "put") !== "delete") sent.set(e.id ?? e.data?.id, (sent.get(e.id ?? e.data?.id) ?? 0) + 1); if (!ev.length && page.watermark === cursor) break; cursor = page.watermark; }
  let beyond = 0, within = 0, fresh = 0, notOlder = 0;
  for (const id of sent.keys()) { const at = atOf.get(id); if (at > Tc) fresh++; else if (held.has(id)) within++; else { beyond++; if (!(at < horizon)) notOlder++; } }
  console.log(`likes replayed after the checkpoint: ${window.length} (failed ${failed}); stream: ${pages} pages, ${bytes} bytes`);
  console.log(`distinct posts rows sent to the device: ${sent.size} = created after acquisition ${fresh} + already held ${within} + BEYOND ITS HORIZON ${beyond} (of which not older than the horizon: ${notOlder})`);
  console.log(`rows gained beyond the horizon: ${beyond} = ${(100 * beyond / held.size).toFixed(1)}% of the ${held.size} held at acquisition — gate: 10% a day; this replay's remaining span is ${((Math.max(...likes.map(l => l.at)) - Tc) / 3600000).toFixed(2)} h`);
} finally { server.kill(); await exited; try { rmSync(dir, { recursive: true, force: true }); } catch {} }
