import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../dist/app.js";
import { defaultFetch } from "../dist/node-fetch.js";
import { memorySessionStore } from "../dist/auth.js";
import { mintId } from "../dist/client.js";
import { processDevice } from "../dist/native.js";
import { webDevice, memoryPersistence } from "../dist/web.js";
import { binary, server, until } from "./helpers/app-server.mjs";

const wasm = readFileSync(new URL("../src/wasm/snapback4_device_bg.wasm", import.meta.url));
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
const transportError = () => Object.assign(Error("setTypeOfService EINVAL"), { code: "EINVAL", syscall: "setTypeOfService" });

// A real mutation commits before its response is lost. Actions use a held
// admission reply, as in close-boundary: neither tier executes action bodies.
for (const tier of ["online", "wasm", "native"]) for (const kind of ["mutation", "action"])
  for (const close of [false, true]) for (const phase of ["fetch", "body"])
    test(`${tier} ${kind}: rejected ${phase} after dispatch is pending; close=${close}`, { timeout: 20_000 }, async t => {
      const { url, dir } = await server(t), held = gate(), id = mintId();
      let entered = false, losing = true, rejected = 0;
      const device = tier === "online" ? undefined : tier === "wasm"
        ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary, dir: join(dir, "device") });
      const options = { url, device, sessionStore: memorySessionStore(), fetch: async (input, init) => {
        const path = new URL(input).pathname;
        if (entered && losing && ["/sync", "/write"].some(prefix => path.startsWith(prefix))) throw transportError();
        if (path !== "/m/add" && path !== "/a/work") return defaultFetch(input, init);
        assert.equal(init.signal, undefined, "a dispatched effect must not be aborted");
        const response = kind === "mutation" ? await defaultFetch(input, init) : Response.json({ state: "done", id, result: "done" });
        if (!losing) return response;
        if (kind === "mutation") assert.equal((await response.clone().json()).state, "sent", "the server committed before transport rejection");
        entered = true;
        const reject = async () => { await held.promise; rejected++; throw transportError(); };
        if (phase === "fetch") { await response.body?.cancel(); return reject(); }
        response.json = reject;
        return response;
      } };
      const app = createApp(options); t.after(async () => { held.release(); await app.close(); });
      await app.ready; assert.equal((await app.auth.guest()).ok, true);
      const op = { kind, name: kind === "mutation" ? "add" : "work" }, args = { body: "committed once" };
      const pending = kind === "mutation" ? app.mutate(op, args, { id }) : app.client.act(op, args, { id });
      await until(() => entered, "effect dispatched");
      if (close) await app.close();
      held.release();
      assert.equal((await pending).state, "pending");
      await until(() => rejected > 0, "late rejection consumed");
      await app.close(); losing = false;
      const reopened = createApp(options); t.after(() => reopened.close()); await reopened.ready;
      if (kind === "mutation") {
        const receipt = await until(async () => { const value = await reopened.client.write(id); return value?.state === "sent" && value; });
        assert.equal(receipt.replayed, true);
        assert.equal((await reopened.client.query({ kind: "query", name: "list" }, {})).data.length, 1);
      } else assert.deepEqual(await reopened.client.act(op, args, { id }), { state: "done", id, result: "done" });
    });
