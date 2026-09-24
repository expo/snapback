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
  test(`local ${tier}: ${operation} held across app.close keeps its outcome unknown`, { timeout: 20_000 }, async t => {
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
    await closing;
    assert.equal(closed, true, "close completes before the held network response is released");
    const outcome = await pending;
    held.release();
    if (operation === "query") { assert.equal(outcome.denied?.code, "E_AUTH"); assert.equal("data" in outcome, false); return; }
    assert.deepEqual(outcome, { state: "pending", id }, "no unreceived outcome becomes a failure");
    assert.equal((await old.mutate({ kind: "mutation", name: "add" }, { body: "must not dispatch" })).why.code, "E_AUTH");
    if (operation.startsWith("mutation")) {
      const reopened = createApp(options); t.after(() => reopened.close()); await reopened.ready;
      const receipt = await until(async () => { const write = await reopened.client.write(id); return write?.state === received.state && write; });
      assert.equal(receipt.id, id);
      if (receipt.state === "sent") assert.equal(receipt.replayed, true);
      if (receipt.state === "failed") assert.equal(receipt.why.code, why.code);
      const rows = await reopened.client.query({ kind: "query", name: "list" }, {});
      assert.equal(rows.data.length, operation === "mutation-sent" ? 1 : 0, "settlement survives reopening without a duplicate or refused prediction");
    }
  });
}

for (const tier of ["wasm", "native"]) for (const operation of ["mutation-sent", "mutation-failed", "action-done", "action-failed"]) {
  test(`local ${tier}: ${operation} arriving during close cleanup remains known`, { timeout: 20_000 }, async t => {
    const { url, dir } = await server(t), held = gate(), cleanup = gate(), id = mintId();
    let received, delivered = false, cleaning = false, armClose = false;
    const underlying = tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary, dir: join(dir, "device") });
    const device = { ...underlying, async open(...args) {
      const core = await underlying.open(...args);
      return { ...core, async close() { if (armClose) { cleaning = true; await cleanup.promise; } await core.close(); } };
    } };
    const app = createApp({ url, device, sessionStore: memorySessionStore(), fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === "/m/add") received = operation === "mutation-sent" ? await (await fetch(input, init)).json() : { state: "failed", id, why };
      else if (path === "/a/work") received = operation === "action-done" ? { state: "done", id, result: { accepted: true } } : { state: "failed", id, why };
      else return fetch(input, init);
      await held.promise;
      const reply = Response.json(received), json = reply.json.bind(reply);
      reply.json = async () => { const body = await json(); delivered = true; return body; };
      return reply;
    } });
    t.after(async () => { held.release(); cleanup.release(); await app.close(); });
    await app.ready; assert.equal((await app.auth.guest()).ok, true);
    const result = operation.startsWith("mutation") ? app.mutate({ kind: "mutation", name: "add" }, { body: "one" }, { id })
      : app.client.act({ kind: "action", name: "work" }, {}, { id });
    await until(() => received); armClose = true;
    const closing = app.close(); await until(() => cleaning);
    held.release(); await until(() => delivered);
    cleanup.release(); await closing;
    const outcome = await result;
    assert.equal(outcome.state, received.state); assert.equal(outcome.id, id);
    if (received.state === "failed") assert.equal(outcome.why.code, why.code);
    else if (received.state === "sent") assert.equal(outcome.seq, received.seq);
    else assert.deepEqual(outcome.result, received.result);
  });
}
