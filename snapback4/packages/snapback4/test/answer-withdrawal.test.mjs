// LLP 3000.019 §3.3: a same-store commit can withdraw read authority.
// Keep these counterexamples before changing commit-time answer retirement.
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
  read <- exists members[.room, viewer]
  sync to members[.room]
query secret():
  return secrets['private']
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
  return { directory, url, kick: () => post("/m/kick", { id: "kick-bob", args: {} }) };
}

for (const tier of ["wasm", "process"]) for (const kind of ["apply", "admit", "remount"]) {
  test(`${tier}: ${kind} must not expose an answer after a same-store membership revocation`, { timeout: 60_000 }, async t => {
    const { directory, url, kick } = await fixture(t);
    const opened = tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ dir: join(directory, "device"), binary });
    const blocked = deferred(), committed = deferred();
    let armed = false, core, watch, snapshotAtCommit, targetRequest, targetResult;
    const resets = [];
    const device = { async open(...args) {
      core = await opened.open(...args);
      return { ...core, async call(request, notifyCommit) {
        if (armed && request.op === "query" && request.name === "secret") await blocked.promise;
        // Expose the real device's commit through the adapter's existing hook.
        const result = await core.call(request);
        notifyCommit?.(result);
        if (armed && !result.denied) {
          if (["clear_rows", "adopt", "settle_exit"].includes(request.op) || (request.op === "observe_store" && result.ok?.reset)) resets.push(request.op);
          const target = kind === "admit" ? request.op === "admit" : request.op === "apply" && request.page.events.some(event => event.kind === "scope");
          if (target && !targetRequest) {
            targetRequest = request; targetResult = result;
            snapshotAtCommit = watch.getSnapshot();
            committed.resolve();
          }
        }
        return result;
      } };
    } };
    const client = await createLocalClient({ url, persona: "bob", device, waitSeconds: 1 });
    t.after(async () => { blocked.resolve(); watch?.close(); await client.close(); });
    await client.sync();
    watch = client.observe(query, {});
    const stop = watch.subscribe(() => {});
    await until(() => watch.getSnapshot().data?.body === "private answer", "initial authorized answer");
    const before = (await core.call({ op: "sync_state", capture: false })).ok;
    if (kind === "remount") { stop(); watch.close(); }
    armed = true;
    const change = kind === "admit" ? client.mutate({ kind: "mutation", name: "leave" }, {}) : kick();
    await Promise.race([committed.promise, until(() => !!targetRequest, "revocation did not commit")]);
    assert.deepEqual(resets, [], "none of the design's named device resets happened");
    assert.equal(client.viewer(), "dev:bob", "the credential and viewer did not change");
    const after = (await core.call({ op: "sync_state", capture: false })).ok;
    assert.equal(after.store_id, before.store_id, "the store incarnation did not change");
    if (kind === "remount") {
      watch = client.observe(query, {});
      assert.deepEqual(watch.getSnapshot(), { loading: true }, "a kept pre-revocation answer cannot initialize the new watch");
    } else {
      assert.deepEqual(snapshotAtCommit, { loading: true }, "commit withdraws the old authorized answer before the held replacement read");
      assert.deepEqual(watch.getSnapshot(), { loading: true });
    }
    if (kind === "admit") assert.ok(targetResult.ok.predicted.includes("members/bob"), "the leave is a real prediction");
    else assert.ok(targetRequest.page.events.some(event => event.table === "secrets" && event.kind === "scope"), "the ordinary apply carries the secret's revoked scope");
    blocked.resolve();
    assert.equal((await change).state, "sent");
    await until(() => "data" in watch.getSnapshot() && watch.getSnapshot().data === null, "the new evaluation sees no authorized secret");
    stop();
  });
}

test("online: a change notification must withdraw revoked data before a held refetch returns", { timeout: 60_000 }, async t => {
  const { url, kick } = await fixture(t);
  const blocked = deferred(), entered = deferred();
  let armed = false;
  const client = createClient({ url, persona: "bob", waitSeconds: 1, fetch: async (input, init) => {
    if (armed && new URL(input).pathname === "/q/secret") { entered.resolve(); await blocked.promise; }
    return fetch(input, init);
  } });
  const watch = client.observe(query, {});
  t.after(async () => { blocked.resolve(); watch.close(); await client.close(); });
  await until(() => watch.getSnapshot().data?.body === "private answer", "initial online answer");
  armed = true;
  assert.equal((await kick()).state, "sent");
  await entered.promise;
  assert.equal(client.viewer(), "dev:bob");
  assert.deepEqual(watch.getSnapshot(), { loading: true }, "the unchanged bearer cannot keep data after membership withdrawal");
  blocked.resolve();
  await until(() => "data" in watch.getSnapshot() && watch.getSnapshot().data === null, "online evaluation sees no authorized secret");
});
