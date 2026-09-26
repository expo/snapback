// @ref LLP 3000.019#3.3 — read rules also depend on the protected row's fields.
// Revision 3's probe-table set is exact and empty for this non-opaque query.
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
table secrets:
  owner: principal
  body: text
  read <- .owner = viewer
  update <- allow
  sync to .owner
query secret():
  return secrets['private']
query sentinel():
  return secrets['private']
mutation transfer():
  update secrets['private'] { owner: 'dev:alice' }
`;

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "sb4-row-authority-"));
  mkdirSync(join(directory, "snapback"));
  writeFileSync(join(directory, "snapback/schema.q"), source);
  const host = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  const exit = once(host, "exit");
  let log = "";
  host.stdout.on("data", b => { log += b; }); host.stderr.on("data", b => { log += b; });
  t.after(async () => { host.kill("SIGTERM"); await exit; rmSync(directory, { recursive: true, force: true }); });
  await until(() => { assert.equal(host.exitCode, null, log); return /http:\/\/127\.0\.0\.1:\d+/.test(log); }, "server did not listen");
  const url = log.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  const post = async (path, body) => (await fetch(url + path, { method: "POST", headers: { "x-snapback-persona": "bob" }, body: JSON.stringify(body) })).json();
  assert.equal((await post("/seed", [{ table: "secrets", row: { id: "private", owner: "dev:bob", body: "private answer" } }])).seeded, 1);
  const backend = await (await fetch(url + "/schema", { headers: { "x-snapback-persona": "bob" } })).json();
  assert.deepEqual(Object.keys(backend.schema.tables), ["secrets"]);
  const rule = backend.schema.tables.secrets.rules.read;
  // Check the actual server schema, not an invented operation descriptor.
  // Eq(Field(owner), Viewer) has no exists, lookup or witness probe.
  assert.deepEqual(rule, { Eq: [{ Field: "owner" }, "Viewer"] });
  const program = backend.programs.find(program => program.name === "secret");
  assert.ok(program && !program.native && program.body.length > 0, "the query is not opaque or native");
  return { directory, url, transfer: () => post("/m/transfer", { id: "transfer-owner", args: {} }) };
}

for (const tier of ["wasm", "process"]) for (const kind of ["apply", "admit", "remount"]) {
  test(`${tier}: ${kind} withdraws an owner-only answer despite having no rule probes`, { timeout: 60_000 }, async t => {
    const { directory, url, transfer } = await fixture(t);
    const opened = tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ dir: join(directory, "device"), binary });
    const blocked = deferred();
    let armed = false, core, watch, snapshotAtCommit, targetRequest, targetResult;
    const resets = [];
    const device = { async open(...args) {
      core = await opened.open(...args);
      return { ...core, async call(request, notifyCommit) {
        if (armed && request.op === "query" && request.name === "secret") await blocked.promise;
        const result = await core.call(request);
        notifyCommit?.(result);
        if (armed && !result.denied) {
          if (["clear_rows", "adopt", "settle_exit"].includes(request.op) || (request.op === "observe_store" && result.ok?.reset)) resets.push(request.op);
          const target = kind === "admit" ? request.op === "admit"
            : request.op === "apply" && result.ok?.published && result.ok.touched.includes("secrets");
          if (target && !targetRequest) {
            targetRequest = request; targetResult = result;
            snapshotAtCommit = watch.getSnapshot();
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
    const change = kind === "admit" ? client.mutate({ kind: "mutation", name: "transfer" }, {}) : transfer();
    await until(() => !!targetRequest, "ownership change did not commit");
    assert.deepEqual(resets, [], "none of revision 3's unconditional resets happened");
    assert.equal(client.viewer(), "dev:bob");
    const after = (await core.call({ op: "sync_state", capture: false })).ok;
    assert.equal(after.store_id, before.store_id, "the store incarnation did not change");
    if (kind === "admit") assert.deepEqual(targetResult.ok.predicted, ["secrets/private"]);
    else {
      assert.deepEqual(targetResult.ok.touched, ["secrets"], "the commit touched no rule-probe table");
      assert.ok(targetRequest.page.events.some(event => event.table === "secrets" && event.kind === "del"), "moving ownership sends the old owner a deletion");
    }
    // Read the real device directly while the client replacement is held.
    const current = (await core.call({ op: "query", name: "secret", viewer: "dev:bob", args: {}, now: Date.now() })).ok;
    assert.equal(current.data, null, "Bob's authority is already gone at the commit");
    if (kind === "remount") {
      watch = client.observe(query, {});
      assert.deepEqual(watch.getSnapshot(), { loading: true }, "a remount must not restore the former owner's answer");
    } else {
      assert.deepEqual(snapshotAtCommit, { loading: true }, "commit withdraws the answer even without a probe-table change");
      assert.deepEqual(watch.getSnapshot(), { loading: true });
    }
    blocked.resolve();
    assert.equal((await change).state, "sent");
    await until(() => "data" in watch.getSnapshot() && watch.getSnapshot().data === null, "the new evaluation sees no authorized secret");
    stop();
  });
}

test("online: remount after owner transfer cannot restore an answer with no rule-probe dependencies", { timeout: 60_000 }, async t => {
  const { url, transfer } = await fixture(t);
  const blocked = deferred();
  let armed = false, observedChange = 0, watch;
  const client = createClient({ url, persona: "bob", waitSeconds: 1, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (armed && path === "/q/secret") await blocked.promise;
    const response = await fetch(input, init);
    if (path === "/changes") {
      const change = await response.clone().json();
      if (change.tables?.includes("secrets")) observedChange = Math.max(observedChange, change.seq);
    }
    return response;
  } });
  t.after(async () => { blocked.resolve(); watch?.close(); await client.close(); });
  watch = client.observe(query, {});
  const stop = watch.subscribe(() => {});
  await until(() => watch.getSnapshot().data?.body === "private answer", "initial online answer");
  // Keep a separate watch alive so /changes consumes the ownership commit
  // while the original key has no subscribers, regardless of poll timing.
  const sentinel = client.observe({ kind: "query", name: "sentinel" }, {});
  t.after(() => sentinel.close());
  await until(() => sentinel.getSnapshot().data?.body === "private answer", "sentinel answer");
  stop(); watch.close(); armed = true;
  const write = await transfer();
  assert.equal(write.state, "sent");
  await until(() => observedChange >= write.seq, "online ownership change notification");
  await delay(0); // Let the consumed notification's client continuation run.
  assert.equal(client.viewer(), "dev:bob");
  watch = client.observe(query, {});
  assert.deepEqual(watch.getSnapshot(), { loading: true }, "a 30-second answer keyed to the same viewer/store is revoked too");
  blocked.resolve();
  await until(() => "data" in watch.getSnapshot() && watch.getSnapshot().data === null, "new online answer");
});
