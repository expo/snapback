// LLP 3000.017: a live query that reads connected[p] follows p. Alice's
// observed online mark for Bob moves when Bob's client starts polling and
// when his grace ends, on every client tier.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "../dist/client.js";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";
import { memoryPersistence, webDevice } from "../dist/web.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, ms = 5000) {
  const start = Date.now();
  for (;;) { if (await check()) return Date.now() - start; if (Date.now() - start >= ms) return null; await sleep(20); }
}
const schema = `use personas alice, bob
use identity
table notes:
  owner: principal
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner
query presenceOf(p: principal):
  return { online: exists connected[p], count: connected[p] }
`;

for (const tier of ["online", "native", "web"]) test(`${tier}: a live online mark follows the principal it reads`, { timeout: 60000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), "sb4-presence-live-"));
  mkdirSync(join(dir, "snapback")); mkdirSync(join(dir, "devices"));
  writeFileSync(join(dir, "snapback/schema.q"), schema);
  const server = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(server, "exit");
  let log = "", url;
  server.stdout.on("data", data => { log += data; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
  server.stderr.on("data", data => { log += data; });
  const clients = [];
  t.after(async () => { for (const client of clients) await client.close().catch(() => {}); server.kill(); await exited; rmSync(dir, { recursive: true, force: true }); });
  assert.notEqual(await until(() => url, 30000), null, log);
  const native = processDevice({ binary, dir: join(dir, "devices"), spawn: (command, args) => spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] }), writeFile: async (path, text) => writeFileSync(path, text) });
  const wasm = readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm"));
  const options = persona => ({ url, persona, waitSeconds: 25 });
  const alice = tier === "online" ? createClient(options("alice"))
    : await createLocalClient({ ...options("alice"), device: tier === "native" ? native : webDevice({ wasm, persist: memoryPersistence() }) });
  clients.push(alice);
  if (tier !== "online") await alice.sync();
  const query = { kind: "query", name: "presenceOf" };
  const mark = alice.observe(query, { p: "dev:bob" });
  t.after(() => mark.close());
  const online = () => mark.getSnapshot()?.data?.online;
  assert.notEqual(await until(() => online() === false), null, "Bob starts away");

  // Bob's client holds a poll while it watches something.
  const bob = createClient(options("bob"));
  clients.push(bob);
  const bobWatch = bob.observe(query, { p: "dev:alice" });
  const cameOnline = await until(() => online() === true && mark.getSnapshot().fresh === true);
  assert.notEqual(cameOnline, null, `Alice's mark stayed ${JSON.stringify(mark.getSnapshot())} after Bob came online`);
  assert.equal(mark.getSnapshot().data.count, 1);

  // Bob leaves. His grace keeps him connected until the clock passes it.
  bobWatch.close();
  await bob.close();
  clients.splice(clients.indexOf(bob), 1);
  await sleep(300);
  assert.equal(online(), true, "inside the grace Bob still counts as connected");
  const advanced = await fetch(`${url}/dev/clock/advance`, { method: "POST", headers: { "x-snapback-persona": "alice", "content-type": "application/json" }, body: JSON.stringify({ duration: "36s" }) });
  assert.equal(advanced.status, 200);
  const wentAway = await until(() => online() === false && mark.getSnapshot().fresh === true);
  assert.notEqual(wentAway, null, `Alice's mark stayed ${JSON.stringify(mark.getSnapshot())} after Bob's grace ended`);
  t.diagnostic(JSON.stringify({ tier, cameOnlineMs: cameOnline, wentAwayMs: wentAway }));
});
