import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../dist/app.js";
import { guardClient } from "../dist/app-client.js";
import { memorySessionStore } from "../dist/auth.js";
import { mintId } from "../dist/client.js";
import { server, until } from "./helpers/app-server.mjs";
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };

for (const method of ["mutate", "act", "upload", "refreshSession", "write"]) test(`${method}: a facade fence preserves a dispatched outcome and refuses later calls`, async () => {
  const held = gate(), id = mintId(); let dispatched = 0;
  const receipt = method === "mutate" || method === "write" ? { state: "sent", id, seq: 7 }
    : method === "act" ? { state: "done", id, result: { accepted: true } }
    : method === "upload" ? { ok: true, asset: { id: "asset", type: "image/png", bytes: 8, width: 1, height: 1, duration: null } }
    : { ok: true, session: { token: "rotated", principal: "alice", kind: "user", expiresAt: Date.now() + 86400000 } };
  const guarded = guardClient({ [method]: async () => { dispatched++; await held.promise; return receipt; } },
    async () => true, () => true, () => ({ code: "E_AUTH", family: "auth", message: "hidden" }));
  const args = method === "mutate" || method === "act" ? [{ name: "add" }, {}, { id }]
    : method === "write" ? [id] : method === "upload" ? [new Uint8Array()] : [];
  const pending = guarded.client[method](...args);
  await until(() => dispatched === 1);
  guarded.fence()(); held.release();
  assert.deepEqual(await pending, receipt);
  const refused = await guarded.client[method](...args);
  assert.equal(dispatched, 1, "a call beginning after the fence must not dispatch");
  if (method === "write") assert.equal(refused, undefined);
  else assert.equal((refused.why ?? refused.denied).code, "E_AUTH");
});

test("a real mutation committed before logout returns sent with its original id", { timeout: 20_000 }, async t => {
  const { url } = await server(t), held = gate(), store = memorySessionStore();
  let receipt, dispatches = 0;
  const app = createApp({ url, sessionStore: store, fetch: async (input, init) => {
    if (new URL(input).pathname !== "/m/add") return fetch(input, init);
    dispatches++;
    const response = await fetch(input, init); receipt = await response.json();
    assert.equal(receipt.state, "sent"); await held.promise;
    return Response.json(receipt, { status: response.status });
  } });
  t.after(async () => { held.release(); await app.close(); }); await app.ready;
  assert.equal((await app.auth.signup("alice@example.com", "password-a")).ok, true);
  const old = app.client, id = mintId(), add = { kind: "mutation", name: "add" };
  const writing = old.mutate(add, { body: "one committed row" }, { id });
  await until(() => receipt);
  assert.equal((await app.auth.logout()).ok, true);
  held.release();
  const result = await writing; assert.equal(result.state, "sent"); assert.equal(result.id, id);
  assert.equal((await old.mutate(add, { body: "must not dispatch" })).why.code, "E_AUTH");
  assert.equal(dispatches, 1);
  assert.equal((await app.auth.login("alice@example.com", "password-a")).ok, true);
  await until(async () => (await app.client.write(id))?.state === "sent");
  const rows = await app.client.query({ kind: "query", name: "list" }, {});
  assert.equal(rows.data.length, 1, "journal recovery replays the same id without duplicating the commit");
});

for (const state of ["done", "failed"]) test(`a dispatched online action preserves its ${state} outcome across close`, async t => {
  const { createClient } = await import("../dist/client.js");
  const held = gate(), id = mintId(); let dispatched = false;
  const receipt = state === "done" ? { state, id, result: { accepted: true } }
    : { state, id, why: { code: "E_INPUT", family: "input", message: "refused" } };
  const raw = createClient({ url: "https://outcome.invalid", persona: "alice", fetch: async () => {
    dispatched = true; await held.promise; return Response.json(receipt);
  } });
  t.after(async () => { held.release(); await raw.close(); });
  const pending = raw.act({ kind: "action", name: "add" }, {}, { id });
  await until(() => dispatched);
  const closing = raw.close(); held.release();
  assert.deepEqual(await pending, receipt); await closing;
});
