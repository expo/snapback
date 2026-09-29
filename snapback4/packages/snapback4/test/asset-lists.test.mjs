// @ref LLP 3000.019#3.5 — real HTTP serving and ordinary list bytes offline on both devices.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { syncControl, parkedChanges } from "./helpers/sync-control.mjs";
import { ServerClock } from "../dist/clock.js";
import { createClient } from "../dist/client.js";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";
import { webDevice, memoryPersistence } from "../dist/web.js";
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const mutation = name => ({ kind: "mutation", name });
const query = { kind: "query", name: "posts" };
const source = `use personas alice, bob, stranger
table follows:
  owner: principal
  principal: principal
  unique byPair: owner, principal
  by byViewer: principal, owner
  read <- allow
  insert <- deny
  delete <- .principal = viewer
  sync public
table posts:
  owner: principal
  caption: text <=80 ?
  until: time ?
  expire at .until
  images: [image <=10000] <=4 ?
  secrets: [image <=10000 once] <=4 ?
  read <- exists follows[.owner, viewer]
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  sync to follows[.owner] by .principal
mutation createPost(images: [image <=10000] <=4 ?, secrets: [image <=10000] <=4 ?):
  return insert posts { owner: viewer, images, secrets }
mutation edit(id: posts, images: [image <=10000] <=4 ?):
  update posts[id] { images }
mutation expire(id: posts, until: time):
  update posts[id] { until }
mutation remove(id: posts):
  delete posts[id]
mutation touch(id: posts):
  update posts[id] { caption: 'touched' }
mutation revokeAndTouch(id: posts):
  delete follows['bob']
  update posts[id] { caption: 'revoked' }
query posts():
  return posts[] first 10 by byId
`;
async function fixture(t, schema = source, shape = assets => assets.map(a => ({ id: a.id }))) {
  const dir = mkdtempSync(join(tmpdir(), "sb4-asset-lists-"));
  mkdirSync(join(dir, "snapback")); writeFileSync(join(dir, "snapback/schema.q"), schema);
  let server, exited, url;
  const clients = [];
  const stop = async () => { if (server) { server.kill(); await exited; server = undefined; } };
  const start = async () => {
    let log = ""; url = undefined;
    server = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    exited = once(server, "exit");
    for (const stream of [server.stdout, server.stderr]) stream.on("data", b => { log += b; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
    const deadline = Date.now() + 15000;
    while (!url) { if (server.exitCode != null || Date.now() > deadline) throw Error(log); await new Promise(r => setTimeout(r, 20)); }
    return url;
  };
  t.after(async () => { for (const c of clients) await c.close(); await stop(); rmSync(dir, { recursive:true, force:true }); });
  await start();
  const alice = createClient({ url, persona: "alice" }); clients.push(alice);
  const bob = createClient({ url, persona: "bob" }); clients.push(bob);
  const seeded = await fetch(url + "/seed", { method: "POST", body: JSON.stringify(["alice", "bob"].map(p => ({ table: "follows", row: { id: p, owner: "dev:alice", principal: "dev:" + p } }))) }).then(r => r.json());
  assert.equal(seeded.seeded, 2, JSON.stringify(seeded));
  const upload = async () => { const r = await alice.upload(png); assert.equal(r.ok, true); return r.asset; };
  const a = await upload(), b = await upload();
  const placed = await alice.mutate(mutation("createPost"), { images: shape([a, b]) });
  assert.equal(placed.state, "sent", JSON.stringify(placed));
  return { dir, url, clients, alice, bob, a, b, id: placed.result.id, upload, start, stop };
}
async function storedMeta(tier, dir, persist, name, key) {
  if (tier === "native") {
    const db = new DatabaseSync(join(dir, "device", `${name}.sqlite`));
    try { return db.prepare("SELECT value FROM _meta WHERE key = ?").get(key)?.value ?? null; }
    finally { db.close(); }
  }
  return (await persist.load(name)).find(c => c.s === "m" && c.k === key)?.v ?? null;
}
async function served(url, id, persona, status) {
  const response = await fetch(`${url}/assets/${id}`, { headers: { "x-snapback-persona": persona } });
  assert.equal(response.status, status);
  if (status === 200) assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  else assert.equal((await response.json()).denied.code, "E_ASSET_UNKNOWN");
  return response;
}
test("a follower GETs every placed element; reorder, drop and deletion keep one home", { timeout: 30000 }, async t => {
  const f = await fixture(t);
  for (const asset of [f.a, f.b]) { await served(f.url, asset.id, "bob", 200); await served(f.url, asset.id, "stranger", 404); }
  const rows = await f.bob.query(query, {}); assert.deepEqual(rows.data[0].images, [f.a, f.b]);
  const edit = images => f.alice.mutate(mutation("edit"), { id: f.id, images: images.map(a => ({ id: a.id })) });
  assert.equal((await edit([f.b, f.a])).state, "sent");
  assert.deepEqual((await f.bob.query(query, {})).data[0].images, [f.b, f.a]);
  for (const a of [f.a, f.b]) await served(f.url, a.id, "bob", 200);
  assert.equal((await edit([f.b])).state, "sent"); await served(f.url, f.a.id, "bob", 404); await served(f.url, f.b.id, "bob", 200);
  assert.equal((await edit([f.a, f.b])).state, "sent");
  assert.equal((await f.alice.mutate(mutation("remove"), { id: f.id })).state, "sent");
  for (const a of [f.a, f.b]) await served(f.url, a.id, "bob", 404);
});
for (const tier of ["native", "wasm"]) test(`${tier}: synced list elements survive offline reopen and drop revokes only that element`, { timeout: 40000 }, async t => {
  const f = await fixture(t); let offline = false;
  const device = tier === "native" ? processDevice({ binary, dir: join(f.dir, "device") })
    : webDevice({ wasm: readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm")), persist: memoryPersistence() });
  const options = { url: f.url, persona: "bob", device, waitSeconds: 1, assets: { keep: "viewed", maxBytes: 10000 }, fetch: (...args) => offline ? Promise.reject(Error("offline")) : fetch(...args) };
  let local = await createLocalClient(options); f.clients.push(local); await local.sync();
  const rows = await local.query(query, {}); assert.equal(rows.data[0].images.length, 2);
  for (const asset of [f.a, f.b]) {
    const result = await local.asset(asset.id); assert.ok("url" in result, JSON.stringify(result)); result.revoke();
    const source = local.assetSource(asset.id); assert.equal((await fetch(source.uri, { headers: source.headers })).status, 200);
  }
  await local.close(); offline = true;
  local = await createLocalClient(options); f.clients.push(local);
  for (const asset of [f.a, f.b]) {
    const result = await local.asset(asset.id); assert.ok("url" in result, JSON.stringify(result));
    assert.deepEqual(Buffer.from(await (await fetch(result.url)).arrayBuffer()), png); result.revoke();
  }
  offline = false;
  assert.equal((await f.alice.mutate(mutation("edit"), { id: f.id, images: [{ id: f.b.id }, { id: f.a.id }] })).state, "sent");
  await local.sync(); offline = true;
  assert.deepEqual((await local.query(query, {})).data[0].images, [f.b, f.a]);
  for (const asset of [f.a, f.b]) { const r = await local.asset(asset.id); assert.ok("url" in r); r.revoke(); }
  offline = false;
  assert.equal((await f.alice.mutate(mutation("edit"), { id: f.id, images: [{ id: f.b.id }] })).state, "sent");
  await local.sync(); offline = true;
  assert.equal((await local.asset(f.a.id)).denied?.code, "E_OFFLINE");
  const kept = await local.asset(f.b.id); assert.ok("url" in kept); kept.revoke();
  offline = false;
  const secret = await f.upload();
  assert.equal((await f.alice.mutate(mutation("createPost"), { secrets: [{ id: secret.id }] })).state, "sent");
  await local.sync(); const viewed = await local.asset(secret.id); assert.ok("url" in viewed); viewed.revoke();
  assert.equal((await local.asset(secret.id)).denied?.code, "E_ASSET_VIEWED");
  offline = true; assert.equal((await local.asset(secret.id)).denied?.code, "E_OFFLINE");
  offline = false; assert.equal((await f.alice.mutate(mutation("remove"), { id: f.id })).state, "sent");
  await local.sync(); offline = true; assert.equal((await local.asset(f.b.id)).denied?.code, "E_OFFLINE");
});

test("reopening a legacy Alice list cannot publish Bob's upload or take his placement", { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const uploaded = await f.bob.upload(png); assert.equal(uploaded.ok, true);
  const asset = uploaded.asset;
  await served(f.url, asset.id, "stranger", 404);
  assert.equal((await served(f.url, asset.id, "bob", 200)).headers.get("x-snapback-asset-home"), null, "upload preview is not a placement");
  await f.stop();
  const db = new DatabaseSync(join(f.dir, ".snapback4/store.sqlite"));
  const stored = db.prepare("SELECT data FROM r WHERE id = ?").get(f.id);
  // Stored values use the core's tagged serialization, not wire JSON.
  const row = JSON.parse(stored.data);
  row.Row.images = { Array: [{ Map: { id: { Id: asset.id } } }] };
  const legacy = JSON.stringify(row);
  db.prepare("UPDATE r SET data = ? WHERE id = ?").run(legacy, f.id);
  db.prepare("DELETE FROM _meta WHERE key = 'asset_columns_version'").run();
  const generation = db.prepare("SELECT value FROM _meta WHERE key = 'generation'").get().value;
  db.close();
  const url = await f.start();
  await served(url, asset.id, "stranger", 404);
  await served(url, asset.id, "bob", 200);
  const check = new DatabaseSync(join(f.dir, ".snapback4/store.sqlite"), { readOnly: true });
  assert.equal(check.prepare("SELECT data FROM r WHERE id = ?").get(f.id).data, legacy);
  assert.equal(check.prepare("SELECT home_table FROM _assets WHERE id = ?").get(asset.id).home_table, null);
  assert.equal(check.prepare("SELECT value FROM _meta WHERE key = 'generation'").get().value, generation);
  check.close();
  const bob = createClient({ url, persona: "bob" }); f.clients.push(bob);
  const placed = await bob.mutate(mutation("createPost"), { images: [{ id: asset.id }] });
  assert.equal(placed.state, "sent", JSON.stringify(placed));
  await fetch(url + "/seed", { method: "POST", body: JSON.stringify([{ table: "follows", row: { id: "bob-self", owner: "dev:bob", principal: "dev:bob" } }]) });
  assert.deepEqual((await bob.query(query, {})).data.find(row => row.id === placed.result.id).images, [asset]);
  await served(url, asset.id, "bob", 200);
  await served(url, asset.id, "stranger", 404);
});

for (const tier of ["native", "wasm"]) for (const copied of [false, true]) for (const ending of ["revoke", "clear", "delete"]) for (const controlled of !copied && ending === "revoke" ? [false, true] : [false]) {
  test(`${tier}: legacy ${copied ? "copied facts" : "bare id"} cannot retain bytes after real home ${ending}${controlled ? " (older sync held across revoke)" : ""}`, { timeout: 40000 }, async t => {
    const f = await fixture(t);
    const legacy = await f.bob.mutate(mutation("createPost"), { images: [] });
    assert.equal(legacy.state, "sent");
    await fetch(f.url + "/seed", { method: "POST", body: JSON.stringify([{ table: "follows", row: { id: "bob-self", owner: "dev:bob", principal: "dev:bob" } }]) });
    await f.stop();
    const db = new DatabaseSync(join(f.dir, ".snapback4/store.sqlite"));
    const row = JSON.parse(db.prepare("SELECT data FROM r WHERE id = ?").get(legacy.result.id).data);
    const real = JSON.parse(db.prepare("SELECT data FROM r WHERE id = ?").get(f.id).data);
    row.Row.images = { Array: [copied ? real.Row.images.Array[0] : { Map: { id: { Id: f.a.id } } }] };
    db.prepare("UPDATE r SET data = ? WHERE id = ?").run(JSON.stringify(row), legacy.result.id);
    db.close();
    const url = await f.start();
    const alice = createClient({ url, persona: "alice" }), bob = createClient({ url, persona: "bob" });
    f.clients.push(alice, bob);
    const response = await fetch(`${url}/assets/${f.a.id}`, { headers: { "x-snapback-persona": "bob" } });
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("access-control-expose-headers").includes("x-snapback-asset-home"));
    const store = new DatabaseSync(join(f.dir, ".snapback4/store.sqlite"), { readOnly: true });
    const storeId = store.prepare("SELECT value FROM _meta WHERE key = 'store_id'").get().value;
    store.close();
    assert.deepEqual(JSON.parse(decodeURIComponent(response.headers.get("x-snapback-asset-home"))), { store_id: storeId, table: "posts", row: f.id, column: "images" });
    await response.arrayBuffer();
    let offline = false;
    const control = syncControl(t);
    const device = tier === "native" ? processDevice({ binary, dir: join(f.dir, "device") })
      : webDevice({ wasm: readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm")), persist: memoryPersistence() });
    const options = { url, persona: "bob", device, waitSeconds: 1, assets: { keep: "viewed", maxBytes: 10000 }, fetch: (input, init) => {
      if (offline) return Promise.reject(Error("offline"));
      if (controlled && new URL(input).pathname === "/changes") return parkedChanges(init.signal);
      return control.fetch(input, init);
    } };
    let local = await createLocalClient(options); f.clients.push(local); await local.sync();
    // An actual later put for B makes the false-home overwrite deterministic.
    assert.equal((await bob.mutate(mutation("touch"), { id: legacy.result.id })).state, "sent");
    await local.sync();
    const downloaded = await local.asset(f.a.id); assert.ok("url" in downloaded, JSON.stringify(downloaded)); downloaded.revoke();
    await local.close(); offline = true;
    local = await createLocalClient(options); f.clients.push(local);
    const retained = await local.asset(f.a.id); assert.ok("url" in retained, JSON.stringify(retained));
    assert.deepEqual(Buffer.from(await (await fetch(retained.url)).arrayBuffer()), png); retained.revoke();
    let older, held;
    if (controlled) await local.sync(); // Drain the offline attempt before arming.
    offline = false;
    if (controlled) {
      held = control.hold(); older = local.sync(); await held.ready;
    }
    if (ending === "revoke") {
      // The review's exact combined mutation: lose A and touch B together.
      assert.equal((await bob.mutate(mutation("revokeAndTouch"), { id: legacy.result.id })).state, "sent");
    } else {
      const out = ending === "clear" ? await alice.mutate(mutation("edit"), { id: f.id, images: [] })
        : await alice.mutate(mutation("remove"), { id: f.id });
      assert.equal(out.state, "sent");
      assert.equal((await bob.mutate(mutation("touch"), { id: legacy.result.id })).state, "sent");
    }
    const synced = local.sync(); held?.release();
    await synced; await older;
    await served(url, f.a.id, "bob", 404);
    offline = true;
    const rows = (await local.query(query, {})).data;
    assert.ok(rows.some(r => r.id === legacy.result.id && r.images[0].id === f.a.id), "legacy reference remains readable");
    if (ending !== "clear") assert.ok(!rows.some(r => r.id === f.id), "real home is gone");
    assert.equal((await local.asset(f.a.id)).denied?.code, "E_OFFLINE");
    await local.close();
    local = await createLocalClient(options); f.clients.push(local);
    assert.equal((await local.asset(f.a.id)).denied?.code, "E_OFFLINE", "reopen cannot resurrect retired bytes");
  });
}

for (const tier of ["native", "wasm"]) for (const [placed, fromOnce] of [[false, false], [true, false], [true, true]]) test(`${tier}: a ${fromOnce ? "once " : ""}download delayed across store replacement ${placed ? "preserves the newer download" : "cannot retain legacy bytes"}, even after reopen`, { timeout: 40000 }, async t => {
  const held = Promise.withResolvers(), release = Promise.withResolvers();
  t.after(() => release.resolve());
  const f = await fixture(t, fromOnce ? source.replace("return insert posts { owner: viewer, images, secrets }", "return insert posts { owner: viewer, images: null, secrets: images }") : source);
  let url = f.url, offline = false, hold = true;
  let core;
  const device = tier === "native" ? processDevice({ binary, dir: join(f.dir, "device") })
    : webDevice({ wasm: readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm")), persist: memoryPersistence() });
  const options = { url: f.url, persona: "bob", device: { async open(...args) { core = await device.open(...args); return core; } }, waitSeconds: 1, assets: { keep: "viewed", maxBytes: 10000 }, fetch: async (input, init) => {
    if (offline) throw Error("offline");
    const response = await fetch(String(input).replace(f.url, url), init);
    if (hold && String(input).endsWith(`/assets/${f.a.id}`) && response.status === 200) {
      hold = false;
      assert.equal(response.headers.get("accept-ranges"), fromOnce ? "none" : "bytes");
      // Finish the authorized network transfer, but withhold it from the client.
      const bytes = await response.arrayBuffer();
      held.resolve(JSON.parse(decodeURIComponent(response.headers.get("x-snapback-asset-home"))));
      await release.promise;
      return new Response(bytes, { status: response.status, headers: response.headers });
    }
    return response;
  } };
  let local = await createLocalClient(options); f.clients.push(local); await local.sync();
  const state = async () => { const r = await core.call({ op: "sync_state" }); assert.ok(!r.denied, JSON.stringify(r)); return r.ok; };
  const manifest = async () => JSON.parse((await core.call({ op: "meta", key: "media:manifest" })).ok || "[]");
  const original = await state();
  const downloading = local.asset(f.a.id);
  const receipt = await held.promise;
  assert.deepEqual(receipt, { store_id: original.store_id, table: "posts", row: f.id, column: fromOnce ? "secrets" : "images" });
  await f.stop();
  const db = new DatabaseSync(join(f.dir, ".snapback4/store.sqlite"));
  const replacementId = `${original.store_id}-replacement`;
  db.prepare("UPDATE _meta SET value = ? WHERE key = 'store_id'").run(replacementId);
  if (fromOnce) {
    // B has the same id and schema generation, with X placed as ordinary media.
    const row = JSON.parse(db.prepare("SELECT data FROM r WHERE id = ?").get(f.id).data);
    row.Row.images = row.Row.secrets;
    row.Row.secrets = "Null";
    db.prepare("UPDATE r SET data = ? WHERE id = ?").run(JSON.stringify(row), f.id);
    db.prepare("UPDATE _assets SET home_column = 'images' WHERE home_id = ?").run(f.id);
  }
  if (!placed) {
    db.prepare("UPDATE _assets SET home_table = NULL, home_id = NULL, home_column = NULL WHERE id = ?").run(f.a.id);
    const row = JSON.parse(db.prepare("SELECT data FROM r WHERE id = ?").get(f.id).data);
    row.Row.images = { Array: [{ Map: { id: { Id: f.a.id } } }] };
    db.prepare("UPDATE r SET data = ? WHERE id = ?").run(JSON.stringify(row), f.id);
  }
  db.close();
  url = await f.start();
  await local.sync();
  const replacement = await state();
  assert.equal(replacement.store_id, replacementId);
  assert.equal(replacement.generation, original.generation, "generation alone cannot distinguish the stores");
  assert.equal(replacement.acquired, true);
  assert.equal(replacement.backend_required, false);
  assert.deepEqual(await manifest(), []);
  let newer;
  if (placed) {
    newer = await local.asset(f.a.id);
    assert.ok("url" in newer, JSON.stringify(newer));
    assert.equal((await manifest())[0].home.store_id, replacementId);
  } else {
    assert.deepEqual((await local.query(query, {})).data[0].images, [{ id: f.a.id }], "the replacement's legacy row was acquired");
    await served(url, f.a.id, "bob", 404);
  }
  release.resolve();
  const delivered = await downloading;
  assert.equal(delivered.denied?.code, "E_ASSET_UNKNOWN", "an old store cannot deliver a retained URL into its replacement");
  if (placed) {
    assert.deepEqual(Buffer.from(await (await fetch(newer.url)).arrayBuffer()), png, "old delivery must not revoke the new live URL");
    newer.revoke();
    assert.equal((await manifest())[0].home.store_id, replacementId);
  } else assert.deepEqual(await manifest(), [], "the old authorized delivery establishes no custody in the replacement");
  offline = true;
  const check = async () => {
    const result = await local.asset(f.a.id);
    if (placed) {
      assert.ok("url" in result, JSON.stringify(result));
      assert.deepEqual(Buffer.from(await (await fetch(result.url)).arrayBuffer()), png); result.revoke();
    } else assert.equal(result.denied?.code, "E_OFFLINE");
  };
  await check();
  await local.close();
  local = await createLocalClient(options); f.clients.push(local);
  await check();
});

for (const tier of ["native", "wasm"]) for (const ending of ["expiry", "generation"]) {
  test(`${tier}: list cache retires on ${ending} and stays retired after offline reopen`, { timeout: 40000 }, async t => {
    const f = await fixture(t);
    let url = f.url, offline = false, wall = Date.now();
    const clock = new ServerClock(() => wall);
    let core;
    const device = tier === "native" ? processDevice({ binary, dir: join(f.dir, "device") })
      : webDevice({ wasm: readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm")), persist: memoryPersistence() });
    const options = { url: f.url, persona: "bob", device: { async open(...args) { core = await device.open(...args); return core; } }, waitSeconds: 1,
      assets: { keep: "viewed", maxBytes: 10000 }, fetch: clock.wrap(async (input, init) => {
        if (offline) throw Error("offline");
        const response = await fetch(String(input).replace(f.url, url), init);
        if (offline) throw Error("offline");
        return response;
      }) };
    // Expiry is observed entirely offline after the row and bytes arrive.
    const until = Date.now() + 60_000;
    if (ending === "expiry") assert.equal((await f.alice.mutate(mutation("expire"), { id: f.id, until })).state, "sent");
    let local = await createLocalClient(options); f.clients.push(local); await local.sync();
    for (const asset of [f.a, f.b]) { const r = await local.asset(asset.id); assert.ok("url" in r, JSON.stringify(r)); r.revoke(); }
    const original = (await core.call({ op: "sync_state" })).ok;
    if (ending === "generation") {
      await f.stop();
      writeFileSync(join(f.dir, "snapback/schema.q"), source.replace("  caption: text <=80 ?", "  caption: text <=80 ?\n  added: text <=20 ?"));
      url = await f.start();
      await local.sync();
      const changed = (await core.call({ op: "sync_state" })).ok;
      assert.equal(changed.store_id, original.store_id);
      assert.ok(changed.generation > original.generation);
      assert.equal(changed.acquired, true);
    }
    offline = true;
    if (ending === "expiry") wall = until + 60_000;
    for (const asset of [f.a, f.b]) assert.equal((await local.asset(asset.id)).denied?.code, "E_OFFLINE");
    assert.deepEqual(JSON.parse((await core.call({ op: "meta", key: "media:manifest" })).ok || "[]"), []);
    await local.close();
    local = await createLocalClient(options); f.clients.push(local);
    for (const asset of [f.a, f.b]) assert.equal((await local.asset(asset.id)).denied?.code, "E_OFFLINE");
  });
}

for (const tier of ["native", "wasm"]) for (const scalar of [false, true]) {
  test(`${tier}: persisted old ${scalar ? "scalar" : "list"} media index reacquires unchanged rows once`, { timeout: 40000 }, async t => {
    const schema = scalar ? source.replaceAll("images: [image <=10000] <=4 ?", "images: image <=10000 ?") : source;
    const f = await fixture(t, schema, assets => scalar ? { id: assets[0].id } : assets.map(a => ({ id: a.id })));
    let offline = false, core, storeName, interrupt = false, terminal = false;
    const persist = memoryPersistence();
    const device = tier === "native" ? processDevice({ binary, dir: join(f.dir, "device") })
      : webDevice({ wasm: readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm")), persist });
    const pages = [];
    const options = { url: f.url, persona: "bob", device: { async open(name, backend) {
      storeName = name; core = await device.open(name, backend);
      const call = core.call.bind(core);
      // Keep the intent unsent while testing only snapshot publication/reopen.
      core.call = request => request.op === "begin_send" ? Promise.resolve({ denied: { code: "E_STORE_BUSY", family: "store", message: "test holds dispatch", retryable: true } }) : call(request);
      return core;
    } }, waitSeconds: 1,
      assets: { keep: "viewed", maxBytes: 10000 }, fetch: async (input, init) => {
        if (offline) throw Error("offline");
        if (terminal && String(input).endsWith("/sync")) {
          offline = true;
          return new Response("catch-up unavailable", { status: 503 });
        }
        const response = await fetch(input, init);
        if (String(input).endsWith("/sync")) {
          const page = await response.clone().json(); pages.push(page);
          if (interrupt && page.snapshot && !page.more) terminal = true;
        }
        return response;
      } };
    let local = await createLocalClient(options); f.clients.push(local); await local.sync();
    const before = (await core.call({ op: "sync_state", capture: false })).ok;
    assert.equal(before.acquired, true); assert.ok(before.watermark > 0);
    const rows = (await f.bob.query(query, {})).data;
    offline = true;
    const pending = await local.mutate(mutation("createPost"), { images: scalar ? null : [] }, { waitSeconds: 0 });
    assert.equal(pending.state, "pending");
    const queued = (await core.call({ op: "queued" })).ok;
    assert.equal(queued.length, 1);
    await local.close();
    // Project only media metadata to the shipped old format. All acquired rows,
    // store identity, generation, watermark and other durable state stay intact.
    const old = scalar ? JSON.stringify({ table: "posts", row: f.id, column: "images", generation: before.generation }) : null;
    if (tier === "native") {
      const db = new DatabaseSync(join(f.dir, "device", `${storeName}.sqlite`));
      db.prepare("DELETE FROM _meta WHERE key = 'device:media-index-format' OR key LIKE 'device:media-row:%'").run();
      if (old) db.prepare("INSERT OR REPLACE INTO _meta (key,value) VALUES (?,?)").run(`device:media:${f.a.id}`, old);
      db.close();
    } else {
      const saved = await persist.load(storeName);
      await persist.save(storeName, [...saved.filter(c => c.s === "m" && (c.k === "device:media-index-format" || c.k.startsWith("device:media-row:"))).map(c => ({ ...c, v: null })),
        ...(old ? [{ s: "m", k: `device:media:${f.a.id}`, v: old }] : [])]);
    }
    offline = true;
    local = await createLocalClient(options); f.clients.push(local);
    const upgrading = (await core.call({ op: "sync_state", capture: false })).ok;
    assert.equal(upgrading.acquired, false);
    assert.equal(upgrading.watermark, before.watermark);
    assert.equal(upgrading.transfer_watermark, 0);
    pages.length = 0; offline = false; interrupt = true;
    await local.sync();
    assert.equal(terminal, true, "terminal snapshot was staged before catch-up failed");
    assert.equal((await core.call({ op: "sync_state", capture: false })).ok.acquired, false);
    assert.equal(await storedMeta(tier, f.dir, persist, storeName, "device:media-index-format"), null);
    await local.close();
    local = await createLocalClient(options); f.clients.push(local);
    const resumed = (await core.call({ op: "sync_state", capture: false })).ok;
    assert.equal(resumed.acquired, false);
    assert.equal(resumed.transfer_watermark, 0, "reopen restarts the interrupted upgrade");
    assert.equal(await storedMeta(tier, f.dir, persist, storeName, "device:media-index-format"), null);
    assert.deepEqual((await core.call({ op: "queued" })).ok, queued, "same durable intent after terminal-page interruption");
    offline = false; interrupt = false; terminal = false;
    await local.sync(); await local.sync();
    assert.equal(pages.filter(p => p.snapshot).length, 2, "one interrupted snapshot, one completed upgrade, no repetition");
    const after = (await core.call({ op: "sync_state", capture: false })).ok;
    assert.equal(after.acquired, true);
    assert.equal(await storedMeta(tier, f.dir, persist, storeName, "device:media-index-format"), "1");
    for (const key of ["store_id", "generation", "watermark"]) assert.equal(after[key], before[key], `unchanged ${key}`);
    assert.deepEqual((await f.bob.query(query, {})).data, rows, "no server-side touch");
    const downloaded = await local.asset(f.a.id); assert.ok("url" in downloaded, JSON.stringify(downloaded)); downloaded.revoke();
    assert.equal(JSON.parse((await core.call({ op: "meta", key: "media:manifest" })).ok).length, 1);
    await local.close(); offline = true;
    local = await createLocalClient(options); f.clients.push(local);
    const retained = await local.asset(f.a.id); assert.ok("url" in retained, JSON.stringify(retained));
    assert.deepEqual(Buffer.from(await (await fetch(retained.url)).arrayBuffer()), png); retained.revoke();
  });
}

for (const tier of ["native", "wasm"]) test(`${tier}: nested placed elements cross inner lists and survive an empty first list offline`, { timeout: 40000 }, async t => {
  const f = await fixture(t, source.replaceAll("images: [image <=10000] <=4 ?", "images: [[image <=10000] <=2] <=2 ?"), assets => assets.map(a => [{ id: a.id }]));
  let offline = false;
  const device = tier === "native" ? processDevice({ binary, dir: join(f.dir, "device") })
    : webDevice({ wasm: readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm")), persist: memoryPersistence() });
  const options = { url: f.url, persona: "bob", device, waitSeconds: 1, assets: { keep: "viewed", maxBytes: 10000 }, fetch: (...args) => offline ? Promise.reject(Error("offline")) : fetch(...args) };
  let local = await createLocalClient(options); f.clients.push(local); await local.sync();
  assert.deepEqual((await local.query(query, {})).data[0].images, [[f.a], [f.b]], "server-placed nested facts");
  for (const a of [f.a, f.b]) { const r = await local.asset(a.id); assert.ok("url" in r, JSON.stringify(r)); r.revoke(); }
  for (const images of [[[f.b], [f.a]], [[], [f.b, f.a]]]) {
    assert.equal((await f.alice.mutate(mutation("edit"), { id: f.id, images: images.map(inner => inner.map(a => ({ id: a.id }))) })).state, "sent");
    await local.sync(); await local.close(); offline = true;
    local = await createLocalClient(options); f.clients.push(local);
    assert.deepEqual((await local.query(query, {})).data[0].images, images);
    for (const a of [f.a, f.b]) {
      const r = await local.asset(a.id); assert.ok("url" in r, JSON.stringify(r));
      assert.deepEqual(Buffer.from(await (await fetch(r.url)).arrayBuffer()), png); r.revoke();
    }
    offline = false;
  }
});

for (const tier of ["native", "wasm"]) test(`${tier}: a legacy copy in refs cannot replace the same row's released photo home`, { timeout: 40000 }, async t => {
  const schema = source.replace("  images: [image <=10000] <=4 ?", "  photo: image <=10000 ?\n  refs: [image <=10000] <=4 ?\n  images: [image <=10000] <=4 ?") + `
mutation placePhoto(photo: image <=10000):
  return insert posts { owner: viewer, photo, refs: [] }
mutation clearPhoto(id: posts):
  update posts[id] { photo: null }
`;
  const f = await fixture(t, schema);
  const asset = await f.upload();
  const placed = await f.alice.mutate(mutation("placePhoto"), { photo: { id: asset.id } });
  assert.equal(placed.state, "sent");
  await f.stop();
  const db = new DatabaseSync(join(f.dir, ".snapback4/store.sqlite"));
  const row = JSON.parse(db.prepare("SELECT data FROM r WHERE id = ?").get(placed.result.id).data);
  row.Row.refs = { Array: [row.Row.photo] };
  db.prepare("UPDATE r SET data = ? WHERE id = ?").run(JSON.stringify(row), placed.result.id);
  db.close();
  const url = await f.start(), alice = createClient({ url, persona: "alice" }); f.clients.push(alice);
  let offline = false, core;
  const device = tier === "native" ? processDevice({ binary, dir: join(f.dir, "device") })
    : webDevice({ wasm: readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm")), persist: memoryPersistence() });
  const options = { url, persona: "bob", device: { async open(...args) { core = await device.open(...args); return core; } }, waitSeconds: 1,
    assets: { keep: "viewed", maxBytes: 10000 }, fetch: (...args) => offline ? Promise.reject(Error("offline")) : fetch(...args) };
  let local = await createLocalClient(options); f.clients.push(local); await local.sync();
  const r = await local.asset(asset.id); assert.ok("url" in r, JSON.stringify(r)); r.revoke();
  assert.equal(JSON.parse((await core.call({ op: "meta", key: "media:manifest" })).ok)[0].home.column, "photo");
  await local.close(); offline = true;
  local = await createLocalClient(options); f.clients.push(local);
  const kept = await local.asset(asset.id); assert.ok("url" in kept, JSON.stringify(kept)); kept.revoke();
  offline = false;
  assert.equal((await alice.mutate(mutation("clearPhoto"), { id: placed.result.id })).state, "sent");
  await local.sync(); await served(url, asset.id, "bob", 404);
  offline = true;
  const remaining = (await local.query(query, {})).data.find(r => r.id === placed.result.id);
  assert.equal(remaining.photo, null); assert.deepEqual(remaining.refs, [asset]);
  assert.equal((await local.asset(asset.id)).denied?.code, "E_OFFLINE");
  await local.close(); local = await createLocalClient(options); f.clients.push(local);
  assert.equal((await local.asset(asset.id)).denied?.code, "E_OFFLINE");
});

for (const tier of ["native", "wasm"]) test(`${tier}: a paged upgrade restore halts follow and flush`, { timeout: 40000 }, async t => {
  const f = await fixture(t);
  let offline = false, restoring = false, allowSend = false, core, storeName, syncs = 0, sends = 0, store;
  const persist = memoryPersistence();
  const device = tier === "native" ? processDevice({ binary, dir: join(f.dir, "device") })
    : webDevice({ wasm: readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm")), persist });
  const options = { url: f.url, persona: "bob", device: { async open(name, backend) {
    storeName = name; core = await device.open(name, backend);
    const call = core.call.bind(core);
    // Prevent a send racing ahead of the restore evidence; release after refusal.
    core.call = request => request.op === "begin_send" && !allowSend ? Promise.resolve({ denied: { code: "E_STORE_BUSY", family: "store", message: "test holds dispatch", retryable: true } }) : call(request);
    return core;
  } }, waitSeconds: 1,
    fetch: async (input, init) => {
      if (offline) throw Error("offline");
      if (restoring) {
        if (String(input).endsWith("/sync")) {
          syncs++;
          assert.equal(JSON.parse(init.body).from, 0, "upgrade requests a snapshot from zero");
          return Response.json({ snapshot: true, store_id: store.store_id, generation: store.generation, watermark: 100, more: true, next: "next", events: [] });
        }
        if (String(input).includes("/m/")) sends++;
        // Only the paged snapshot may provide the restore evidence in this test.
        throw Error("no other transport during restore");
      }
      return fetch(input, init);
    } };
  let local = await createLocalClient(options); f.clients.push(local); await local.sync();
  store = (await core.call({ op: "sync_state", capture: false })).ok;
  assert.equal(store.acquired, true, "initial acquisition does not halt");
  offline = true;
  const pending = await local.mutate(mutation("createPost"), { images: [] }, { waitSeconds: 0 });
  assert.equal(pending.state, "pending");
  await local.close();
  if (tier === "native") {
    const db = new DatabaseSync(join(f.dir, "device", `${storeName}.sqlite`));
    db.prepare("UPDATE _meta SET value = '5000' WHERE key = 'device:watermark'").run();
    db.prepare("DELETE FROM _meta WHERE key = 'device:media-index-format'").run();
    db.close();
  } else {
    await persist.save(storeName, [{ s: "m", k: "device:watermark", v: "5000" }, { s: "m", k: "device:media-index-format", v: null }]);
  }
  local = await createLocalClient(options); f.clients.push(local);
  const upgrading = (await core.call({ op: "sync_state", capture: false })).ok;
  assert.equal(upgrading.watermark, 5000);
  assert.equal(upgrading.restore_watermark, 5000);
  assert.equal(upgrading.transfer_watermark, 0);
  const queued = (await core.call({ op: "queued" })).ok;
  assert.equal(queued.length, 1);
  assert.equal(queued[0].id, pending.id);
  restoring = true; offline = false;
  await local.sync();
  assert.equal((await local.query(query, {})).denied?.code, "E_STORE_RESTORE");
  assert.equal((await core.call({ op: "sync_state", capture: false })).ok.restore_refusal?.code, "E_STORE_RESTORE");
  assert.equal(syncs, 1);
  allowSend = true;
  await local.sync();
  await new Promise(r => setTimeout(r, 1400));
  assert.equal(syncs, 1, "follow and explicit sync stop after the restore refusal");
  assert.equal(sends, 0, "flush sends no queued intent to the restored server");
  assert.deepEqual((await core.call({ op: "queued" })).ok, queued);
  await local.close();
  local = await createLocalClient(options); f.clients.push(local); await local.sync();
  assert.equal((await local.query(query, {})).denied?.code, "E_STORE_RESTORE");
  assert.equal(syncs, 1, "reopen preserves the halt");
  assert.equal(sends, 0);
  assert.deepEqual((await core.call({ op: "queued" })).ok, queued);
});

// A stays open while B acquires through the same native store. The continuation
// is requested only after A captures B's staged or published progress.
for (const staged of [false, true]) for (const terminal of [false, true]) test(`native: initial acquisition rejects an overtaken ${terminal ? "terminal" : "nonterminal"} snapshot continuation after B ${staged ? "stages" : "publishes"}`, { timeout: 40000 }, async t => {
  const f = await fixture(t);
  const device = processDevice({ binary, dir: join(f.dir, "shared-device") });
  let core, overtaken = false, continuation, observed, published, advanced, offline = false;
  const options = { url: f.url, persona: "bob", waitSeconds: 1,
    device: { async open(name, backend) {
      core = await device.open(name, backend);
      return { ...core, async call(request) {
        const answer = await core.call(request);
        if (request.op === "observe_store" && request.page.after && request.page.watermark < advanced) {
          continuation = request.page;
          observed = answer;
        }
        if (request.op === "apply" && request.page.snapshot && request.page.more && !overtaken) {
          assert.ok(answer.ok, JSON.stringify(answer));
          overtaken = true;
          assert.equal(request.page.watermark, 2);
          assert.equal((await f.alice.mutate(mutation("touch"), { id: f.id })).state, "sent");
          const b = await device.open(name);
          try {
            const reply = await fetch(f.url + "/sync", { method: "POST", headers: { "x-snapback-persona": "bob" }, body: JSON.stringify({ from: 0, limit: 100 }) });
            const page = await reply.json();
            assert.equal(page.snapshot, true); assert.equal(page.more, false);
            assert.equal(page.watermark, request.page.watermark + 1);
            assert.ok((await b.call({ op: "apply", first: true, page: { ...page, stage_snapshot: staged } })).ok);
            const state = (await b.call({ op: "sync_state", capture: false })).ok;
            assert.equal(state.acquired, !staged);
            published = state.watermark;
            advanced = page.watermark;
            assert.equal(advanced, 3);
            assert.equal(published, staged ? 0 : advanced);
            assert.equal(state.restore_watermark, advanced);
            if (staged) assert.equal(state.restore_images_at, advanced);
          } finally { await b.close(); }
        }
        return answer;
      } };
    } },
    async fetch(input, init) {
      if (offline) throw Error("offline");
      if (String(input).endsWith("/sync")) {
        const body = JSON.parse(init.body);
        // One row starts A's snapshot; vary whether its continuation finishes.
        if (!overtaken) body.limit = 1;
        else if (body.after) body.limit = terminal ? 100 : 1;
        return fetch(input, { ...init, body: JSON.stringify(body) });
      }
      return fetch(input, init);
    },
  };
  const local = await createLocalClient(options); f.clients.push(local);
  await local.sync();
  assert.equal(overtaken, true);
  assert.ok(continuation, "A requested its old continuation after B advanced");
  assert.equal(continuation.more, !terminal);
  assert.equal(continuation.requested_watermark, 0);
  assert.equal(continuation.captured_watermark, published);
  assert.equal(continuation.captured_restore_watermark, advanced);
  if (staged) assert.equal(continuation.captured_restore_images_at, advanced);
  assert.equal(continuation.watermark, advanced - 1);
  assert.equal(observed.denied?.code, "E_GENERATION");
  await local.sync();
  const state = (await core.call({ op: "sync_state", capture: false })).ok;
  assert.equal(state.restore_refusal, undefined);
  assert.equal(state.backend_required, false, "the open owner adopts the published identity");
  assert.equal(state.acquired, true);
  offline = true;
  assert.equal((await local.query(query, {})).data?.[0].caption, "touched", "the still-open owner answers offline");
  await local.close();
  const reopened = await createLocalClient(options); f.clients.push(reopened);
  assert.equal((await reopened.query(query, {})).data[0].caption, "touched");
  assert.equal((await core.call({ op: "sync_state", capture: false })).ok.restore_refusal, undefined);
});

// @ref LLP 3000.029#4 — asset-only clients follow revocation without a query mounted.
for (const ending of ["membership", "deletion", "expiry", "sign-out"]) test(`live online asset handle withdraws on ${ending}`, { timeout: 30000 }, async t => {
  const f = await fixture(t, source.replace("delete <- .principal = viewer", "delete <- allow"));
  if (ending === "expiry") assert.equal((await f.alice.mutate(mutation("expire"), { id: f.id, until: Date.now() + 1500 })).state, "sent");
  const handle = await f.bob.asset(f.a.id);
  assert.ok("url" in handle, JSON.stringify(handle));
  assert.ok(handle.url);
  if (ending === "membership") assert.equal((await f.alice.mutate(mutation("revokeAndTouch"), { id: f.id })).state, "sent");
  if (ending === "deletion") assert.equal((await f.alice.mutate(mutation("remove"), { id: f.id })).state, "sent");
  if (ending === "sign-out") await f.bob.signOut();
  const end = Date.now() + 6000;
  while (handle.url && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(handle.url, "", "no copied URL survives received revocation or its original deadline");
  handle.revoke();
});

for (const tier of ["online", "wasm"]) test(`${tier}: a rule change withdraws a displayed row and asset before its held replacement`, { timeout: 30000 }, async t => {
  const gate = Promise.withResolvers();
  t.after(() => gate.resolve());
  const f = await fixture(t);
  let url = f.url, hold = false, polls = 0;
  const wait = async check => {
    const end = Date.now() + 10000;
    while (!check()) { assert.ok(Date.now() < end, "rule-change observation did not settle"); await new Promise(r => setTimeout(r, 5)); }
  };
  const opener = webDevice({ wasm: readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm")), persist: memoryPersistence() });
  const options = { url: f.url, persona: "bob", waitSeconds: 1, device: { async open(...args) {
    const core = await opener.open(...args);
    return { ...core, async call(request, notify) { if (hold && request.op === "query") await gate.promise; return core.call(request, notify); } };
  } }, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (hold && path === "/q/posts") await gate.promise;
    const response = await fetch(String(input).replace(f.url, url), init);
    if (path === "/changes") polls++;
    return response;
  } };
  const client = tier === "online" ? createClient(options) : await createLocalClient(options);
  f.clients.push(client);
  if (client.sync) await client.sync();
  const watch = client.observe(query, {});
  await wait(() => watch.getSnapshot().data?.length && polls);
  const asset = await client.asset(f.a.id);
  assert.ok("url" in asset, JSON.stringify(asset));
  hold = true;
  await f.stop();
  writeFileSync(join(f.dir, "snapback/schema.q"), source.replace("read <- exists follows[.owner, viewer]", "read <- .owner = viewer").replace("sync to follows[.owner] by .principal", "sync to .owner"));
  url = await f.start();
  if (client.sync) await client.sync();
  await wait(() => !("data" in watch.getSnapshot()) && asset.url === "");
  gate.resolve();
  await wait(() => Array.isArray(watch.getSnapshot().data) && watch.getSnapshot().data.length === 0);
  assert.equal(asset.url, "");
  watch.close(); asset.revoke();
});

test("an asset's readable rule witness expires offline at its original deadline", { timeout: 10000 }, async t => {
  const schema = source.replace("  read <- allow\n  insert <- deny", "  immutable owner, principal\n  until: time ?\n  expire at .until\n  read <- allow\n  update <- allow\n  insert <- deny") + `
mutation expireFollow(until: time):
  update follows['bob'] { until }
`;
  const f = await fixture(t, schema);
  const until = Date.now() + 1500;
  assert.equal((await f.alice.mutate(mutation("expireFollow"), { until })).state, "sent");
  const bob = createClient({ url: f.url, persona: "bob", fetch: (input, init) =>
    new URL(input).pathname === "/changes" ? parkedChanges(init.signal) : fetch(input, init) });
  f.clients.push(bob);
  const read = await bob.asset(f.a.id);
  assert.ok("url" in read, JSON.stringify(read));
  await new Promise(resolve => setTimeout(resolve, Math.max(0, until - Date.now()) + 20));
  assert.equal(read.url, "", "membership expiry is a grant deadline even without a change feed response");
  read.revoke();
});
