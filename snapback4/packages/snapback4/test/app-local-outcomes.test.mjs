import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../dist/app.js";
import { memorySessionStore } from "../dist/auth.js";
import { mintId } from "../dist/client.js";
import { processDevice } from "../dist/native.js";
import { webDevice, memoryPersistence } from "../dist/web.js";
import { binary, server, until } from "./helpers/app-server.mjs";
const wasm = readFileSync(new URL("../src/wasm/snapback4_device_bg.wasm", import.meta.url));
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
const why = { code: "E_MODEL_REFUSED", family: "input", message: "authoritative terminal refusal", site: "write", rewrite: "submit an allowed body" };

for (const tier of ["wasm", "native"]) for (const operation of ["mutation-sent", "mutation-failed", "action-done", "action-failed", "query"]) {
  test(`local ${tier}: ${operation} delivered across app.close keeps its outcome boundary`, { timeout: 20_000 }, async t => {
    const { url, dir } = await server(t), held = gate(), id = mintId(); let received;
    const device = tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary, dir: join(dir, "device") });
    const sessionStore = memorySessionStore();
    const options = { url, device, sessionStore, fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (operation === "query" && path === "/schema") {
        const backend = await (await fetch(input, init)).json();
        backend.schema.operations.list.runs = "server";
        return Response.json(backend);
      }
      if (operation.startsWith("mutation") && path === "/m/add") {
        received = operation === "mutation-sent" ? await (await fetch(input, init)).json() : { state: "failed", id, why };
      } else if (operation.startsWith("action") && path === "/a/work") {
        received = operation === "action-done" ? { state: "done", id, result: { accepted: true } } : { state: "failed", id, why };
      } else if (operation === "query" && path === "/q/list") {
        received = await (await fetch(input, init)).json();
      } else return fetch(input, init);
      await held.promise;
      return Response.json(received);
    } };
    const app = createApp(options); t.after(async () => { held.release(); await app.close(); });
    await app.ready; assert.equal((await app.auth.guest()).ok, true);
    const old = app.client;
    const pending = operation.startsWith("mutation") ? old.mutate({ kind: "mutation", name: "add" }, { body: "one write" }, { id })
      : operation.startsWith("action") ? old.act({ kind: "action", name: "work" }, {}, { id })
      : old.query({ kind: "query", name: "list", runs: "server" }, {});
    await until(() => received, "operation reached the held response");
    let closed = false;
    const closing = app.close().then(() => { closed = true; }); await until(() => app.auth.state === "signed-out");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closed, false, "close keeps private response/settlement custody while hiding the public client");
    held.release();
    const outcome = await pending; await closing;
    if (operation === "query") { assert.equal(outcome.denied?.code, "E_AUTH"); assert.equal("data" in outcome, false); return; }
    assert.equal(outcome.id, id); assert.equal(outcome.state, received.state);
    if (received.why) assert.deepEqual(outcome.why, why);
    if (received.seq !== undefined) assert.equal(outcome.seq, received.seq);
    if (received.result !== undefined) assert.deepEqual(outcome.result, received.result);
    assert.equal((await old.mutate({ kind: "mutation", name: "add" }, { body: "must not dispatch" })).why.code, "E_AUTH");
    if (operation.startsWith("mutation")) {
      const reopened = createApp({ url, device, sessionStore }); t.after(() => reopened.close()); await reopened.ready;
      const receipt = await reopened.client.write(id); assert.equal(receipt.state, received.state); assert.equal(receipt.id, id);
      if (receipt.state === "failed") assert.equal(receipt.why.code, why.code);
      const rows = await reopened.client.query({ kind: "query", name: "list" }, {});
      assert.equal(rows.data.length, operation === "mutation-sent" ? 1 : 0, "settlement survives reopening without a duplicate or refused prediction");
    }
  });
}
