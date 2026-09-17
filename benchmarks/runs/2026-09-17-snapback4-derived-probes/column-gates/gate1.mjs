// LLP 3000.007.001 §7 gate 1, by proxy on the published binary: what one like costs a bystander device and the
// durable store, under (H) the hand-kept count column — byte-for-byte what a maintained column's mirror would
// put, (M) a declared maintain that inherits public sync, (O) the same maintain `online only`.
// Usage: SB=/path/to/snapback4 node gate1.mjs [N=100000] [SIZES=500,4000] [FORMS=H,M,O]
import { spawn, execFileSync } from "node:child_process"; import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os"; import { join } from "node:path";
const SB = process.env.SB; if (!SB) throw new Error("SB=/path/to/snapback4");
const N = Number(process.env.N ?? 100000), POSTS = 2000, CONC = Number(process.env.CONC ?? 8);
const SIZES = (process.env.SIZES ?? "500,4000").split(",").map(Number), FORMS = (process.env.FORMS ?? "H,M,O").split(",");
const schema = (form) => `use personas alice, bob

table posts:
  authorId: principal
  body: text <=4000
  at: time
${form === "H" ? "  score: int default 0\n" : ""}  by byTime: at, id
  immutable authorId, at
  public 'posts are public'
  insert <- .authorId = viewer
${form === "H" ? "  update <- allow\n" : ""}  sync public last 2000 by byTime

table likes:
  postId: posts
  principal: principal
  at: time
  by byPost: postId, id
  by byTime: at, id
  immutable postId, principal, at
  public 'likes are public'
  insert <- .principal = viewer
  sync public last 2000 by byTime
${form === "M" ? "\nmaintain likeCounts: count likes by postId\n  read <- allow\n" : ""}${form === "O" ? "\nmaintain likeCounts: count likes by postId\n  read <- allow\n  online only\n" : ""}
mutation like(postId: posts):
  p = posts[postId] ! else POST_NOT_FOUND
  insert likes { postId: p.id, principal: viewer, at: now }
${form === "H" ? "  update posts[p.id] { score: p.score + 1 }\n" : ""}`;
const du = (dir) => { let n = 0; for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); n += e.isDirectory() ? du(p) : statSync(p).size; } return n; };
const results = [];
const baseline = {};
for (const size of SIZES) for (const form of FORMS) for (const likesWanted of [0, N]) {
  const dir = mkdtempSync(join(tmpdir(), `colgate1-${form}-${size}-`)); mkdirSync(join(dir, "snapback")); writeFileSync(join(dir, "snapback/schema.q"), schema(form));
  const server = spawn(SB, ["dev", "--port", "0", "--no-watch", "--hold-schedules"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(server, "exit"); let out = ""; server.stderr.on("data", d => out += d);
  const api = await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("not ready: " + out)), 300000); server.stdout.on("data", d => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); res(m[0]); } }); server.on("exit", () => rej(new Error("exited: " + out))); });
  const raw = async (path, body, persona) => { const r = await fetch(`${api}${path}`, { method: "POST", headers: { "x-snapback-persona": persona, "content-type": "application/json" }, body: JSON.stringify(body) }); const text = await r.text(); return { status: r.status, text }; };
  const post = async (path, body, persona) => JSON.parse((await raw(path, body, persona)).text);
  try {
    const t0 = Date.now(), body = "x".repeat(size), base = Date.now() - POSTS * 1000;
    for (let i = 0; i < POSTS; i += 500) {
      const rows = Array.from({ length: 500 }, (_, k) => ({ table: "posts", row: { id: `p${String(i + k).padStart(6, "0")}`, authorId: "alice", body, at: base + (i + k) * 1000, ...(form === "H" ? { score: 0 } : {}) } }));
      const s = await post("/seed", rows, "alice"); if (s.seeded === undefined) throw new Error("seed: " + JSON.stringify(s).slice(0, 400));
    }
    // bob, a bystander device, acquires
    let from = 0, after = null, held = 0, watermark = 0;
    for (;;) { const page = await post("/sync", { from, limit: 1000, after, stream: false, pending: [] }, "bob"); if (page.code) throw new Error("snapshot: " + JSON.stringify(page).slice(0, 300)); held += (page.events ?? []).filter(e => e.table === "posts").length; watermark = page.watermark; if (!page.more && !page.next) break; after = page.next ?? null; if (after === null) break; }
    const s0 = du(join(dir, ".snapback4"));
    // alice likes, round-robin over the posts
    const tLike = Date.now(); let done = 0, failed = 0, next = 0;
    await Promise.all(Array.from({ length: CONC }, async () => { for (;;) { const i = next++; if (i >= likesWanted) return; const r = await post("/m/like", { id: `l-${i}`, args: { postId: `p${String(i % POSTS).padStart(6, "0")}` } }, "alice"); if (r.seq === undefined) { failed++; if (failed < 3) console.error("like failed:", JSON.stringify(r).slice(0, 300)); } else done++; } }));
    const likeMs = Date.now() - tLike;
    // bob follows the log from its watermark
    let bytes = 0, pages = 0; const events = {}; let cursor = watermark;
    for (;;) { const r = await raw("/sync", { from: cursor, limit: 500, after: null, stream: true, pending: [] }, "bob"); const page = JSON.parse(r.text); if (page.code) throw new Error("stream: " + r.text.slice(0, 300)); bytes += Buffer.byteLength(r.text); pages++; for (const e of page.events ?? []) events[e.table] = (events[e.table] ?? 0) + 1; if (page.watermark === cursor && !(page.events ?? []).length) break; cursor = page.watermark; if (!page.more && !(page.events ?? []).length) break; if (!page.more) { /* one more to confirm empty */ } }
    server.kill("SIGTERM"); await exited;
    const s1 = du(join(dir, ".snapback4"));
    // durable cost: checkpoint a copy of the store, then read the database's size and the log's own rows
    const copy = join(dir, "copy"); mkdirSync(copy);
    for (const f of readdirSync(join(dir, ".snapback4"))) if (f.startsWith("store.sqlite")) execFileSync("/bin/cp", [join(dir, ".snapback4", f), join(copy, f)]);
    const sql = (q) => execFileSync("/usr/bin/sqlite3", [join(copy, "store.sqlite"), q], { encoding: "utf8" }).trim();
    sql("PRAGMA wal_checkpoint(TRUNCATE);");
    const dbBytes = statSync(join(copy, "store.sqlite")).size;
    const logRows = sql(`SELECT t || '/' || kind || '=' || count(*) || 'rows/' || coalesce(sum(length(data)),0) || 'B' FROM _log WHERE seq > ${watermark} GROUP BY t, kind ORDER BY 1;`).split("\n").join(" ");
    const logBytes = Number(sql(`SELECT coalesce(sum(length(data) + length(partition) + length(t) + length(kind) + length(id) + 16), 0) FROM _log WHERE seq > ${watermark};`));
    const logCount = Number(sql(`SELECT count(*) FROM _log WHERE seq > ${watermark};`));
    const files = readdirSync(join(dir, ".snapback4")).map(f => `${f}=${statSync(join(dir, ".snapback4", f)).size}`).join(" ");
    let log = "";
    try { const db = readdirSync(join(dir, ".snapback4")).find(f => /\.(db|sqlite3?)$/.test(f)); if (db) log = execFileSync("/usr/bin/sqlite3", ["-readonly", join(dir, ".snapback4", db), "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '\\_%' ESCAPE '\\' ORDER BY 1;"], { encoding: "utf8" }).trim().split("\n").join(","); } catch (e) { log = "sqlite3: " + e.message.slice(0, 120); }
    if (likesWanted === 0) { baseline[`${form}/${size}`] = dbBytes; console.log(JSON.stringify({ form, size, baselineDbBytes: dbBytes, heldAtAcquisition: held })); continue; }
    const row = { form, size, dbBytes, dbGrowthPerLike: +((dbBytes - baseline[`${form}/${size}`]) / done).toFixed(1), logRowsPerLike: +(logCount / done).toFixed(3), logBytesPerLike: +(logBytes / done).toFixed(1), logRows, likes: done, failed, heldAtAcquisition: held, likeMs, perSecond: Math.round(done / (likeMs / 1000)), streamBytes: bytes, streamBytesPerLike: +(bytes / done).toFixed(1), pages, events, eventsPerLike: +(Object.values(events).reduce((a, b) => a + b, 0) / done).toFixed(3), storeBefore: s0, storeAfter: s1, storeBytesPerLike: +((s1 - s0) / done).toFixed(1), files, engineTables: log, totalMs: Date.now() - t0 };
    results.push(row); console.log(JSON.stringify(row));
  } catch (e) { console.error(`FAILED ${form}/${size}:`, e.message, "\n", out.slice(-600)); try { server.kill("SIGKILL"); } catch {} }
  finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
}
console.log("\nform size  wireB/like  events/like  logRows/like  logB/like  dbGrowthB/like  likes/s");
for (const r of results) console.log(`${r.form}    ${String(r.size).padEnd(5)} ${String(r.streamBytesPerLike).padEnd(11)} ${String(r.eventsPerLike).padEnd(12)} ${String(r.logRowsPerLike).padEnd(13)} ${String(r.logBytesPerLike).padEnd(10)} ${String(r.dbGrowthPerLike).padEnd(15)} ${r.perSecond}`);
