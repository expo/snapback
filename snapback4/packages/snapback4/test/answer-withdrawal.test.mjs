// LLP 3000.019 §3.3: a same-store commit can withdraw read authority.
// Explicit false withdraws at commit; the default bounds the retained revocation episode.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { episodeDeadline } from "../dist/read-episode.js";
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
  read <- exists members[.room, viewer]
  sync to members[.room]
query secret():
  return secrets['private']
table owned:
  owner: principal
  body: text
  read <- .owner = viewer
  update <- allow
  sync to .owner
query ownedSecret():
  return owned['private']
mutation transfer():
  update owned['private'] { owner: 'dev:alice' }
mutation leave():
  delete members[room = 'room', principal = viewer]
mutation kick():
  delete members[room = 'room', principal = 'dev:bob']
`;

async function fixture(t, exhaustion = false) {
  const directory = mkdtempSync(join(tmpdir(), "sb4-answer-withdrawal-"));
  mkdirSync(join(directory, "snapback"));
  const schema = exhaustion ? source.replace("return secrets['private']", "return { secret: secrets['private'], samples: count(pulses) }")
    .replace("return owned['private']", "return { secret: owned['private'], samples: count(pulses) }") + `
table pulses:
  principal: principal
  unique principal
  cap 50
  read <- allow
  ephemeral 4s
` : source;
  writeFileSync(join(directory, "snapback/schema.q"), schema);
  const host = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  const exit = once(host, "exit");
  let log = "";
  host.stdout.on("data", b => { log += b; }); host.stderr.on("data", b => { log += b; });
  t.after(async () => { host.kill("SIGTERM"); await exit; rmSync(directory, { recursive: true, force: true }); });
  await until(() => { assert.equal(host.exitCode, null, log); return /http:\/\/127\.0\.0\.1:\d+/.test(log); }, "server did not listen");
  const url = log.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  const post = async (path, body, persona = "alice") => (await fetch(url + path, { method: "POST", headers: { "x-snapback-persona": persona }, body: JSON.stringify(body) })).json();
  assert.equal((await post("/seed", [
    ...["alice", "bob"].map(person => ({ table: "members", row: { id: person, room: "room", principal: `dev:${person}` } })),
    { table: "secrets", row: { id: "private", room: "room", body: "private answer" } },
    { table: "owned", row: { id: "private", owner: "dev:bob", body: "private answer" } },
  ])).seeded, 4);
  return { directory, url, transfer: () => post("/m/transfer", { id: "transfer", args: {} }, "bob"), kick: () => post("/m/kick", { id: "kick-bob", args: {} }) };
}

for (const tier of ["wasm", "process"]) for (const keep of [undefined, false]) for (const mode of keep === false ? ["held"] : ["held", "throw", "unavailable", "retryExhausted"]) for (const kind of ["apply", "admit", "transfer", ...(mode === "held" ? ["remount"] : [])]) {
  test(`${tier}: ${kind} revocation, keep=${keep}, ${mode}`, { timeout: 60_000 }, async t => {
    const { directory, url, kick, transfer } = await fixture(t, mode === "retryExhausted");
    const body = read => mode === "retryExhausted" ? read.data?.secret?.body : read.data?.body;
    let exhaustedReplies = 0;
    const readOp = kind === "transfer" ? { ...query, name: "ownedSecret" } : query;
    const opened = tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ dir: join(directory, "device"), binary });
    const blocked = deferred(), committed = deferred();
    let armed = false, core, watch, snapshotAtCommit, targetRequest, targetResult;
    const resets = [];
    const device = { async open(...args) {
      core = await opened.open(...args);
      return { ...core, async call(request, notifyCommit) {
        if (armed && request.op === "query" && request.name === readOp.name) {
          await blocked.promise;
          if (mode === "throw") throw Error("failed post-commit device read");
          if (mode === "unavailable") return { ok: { loading: true, unknown: true, tables: [] } };
        }
        // Expose the real device's commit through the adapter's existing hook.
        const result = await core.call(request);
        notifyCommit?.(result);
        if (armed && !result.denied) {
          if (["clear_rows", "adopt", "settle_exit"].includes(request.op) || (request.op === "observe_store" && result.ok?.reset)) resets.push(request.op);
          const target = kind === "admit" ? request.op === "admit" : request.op === "apply" && request.page.events.some(event => kind === "transfer" ? event.table === "owned" : event.kind === "scope");
          if (target && !targetRequest) {
            targetRequest = request; targetResult = result;
            snapshotAtCommit = watch.getSnapshot();
            committed.resolve();
          }
        }
        return result;
      } };
    } };
    const client = await createLocalClient({ url, persona: "bob", device, waitSeconds: 1, fetch: async (input, init) => {
      if (armed && mode === "unavailable" && new URL(input).pathname === `/q/${readOp.name}`) return Response.json({ loading: true });
      if (mode === "retryExhausted") {
        const path = new URL(input).pathname, query = path === `/q/${readOp.name}`;
        if (armed && query) await blocked.promise;
        const response = await fetch(input, init);
        if (query || path === "/changes") {
          const json = await response.json();
          // Exercise runLocal's real four-attempt ephemeral fence. The query
          // still reads the real revoked row; only its ephemeral epoch is old.
          if (armed && query) exhaustedReplies++;
          return Response.json({ ...json, nextExpiry: null, ephemeral: {
            incarnation: "retry-floor", epoch: armed && query ? 0 : 100, tables: [],
          } });
        }
        return response;
      }
      return fetch(input, init);
    } });
    t.after(async () => { blocked.resolve(); watch?.close(); await client.close(); });
    await client.sync();
    watch = client.observe(readOp, {}, { keep });
    const stop = watch.subscribe(() => {});
    await until(() => body(watch.getSnapshot()) === "private answer", "initial authorized answer");
    const before = (await core.call({ op: "sync_state", capture: false })).ok;
    if (kind === "remount") { stop(); watch.close(); }
    armed = true;
    const change = kind === "admit" ? client.mutate({ kind: "mutation", name: "leave" }, {}) : kind === "transfer" ? transfer() : kick();
    await Promise.race([committed.promise, until(() => !!targetRequest, "revocation did not commit")]);
    assert.deepEqual(resets, [], "none of the design's named device resets happened");
    assert.equal(client.viewer(), "dev:bob", "the credential and viewer did not change");
    const after = (await core.call({ op: "sync_state", capture: false })).ok;
    assert.equal(after.store_id, before.store_id, "the store incarnation did not change");
    if (kind === "remount") {
      watch = client.observe(readOp, {}, { keep });
      assert.deepEqual(watch.getSnapshot(), { loading: true }, "a kept pre-revocation answer cannot initialize the new watch");
    } else {
      if (keep === false) {
        assert.deepEqual(snapshotAtCommit, { loading: true }, "keep:false withdraws at commit");
        assert.deepEqual(watch.getSnapshot(), { loading: true });
      } else {
        assert.equal(body(snapshotAtCommit), "private answer");
        assert.equal(snapshotAtCommit.revalidating, true);
        const deadline = episodeDeadline(snapshotAtCommit);
        assert.ok(Number.isFinite(deadline));
        if (mode === "held") {
          let now = deadline - 1;
          t.mock.method(Date, "now", () => now);
          assert.equal(body(watch.getSnapshot()), "private answer");
          now = deadline;
          assert.deepEqual(watch.getSnapshot(), { loading: true }, "host deadline works while the re-read and timers are held");
        }
      }
    }
    if (kind === "admit") assert.ok(targetResult.ok.predicted.includes("members/bob"), "the leave is a real prediction");
    else assert.ok(targetRequest.page.events.some(event => event.table === (kind === "transfer" ? "owned" : "secrets") && (kind === "transfer" || event.kind === "scope")), "the ordinary apply carries the secret's revoked scope");
    blocked.resolve();
    assert.equal((await change).state, "sent");
    if (mode === "held") await until(() => "data" in watch.getSnapshot() && watch.getSnapshot().data === null, "post-deadline read still publishes null");
    else await until(() => watch.getSnapshot().loading && (mode !== "retryExhausted" || exhaustedReplies >= 4),
      "a failed whole re-read withdraws, including four rejected replies");
    stop();
  });
}

for (const keep of [undefined, false]) for (const mode of ["held", "retryExhausted", "unavailable", "throw"]) test(`online: revoked data, keep=${keep}, ${mode}`, { timeout: 60_000 }, async t => {
  const { url, kick } = await fixture(t);
  const readOp = query;
  const blocked = deferred(), entered = deferred();
  let armed = false;
  const client = createClient({ url, persona: "bob", waitSeconds: 1, fetch: async (input, init) => {
    if (armed && new URL(input).pathname === "/q/secret") {
      entered.resolve(); await blocked.promise;
      if (mode === "throw") throw Error("failed post-commit read");
      if (mode === "unavailable") return Response.json({ loading: true });
      if (mode === "retryExhausted") return Response.json({ data: "obsolete", complete: true, seq: 0 });
    }
    return fetch(input, init);
  } });
  const watch = client.observe(readOp, {}, { keep });
  t.after(async () => { blocked.resolve(); watch.close(); await client.close(); });
  await until(() => watch.getSnapshot().data?.body === "private answer", "initial online answer");
  armed = true;
  assert.equal((await kick()).state, "sent");
  await entered.promise;
  assert.equal(client.viewer(), "dev:bob");
  if (keep === false) assert.deepEqual(watch.getSnapshot(), { loading: true });
  else {
    assert.equal(watch.getSnapshot().data?.body, "private answer");
    assert.equal(watch.getSnapshot().revalidating, true);
    if (mode === "held") {
      const deadline = episodeDeadline(watch.getSnapshot());
      t.mock.method(Date, "now", () => deadline);
      assert.deepEqual(watch.getSnapshot(), { loading: true });
    }
  }
  blocked.resolve();
  if (mode === "held") await until(() => "data" in watch.getSnapshot() && watch.getSnapshot().data === null, "online evaluation sees no authorized secret");
  else await until(() => watch.getSnapshot().loading, "failed or exhausted read withdraws");
});
