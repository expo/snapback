// Does a device answer a page past its horizon from SCATTERED old rows and call it complete?
// A horizoned table (`sync public last 5 by byTime`), 12 posts; bob's device acquires the newest 5; alice then
// likes two OLD posts (a hand-kept score: the parent row is put); bob's device is streamed those rows.
// Usage: SB=/path/to/snapback4 PKG=/path/to/unpacked/snapback4/package node measure.mjs
import { spawn } from "node:child_process"; import { once } from "node:events"; import { readFileSync } from "node:fs"; import { join } from "node:path";
const { SB, PKG } = process.env; if (!SB || !PKG) throw new Error("SB= and PKG= are required");
const { createLocalClient } = await import(join(PKG, "dist/local.js")); const { memoryPersistence, webDevice } = await import(join(PKG, "dist/web.js"));
const wasm = readFileSync(join(PKG, "dist/wasm/snapback4_device_bg.wasm"));
const server = spawn(SB, ["dev", "--port", "0", "--no-watch", "--memory", "--hold-schedules"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
const exited = once(server, "exit"); let out = ""; server.stderr.on("data", d => out += d);
const url = await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("not ready " + out)), 300000); server.stdout.on("data", d => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); res(m[0]); } }); });
const post = async (path, body, persona) => (await fetch(`${url}${path}`, { method: "POST", headers: { "x-snapback-persona": persona, "content-type": "application/json" }, body: JSON.stringify(body) })).json();
const api = { timeline: { kind: "query", name: "timeline" }, like: { kind: "mutation", name: "like" } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const show = (label, r) => { const { data, next, ...rest } = r; console.log(label.padEnd(34), "rows:", (data ?? []).map(x => `${x.id}(${x.score})`).join(" ") || "-", "| next:", next != null, "|", JSON.stringify(rest)); };
try {
  const rows = Array.from({ length: 12 }, (_, i) => ({ table: "posts", row: { id: `p${String(i + 1).padStart(2, "0")}`, authorId: "dev:alice", body: `post ${i + 1}`, at: (i + 1) * 1000, score: 0 } }));
  const seeded = await post("/seed", rows, "alice"); if (seeded.seeded !== 12) throw new Error(JSON.stringify(seeded));
  const truth = async (c) => post("/q/timeline", { args: { c } }, "bob");
  const bob = await createLocalClient({ url, persona: "bob", device: webDevice({ wasm, persist: memoryPersistence() }), waitSeconds: 1 });
  const page = async (c) => bob.query(api.timeline, { c: c ?? null });
  // control: the same three pages before any like — the device must hand the page that crosses its horizon to the server
  { let c = null; for (let n = 1; n <= 3; n++) { const r = await page(c); show(`control page ${n} (before any like)`, r); c = r.next; if (c == null) break; } }
  let r1;
  // alice likes two posts far older than bob's horizon (p08..p12)
  for (const id of ["p02", "p04"]) { const w = await post("/m/like", { id: `like-${id}`, args: { postId: id } }, "alice"); if (w.seq === undefined) throw new Error(JSON.stringify(w)); }
  await sleep(2500); // let bob's device follow the stream
  r1 = await page(null); show("device page 1 (after likes)", r1);
  const r2 = await page(r1.next); show("device page 2", r2);
  const r3 = r2.next != null ? await page(r2.next) : null; if (r3) show("device page 3", r3);
  const s1 = await truth(null); const s2 = await truth(s1.next); const s3 = await truth(s2.next);
  console.log("server page 1".padEnd(34), (s1.data ?? []).map(x => x.id).join(" ")); console.log("server page 2".padEnd(34), (s2.data ?? []).map(x => x.id).join(" ")); console.log("server page 3".padEnd(34), (s3.data ?? []).map(x => x.id).join(" "));
  const ids = r => (r?.data ?? []).map(x => x.id).join(" ");
  for (const [n, d, s] of [[2, r2, s2], [3, r3, s3]]) if (d) console.log(`page ${n}: device ${ids(d) === ids(s) ? "EQUALS" : "DIFFERS FROM"} server${ids(d) !== ids(s) && d.complete ? "  ← and the device called it complete" : ""}`);
  await bob.close();
} finally { server.kill(); await exited; }
