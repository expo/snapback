// Caller IDs across independent owners and the bounded device receipt window.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, mintId } from "../dist/client.js";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";
import { memoryPersistence, webDevice } from "../dist/web.js";

const binary = process.env.SNAPBACK4_BIN ?? new URL("../../../target/debug/snapback4", import.meta.url).pathname;
const wasm = readFileSync(new URL("../src/wasm/snapback4_device_bg.wasm", import.meta.url));
const op = name => ({ kind: "mutation", name });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(check) {
  const end = Date.now() + 15000;
  do { const value = await check(); if (value) return value; await new Promise(r => setTimeout(r, 20)); } while (Date.now() < end);
  throw new Error("timed out waiting for write");
}
const source = `use personas alice, bob
table records:
  n: int
  public 'write identity witness'
  insert <- allow
  delete <- allow
  sync public
mutation record(n: int):
  return insert records { n }
mutation explicit(row: records, n: int):
  return insert records { id: row, n }
mutation guarded():
  require exists records['gate'] else LOCKED
  insert records { n: 7 }
mutation shut():
  delete records['gate']
mutation answer(n: int):
  return n
query records():
  return records[] first 100 by byId
`;
async function fixture(t, tier) {
  const dir = mkdtempSync(join(tmpdir(), "sb4-write-ids-"));
  mkdirSync(join(dir, "snapback")); writeFileSync(join(dir, "snapback/schema.q"), source);
  const server = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(server, "exit"); let log = "", url;
  for (const stream of [server.stdout, server.stderr]) stream.on("data", chunk => { log += chunk; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
  const clients = [], cores = [], posts = [], replies = [], shared = new Map();
  let offline = false, held, ordered = false;
  const firstAdmission = deferred();
  t.after(async () => { held?.resolve(); firstAdmission.resolve(); for (const client of clients) await client.close(); for (const held of shared.values()) await held.core.close(); server.kill(); await exited; rmSync(dir, { recursive: true, force: true }); });
  await until(() => { if (server.exitCode != null) throw new Error(log); return url; });
  const native = processDevice({ dir: join(dir, "devices"), binary });
  const web = webDevice({ wasm, persist: memoryPersistence() });
  const device = { async open(name, backend) {
    // Memory has one synchronous transaction owner. Two native-shaped clients
    // share its serialized host, as two native processes share SQLite.
    let core;
    if (tier === "memory") {
      let held = shared.get(name);
      if (!held) { held = { core: await web.open(name, backend), owners: 0 }; shared.set(name, held); }
      held.owners++; core = held.core;
    } else core = await native.open(name, backend);
    const index = cores.length; cores.push(core); let closed = false;
    return { async call(request) {
      if (ordered && request.op === "admit" && index === 1) await firstAdmission.promise;
      const answer = await core.call(request);
      if (request.op === "admit" && index === 0) firstAdmission.resolve();
      return answer;
    }, async close() {
      if (closed) return; closed = true;
      if (tier !== "memory") return core.close();
      const held = shared.get(name);
      if (--held.owners === 0) { shared.delete(name); await core.close(); }
    } };
  } };
  const transport = async (input, init) => {
    if (offline) throw new TypeError("offline");
    if (!String(input).includes("/m/")) return fetch(input, init);
    posts.push({ path: new URL(input).pathname, ...JSON.parse(init.body) });
    await held?.promise;
    const response = await fetch(input, init); replies.push(await response.clone().json()); return response;
  };
  const open = async (persona = "alice") => {
    const options = { url, persona, fetch: transport, waitSeconds: 1 };
    const client = tier === "online" ? createClient(options) : await createLocalClient({ ...options, device });
    clients.push(client); if (tier !== "online" && !offline) await client.sync(); return client;
  };
  return { url, dir, open, cores, posts, replies, clients,
    offline: value => { offline = value; }, order: () => { ordered = true; }, hold: () => { held = deferred(); return held.resolve; },
    rows: async () => (await fetch(url + "/q/records", { method: "POST", headers: { "x-snapback-persona": "alice" }, body: '{"args":{}}' }).then(r => r.json())).data,
  };
}

for (const tier of ["memory", "native"]) {
  for (const equal of [true, false]) for (const sending of [false, true]) {
    test(`W6R1 A ${tier}: already-open owners ${equal ? "equal" : "conflicting"} input, ${sending ? "in-flight send" : "offline"}`, async t => {
      const f = await fixture(t, tier), first = await f.open(), second = await f.open(), id = mintId();
      f.order(); f.offline(true); await first.sync(); await second.sync();
      const events = []; second.onWrite(write => events.push(write));
      let release;
      if (sending) { f.offline(false); release = f.hold(); }
      const a = first.mutate(op("record"), { n: 1 }, { id });
      if (sending) await until(() => f.posts.length === 1);
      const b = second.mutate(op("record"), { n: equal ? 1 : 2 }, { id });
      if (!equal) {
        const overlapping = second.mutate(op("record"), { n: 2 }, { id });
        for (const refused of await Promise.all([b, overlapping])) assert.equal(refused.why?.code, "E_WRITE_ID_REUSE", JSON.stringify(refused));
        assert.equal(events.length, 0);
      }
      else assert.equal((await b).state, "pending");
      const queue = (await f.cores[0].call({ op: "queued" })).ok;
      assert.equal(queue.length, 1); assert.equal(queue[0].args.n, 1);
      const read = await second.query({ kind: "query", name: "records" }, {});
      assert.equal(read.data.length, 1, "duplicate admission must leave exactly the original prediction");
      assert.equal(read.data[0].id, queue[0].new_ids[0]); assert.equal(read.data[0].n, 1);
      assert.equal((await second.write(id)).state, "pending", "conflict cannot replace the durable outcome");
      assert.equal((await second.mutate(op("record"), { n: 1 }, { id })).state, "pending", "the losing owner can recover the original input");
      release?.(); f.offline(false); await first.sync(); await second.sync();
      await Promise.all([a, b]);
      await until(async () => (await first.write(id))?.state === "sent");
      await until(async () => (await second.write(id))?.state === "sent");
      assert.equal((await f.rows()).length, 1); assert.equal((await f.rows())[0].n, 1);
      assert.ok(f.posts.every(p => p.args.n === 1));
      t.diagnostic(`store=${tier} predictions=1 queued=1 applied=1 conflicting_events=0`);
    });
  }
  for (const guarded of [false, true]) test(`W6R1 B ${tier}: evicted ${guarded ? "changed guard" : "explicit row"} outcome reaches server replay`, { timeout: 120000 }, async t => {
    const f = await fixture(t, tier), client = await f.open(), id = mintId();
    if (guarded) assert.equal((await client.mutate(op("explicit"), { row: "gate", n: 0 })).state, "sent");
    const name = guarded ? "guarded" : "explicit", args = guarded ? {} : { row: "R", n: 1 };
    const first = await client.mutate(op(name), args, { id }); assert.equal(first.state, "sent");
    if (guarded) assert.equal((await client.mutate(op("shut"), {})).state, "sent");
    for (let n = 0; n < 256; n++) assert.equal((await client.mutate(op("answer"), { n })).state, "sent");
    assert.equal(await client.write(id), undefined); await client.close();
    const reopened = await f.open(); f.offline(true); await reopened.sync();
    const queued = await reopened.mutate(op(name), args, { id });
    t.diagnostic(`before_or_after_retry=${JSON.stringify(queued)}`);
    assert.equal(queued.state, "pending", "local refusal must leave an unknown caller ID replayable");
    const durable = (await f.cores.at(-1).call({ op: "queued" })).ok;
    assert.equal(durable.length, 1); assert.deepEqual(durable[0].predicted, []); assert.equal(durable[0].predictable, false);
    const count = f.posts.length; f.offline(false); await reopened.sync();
    await until(async () => (await reopened.write(id))?.state === "sent");
    assert.deepEqual(await reopened.write(id), { state: "sent", id, seq: first.seq, replayed: true });
    assert.equal(f.posts.length - count, 1); assert.equal((await f.rows()).length, 1);
    const refused = await reopened.mutate(op(name), args, { id: mintId() });
    assert.equal(refused.state, "failed"); assert.equal(refused.why.code, guarded ? "LOCKED" : "E_CONSTRAINT");
    t.diagnostic(`store=${tier} evicting_writes=256 replay_posts=1 duplicate_rows=0`);
  });
}

for (const tier of ["online", "memory", "native"]) test(`W6R1 principals ${tier}: one caller ID is independent per principal`, async t => {
  const f = await fixture(t, tier), alice = await f.open(), bob = await f.open("bob"), id = mintId();
  const a = await alice.mutate(op("record"), { n: 1 }, { id });
  const b = await bob.mutate(op("record"), { n: 2 }, { id });
  assert.equal(a.state, "sent"); assert.equal(b.state, "sent"); assert.notEqual(a.seq, b.seq);
  assert.deepEqual((await f.rows()).map(r => r.n).sort(), [1, 2]);
  for (const [client, n, seq] of [[alice, 1, a.seq], [bob, 2, b.seq]]) assert.deepEqual(await client.mutate(op("record"), { n }, { id }), { state: "sent", id, seq, replayed: true });
  assert.equal(f.posts.length, 2); t.diagnostic(`tier=${tier} principals=2 applications=2 posts=2`);
});

for (const ended of ["closed", "signed-out"]) test(`W6R1 online ${ended}: retrying a sent ID cannot emit a contradictory failure`, async t => {
  const events = [], posts = [], id = mintId();
  const client = createClient({ url: "https://write-id.invalid", persona: "alice", fetch: async (url, init) => {
    if (String(url).includes("/m/")) { posts.push(JSON.parse(init.body)); return Response.json({ state: "sent", seq: 1, result: 7 }); }
    if (ended === "signed-out") return Response.json({ denied: { code: "E_AUTH", family: "auth", message: "expired" } });
    return Response.json({ ok: true, seq: 1 });
  } });
  t.after(() => client.close()); client.onWrite(write => events.push(write));
  assert.equal((await client.mutate(op("record"), { n: 7 }, { id })).state, "sent");
  if (ended === "closed") await client.close(); else { await client.query({ kind: "query", name: "records" }, {}); assert.equal(client.link(), "signed-out"); }
  const retry = await client.mutate(op("record"), { n: 7 }, { id });
  assert.equal(retry.state, "failed"); assert.equal(retry.why.code, ended === "closed" ? "E_CLOSED" : "E_AUTH");
  assert.equal(events.length, 1, "an unavailable call cannot overwrite or emit a second terminal outcome for a sent write");
  assert.equal(events[0].state, "sent"); assert.equal(posts.length, 1);
});

test("server write ids bind raw arguments and operation names across independent clients", async t => {
  const f = await fixture(t, "online");
  const post = async (name, id, args) => fetch(`${f.url}/m/${name}`, {
    method: "POST", headers: { "x-snapback-persona": "alice", "content-type": "application/json" },
    body: JSON.stringify({ id, args }),
  }).then(response => response.json());
  const id = mintId();
  const first = await post("explicit", id, { row: "stable", n: 7 });
  assert.equal(first.state, "sent");
  const replay = await post("explicit", id, { n: 7, row: "stable" });
  assert.deepEqual(replay, { state: "sent", id, seq: first.seq, replayed: true });
  for (const [name, args] of [["explicit", { row: "stable", n: 8 }], ["answer", { n: 7 }], ["removed", {}]]) {
    const reused = await post(name, id, args);
    assert.equal(reused.state, "failed"); assert.equal(reused.why.code, "E_ID_REUSED");
    assert.equal(reused.why.family, "input"); assert.equal(reused.result, undefined);
  }
  assert.equal((await f.rows()).length, 1);
  // The server compares raw wire input, even when a decoder would erase it.
  const raw = mintId();
  assert.equal((await post("answer", raw, { n: 1 })).state, "sent");
  assert.equal((await post("answer", raw, { n: "1" })).why.code, "E_ID_REUSED");
});
