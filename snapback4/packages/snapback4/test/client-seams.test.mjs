// Lane C's client/dev seams against the real HTTP host and process device.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, mintId } from "../dist/client.js";
import { createLocalClient } from "../dist/local.js";
import { createApp } from "../dist/app.js";
import { processDevice } from "../dist/native.js";
import { guest, signup, login, memorySessionStore } from "../dist/auth.js";
import { mintSession } from "../dist/worker.js";
import { memoryPersistence, webDevice } from "../dist/web.js";

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
table receipts:
  n: int
  read <- allow
  insert <- allow
  sync public
mutation record(n: int):
  return insert receipts { n }
query receipts():
  return receipts[] first 100 by byId
mutation answerNull():
  return null
mutation answer(n: int):
  return { n: n }
mutation answerPair(a: int, b: int):
  return { a, b }
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
async function fixture(t, release = false, schema = source) {
  const dir = mkdtempSync(join(tmpdir(), "sb4-seams-"));
  mkdirSync(join(dir, "snapback")); mkdirSync(join(dir, "devices"));
  writeFileSync(join(dir, "snapback/schema.q"), schema);
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
  const web = webDevice({ wasm: readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm")), persist: memoryPersistence() });
  return { dir, url, device, web, cores, clients, post, log: () => log };
}

const meterSource = `use personas alice
use identity
table records:
  owner: principal
  n: int
  by byOwner: owner, id
  read <- .owner = viewer
  insert <- .owner = viewer
mutation put(n: int):
  return insert records { owner: viewer, n }
query rows():
  return { principal: viewer, rows: records[viewer] first 10 by byOwner }
`;

for (const release of [false, true]) test(`W7c ${release ? "serve ignores" : "dev exposes"} meters by default and explicitly for a real account`, async t => {
  const f = await fixture(t, release, meterSource);
  const status = await fetch(`${f.url}/dev/status`);
  assert.equal(status.status, release ? 403 : 200);
  if (!release) {
    const health = await status.json();
    assert.equal(typeof health.storeId, "string"); assert.equal(health.generation, 1);
    const foreign = await fetch(`${f.url}/dev/status`, { headers: { origin: "https://example.com" } });
    assert.equal(foreign.status, 403);
  }
  const registered = await signup(f.url, "meter@example.com", "password-123");
  assert.equal(registered.ok, true, JSON.stringify(registered));
  const session = registered.session, replies = [];
  const client = createClient({ url: f.url, session, meter: true, fetch: async (url, init) => {
    const response = await fetch(url, init);
    if (String(url).includes("/q/")) replies.push({ headers: init.headers, body: await response.clone().json() });
    return response;
  } });
  f.clients.push(client);
  assert.equal((await client.mutate(mutation("put"), { n: 7 })).state, "sent");
  const op = { kind: "query", name: "rows" };
  const read = await client.query(op, {});
  assert.equal(read.data.principal, session.principal);
  assert.equal(read.data.rows.length, 1); assert.equal(read.data.rows[0].n, 7);
  assert.equal(read.complete, true); assert.equal(read.fresh, true);
  assert.equal(replies[0].headers["x-snapback-meter"], "1");
  if (release) {
    assert.equal(Object.hasOwn(read, "meter"), false);
    assert.equal(Object.hasOwn(replies[0].body, "meter"), false);
  } else {
    assert.deepEqual(read.meter, replies[0].body.meter);
    for (const field of ["examined", "indexEntries", "probes", "steps", "heapBytes", "outputBytes", "rowsWritten"]) assert.equal(typeof read.meter?.[field], "number", field);
    assert.ok(read.meter.examined > 0); assert.ok(read.meter.heapBytes > 0);
    const cli = spawnSync(binary, ["run", "rows", "--as", session.principal, "--json"], { cwd: f.dir, encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
    const result = JSON.parse(cli.stdout), m = result.metered;
    assert.deepEqual(result.data, read.data);
    assert.deepEqual(read.meter, { examined: m.examined, indexEntries: m.index_entries, probes: m.rule_probes, steps: m.steps, heapBytes: m.heap_bytes, outputBytes: m.output_bytes, rowsWritten: m.rows_written, cut: null });
    const watch = client.observe(op, {});
    await until(() => watch.getSnapshot().data);
    assert.deepEqual(watch.getSnapshot().meter, read.meter); watch.close();
    t.diagnostic(`meter=${JSON.stringify(read.meter)}`);
  }
  const plain = createClient({ url: f.url, session }); f.clients.push(plain);
  assert.equal(Object.hasOwn(await plain.query(op, {}), "meter"), !release);
  for (const value of [undefined, "0", "1"]) {
    const response = await fetch(`${f.url}/q/rows`, { method: "POST", headers: { authorization: `Bearer ${session.token}`, ...(value === undefined ? {} : { "x-snapback-meter": value }) }, body: JSON.stringify({ args: {} }) });
    const body = await response.json();
    assert.deepEqual(body.data, read.data);
    assert.equal(Object.hasOwn(body, "meter"), !release);
  }
  const denied = await (await fetch(`${f.url}/q/rows`, { method: "POST", headers: { "x-snapback-meter": "1" }, body: "{}" })).json();
  assert.equal(denied.denied.code, "E_AUTH"); assert.equal(Object.hasOwn(denied, "meter"), false);
  const preflight = await fetch(`${f.url}/q/rows`, { method: "OPTIONS", headers: { origin: "http://localhost:5173", "access-control-request-headers": "x-snapback-meter" } });
  assert.ok(preflight.headers.get("access-control-allow-headers").includes("x-snapback-meter"));
});

for (const tier of ["online", "web", "native"]) {
  async function callerFixture(t) {
    const f = await fixture(t);
    let offline = false, drop = false;
    const attempts = [], replies = [];
    const open = async () => {
      const options = { url: f.url, persona: "alice", waitSeconds: 1, fetch: async (input, init) => {
        if (offline) throw new TypeError("offline");
        if (!String(input).includes("/m/")) return fetch(input, init);
        attempts.push({ path: new URL(input).pathname, ...JSON.parse(init.body) });
        const response = await fetch(input, init);
        replies.push(await response.clone().json());
        if (drop) { drop = false; throw new TypeError("committed acknowledgement lost"); }
        return response;
      } };
      const client = tier === "online" ? createClient(options) : await createLocalClient({ ...options, device: tier === "web" ? f.web : f.device });
      f.clients.push(client);
      if (!offline && tier !== "online") await client.sync();
      return client;
    };
    return { ...f, open, attempts, replies, offline: value => { offline = value; }, drop: () => { drop = true; } };
  }

  test(`W6d ${tier}: caller id retries share pending writes and retained receipts`, async t => {
    const f = await callerFixture(t), client = await f.open(), id = mintId();
    f.offline(true);
    if (tier === "online") await client.query({ kind: "query", name: "receipts" }, {});
    else await client.sync();
    const events = []; client.onWrite(write => events.push(write));
    const args = { n: 43 };
    const [first, concurrent] = await Promise.all([
      client.mutate(mutation("record"), args, { id }), client.mutate(mutation("record"), { n: 43 }, { id }),
    ]);
    assert.equal(first.id, id); assert.equal(first.state, "pending");
    assert.strictEqual(concurrent, first, "a concurrent admission returns the same Write object");
    assert.strictEqual(await client.mutate(mutation("record"), { n: 43 }, { id }), first);
    args.n = 99;
    for (const [op, changed] of [["record", { n: 44 }], ["answer", { n: 43 }]]) {
      const refused = await client.mutate(mutation(op), changed, { id });
      assert.equal(refused.state, "failed"); assert.equal(refused.why.code, "E_WRITE_ID_REUSE");
      assert.equal((await client.write(id)).state, "pending", "a conflicting retry cannot replace the original outcome");
    }
    f.offline(false);
    if (tier !== "online") await client.sync();
    const sent = await until(() => events.find(write => write.id === id && write.state === "sent"));
    const receipt = { state: "sent", id, seq: sent.seq, replayed: true };
    assert.deepEqual(await client.mutate(mutation("record"), { n: 43 }, { id }), receipt);
    assert.deepEqual(await client.write(id), receipt);
    assert.equal((await client.mutate(mutation("record"), { n: 44 }, { id })).why.code, "E_WRITE_ID_REUSE");
    assert.equal(f.attempts.length, 1); assert.equal(f.attempts[0].id, id);
    const rows = (await f.post("/q/receipts", { args: {} })).data;
    assert.equal(rows.length, 1); assert.equal(rows[0].n, 43); assert.notEqual(rows[0].id, id);
    if (tier !== "online") assert.ok(f.attempts[0].newIds.includes(rows[0].id), "prediction row ids remain separate from the write id");
    assert.equal(events.filter(write => write.id === id).length, 1);
    t.diagnostic(`tier=${tier} posts=1 applied=1 terminal_events=1`);
  });

  test(`W6d ${tier}: malformed caller ids fail locally`, async t => {
    const f = await callerFixture(t), client = await f.open();
    for (const id of ["", "fixture-1", "0".repeat(25), "0".repeat(27), "8" + "0".repeat(25), "0".repeat(25) + "I", "0".repeat(25) + "a", null, 42]) {
      const write = await client.mutate(mutation("record"), { n: 1 }, { id });
      assert.equal(write.state, "failed", JSON.stringify(write)); assert.equal(write.why.code, "E_WRITE_ID");
      assert.equal(typeof write.id, "string", "even an untyped JavaScript caller receives a Write-shaped refusal");
    }
    assert.equal(f.attempts.length, 0);
    const valid = await client.mutate(mutation("record"), { n: 1 }, { id: "7" + "Z".repeat(25) });
    assert.equal(valid.state, "sent"); assert.equal(f.attempts.length, 1);
  });

  test(`W6d ${tier}: input key order is immaterial and an evicted receipt never readmits on the same client`, { timeout: 60000 }, async t => {
    const f = await callerFixture(t), client = await f.open(), id = mintId();
    const first = await client.mutate(mutation("answerPair"), { a: 1, b: 2 }, { id });
    assert.equal(first.state, "sent");
    const receipt = { state: "sent", id, seq: first.seq, replayed: true };
    assert.deepEqual(await client.mutate(mutation("answerPair"), { b: 2, a: 1 }, { id }), receipt);
    assert.equal(f.attempts.length, 1);
    for (let n = 0; n < 256; n++) assert.equal((await client.mutate(mutation("answer"), { n })).state, "sent");
    assert.equal(await client.write(id), undefined);
    const expired = await client.mutate(mutation("answerPair"), { a: 1, b: 2 }, { id });
    assert.equal(expired.state, "failed"); assert.equal(expired.why.code, "E_WRITE_RECEIPT_EXPIRED");
    assert.equal(f.attempts.length, 257, "receipt eviction does not enqueue a known id again");
    await client.close(); const reopened = await f.open();
    assert.deepEqual(await reopened.mutate(mutation("answerPair"), { a: 1, b: 2 }, { id }), receipt);
    assert.equal(f.attempts.length, 258, "without retained local evidence the server's original outcome wins");
    t.diagnostic(`tier=${tier} retained_receipts=256 known_id_readmissions=0 server_recovery_posts=1`);
  });

  test(`W6d ${tier}: two client POSTs with the caller id apply once after a lost reply`, async t => {
    const f = await callerFixture(t), client = await f.open(), id = mintId();
    f.drop();
    const first = await client.mutate(mutation("record"), { n: 7 }, { id });
    assert.equal(first.id, id);
    await client.mutate(mutation("record"), { n: 7 }, { id });
    await until(async () => (await client.write(id))?.state === "sent");
    assert.equal(f.attempts.length, 2); assert.deepEqual(f.attempts[1], f.attempts[0]);
    const receipt = { state: "sent", id, seq: f.replies[0].seq, replayed: true };
    assert.deepEqual(f.replies[1], { ...receipt, store_id: f.replies[0].store_id, head: f.replies[0].seq }); assert.deepEqual(await client.write(id), receipt);
    assert.equal((await f.post("/q/receipts", { args: {} })).data.length, 1);
    // A new client recovers the original receipt by resending the same input.
    await client.close(); const reopened = await f.open();
    assert.deepEqual(await reopened.mutate(mutation("record"), { n: 7 }, { id }), receipt);
    assert.equal(f.attempts.length, tier === "online" ? 3 : 2);
    t.diagnostic(`tier=${tier} retry_posts=2 applied=1 historical_results=0`);
  });

  if (tier !== "online") test(`W6d ${tier}: reopen deduplicates the queued caller id before prediction`, async t => {
    const f = await callerFixture(t), client = await f.open(), id = mintId();
    f.offline(true); await client.sync();
    assert.equal((await client.mutate(mutation("record"), { n: 8 }, { id })).state, "pending");
    await client.close(); const reopened = await f.open();
    const first = await reopened.mutate(mutation("record"), { n: 8 }, { id });
    assert.equal(first.id, id); assert.equal(first.state, "pending");
    assert.strictEqual(await reopened.mutate(mutation("record"), { n: 8 }, { id }), first);
    assert.equal((await reopened.mutate(mutation("record"), { n: 9 }, { id })).why.code, "E_WRITE_ID_REUSE");
    const predicted = await reopened.query({ kind: "query", name: "receipts" }, {});
    assert.equal(predicted.data.length, 1); assert.equal(predicted.data[0].pending, true);
    f.offline(false); await reopened.sync();
    await until(async () => (await reopened.write(id))?.state === "sent");
    assert.equal(f.attempts.length, 1);
    assert.equal((await f.post("/q/receipts", { args: {} })).data.length, 1);
    t.diagnostic(`tier=${tier} reopened_queued=1 predictions=1 posts=1 applied=1`);
  });
}

for (const transport of ["HTTP", "client"]) test(`W6b password character minimum and byte maximum through ${transport}`, { timeout: 60000 }, async t => {
  const f = await fixture(t, true, "use identity password\n");
  const signIn = async (route, email, password) => {
    if (transport === "client") return (route === "signup" ? signup : login)(f.url, email, password);
    const result = await f.post(`/auth/${route}`, { email, password }, false);
    return result.session ? { ok: true, session: result.session } : { ok: false, why: result.denied };
  };
  for (const [n, letter] of ["é", "😀", "a"].entries()) {
    const email = `unicode-${n}@example.com`;
    const short = await signIn("signup", email, letter.repeat(7));
    assert.equal(short.ok, false, `${transport}: seven ${letter} characters must be refused`);
    assert.equal(short.why.code, "E_AUTH");
    assert.equal(short.why.message, "E_AUTH: a password needs at least 8 characters");
    const accepted = await signIn("signup", email, letter.repeat(8));
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    assert.equal(accepted.session.kind, "user");
    const signedIn = await signIn("login", email, letter.repeat(8));
    assert.equal(signedIn.ok, true, JSON.stringify(signedIn));
    assert.equal(signedIn.session.principal, accepted.session.principal);
  }
  const two = await signIn("signup", "two@example.com", "😀😀");
  assert.equal(two.ok, false);
  assert.equal(two.why.code, "E_AUTH");
  const maximum = "é".repeat(512);
  const accepted = await signIn("signup", "maximum@example.com", maximum);
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.equal((await signIn("login", "maximum@example.com", maximum)).session?.principal, accepted.session.principal);
  for (const route of ["signup", "login"]) {
    const oversized = await signIn(route, "maximum@example.com", maximum + "a");
    assert.equal(oversized.ok, false);
    assert.equal(oversized.why.code, "E_AUTH");
    assert.equal(oversized.why.message, "E_AUTH: a password is at most 1024 UTF-8 bytes");
  }
  t.diagnostic(`${transport}: 7 characters refused at 7/14/28 bytes; 8 accepted at 8/16/32 bytes; 2 characters / 8 bytes refused; 512 characters / 1024 bytes accepted; 1025 bytes refused`);
});

test("W6b identity forms advertise and enforce the guest choice", { timeout: 60000 }, async t => {
  for (const [form, guests, password] of [["use identity", true, true], ["use identity guests", true, false], ["use identity password", false, true]]) {
    const f = await fixture(t, true, `${form}\n`);
    const config = await (await fetch(f.url + "/auth/config")).json();
    assert.deepEqual(config, { guests, password });
    const visitor = await guest(f.url);
    assert.equal(visitor.ok, guests, JSON.stringify(visitor));
    if (guests) assert.equal(visitor.session.kind, "guest");
    else {
      assert.equal(visitor.why.code, "E_AUTH");
      assert.equal(visitor.why.message, "E_AUTH: this identity method is not enabled in schema.q");
    }
    const registered = await signup(f.url, "person@example.com", "é".repeat(8));
    assert.equal(registered.ok, password, JSON.stringify(registered));
    if (password) assert.equal(registered.session.kind, "user");
    else assert.equal(registered.why.code, "E_AUTH");
  }
});

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

for (const tier of ["online", "process-device"]) for (const queued of [false, true]) {
  test(`${tier}: ${queued ? "queued" : "immediate"} lost first acknowledgement preserves the same-id replay receipt`, { timeout: 15000 }, async t => {
    const f = await fixture(t);
    let offline = false, dropped = false;
    const attempts = [], replies = [];
    const transport = async (input, init) => {
      if (offline) throw new TypeError("offline");
      // Exercise the HTTP replay receipt deterministically. Acquisition is
      // temporarily unavailable until that reply arrives; otherwise sync can
      // acknowledge the id first and correctly avoid the second POST.
      if (String(input).endsWith("/sync") && dropped && replies.length < 2) return Response.json({}, { status: 503 });
      if (!String(input).endsWith("/m/record")) return fetch(input, init);
      attempts.push(JSON.parse(init.body));
      const response = await fetch(input, init);
      const reply = await response.clone().json();
      replies.push(reply);
      if (!dropped) { dropped = true; throw new TypeError("first committed acknowledgement lost"); }
      return response;
    };
    const options = { url: f.url, persona: "alice", waitSeconds: 1, fetch: transport };
    const client = tier === "online" ? createClient(options) : await createLocalClient({ ...options, device: f.device });
    f.clients.push(client);
    const terminal = []; client.onWrite(write => terminal.push(write));
    const fresh = await client.mutate(mutation("answer"), { n: 41 });
    assert.deepEqual(fresh, { state: "sent", id: fresh.id, seq: fresh.seq, result: { n: 41 } });
    const nil = await client.mutate(mutation("answerNull"), {});
    assert.deepEqual(nil, { state: "sent", id: nil.id, seq: nil.seq, result: null });
    if (queued) {
      offline = true;
      if (tier === "online") await client.query({ kind: "query", name: "receipts" }, {});
      else await client.sync();
      assert.equal(client.link(), "offline");
    }
    const initial = await client.mutate(mutation("record"), { n: 43 });
    if (queued) assert.equal(initial.state, "pending");
    offline = false;
    if (tier !== "online") await client.sync();
    const final = await until(() => terminal.find(write => write.id === initial.id));
    assert.deepEqual(replies[0].result.n, 43);
    assert.equal(replies[0].replayed, undefined);
    const receipt = { state: "sent", id: initial.id, seq: replies[0].seq, replayed: true };
    assert.deepEqual(replies[1], { ...receipt, store_id: replies[0].store_id, head: replies[0].seq }, "the real HTTP server withholds historical values");
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[1], attempts[0], "retry preserves id, arguments and predicted ids");
    const rows = await f.post("/q/receipts", { args: {} });
    assert.equal(rows.data.length, 1, "the dropped response does not duplicate the write");
    t.diagnostic(`wire=${JSON.stringify(replies[1])}; client=${JSON.stringify(final)}; result key=${Object.hasOwn(final, "result")}`);
    assert.deepEqual(final, receipt, "the client preserves replay identity without a result property");
    if (initial.state === "sent") assert.deepEqual(initial, receipt, "mutate returns the replay outcome intact");
    assert.equal(terminal.filter(write => write.id === initial.id).length, 1);
  });
}

test("write types require replay narrowing through mutate, onWrite and useMutation", () => {
  const dir = mkdtempSync(join(tmpdir(), "sb4-write-types-"));
  const packageRoot = join(root, "packages/snapback4");
  const require = createRequire(join(packageRoot, "package.json"));
  try {
    const fixture = join(dir, "write.ts");
    writeFileSync(fixture, `
import type { Client, Mutation, Write } from ${JSON.stringify(join(packageRoot, "dist/contract.js"))};
import { useMutation } from ${JSON.stringify(join(packageRoot, "dist/react.js"))};
type Value = { n: number };
declare const client: Client;
declare const op: Mutation<{}, Value>;
const identified: Promise<Write<Value>> = client.mutate(op, {}, { id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" });
// @ts-expect-error a caller id must be a string
client.mutate(op, {}, { id: 42 });
function inspect(write: Write<Value>) {
  if (write.state === "pending") {
    // @ts-expect-error pending is not a predicted result
    write.result;
  }
  if (write.state === "sent") {
    // @ts-expect-error sent alone no longer promises a result
    const value: Value = write.result;
    if (write.replayed) {
      const absent: undefined = write.result;
      // @ts-expect-error replay cannot supply a historical value
      const value: Value = write.result;
    } else {
      const value: Value = write.result;
    }
  }
}
const fresh: Write<Value> = { state: "sent", id: "fresh", seq: 1, result: { n: 1 } };
const explicitFresh: Write<Value> = { state: "sent", id: "fresh", seq: 1, replayed: false, result: { n: 1 } };
const replay: Write<Value> = { state: "sent", id: "replay", seq: 1, replayed: true };
const nil: Write<null> = { state: "sent", id: "nil", seq: 1, result: null };
// @ts-expect-error fresh sent must have its result
const missing: Write<Value> = { state: "sent", id: "missing", seq: 1 };
// @ts-expect-error a replay cannot also claim a result
const historical: Write<Value> = { state: "sent", id: "old", seq: 1, replayed: true, result: { n: 1 } };
async function returned() { inspect(await client.mutate(op, {})); }
client.onWrite(write => {
  if (write.state === "sent" && write.replayed) {
    const absent: undefined = write.result;
  }
});
function hook() {
  const mutation = useMutation(op);
  mutation.run({}).then(inspect);
  if (mutation.last) inspect(mutation.last);
}
`);
    const check = spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"), "--noEmit", "--strict", "--exactOptionalPropertyTypes", "--skipLibCheck", "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "Bundler", "--jsx", "react-jsx", fixture], { cwd: packageRoot, encoding: "utf8" });
    assert.equal(check.status, 0, check.stdout + check.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const [keep, maxBytes] of [["viewed", png.length], ["viewed", png.length - 1], ["none", png.length]]) test(`createApp forwards asset retention (${keep}, ${maxBytes} bytes) through a real offline reopen`, { timeout: 20_000 }, async t => {
  const f = await fixture(t), sessionStore = memorySessionStore();
  let offline = false, assetRequests = 0;
  const options = { url: f.url, device: f.device, sessionStore, assets: { keep, maxBytes }, fetch: (input, init) => {
    if (new URL(input).pathname.startsWith("/assets/")) assetRequests++;
    if (offline) throw Error("offline");
    return fetch(input, init);
  } };
  let app = createApp(options); f.clients.push(app);
  await app.ready; assert.equal((await app.auth.guest()).ok, true);
  const viewer = app.auth.viewer;
  const uploaded = await app.client.upload(png); assert.equal(uploaded.ok, true);
  const placed = await app.mutate(mutation("attach"), { photo: { id: uploaded.asset.id }, until: null });
  assert.equal(placed.state, "sent");
  await app.client.sync(); assert.equal(app.client.acquired, true);
  const viewed = await app.client.asset(uploaded.asset.id);
  assert.ok("url" in viewed, JSON.stringify(viewed)); viewed.revoke();
  await app.close(); offline = true;
  app = createApp(options); f.clients.push(app);
  assert.equal((await app.ready).ok, true);
  assert.equal(app.auth.viewer, viewer); assert.equal(app.client.link(), "offline");
  const requests = assetRequests;
  const retained = await app.client.asset(uploaded.asset.id);
  if (keep === "viewed" && maxBytes >= png.length) {
    assert.ok("url" in retained, JSON.stringify(retained));
    try { assert.deepEqual(Buffer.from(await (await fetch(retained.url)).arrayBuffer()), png); }
    finally { retained.revoke(); }
  } else assert.equal(retained.denied?.code, "E_OFFLINE", "the configured policy and byte limit still bound retention");
  assert.equal(assetRequests, requests, "offline reads use retained bytes without an asset request");
});

test("createApp forwards local waitSeconds while retaining app-owned identity", { timeout: 15_000 }, async t => {
  const f = await fixture(t), waits = [];
  const options = { url: f.url, device: f.device, sessionStore: memorySessionStore(), waitSeconds: 30,
    // Excess properties from an untyped caller must not bypass app.auth.
    persona: "bob", guest: true, session: { principal: "dev:bob", token: "untrusted", kind: "user", expiresAt: Date.now() + 86400000 },
    fetch: (input, init) => {
      const url = new URL(input);
      if (url.pathname === "/changes") waits.push(url.searchParams.get("wait"));
      return fetch(input, init);
    },
  };
  let app = createApp(options);
  f.clients.push(app);
  await app.ready; assert.equal(app.auth.state, "signed-out");
  const signedIn = await app.auth.guest(); assert.equal(signedIn.ok, true);
  assert.equal(app.client.viewer(), signedIn.session.principal);
  const sent = await app.mutate(mutation("record"), { n: 1 }); assert.equal(sent.state, "sent");
  await until(() => waits.length > 0);
  assert.ok(waits.every(wait => wait === "30"), JSON.stringify(waits));
  await app.close();
  app = createApp(options); f.clients.push(app);
  assert.equal((await app.ready).ok, true);
  assert.equal(app.client.viewer(), signedIn.session.principal);
  waits.length = 0;
  assert.equal((await app.mutate(mutation("record"), { n: 2 })).state, "sent");
  await until(() => waits.length > 0);
  assert.ok(waits.every(wait => wait === "30"), JSON.stringify(waits));
});

test("online createApp ignores settings that apply only with a device", { timeout: 15_000 }, async t => {
  const f = await fixture(t);
  const app = createApp({ url: f.url, sessionStore: memorySessionStore(),
    get assets() { throw Error("online must not read the local asset policy"); },
    get waitSeconds() { throw Error("online must not read local polling configuration"); },
  });
  f.clients.push(app);
  assert.equal((await app.ready).ok, true);
  assert.equal((await app.auth.guest()).ok, true);
  assert.equal((await app.mutate(mutation("record"), { n: 2 })).state, "sent");
  assert.equal((await app.client.query({ kind: "query", name: "receipts" }, {})).data[0].n, 2);
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


for (const release of [false, true]) test(`W7r1 hidden versus absent non-uniform reads under ${release ? "serve" : "dev"}`, async t => {
  const schema = `use identity
 table records:
   owner: principal
   read <- .owner = viewer
   insert <- allow
 table padding:
   public 'equal commit count'
   insert <- allow
 mutation seed(hidden: bool):
   if hidden:
     insert records {id: 'hidden', owner: 'somebody-else'}
   else:
     insert padding {id: 'padding'}
   return null
 query scan():
   return records first 10 by byId
 `.replace(/^ /gm, "");
  const observations = [];
  for (const hidden of [false, true]) {
    const f = await fixture(t, release, schema);
    const token = spawnSync(binary, ["token", "--service", "meter", ...(release ? ["--release", join(f.dir, "release")] : [])], { cwd: f.dir, encoding: "utf8" });
    assert.equal(token.status, 0, token.stderr);
    const session = await mintSession(f.url, token.stdout.trim(), "member:viewer");
    const headers = { authorization: `Bearer ${session.token}` };
    const write = await (await fetch(`${f.url}/m/seed`, { method: "POST", headers, body: JSON.stringify({ args: { hidden } }) })).json();
    assert.equal(write.state, "sent", JSON.stringify(write));
    const query = async meter => (await fetch(`${f.url}/q/scan`, { method: "POST", headers: { ...headers, ...(meter ? { "x-snapback-meter": "1" } : {}) }, body: '{"args":{}}' })).json();
    const opted = await query(true), plain = await query(false);
    assert.match(write.store_id, /^[0-9a-f]{32}$/);
    assert.equal(opted.store_id, write.store_id); assert.equal(plain.store_id, write.store_id);
    assert.deepEqual(plain.data, []); assert.equal(plain.complete, false);
    assert.equal(Object.hasOwn(plain, "meter"), !release);
    assert.equal(Object.hasOwn(opted, "meter"), !release);
    for (const key of ["metered", "capped_at", "cappedAt"]) { assert.equal(Object.hasOwn(opted, key), false); }
    observations.push({ opted, plain });
  }
  // Each fixture has its own random store identity; every answer above must
  // identify its seed's store. Compare the remaining observable fields.
  const withoutMeter = ({ meter, store_id, ...rest }) => rest;
  assert.deepEqual(withoutMeter(observations[0].plain), withoutMeter(observations[1].plain));
  if (release) assert.deepEqual(withoutMeter(observations[0].opted), withoutMeter(observations[1].opted));
  else {
    const [absent, hidden] = observations.map(x => x.opted.meter);
    assert.ok(hidden.examined > absent.examined);
    assert.notDeepEqual(hidden, absent);
    assert.deepEqual(observations.map(x => withoutMeter(x.opted)), observations.map(x => withoutMeter(x.plain)));
    t.diagnostic(`absent=${JSON.stringify(absent)} hidden=${JSON.stringify(hidden)}`);
  }
});

const cutSource = `use personas alice
use identity
table entries:
  room: text <=10
  body: text <=100
  at: time
  by byRoomTime: room, at, id
  by byRoomWords: room, words(body), at, id
  public 'cut fixture'
  sync public
table privateWords:
  owner: principal
  body: text <=100
  at: time
  by byOwner: owner, id
  by byWords: words(body), at, id
  read <- .owner = viewer
  sync to .owner
query wordCut(q: text <=100, c: cursor ?):
  return privateWords matching q after c last 10 by byWords
query search(room: text <=10, q: text <=100, c: cursor ?):
  return entries[room] matching q after c last 10 by byRoomWords
query filtered(c: cursor ?):
  return entries['normal'] after c last 10 by byRoomTime where .body = 'absent'
`;

for (const release of [false, true]) test(`W8R1a ${release ? "serve" : "dev"} withholds hidden population cuts`, { timeout: 60000 }, async t => {
  const schema = `use identity
table records:
  owner: principal
  body: text <=100
  by byWords: words(body), id
  read <- .owner = viewer
  insert <- allow
  online only
table padding:
  public 'equal commit count'
  insert <- allow
  online only
mutation seed(hidden: bool, count: int, body: text <=100):
  for i in range(0, count):
    if hidden:
      insert records { owner: 'somebody-else', body }
    else:
      insert padding {}
query scan():
  return records first 10 by byId
query search():
  return records matching 'cof' first 10 by byWords
`;
  const worlds = [];
  for (const hidden of [false, true]) {
    const f = await fixture(t, release, schema);
    const token = spawnSync(binary, ["token", "--service", "meter", ...(release ? ["--release", join(f.dir, "release")] : [])], { cwd: f.dir, encoding: "utf8" });
    assert.equal(token.status, 0, token.stderr);
    const session = await mintSession(f.url, token.stdout.trim(), "member:viewer");
    const headers = { authorization: `Bearer ${session.token}`, "x-snapback-meter": "1" };
    let identity;
    const seed = async (count, body) => {
      const response = await (await fetch(`${f.url}/m/seed`, { method: "POST", headers, body: JSON.stringify({ args: { hidden, count, body } }) })).json();
      assert.equal(response.state, "sent", JSON.stringify(response));
      assert.match(response.store_id, /^[0-9a-f]{32}$/);
      identity ??= response.store_id;
      assert.equal(response.store_id, identity);
    };
    const observed = [];
    const read = async (name, reason) => {
      const page = await (await fetch(`${f.url}/q/${name}`, { method: "POST", headers, body: '{"args":{}}' })).json();
      assert.deepEqual(page.data, []); assert.equal(page.complete, false); assert.equal(page.next, null);
      assert.equal(page.cut, null, JSON.stringify(page));
      if (release) assert.equal(Object.hasOwn(page, "meter"), false);
      else assert.equal(page.meter.cut, hidden ? reason : null);
      const { meter, store_id, ...production } = page;
      assert.equal(store_id, identity); // Only the independently minted fixture identity differs.
      observed.push(production);
    };
    for (let n = 0; n < 32; n++) await seed(1, `cof${n}`);
    await read("search", null);
    await seed(1, "cof32"); await read("search", "words");
    for (let left = 8193 - 33; left > 0; left -= 1000) await seed(Math.min(left, 1000), "coffee");
    await read("scan", "meter");
    worlds.push(observed);
  }
  assert.deepEqual(worlds[0], worlds[1], "all production fields, including cut, viewer and equal commit counts");
  t.diagnostic("hidden words=32,33 hidden rows=8193 identical full-response pairs=3");
});

for (const tier of ["online", "native", "web"]) test(`W8R1a ${tier} server-run observations retain nothing during a replacing fetch`, { timeout: 30000 }, async t => {
  const f = await fixture(t, false, cutSource.replace("  sync public", "  online only").replace("  sync to .owner", "  online only") + "\nmutation pulse(): server\n  return null\n");
  const seeds = Array.from({ length: 8233 }, (_, n) => ({ table: "entries", row: { id: `r${n}`, room: n < 8200 ? "normal" : "words", body: n < 8200 ? "coffee" : `cof${n}`, at: n } }));
  seeds.push(...Array.from({ length: 33 }, (_, n) => ({ table: "privateWords", row: { id: `p${n}`, owner: "dev:alice", body: `cof${n}`, at: n } })));
  for (let n = 0; n < seeds.length; n += 1000) await f.post("/seed", seeds.slice(n, n + 1000));
  let offline = false, hold = false, release;
  const gate = new Promise(resolve => { release = resolve; });
  const options = { url: f.url, persona: "alice", waitSeconds: 1, fetch: async (url, init) => {
    if (offline) throw Error("offline");
    if (hold && String(url).includes("/q/")) await Promise.race([gate, new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Error("closed")), { once: true }))]);
    return fetch(url, init);
  } };
  const client = tier === "online" ? createClient(options) : await createLocalClient({ ...options, device: tier === "native" ? f.device : f.web });
  f.clients.push(client);
  if (tier !== "online") await client.sync();
  const watches = [["filtered", {}, "meter", false], ["search", { room: "words", q: "cof" }, null, true], ["wordCut", { q: "cof" }, null, false]].map(([name, args, cut, complete]) => ({ watch: client.observe({ kind: "query", name }, args), cut, complete }));
  t.after(() => watches.forEach(({ watch }) => watch.close()));
  for (const { watch, cut } of watches) await until(() => watch.getSnapshot().cut === cut && watch.getSnapshot().fresh);
  const before = watches.map(({ watch }) => watch.getSnapshot());
  assert.ok(before[1].next, "the full uniform page continues past 32 words");
  assert.equal(before[2].next, null, "the nonuniform discovery cut has no continuation");
  hold = true;
  assert.equal((await client.mutate(mutation("pulse"), {})).state, "sent");
  await until(() => watches.every(({ watch }) => watch.getSnapshot().loading));
  hold = false; release();
  await until(() => watches.every(({ watch }) => watch.getSnapshot().fresh));
  offline = true;
  if (tier === "online") await client.query({ kind: "query", name: "filtered" }, {});
  else await client.sync();
  await until(() => watches.every(({ watch }) => watch.getSnapshot().loading));
});

for (const tier of ["online", "native", "web"]) test(`W8a ${tier} uniform words continue while nonuniform words and meter cuts remain bounded`, { timeout: 30000 }, async t => {
  const source = tier === "online" ? cutSource : cutSource.replaceAll("c: cursor ?):", "c: cursor ?) held:");
  const f = await fixture(t, false, source);
  const seeds = Array.from({ length: 8233 }, (_, n) => ({ table: "entries", row: { id: `r${String(n).padStart(5, "0")}`, room: n < 8200 ? "normal" : "words", body: n < 8200 ? "coffee" : `cof${n}`, at: n } }));
  seeds.push(...Array.from({ length: 33 }, (_, n) => ({ table: "privateWords", row: { id: `p${n}`, owner: "dev:alice", body: `cof${n}`, at: n } })));
  for (let n = 0; n < seeds.length; n += 1000) assert.equal((await f.post("/seed", seeds.slice(n, n + 1000))).seeded, Math.min(1000, seeds.length - n));
  let offline = false;
  const requests = [];
  const gated = (url, init) => { if (String(url).includes("/q/")) requests.push(url); return offline ? Promise.reject(new Error("offline")) : fetch(url, init); };
  const wire = [];
  const inspect = async (url, init) => {
    const response = await fetch(url, init);
    if (String(url).includes("/q/")) wire.push(await response.clone().json());
    return response;
  };
  const client = tier === "online" ? createClient({ url: f.url, persona: "alice", fetch: inspect }) : await createLocalClient({ url: f.url, persona: "alice", fetch: gated, device: tier === "native" ? f.device : f.web, waitSeconds: 1 });
  f.clients.push(client);
  if (tier !== "online") await client.sync();
  const read = (name, args) => client.query({ kind: "query", name }, args);
  const meter = await read("filtered", {});
  assert.deepEqual(meter.data, []);
  assert.equal(meter.complete, false);
  assert.equal(meter.cut, "meter");
  const words = await read("search", { room: "words", q: "cof" });
  assert.equal(words.cut, null);
  assert.equal(words.complete, true);
  assert.equal(words.data.length, 10);
  assert.ok(words.next);
  const nonuniform = await read("wordCut", { q: "cof" });
  assert.equal(nonuniform.cut, tier === "online" ? null : "words");
  assert.equal(nonuniform.complete, false);
  assert.equal(nonuniform.next, null);
  assert.equal(nonuniform.data.length, 10);
  for (const [term, size] of [["coffee", 10], ["absent", 0]]) {
    const page = await read("search", { room: "normal", q: term });
    assert.equal(page.data.length, size);
    assert.equal(page.complete, true);
    assert.equal(page.cut, null);
  }
  if (tier === "online") assert.deepEqual(wire.map(reply => reply.cut), ["meter", null, null, null, null]);
  if (tier !== "online") {
    assert.deepEqual(requests, [], "a held cut must not fall back to the server");
    offline = true; await client.sync();
    const stale = await read("filtered", {});
    assert.equal(stale.cut, "meter"); assert.equal(stale.fresh, false);
  }
});

for (const release of [false, true]) test(`W8a ${release ? "serve" : "dev"} refuses held queries with a rewrite`, async t => {
  const f = await fixture(t, release, `use identity
query heldValue() held:
  return [1, 2]
query onlineValue():
  return [1, 2]
`);
  const signed = await guest(f.url);
  assert.equal(signed.ok, true, JSON.stringify(signed));
  const client = createClient({ url: f.url, session: signed.session }); f.clients.push(client);
  const read = await client.query({ kind: "query", name: "heldValue" }, {});
  assert.equal(read.denied?.code, "E_QUERY_HELD", JSON.stringify(read));
  assert.equal(read.denied.guide, "search");
  assert.equal(read.denied.message, "query heldValue is held: it runs only on the device");
  assert.match(read.denied.rewrite, /grouped or newest form/);
  const ordinary = await client.query({ kind: "query", name: "onlineValue" }, {});
  assert.deepEqual(ordinary.data, [1, 2]); assert.equal(ordinary.cut, null); assert.equal(ordinary.complete, true);
});

for (const tier of ["native", "web"]) test(`W8a ${tier} held horizon stays local online, including observe`, async t => {
  const source = cutSource.replace("  sync public", "  sync public last 1 by byId").replace("query search(room: text <=10, q: text <=100, c: cursor ?):", "query search(room: text <=10, q: text <=100, c: cursor ?) held:");
  const f = await fixture(t, false, source);
  assert.equal((await f.post("/seed", [1, 2].map(n => ({ table: "entries", row: { id: `r${n}`, room: "normal", body: "coffee", at: n } })))).seeded, 2);
  const requests = [];
  const client = await createLocalClient({ url: f.url, persona: "alice", device: tier === "native" ? f.device : f.web, waitSeconds: 1,
    fetch: (url, init) => { if (String(url).includes("/q/")) requests.push(url); return fetch(url, init); } });
  f.clients.push(client); await client.sync();
  const op = { kind: "query", name: "search" };
  const read = await client.query(op, { room: "normal", q: "coffee" });
  assert.equal(read.data.length, 1); assert.equal(read.complete, false); assert.equal(read.cut, null);
  const watch = client.observe(op, { room: "normal", q: "absent" });
  t.after(() => watch.close());
  await until(() => "data" in watch.getSnapshot());
  assert.deepEqual(watch.getSnapshot().data, []);
  assert.equal(watch.getSnapshot().complete, false); assert.equal(watch.getSnapshot().cut, null);
  assert.deepEqual(requests, [], "held must not turn incomplete local coverage into a server call");
});

for (const tier of ["native", "web"]) {
  for (const kind of ["cursorless", "meter"]) test(`W13b ${tier} ${kind} incomplete read stays local online`, { timeout: 60000 }, async t => {
    const f = await fixture(t, false, cutSource + "\nquery top():\n  return entries['normal'] last 1 by byRoomTime\n");
    const count = kind === "meter" ? 8200 : 2;
    for (let start = 0; start < count; start += 1000) {
      const seeds = Array.from({ length: Math.min(1000, count - start) }, (_, i) => ({ table: "entries", row: { id: `r${start + i}`, room: "normal", body: "coffee", at: start + i } }));
      assert.equal((await f.post("/seed", seeds)).seeded, seeds.length);
    }
    const requests = [];
    const client = await createLocalClient({ url: f.url, persona: "alice", device: tier === "native" ? f.device : f.web, waitSeconds: 1,
      fetch: (url, init) => { if (String(url).includes("/q/")) requests.push(String(url)); return fetch(url, init); } });
    f.clients.push(client); await client.sync();
    const read = await client.query({ kind: "query", name: kind === "meter" ? "filtered" : "top" }, {});
    assert.equal(read.complete, false); assert.equal(read.cut, kind === "meter" ? "meter" : null);
    assert.equal(read.data.length, kind === "meter" ? 0 : 1);
    assert.deepEqual(requests, [], "an incomplete answer with known coverage needs zero /q/ requests");
    t.diagnostic(`${tier} ${kind}: rows=${read.data.length} complete=${read.complete} /q/=${requests.length}`);
  });

  test(`W13b ${tier} horizon and presence use server knowledge only online`, async t => {
    const schema = cutSource.replace("  sync public", "  sync public last 1 by byId") + "\nquery online():\n  return connected[viewer]\n";
    const f = await fixture(t, false, schema);
    await f.post("/seed", [1, 2].map(n => ({ table: "entries", row: { id: `r${n}`, room: "normal", body: "coffee", at: n } })));
    const requests = []; let offline = false;
    const client = await createLocalClient({ url: f.url, persona: "alice", device: tier === "native" ? f.device : f.web, waitSeconds: 1,
      fetch: (url, init) => { if (String(url).includes("/q/")) requests.push(String(url)); return offline ? Promise.reject(new Error("offline")) : fetch(url, init); } });
    f.clients.push(client); await client.sync();
    const op = { kind: "query", name: "search" }, args = { room: "normal", q: "coffee" };
    assert.equal((await client.query(op, args)).data.length, 2);
    assert.equal(requests.filter(url => url.endsWith("/q/search")).length, 1);
    assert.equal((await client.query({ kind: "query", name: "online" }, {})).complete, true);
    assert.equal(requests.filter(url => url.endsWith("/q/online")).length, 1);
    offline = true; await client.sync(); requests.length = 0;
    const local = await client.query(op, args);
    assert.equal(local.data.length, 1); assert.equal(local.complete, false); assert.equal(local.fresh, false);
    assert.deepEqual(requests, []);
  });
}

for (const release of [false, true]) test(`W13b ${release ? "serve hides" : "dev logs"} a measured cut`, { timeout: 60000 }, async t => {
  const schema = cutSource.replace("  sync public", "  insert <- allow\n  sync public") + `
mutation fill(start: int, count: int):
  for i in range(start, start + count):
    insert entries { room: 'normal', body: 'coffee', at: i }
`;
  const f = await fixture(t, release, schema);
  const signed = await guest(f.url); assert.equal(signed.ok, true);
  const headers = { authorization: `Bearer ${signed.session.token}` };
  const post = async (path, args) => (await fetch(f.url + path, { method: "POST", headers, body: JSON.stringify({ args }) })).json();
  for (let start = 0; start < 8200; start += 1000) assert.equal((await post("/m/fill", { start, count: Math.min(1000, 8200 - start) })).state, "sent");
  for (let n = 0; n < 6; n++) {
    const read = await post("/q/filtered", {});
    assert.equal(read.cut, "meter"); assert.equal(read.complete, false);
    assert.equal(Object.hasOwn(read, "meter"), !release);
  }
  // Reading the pipes is asynchronous; give the first emitted line a chance to arrive.
  if (!release) await until(() => f.log().includes("snapback4 dev: read filtered"));
  const lines = f.log().split("\n").filter(line => line.startsWith("snapback4 dev: read "));
  assert.equal(lines.length, release ? 0 : 1, f.log());
  if (!release) {
    assert.match(lines[0], /read filtered \(.+\) cut by examined rows at .+; examined=\d+ index_entries=\d+ rule_probes=\d+ steps=\d+ heap_bytes=\d+ output_bytes=\d+ rows_written=0; snapback4 why filtered/);
    t.diagnostic(lines[0]);
    const read = await f.post("/q/filtered", { args: {} });
    assert.equal(read.cut, "meter");
    await until(() => f.log().includes("suppressed 5 repeated read cuts"));
    const changed = f.log().split("\n").filter(line => line.startsWith("snapback4 dev: read "));
    assert.equal(changed.length, 2);
    assert.match(changed[1], /filtered \(dev:alice\).*; suppressed 5 repeated read cuts$/);
    t.diagnostic(changed[1]);
  }
});
