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
async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "sb4-asset-lists-"));
  mkdirSync(join(dir, "snapback")); writeFileSync(join(dir, "snapback/schema.q"), source);
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
  const placed = await alice.mutate(mutation("createPost"), { images: [{ id: a.id }, { id: b.id }] });
  assert.equal(placed.state, "sent", JSON.stringify(placed));
  return { dir, url, clients, alice, bob, a, b, id: placed.result.id, upload, start, stop };
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

for (const tier of ["native", "wasm"]) for (const copied of [false, true]) for (const ending of ["revoke", "clear", "delete"]) {
  test(`${tier}: legacy ${copied ? "copied facts" : "bare id"} cannot retain bytes after real home ${ending}`, { timeout: 40000 }, async t => {
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
    const device = tier === "native" ? processDevice({ binary, dir: join(f.dir, "device") })
      : webDevice({ wasm: readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm")), persist: memoryPersistence() });
    const options = { url, persona: "bob", device, waitSeconds: 1, assets: { keep: "viewed", maxBytes: 10000 }, fetch: (...args) => offline ? Promise.reject(Error("offline")) : fetch(...args) };
    let local = await createLocalClient(options); f.clients.push(local); await local.sync();
    // An actual later put for B makes the false-home overwrite deterministic.
    assert.equal((await bob.mutate(mutation("touch"), { id: legacy.result.id })).state, "sent");
    await local.sync();
    const downloaded = await local.asset(f.a.id); assert.ok("url" in downloaded, JSON.stringify(downloaded)); downloaded.revoke();
    await local.close(); offline = true;
    local = await createLocalClient(options); f.clients.push(local);
    const retained = await local.asset(f.a.id); assert.ok("url" in retained, JSON.stringify(retained));
    assert.deepEqual(Buffer.from(await (await fetch(retained.url)).arrayBuffer()), png); retained.revoke();
    offline = false;
    if (ending === "revoke") {
      // The review's exact combined mutation: lose A and touch B together.
      assert.equal((await bob.mutate(mutation("revokeAndTouch"), { id: legacy.result.id })).state, "sent");
    } else {
      const out = ending === "clear" ? await alice.mutate(mutation("edit"), { id: f.id, images: [] })
        : await alice.mutate(mutation("remove"), { id: f.id });
      assert.equal(out.state, "sent");
      assert.equal((await bob.mutate(mutation("touch"), { id: legacy.result.id })).state, "sent");
    }
    await local.sync();
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

for (const tier of ["native", "wasm"]) test(`${tier}: a download delayed across store replacement cannot retain legacy bytes, even after reopen`, { timeout: 40000 }, async t => {
  const held = Promise.withResolvers(), release = Promise.withResolvers();
  t.after(() => release.resolve());
  const f = await fixture(t);
  let url = f.url, offline = false;
  let core;
  const device = tier === "native" ? processDevice({ binary, dir: join(f.dir, "device") })
    : webDevice({ wasm: readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm")), persist: memoryPersistence() });
  const options = { url: f.url, persona: "bob", device: { async open(...args) { core = await device.open(...args); return core; } }, waitSeconds: 1, assets: { keep: "viewed", maxBytes: 10000 }, fetch: async (input, init) => {
    if (offline) throw Error("offline");
    const response = await fetch(String(input).replace(f.url, url), init);
    if (String(input).endsWith(`/assets/${f.a.id}`) && response.status === 200) {
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
  assert.deepEqual(receipt, { store_id: original.store_id, table: "posts", row: f.id, column: "images" });
  await f.stop();
  const db = new DatabaseSync(join(f.dir, ".snapback4/store.sqlite"));
  const replacementId = `${original.store_id}-replacement`;
  db.prepare("UPDATE _meta SET value = ? WHERE key = 'store_id'").run(replacementId);
  db.prepare("UPDATE _assets SET home_table = NULL, home_id = NULL, home_column = NULL WHERE id = ?").run(f.a.id);
  const row = JSON.parse(db.prepare("SELECT data FROM r WHERE id = ?").get(f.id).data);
  row.Row.images = { Array: [{ Map: { id: { Id: f.a.id } } }] };
  db.prepare("UPDATE r SET data = ? WHERE id = ?").run(JSON.stringify(row), f.id);
  db.close();
  url = await f.start();
  await local.sync();
  const replacement = await state();
  assert.equal(replacement.store_id, replacementId);
  assert.equal(replacement.generation, original.generation, "generation alone cannot distinguish the stores");
  assert.equal(replacement.acquired, true);
  assert.equal(replacement.backend_required, false);
  assert.deepEqual(await manifest(), []);
  assert.deepEqual((await local.query(query, {})).data[0].images, [{ id: f.a.id }], "the replacement's legacy row was acquired");
  await served(url, f.a.id, "bob", 404);
  release.resolve();
  const delivered = await downloading;
  assert.ok("url" in delivered, JSON.stringify(delivered));
  assert.deepEqual(Buffer.from(await (await fetch(delivered.url)).arrayBuffer()), png); delivered.revoke();
  assert.deepEqual(await manifest(), [], "the old authorized delivery establishes no custody in the replacement");
  offline = true;
  assert.equal((await local.asset(f.a.id)).denied?.code, "E_OFFLINE");
  await local.close();
  local = await createLocalClient(options); f.clients.push(local);
  assert.equal((await local.asset(f.a.id)).denied?.code, "E_OFFLINE", "reopen cannot resurrect the old store's bytes");
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
