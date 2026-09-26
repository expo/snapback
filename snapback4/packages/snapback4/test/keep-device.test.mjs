// LLP 3000.019 §3.3 revision 4: the application explicitly opts into stale presentation.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "../dist/client.js";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";
import { memoryPersistence, webDevice } from "../dist/web.js";

const binary = process.env.SNAPBACK4_BIN ?? resolve(import.meta.dirname, "../../../target/debug/snapback4");
const wasm = readFileSync(new URL("../src/wasm/snapback4_device_bg.wasm", import.meta.url));
const query = { kind: "query", name: "secret" };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(check, message) {
  for (let n = 0; n < 1000; n++) { if (check()) return; await delay(10); }
  assert.fail(message);
}
const source = `use personas alice, bob
table members:
  room: text <=40
  principal: principal
  unique room, principal
  immutable room, principal
  read <- exists members[.room, viewer]
  delete <- exists members[.room, viewer]
  sync to members[.room]
table secrets:
  room: text <=40
  body: text
  update <- allow
  read <- exists members[.room, viewer]
  sync to members[.room]
query secret():
  return secrets['private']
query second():
  return secrets['private']
query required():
  return secrets['private'] ! else HIDDEN
mutation edit(body: text):
  update secrets['private'] { body }
mutation leave():
  delete members[room = 'room', principal = viewer]
mutation kick():
  delete members[room = 'room', principal = 'dev:bob']
`;

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "sb4-answer-withdrawal-"));
  mkdirSync(join(directory, "snapback"));
  writeFileSync(join(directory, "snapback/schema.q"), source);
  const host = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  const exit = once(host, "exit");
  let log = "";
  host.stdout.on("data", b => { log += b; }); host.stderr.on("data", b => { log += b; });
  t.after(async () => { host.kill("SIGTERM"); await exit; rmSync(directory, { recursive: true, force: true }); });
  await until(() => { assert.equal(host.exitCode, null, log); return /http:\/\/127\.0\.0\.1:\d+/.test(log); }, "server did not listen");
  const url = log.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  const post = async (path, body) => (await fetch(url + path, { method: "POST", headers: { "x-snapback-persona": "alice" }, body: JSON.stringify(body) })).json();
  assert.equal((await post("/seed", [
    ...["alice", "bob"].map(person => ({ table: "members", row: { id: person, room: "room", principal: `dev:${person}` } })),
    { table: "secrets", row: { id: "private", room: "room", body: "private answer" } },
  ])).seeded, 3);
  return { directory, url, post, kick: () => post("/m/kick", { id: "kick-bob", args: {} }) };
}

for (const tier of ["wasm", "process"]) for (const change of ["apply", "admit", "settle", "revoke", "leave", "refusal"]) {
  test(`${tier}: keep across ${change} publishes no loading and replaces the old answer`, { timeout: 30_000 }, async t => {
    const { directory, url, post, kick } = await fixture(t);
    const opener = tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ dir: join(directory, "device"), binary });
    const readOp = change === "refusal" ? { ...query, name: "required" } : query;
    const held = deferred(), atCommit = deferred();
    let armed = false, blocking = false, snapshot, commitTime, captured, core, watch, plain;
    const target = (change === "revoke" || change === "refusal") ? "apply" : change === "leave" ? "admit" : change;
    const device = { async open(...args) {
      core = await opener.open(...args);
      return { ...core, async call(request, committed) {
        if (blocking && request.op === "query" && request.name === readOp.name) await held.promise;
        const result = await core.call(request);
        committed?.(result);
        if (armed && request.op === target && !result.denied && !captured) {
          captured = { ...request, result };
          blocking = true;
          snapshot = watch.getSnapshot();
          commitTime = Date.now();
          atCommit.resolve();
        }
        return result;
      } };
    } };
    const client = await createLocalClient({ url, persona: "bob", device, waitSeconds: 1 });
    t.after(async () => { held.resolve(); watch?.close(); plain?.close(); await client.close(); });
    await client.sync();
    watch = client.observe(readOp, {}, { keep: true });
    plain = client.observe(readOp, {});
    await until(() => watch.getSnapshot().data?.body === "private answer" && plain.getSnapshot().data?.body === "private answer", "initial answers");
    const values = [];
    watch.subscribe(() => values.push(watch.getSnapshot()));
    armed = true;
    const operation = change === "apply" ? post("/m/edit", { id: "remote-edit", args: { body: "next answer" } })
      : (change === "revoke" || change === "refusal") ? kick()
      : client.mutate({ kind: "mutation", name: change === "leave" ? "leave" : "edit" }, change === "leave" ? {} : { body: "next answer" });
    await atCommit.promise;
    assert.ok("data" in snapshot, JSON.stringify(snapshot));
    assert.equal(snapshot.fresh, false);
    assert.ok(snapshot.since <= commitTime, "retention carries the prior answer's wall time");
    assert.equal(plain.getSnapshot().loading, true, "a keep subscriber cannot change the default watch");
    if (change === "revoke" || change === "leave") {
      assert.equal(snapshot.data.body, "private answer", "explicit keep accepts the withdrawn row until the re-read");
      if (change === "revoke") assert.equal((await core.call({ op: "query", name: "secret", args: {}, viewer: "dev:bob", now: Date.now() })).ok.data, null, "the actual device has already revoked the row");
    }
    if (change === "leave") assert.ok(captured.result.ok.predicted.includes("members/bob"));
    blocking = false; held.resolve();
    assert.equal((await operation).state, "sent");
    await until(() => change === "refusal" ? watch.getSnapshot().denied?.code === "HIDDEN" : change === "revoke" || change === "leave" ? watch.getSnapshot().data === null : watch.getSnapshot().data?.body === "next answer", "replacement answer");
    assert.ok(values.length > 0);
    const beforeReplacement = change === "refusal" ? values.slice(0, values.findIndex(read => "denied" in read) + 1) : values;
    assert.ok(beforeReplacement.every(read => !("loading" in read)), JSON.stringify(values));
  });
}

for (const tier of ["wasm", "process", "online"]) test(`${tier}: keep remount lifetime, isolation, last subscriber and sign-out`, { timeout: 30_000 }, async t => {
  const { directory, url } = await fixture(t);
  const held = deferred(); let holding = false, requests = 0;
  const opener = tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ dir: join(directory, "device"), binary });
  const device = { async open(...args) {
    const core = await opener.open(...args);
    return { ...core, async call(request, committed) {
      if (request.op === "query") { requests++; if (holding) await held.promise; }
      return core.call(request, committed);
    } };
  } };
  const options = { url, persona: "bob", device, fetch: async (url, init) => {
    if (new URL(url).pathname.startsWith("/q/")) { requests++; if (holding) await held.promise; }
    return fetch(url, init);
  } };
  const client = tier === "online" ? createClient(options) : await createLocalClient(options);
  t.after(async () => { held.resolve(); await client.close(); });
  let watch = client.observe(query, {}, { keep: true });
  const stop = watch.subscribe(() => {}), sibling = client.observe(query, {}, { keep: true });
  const stopSibling = sibling.subscribe(() => {});
  await until(() => watch.getSnapshot().data?.body === "private answer", "initial answer");
  const sinceBefore = Date.now();
  stop(); watch.close();
  assert.equal(sibling.getSnapshot().data.body, "private answer", "one subscriber leaving does not close the shared watch");
  stopSibling(); // No close(): the last unsubscribe begins the keep window.
  holding = true;
  const before = requests;
  watch = client.observe(query, {}, { keep: true });
  assert.equal(watch.getSnapshot().data?.body, "private answer");
  assert.equal(watch.getSnapshot().fresh, false);
  assert.ok(watch.getSnapshot().since <= sinceBefore);
  await until(() => requests > before, "remount rereads immediately");
  for (const [op, args, options] of [[query, {}, undefined], [query, { other: true }, { keep: true }], [{ ...query, name: "different" }, {}, { keep: true }]]) {
    const other = client.observe(op, args, options);
    assert.deepEqual(other.getSnapshot(), { loading: true }, "option, operation and arguments isolate keys");
    other.close();
  }
  watch.close();
  const wall = Date.now();
  const now = t.mock.method(Date, "now", () => wall + 29_999);
  watch = client.observe(query, {}, { keep: true });
  assert.ok("data" in watch.getSnapshot(), "before the 30-second boundary");
  now.mock.restore(); watch.close();
  const expiredAt = Date.now();
  t.mock.method(Date, "now", () => expiredAt + 30_000);
  watch = client.observe(query, {}, { keep: true });
  assert.deepEqual(watch.getSnapshot(), { loading: true }, "at 30 seconds memory has expired");
  t.mock.restoreAll(); watch.close();
  holding = false; held.resolve();
  watch = client.observe(query, {}, { keep: true });
  await until(() => watch.getSnapshot().data?.body === "private answer", "new answer");
  const idle = client.observe({ ...query, name: "second" }, {}, { keep: true });
  await until(() => idle.getSnapshot().data?.body === "private answer", "second key ready");
  idle.close();
  const ending = client.signOut();
  assert.ok(!("data" in watch.getSnapshot()), "sign-out synchronously drops the active answer");
  const after = client.observe({ ...query, name: "second" }, {}, { keep: true });
  assert.ok(!("data" in after.getSnapshot()), "sign-out drops idle answers too");
  await ending;
});

for (const tier of ["wasm", "process"]) test(`${tier}: keep never publishes an evaluation captured before a newer commit`, async t => {
  const { directory, url, post } = await fixture(t);
  const opener = tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ dir: join(directory, "device"), binary });
  const held = deferred(); let hold = false, captured = false;
  const client = await createLocalClient({ url, persona: "bob", device: { async open(...args) {
    const core = await opener.open(...args);
    return { ...core, async call(request, committed) {
      const reply = await core.call(request); committed?.(reply);
      if (hold && request.op === "query" && reply.ok?.data?.body === "obsolete") { captured = true; await held.promise; }
      return reply;
    } };
  } } });
  t.after(async () => { held.resolve(); await client.close(); });
  const watch = client.observe(query, {}, { keep: true }), values = [];
  await until(() => watch.getSnapshot().data?.body === "private answer", "first answer");
  watch.subscribe(() => values.push(watch.getSnapshot()));
  hold = true;
  await post("/m/edit", { id: "edit-one", args: { body: "obsolete" } }); await client.sync();
  await until(() => captured, "old evaluation captured");
  await post("/m/edit", { id: "edit-two", args: { body: "current" } }); await client.sync();
  assert.equal(watch.getSnapshot().data.body, "private answer");
  hold = false; held.resolve();
  await until(() => watch.getSnapshot().data?.body === "current", "current evaluation");
  assert.ok(values.every(read => read.data?.body !== "obsolete" && !("loading" in read)), JSON.stringify(values));
});
