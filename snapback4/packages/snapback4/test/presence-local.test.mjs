// LLP 3000.017 §3.2 on the local client, over the wasm and process devices: a
// background presence refresh is quiet when it fails, publishes an accepted
// loading answer, and a reply that a newer read overtook changes neither the
// answer, the interval, nor what a later recovery shows.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";
import { memoryPersistence, webDevice } from "../dist/web.js";

const binary = process.env.SNAPBACK4_BIN ?? resolve(import.meta.dirname, "../../../target/debug/snapback4");
const wasm = readFileSync(new URL("../src/wasm/snapback4_device_bg.wasm", import.meta.url));
const until = async (check, message, ms = 10_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await delay(10); } assert.fail(message); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const query = { kind: "query", name: "presenceOf" };
const refused = { code: "NOT_HERE", family: "rule", message: "not here" };
const source = `use personas alice, bob
table notes:
  owner: principal
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner
query presenceOf(p: principal):
  return { online: exists connected[p], notes: count(notes where .owner = viewer) }
mutation note():
  insert notes { owner: viewer }
  return null
`;

// Bob's local client. `plan(n, body)` scripts the nth /q/presenceOf reply from
// the server's own body: it returns a body, a Response, or a promise of either.
// `down()` then fails every request, as an outage would.
async function bob(t, tier, plan) {
  const directory = mkdtempSync(join(tmpdir(), "sb4-presence-local-"));
  mkdirSync(join(directory, "snapback"));
  writeFileSync(join(directory, "snapback/schema.q"), source);
  const host = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  const exit = once(host, "exit");
  let log = "", client;
  host.stdout.on("data", b => { log += b; }); host.stderr.on("data", b => { log += b; });
  t.after(async () => { await client?.close(); host.kill("SIGTERM"); await exit; rmSync(directory, { recursive: true, force: true }); });
  await until(() => { assert.equal(host.exitCode, null, log); return /http:\/\/127\.0\.0\.1:\d+/.test(log); }, "server did not listen", 30_000);
  const url = log.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  const reads = [];
  let outage = false;
  const device = tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ dir: join(directory, "device"), binary });
  client = await createLocalClient({ url, persona: "bob", device, waitSeconds: 1, fetch: async (input, init) => {
    if (outage) throw new TypeError("fetch failed");
    const response = await fetch(input, init);
    if (new URL(input).pathname !== "/q/presenceOf") return response;
    reads.push(Date.now());
    const reply = await plan(reads.length, await response.json());
    return reply instanceof Response ? reply : Response.json(reply);
  } });
  await client.sync();
  return { client, reads, down: () => { outage = true; } };
}
// The server's answer, marked with the read that produced it, refreshing every 300 ms unless `extra` says otherwise.
const answer = (body, v, extra = {}) => ({ ...body, data: { ...body.data, v }, refresh: 300, ...extra });

for (const tier of ["wasm", "process"]) {
  test(`${tier}: a failed background refresh keeps the answer and the link`, { timeout: 60_000 }, async t => {
    const { client, reads } = await bob(t, tier, (n, body) => n === 2 ? new Response("unavailable", { status: 503 }) : answer(body, n));
    const mark = client.observe(query, { p: "dev:alice" });
    t.after(() => mark.close());
    await until(() => mark.getSnapshot()?.data?.v === 1, `the first answer did not arrive: ${JSON.stringify(mark.getSnapshot())}`);
    const seen = [];
    const stop = mark.subscribe(() => seen.push(mark.getSnapshot()));
    await until(() => reads.length >= 2, "the background refresh ran");
    await delay(100);
    assert.equal(mark.getSnapshot().data?.v, 1, "a failed background refresh keeps the answer");
    assert.equal(client.link(), "online", "a failed background refresh says nothing about the link");
    await until(() => mark.getSnapshot()?.data?.v >= 3, "the refresh retried at its interval");
    stop();
    assert.ok(seen.every(read => "data" in read && read.fresh === true), `the failure published something other than a served answer: ${JSON.stringify(seen)}`);
  });

  for (const [kind, reply, shown] of [
    ["loading", body => ({ loading: true, seq: body.seq, tables: body.tables ?? [], refresh: 300 }), read => "loading" in read],
    ["refusal", () => ({ denied: refused, refresh: 300 }), read => read.denied?.code === "NOT_HERE"],
  ]) test(`${tier}: an accepted ${kind} is published, and recovery never brings back the answer it replaced`, { timeout: 60_000 }, async t => {
    const { client, down } = await bob(t, tier, (n, body) => n === 1 ? answer(body, 1) : reply(body));
    const mark = client.observe(query, { p: "dev:alice" });
    t.after(() => mark.close());
    await until(() => mark.getSnapshot()?.data?.v === 1, `the first answer did not arrive: ${JSON.stringify(mark.getSnapshot())}`);
    await until(() => shown(mark.getSnapshot()), `the server's own ${kind} was not published: ${JSON.stringify(mark.getSnapshot())}`);
    const seen = [];
    const stop = mark.subscribe(() => seen.push(mark.getSnapshot()));
    down();
    await until(() => client.link() === "offline", "the outage took the link offline");
    await delay(300);
    stop();
    assert.ok(!seen.some(read => read.data?.v === 1), `recovery brought back the answer the ${kind} replaced: ${JSON.stringify(seen)}`);
  });

  test(`${tier}: an overtaken background reply changes neither the answer, the interval, nor what recovery shows`, { timeout: 60_000 }, async t => {
    const held = deferred();
    const { client, reads, down } = await bob(t, tier, async (n, body) => {
      if (n === 1) return answer(body, 1, { nextExpiry: Date.now() + 900 });
      // The background refresh is held past the expiry, whose re-run answers v3 and stops refreshing.
      if (n === 2) { await held.promise; return answer(body, 2); }
      return answer(body, n, { refresh: undefined });
    });
    const mark = client.observe(query, { p: "dev:alice" });
    t.after(() => { held.resolve(); mark.close(); });
    await until(() => mark.getSnapshot()?.data?.v === 1, `the first answer did not arrive: ${JSON.stringify(mark.getSnapshot())}`);
    const seen = [];
    const stop = mark.subscribe(() => seen.push(mark.getSnapshot()));
    await until(() => mark.getSnapshot()?.data?.v === 3, `the expiry did not re-run the watch: ${JSON.stringify(mark.getSnapshot())}`);
    assert.equal(reads.length, 3, "the held refresh, then the expiry's re-run");
    held.resolve();
    await delay(700);
    assert.equal(mark.getSnapshot().data?.v, 3, "the overtaken reply was not published");
    assert.equal(reads.length, 3, "the overtaken reply did not re-arm the interval that v3 ended");
    // An outage takes the link offline, and the client recovers the server answer it last accepted.
    down();
    await until(() => client.link() === "offline", "the outage took the link offline");
    await until(() => seen.some(read => read.fresh === false), `no recovery was published: ${JSON.stringify(seen)}`);
    stop();
    const recovered = seen.find(read => read.fresh === false);
    assert.equal(recovered.data?.v, 3, `recovery showed a reply that was never accepted: ${JSON.stringify(recovered)}`);
    assert.ok(!seen.some(read => read.data?.v === 2), `the overtaken reply was published: ${JSON.stringify(seen)}`);
  });

  test(`${tier}: an accepted background reply does not replace a newer answer another read remembered`, { timeout: 60_000 }, async t => {
    const held = deferred();
    const { client, reads, down } = await bob(t, tier, async (n, body) => {
      if (n === 1) return answer(body, 1);
      // The background refresh is held while a one-shot read of the same query answers v3.
      if (n === 2) { await held.promise; return answer(body, 2, { refresh: undefined }); }
      return answer(body, n, { refresh: undefined });
    });
    const mark = client.observe(query, { p: "dev:alice" });
    t.after(() => { held.resolve(); mark.close(); });
    await until(() => mark.getSnapshot()?.data?.v === 1, `the first answer did not arrive: ${JSON.stringify(mark.getSnapshot())}`);
    await until(() => reads.length >= 2, "the background refresh started");
    assert.equal((await client.query(query, { p: "dev:alice" })).data?.v, 3, "the one-shot read answered");
    held.resolve();
    // Nothing overtook the refresh on this watch, so its reply is published; the one-shot answer stays remembered.
    await until(() => mark.getSnapshot()?.data?.v === 2, `the background reply was not published: ${JSON.stringify(mark.getSnapshot())}`);
    const seen = [];
    const stop = mark.subscribe(() => seen.push(mark.getSnapshot()));
    down();
    await until(() => client.link() === "offline", "the outage took the link offline");
    await until(() => seen.some(read => read.fresh === false), `no recovery was published: ${JSON.stringify(seen)}`);
    stop();
    assert.equal(seen.find(read => read.fresh === false).data?.v, 3, `recovery lost the newer answer: ${JSON.stringify(seen)}`);
  });

  test(`${tier}: an accepted background reply is what a later recovery shows`, { timeout: 60_000 }, async t => {
    const { client, down } = await bob(t, tier, (n, body) => n === 1 ? answer(body, 1) : answer(body, n, { refresh: undefined }));
    const mark = client.observe(query, { p: "dev:alice" });
    t.after(() => mark.close());
    await until(() => mark.getSnapshot()?.data?.v === 2, `the background refresh was not published: ${JSON.stringify(mark.getSnapshot())}`);
    const seen = [];
    const stop = mark.subscribe(() => seen.push(mark.getSnapshot()));
    down();
    await until(() => client.link() === "offline", "the outage took the link offline");
    await until(() => seen.some(read => read.fresh === false), `no recovery was published: ${JSON.stringify(seen)}`);
    stop();
    assert.equal(seen.find(read => read.fresh === false).data?.v, 2, `recovery did not show the accepted background answer: ${JSON.stringify(seen)}`);
  });

  test(`${tier}: an accepted background reply replaces an older read's answer that landed while it ran`, { timeout: 60_000 }, async t => {
    const first = deferred(), second = deferred();
    const { client, reads, down } = await bob(t, tier, async (n, body) => {
      if (n === 1) return answer(body, 1);
      // A one-shot read begins first and is held; the background refresh begins after it.
      if (n === 2) { await first.promise; return answer(body, 2); }
      if (n === 3) { await second.promise; return answer(body, 3, { refresh: undefined }); }
      return answer(body, n, { refresh: undefined });
    });
    const mark = client.observe(query, { p: "dev:alice" });
    t.after(() => { first.resolve(); second.resolve(); mark.close(); });
    await until(() => mark.getSnapshot()?.data?.v === 1, `the first answer did not arrive: ${JSON.stringify(mark.getSnapshot())}`);
    const older = client.query(query, { p: "dev:alice" });
    await until(() => reads.length >= 3, "the background refresh began after the one-shot read");
    first.resolve();
    assert.equal((await older).data?.v, 2, "the older one-shot read landed");
    second.resolve();
    await until(() => mark.getSnapshot()?.data?.v === 3, `the background reply was not published: ${JSON.stringify(mark.getSnapshot())}`);
    const seen = [];
    const stop = mark.subscribe(() => seen.push(mark.getSnapshot()));
    down();
    await until(() => client.link() === "offline", "the outage took the link offline");
    await until(() => seen.some(read => read.fresh === false), `no recovery was published: ${JSON.stringify(seen)}`);
    stop();
    assert.equal(seen.find(read => read.fresh === false).data?.v, 3, `recovery stepped back to the older read's answer: ${JSON.stringify(seen)}`);
  });

  test(`${tier}: an older read's refusal that lands after an accepted background reply does not erase it`, { timeout: 60_000 }, async t => {
    const first = deferred();
    const { client, reads, down } = await bob(t, tier, async (n, body) => {
      if (n === 1) return answer(body, 1);
      // A one-shot read begins first and is held; its refusal lands after the background reply.
      if (n === 2) { await first.promise; return { denied: refused, refresh: 300 }; }
      return answer(body, n, { refresh: undefined });
    });
    const mark = client.observe(query, { p: "dev:alice" });
    t.after(() => { first.resolve(); mark.close(); });
    await until(() => mark.getSnapshot()?.data?.v === 1, `the first answer did not arrive: ${JSON.stringify(mark.getSnapshot())}`);
    const older = client.query(query, { p: "dev:alice" });
    await until(() => mark.getSnapshot()?.data?.v === 3, `the background reply was not published: ${JSON.stringify(mark.getSnapshot())}`);
    first.resolve();
    assert.equal((await older).denied?.code, "NOT_HERE", "the older one-shot read was refused");
    const seen = [];
    const stop = mark.subscribe(() => seen.push(mark.getSnapshot()));
    down();
    await until(() => client.link() === "offline", "the outage took the link offline");
    await until(() => seen.some(read => read.fresh === false), `no recovery was published: ${JSON.stringify(seen)}`);
    stop();
    assert.equal(seen.find(read => read.fresh === false).data?.v, 3, `an older refusal erased the newer answer: ${JSON.stringify(seen)}`);
    assert.ok(reads.length >= 3, "the refresh ran after the one-shot read began");
  });

  test(`${tier}: an accepted background reply does not undo a newer read's deletion of an absent answer`, { timeout: 60_000 }, async t => {
    const held = deferred();
    const { client, reads, down } = await bob(t, tier, async (n, body) => {
      // The watch starts with loading, so nothing is remembered for it.
      if (n === 1) return { loading: true, seq: body.seq, tables: body.tables ?? [], refresh: 300 };
      if (n === 2) { await held.promise; return answer(body, 2, { refresh: undefined }); }
      // A one-shot read of the same query is refused while the refresh is held.
      return { denied: refused, refresh: 300 };
    });
    const mark = client.observe(query, { p: "dev:alice" });
    t.after(() => { held.resolve(); mark.close(); });
    await until(() => reads.length >= 2, "the background refresh started");
    assert.equal((await client.query(query, { p: "dev:alice" })).denied?.code, "NOT_HERE", "the one-shot read was refused");
    held.resolve();
    await until(() => mark.getSnapshot()?.data?.v === 2, `the background reply was not published: ${JSON.stringify(mark.getSnapshot())}`);
    const seen = [];
    const stop = mark.subscribe(() => seen.push(mark.getSnapshot()));
    down();
    await until(() => client.link() === "offline", "the outage took the link offline");
    await delay(300);
    stop();
    assert.ok(!seen.some(read => read.fresh === false && read.data?.v === 2), `recovery showed an answer a newer refusal had removed: ${JSON.stringify(seen)}`);
  });
}
