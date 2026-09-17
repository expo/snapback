// What does a device HOLD after old rows of a horizoned table are updated? (LLP 3000.007.001 §3.6 / §7 gate 2, at the device.)
// Same schema and steps as measure.mjs; counts the `posts` rows in the device's own persisted row store.
// Usage: SB=/path/to/snapback4 PKG=/path/to/snapback4/package node growth.mjs
import { spawn } from "node:child_process"; import { once } from "node:events"; import { readFileSync } from "node:fs"; import { join } from "node:path";
const { SB, PKG } = process.env; if (!SB || !PKG) throw new Error("SB= and PKG= are required");
const { createLocalClient } = await import(join(PKG, "dist/local.js")); const { memoryPersistence, webDevice } = await import(join(PKG, "dist/web.js"));
const wasm = readFileSync(join(PKG, "dist/wasm/snapback4_device_bg.wasm"));
const server = spawn(SB, ["dev", "--port", "0", "--no-watch", "--memory", "--hold-schedules"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
const exited = once(server, "exit"); let out = ""; server.stderr.on("data", d => out += d);
const url = await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("not ready " + out)), 300000); server.stdout.on("data", d => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(t); res(m[0]); } }); });
const post = async (path, body, persona) => (await fetch(`${url}${path}`, { method: "POST", headers: { "x-snapback-persona": persona, "content-type": "application/json" }, body: JSON.stringify(body) })).json();
const api = { timeline: { kind: "query", name: "timeline" } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const held = (persist) => { const ids = new Set(); for (const [, store] of persist.stores) for (const [, c] of store) if (c.s === "r" && c.v != null && /posts/.test(c.k)) { const m = c.v.match(/"p\d\d"/); if (m) ids.add(m[0].replaceAll('"', "")); } return [...ids].sort(); };
try {
  const rows = Array.from({ length: 12 }, (_, i) => ({ table: "posts", row: { id: `p${String(i + 1).padStart(2, "0")}`, authorId: "dev:alice", body: `post ${i + 1}`, at: (i + 1) * 1000, score: 0 } }));
  const seeded = await post("/seed", rows, "alice"); if (seeded.seeded !== 12) throw new Error(JSON.stringify(seeded));
  const persist = memoryPersistence();
  const bob = await createLocalClient({ url, persona: "bob", device: webDevice({ wasm, persist }), waitSeconds: 1 });
  await bob.query(api.timeline, { c: null });
  console.log("held after acquisition :", held(persist).join(" "));
  for (const id of ["p02", "p04"]) { const w = await post("/m/like", { id: `like-${id}`, args: { postId: id } }, "alice"); if (w.seq === undefined) throw new Error(JSON.stringify(w)); }
  await sleep(2500); await bob.sync?.();
  const after = held(persist);
  console.log("held after two old likes:", after.join(" "));
  console.log(`rows beyond the horizon now held: ${after.filter(id => id < "p08").length} (p02 and p04 were never acquired)`);
  await bob.close();
} finally { server.kill(); await exited; }
