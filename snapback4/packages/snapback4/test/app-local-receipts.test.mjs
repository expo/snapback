import { hangBudget } from './helpers/wait.mjs';
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

for (const tier of ["wasm", "native"]) for (const refuse of [false, true]) for (const close of [false, true])
  test(`${tier}: known ${refuse ? "failed" : "sent"} survives keep_write failure; close=${close}`, { timeout: hangBudget(15) }, async t => {
    const { url, dir } = await server(t), saving = gate(), id = mintId(), events = [];
    let entered = false, broken = true, failures = 0;
    const underlying = tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary, dir: join(dir, "device") });
    const device = { ...underlying, async open(...args) {
      const core = await underlying.open(...args);
      return { ...core, async call(request, ...rest) {
        if (request.op === "keep_write" && broken) { entered = true; await saving.promise; failures++; throw Error("receipt store unavailable"); }
        return core.call(request, ...rest);
      } };
    } };
    const options = { url, device, sessionStore: memorySessionStore() }, app = createApp(options);
    t.after(async () => { saving.release(); await app.close(); });
    await app.ready; assert.equal((await app.auth.guest()).ok, true);
    app.client.onWrite(write => events.push(write));
    const pending = app.mutate({ kind: "mutation", name: "add" }, { body: refuse ? "x".repeat(201) : "one row" }, { id });
    await until(() => entered, "server outcome reached device receipt storage");
    const closing = close ? app.close() : undefined; saving.release();
    const result = await pending; await closing;
    assert.equal(result.state, refuse ? "failed" : "sent"); assert.equal(result.id, id); assert.ok(failures > 0);
    if (!close) {
      assert.equal(events.length, 1); assert.equal(events[0].state, result.state);
      for (let n = 0; n < 3; n++) {
        const receipt = await app.client.write(id); assert.equal(receipt.state, result.state);
        if (refuse) assert.equal(receipt.why.code, result.why.code); else assert.equal(receipt.seq, result.seq);
      }
      assert.equal(events.length, 1); await app.close();
    }
    broken = false;
    const reopened = createApp(options); t.after(() => reopened.close()); await reopened.ready;
    const receipt = await until(async () => { const value = await reopened.client.write(id); return value?.state === result.state && value; });
    if (!refuse) assert.equal(receipt.replayed, true);
    assert.equal((await reopened.client.query({ kind: "query", name: "list" }, {})).data.length, refuse ? 0 : 1);
  });
