// Probe (not a suite test): does a live query that reads connected[p]
// follow presence? Alice observes Bob's online mark while Bob opens a
// client, then closes it.
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "../dist/client.js";
import { createLocalClient } from "../dist/local.js";
import { memoryPersistence, webDevice } from "../dist/web.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, ms) { const start = Date.now(); for (;;) { if (await check()) return Date.now() - start; if (Date.now() - start >= ms) return null; await sleep(20); } }
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

for (const tier of ["online", "web"]) test(`presence liveness: ${tier}`, { timeout: 300000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), "sb4-presence-probe-"));
  mkdirSync(join(dir, "snapback")); writeFileSync(join(dir, "snapback/schema.q"), schema);
  const child = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit"); let log = "", url;
  child.stdout.on("data", d => { log += d; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
  child.stderr.on("data", d => { log += d; });
  t.after(async () => { child.kill(); await exited; rmSync(dir, { recursive: true, force: true }); });
  await waitFor(() => url, 30000);
  const wasm = readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm"));
  const open = async persona => {
    const options = { url, persona, waitSeconds: 25 };
    const c = tier === "online" ? createClient(options) : await createLocalClient({ ...options, device: webDevice({ wasm, persist: memoryPersistence() }) });
    if (tier !== "online") await c.sync();
    return c;
  };
  const alice = await open("alice");
  const watch = alice.observe({ kind: "query", name: "presenceOf" }, { p: "dev:bob" });
  const online = () => watch.getSnapshot()?.data?.online;
  await waitFor(() => online() === false, 10000);
  const before = watch.getSnapshot();
  const bob = await open("bob");
  // Give Bob a live watch too, so every tier holds a /changes poll for him.
  const bobWatch = bob.observe({ kind: "query", name: "presenceOf" }, { p: "dev:alice" });
  await sleep(3000);
  const direct = await alice.query({ kind: "query", name: "presenceOf" }, { p: "dev:bob" });
  const liveAt3s = watch.getSnapshot()?.data;
  const cameOnline = await waitFor(() => online() === true, 60000);
  bobWatch.close(); await bob.close();
  await sleep(40000);
  const directAfter = await alice.query({ kind: "query", name: "presenceOf" }, { p: "dev:bob" });
  const liveAfter = watch.getSnapshot()?.data;
  const report = { tier, before: before?.data, oneShotAt3s: direct?.data ?? direct, liveAt3s, cameOnlineMs: cameOnline, oneShot40sAfterClose: directAfter?.data ?? directAfter, live40sAfterClose: liveAfter, fresh: watch.getSnapshot()?.fresh, complete: watch.getSnapshot()?.complete };
  console.log("PROBE " + JSON.stringify(report));
  watch.close(); await alice.close();
});
