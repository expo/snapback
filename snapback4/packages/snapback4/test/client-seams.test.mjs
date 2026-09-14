// Lane C's client/dev seams against the real HTTP host and process device.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "../dist/client.js";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const mutation = name => ({ kind: "mutation", name });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) { const value = await check(); if (value) return value; if (Date.now() >= end) throw new Error("timed out waiting"); await sleep(20); }
}
const source = `use personas alice, bob
use identity
table photos:
  owner: principal
  photo: image <=100000 ?
  until: time ?
  by byExpiry: until
  by byOwner: owner, id
  expire at .until
  read <- .owner = viewer
  insert <- allow
  update <- allow
  delete <- allow
  sync to .owner
table secrets:
  photo: image <=100000 once
  read <- allow
  insert <- allow
  sync public
table clips:
  clip: video <=100000
  read <- allow
  insert <- allow
  sync public
mutation answer(n: int):
  return { n: n }
mutation attach(photo: image <=100000, until: time ?):
  require photo.width = 1 else WRONG_WIDTH
  return insert photos { owner: viewer, photo, until }
mutation attachOnce(photo: image <=100000):
  return insert secrets { photo }
mutation clip(clip: video <=100000):
  duration = clip.duration
  require duration != null else DURATION_UNKNOWN
  require duration <= 60000 else TOO_LONG
  return insert clips { clip }
mutation clear(id: photos):
  return update photos[id] { photo: null }
mutation remove(id: photos):
  delete photos[id]
mutation revoke(id: photos):
  return update photos[id] { owner: 'dev:bob' }
query photos():
  return photos[] first 100 by byId
query clips():
  return clips[] first 10 by byId
`;
async function fixture(t, release = false) {
  const dir = mkdtempSync(join(tmpdir(), "sb4-seams-"));
  mkdirSync(join(dir, "snapback")); mkdirSync(join(dir, "devices"));
  writeFileSync(join(dir, "snapback/schema.q"), source);
  if (release) {
    const deployed = spawnSync(binary, ["deploy", join(dir, "release")], { cwd: dir, encoding: "utf8" });
    assert.equal(deployed.status, 0, deployed.stdout + deployed.stderr);
  }
  const server = spawn(binary, release ? ["serve", join(dir, "release"), "--port", "0"] : ["dev", "--port", "0", "--no-watch"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(server, "exit");
  let log = "", url;
  server.stdout.on("data", data => { log += data; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
  server.stderr.on("data", data => { log += data; });
  const clients = [];
  t.after(async () => { for (const client of clients) await client.close(); server.kill(); await exited; rmSync(dir, { recursive: true, force: true }); });
  await until(() => { if (server.exitCode != null) throw new Error(log); return url; });
  const native = processDevice({ binary, dir: join(dir, "devices"), spawn: (command, args) => spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] }), writeFile: async (path, text) => writeFileSync(path, text) });
  const cores = [];
  const device = { async open(name, backend) { const core = await native.open(name, backend); cores.push(core); return core; } };
  const post = async (path, body, persona = true) => (await fetch(url + path, { method: "POST", headers: persona ? { "x-snapback-persona": "alice" } : {}, body: JSON.stringify(body) })).json();
  return { url, device, cores, clients, post, log: () => log };
}

test("sent results reach online, process-device and queued-write callers", async t => {
  const f = await fixture(t);
  const online = createClient({ url: f.url, persona: "alice", waitSeconds: 1 }); f.clients.push(online);
  assert.deepEqual((await online.mutate(mutation("answer"), { n: 41 })).result, { n: 41 });
  let offline = false;
  const local = await createLocalClient({ url: f.url, persona: "alice", device: f.device, waitSeconds: 1, fetch: (...args) => offline ? Promise.reject(new TypeError("offline")) : fetch(...args) }); f.clients.push(local);
  assert.deepEqual((await local.mutate(mutation("answer"), { n: 42 })).result, { n: 42 });
  const terminal = [];
  local.onWrite(write => terminal.push(write));
  offline = true;
  const pending = await local.mutate(mutation("answer"), { n: 43 });
  assert.deepEqual(pending, { state: "pending", id: pending.id });
  offline = false;
  await local.sync();
  const landed = await until(() => terminal.find(write => write.id === pending.id));
  assert.equal(landed.state, "sent"); assert.deepEqual(landed.result, { n: 43 });
  assert.equal(terminal.filter(write => write.id === pending.id).length, 1);
});

test("ordinary media survives a process-device offline reopen; once never persists; home changes purge bytes", async t => {
  const f = await fixture(t);
  let offline = false, assetRequests = 0;
  const gated = (...args) => { if (String(args[0]).includes("/assets/")) assetRequests++; return offline ? Promise.reject(new TypeError("offline")) : fetch(...args); };
  const options = { url: f.url, persona: "alice", device: f.device, waitSeconds: 1, fetch: gated, assets: { keep: "viewed", maxBytes: png.length * 2 } };
  let local = await createLocalClient(options); f.clients.push(local);
  const place = async (op = "attach", until = null) => {
    const uploaded = await local.upload(png); assert.equal(uploaded.ok, true, JSON.stringify(uploaded));
    const sent = await local.mutate(mutation(op), { photo: { id: uploaded.asset.id }, ...(op === "attach" ? { until } : {}) });
    assert.equal(sent.state, "sent", JSON.stringify(sent));
    return { id: uploaded.asset.id, row: sent.result.id };
  };
  const core = () => f.cores.at(-1);
  const manifest = async () => JSON.parse((await core().call({ op: "meta", key: "media:manifest" })).ok || "[]");
  const stored = async id => (await core().call({ op: "meta", key: `media:bytes:${id}` })).ok;
  const view = async id => { const read = await local.asset(id); assert.ok("url" in read, JSON.stringify(read)); const bytes = await (await fetch(read.url)).arrayBuffer(); assert.deepEqual(Buffer.from(bytes), png); read.revoke(); };
  const ordinary = await place(), secret = await place("attachOnce");
  await view(ordinary.id); await view(secret.id);
  assert.equal((await manifest()).length, 1); assert.equal(await stored(secret.id), null);
  await view(ordinary.id);
  assert.equal(assetRequests, 3, "online media is revalidated on every call");
  assert.equal((await local.asset(secret.id)).denied?.code, "E_ASSET_VIEWED");
  await local.close(); offline = true;
  local = await createLocalClient(options); f.clients.push(local);
  const before = assetRequests;
  await view(ordinary.id);
  assert.equal((await local.asset(secret.id)).denied?.code, "E_OFFLINE");
  assert.equal(assetRequests, before, "offline asset reads perform no fetch");
  offline = false; await local.sync(); await until(() => local.link() === "online");
  await f.post("/m/remove", { args: { id: ordinary.row } }); await local.sync();
  assert.equal((await manifest()).length, 0); assert.equal(await stored(ordinary.id), "", "deleted home purges the actual bytes");
  for (const op of ["clear", "revoke"]) {
    const item = await place(); await view(item.id);
    await f.post(`/m/${op}`, { args: { id: item.row } }); await local.sync();
    assert.equal((await manifest()).length, 0, op); assert.equal(await stored(item.id), "", op);
  }
  const expiring = await place("attach", Date.now() + 1000); await view(expiring.id);
  offline = true; await local.sync();
  await until(async () => (await manifest()).length === 0);
  assert.equal(await stored(expiring.id), "", "idle offline expiry purges bytes without a stream");
  offline = false; await local.sync(); await until(() => local.link() === "online");
  const lru = [];
  for (let n = 0; n < 3; n++) { const item = await place(); lru.push(item); await view(item.id); }
  assert.equal((await manifest()).length, 2); assert.equal(await stored(lru[0].id), "");
  assert.equal((await manifest()).reduce((n, entry) => n + entry.bytes, 0), png.length * 2);
  await local.close();
  local = await createLocalClient({ ...options, assets: { keep: "none", maxBytes: 0 } }); f.clients.push(local);
  assert.equal((await manifest()).length, 0); assert.equal(await stored(lru[2].id), "");
  t.diagnostic(`media: ${png.length} B/image; maxBytes ${png.length * 2}; 2 retained then 0 with keep:none; once bytes 0; deleted home bytes 0`);
});

test("dev loopback admits 200 sign-ins without minute limits; serve retains peer and email limits", async t => {
  const dev = await fixture(t);
  const start = performance.now();
  for (let n = 0; n < 200; n++) {
    const result = await dev.post("/auth/guest", {}, false);
    assert.ok(result.session?.token, JSON.stringify(result));
  }
  // A bounded-invalid password checks the email admission counter without
  // adding 200 Argon2 computations to the blocking suite's sixty-second budget.
  for (let n = 0; n < 200; n++) {
    const result = await dev.post("/auth/login", { email: "same@example.com", password: "x".repeat(1025) }, false);
    assert.equal(result.denied?.code, "E_AUTH", JSON.stringify(result));
  }
  assert.match(dev.log(), /no per-peer or per-email minute limits; Argon2 slots: (?:[2-9]|1[0-6]) on this host; connection\/worker caps still apply/);
  const release = await fixture(t, true);
  for (let n = 0; n < 30; n++) assert.ok((await release.post("/auth/guest", {}, false)).session?.token);
  assert.equal((await release.post("/auth/guest", {}, false)).denied?.code, "E_RATE_LIMIT");
  const email = await fixture(t, true);
  for (let n = 0; n < 10; n++) assert.equal((await email.post("/auth/login", { email: "SAME@example.com", password: "x".repeat(1025) }, false)).denied?.code, "E_AUTH");
  assert.equal((await email.post("/auth/login", { email: "same@example.com", password: "x".repeat(1025) }, false)).denied?.code, "E_RATE_LIMIT");
  assert.ok((await email.post("/auth/guest", {}, false)).session?.token, "email refusal does not exhaust the peer");
  assert.doesNotMatch(release.log(), /no per-peer or per-email/);
  t.diagnostic(`identity: 200 guest sign-ins + 200 same-email attempts; dev E_RATE_LIMIT=0; serve peer 31 and email 11 refused; ${Math.round(performance.now() - start)} ms`);
});


test("id-only video predicts after offline reopen and its ordinary bytes are retained", async t => {
  const f = await fixture(t);
  let offline = false;
  const options = { url: f.url, persona: "alice", device: f.device, waitSeconds: 1, assets: { keep: "viewed", maxBytes: 1000 }, fetch: (...args) => offline ? Promise.reject(new TypeError("offline")) : fetch(...args) };
  const mp4 = Buffer.alloc(60);
  mp4.writeUInt32BE(20, 0); mp4.write("ftyp", 4); mp4.write("isom", 8);
  mp4.writeUInt32BE(40, 20); mp4.write("moov", 24);
  mp4.writeUInt32BE(32, 28); mp4.write("mvhd", 32);
  mp4.writeUInt32BE(1000, 48); mp4.writeUInt32BE(1000, 52);
  let client = await createLocalClient(options); f.clients.push(client);
  const uploaded = await client.upload(mp4); assert.equal(uploaded.ok, true, JSON.stringify(uploaded));
  assert.equal(uploaded.asset.duration, 1000);
  await client.close(); offline = true;
  client = await createLocalClient(options); f.clients.push(client);
  const terminal = []; client.onWrite(write => terminal.push(write));
  const pending = await client.mutate(mutation("clip"), { clip: { id: uploaded.asset.id } });
  assert.equal(pending.state, "pending");
  const predicted = await client.query({ kind: "query", name: "clips" }, {});
  assert.equal(predicted.data[0].pending, true);
  assert.equal(predicted.data[0].clip.duration, 1000);
  offline = false; await client.sync();
  const sent = await until(() => terminal.find(write => write.id === pending.id));
  assert.equal(sent.state, "sent"); assert.deepEqual(sent.result.clip, uploaded.asset);
  const online = await client.asset(uploaded.asset.id); assert.equal(online.type, "video/mp4"); online.revoke();
  await client.close(); offline = true;
  client = await createLocalClient(options); f.clients.push(client);
  const held = await client.asset(uploaded.asset.id); assert.equal(held.type, "video/mp4");
  assert.deepEqual(Buffer.from(await (await fetch(held.url)).arrayBuffer()), mp4); held.revoke();
  t.diagnostic("video: 60 B retained; duration 1000 ms; id-only pending prediction agrees with sent.result after reopen");
});
