import { waitFor as awaitState, hangBudget } from './helpers/wait.mjs';
// Real wasm/process stores, with controlled sync and credential replies.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { guardClient } from "../dist/app-client.js";
import { createLocalClient } from "../dist/local.js";
import { webDevice, memoryPersistence } from "../dist/web.js";
import { processDevice } from "../dist/native.js";
import { memorySessionStore } from "../dist/auth.js";
const wasm = readFileSync(new URL("../dist/wasm/snapback4_device_bg.wasm", import.meta.url));
const original = JSON.parse(readFileSync(new URL("./chat-schema.json", import.meta.url), "utf8"));
const binary = process.env.SNAPBACK4_BIN ?? resolve(import.meta.dirname, "../../../target/debug/snapback4");
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(check) { return awaitState(check); }

for (const keep of [undefined, true]) for (const guarded of keep === undefined ? [false, true] : [false]) for (const tier of ["wasm", "process"]) for (const reset of ["adoption", "replacement", "credentials", "viewer", "sign-out", "close"]) {
  test(`${tier} keep=${keep} facade=${guarded}: ${reset} drops active and lingering answers before a held read lands`, { timeout: hangBudget(13) }, async t => {
    const dir = mkdtempSync(join(tmpdir(), "sb4-keep-reset-"));
    const opener = tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ dir, binary });
    let generation = original.generation, store = "A", principal = "dev:alice", marker = "old", hold = false, heldReads = 0;
    const gate = deferred(), commits = [];
    const backend = () => ({ ...original, generation, programs: [...original.programs, ...["marker", "idle"].map(name => ({ name, kind: "Query", args: {}, body: [{ Return: { Literal: { String: marker } } }] }))] });
    const session = { kind: "user", token: "old-token", principal, expiresAt: Date.now() + 90 * 86400000 };
    const raw = await createLocalClient({ url: "http://keep-reset.test", session, sessionStore: memorySessionStore(),
      device: { async open(...args) {
        const core = await opener.open(...args);
        return { ...core, async call(request, committed) {
          const reply = await core.call(request);
          committed?.(reply);
          if (!reply.denied && (request.op === "adopt" || (request.op === "observe_store" && reply.ok.reset))) commits.push(request.op);
          if (hold && request.op === "query") { heldReads++; await gate.promise; }
          return reply;
        } };
      } }, fetch: async (input, init) => {
        const path = new URL(input).pathname;
        if (path === "/schema") return Response.json(backend());
        if (path === "/sync") {
          const request = JSON.parse(init.body);
          return Response.json({ snapshot: request.from === 0 && !request.stream, events: [], watermark: 10, more: false, generation, store_id: store });
        }
        if (path === "/changes") return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Error("closed")), { once: true }));
        if (path === "/auth/refresh") return Response.json({ session: { ...session, token: "new-token", principal } });
        if (path === "/auth/logout") return Response.json({ ok: true });
        if (path.startsWith("/q/")) {
          const data = marker; if (hold) { heldReads++; await gate.promise; }
          // @ref LLP 3000.029#8 — these literal queries have no dependencies.
          // Missing metadata would make their fallback replies invalidate peers.
          return Response.json({ data, complete: true, tables: [], seq: 10 });
        }
        throw Error(path);
      },
    });
    const client = guarded ? guardClient(raw, async () => true, () => true, () => ({ code: "E_AUTH", family: "auth", message: "ended" })).client : raw;
    t.after(async () => { gate.resolve(); await client.close(); rmSync(dir, { recursive: true, force: true }); });
    const op = { kind: "query", name: "marker" }, idleOp = { kind: "query", name: "idle" };
    const watch = client.observe(op, {}, { keep }), idle = client.observe(idleOp, {}, { keep });
    await until(() => watch.getSnapshot().data === "old" && idle.getSnapshot().data === "old");
    if (keep === true) idle.close(); hold = true;
    const notices = []; watch.subscribe(() => notices.push(watch.getSnapshot()));
    let resetting;
    if (reset === "adoption" || reset === "replacement") {
      if (reset === "adoption") generation++; else store = "B";
      marker = "new";
      resetting = client.sync();
    } else if (reset === "credentials" || reset === "viewer") {
      if (reset === "viewer") principal = "dev:bob";
      resetting = client.refreshSession();
    } else resetting = reset === "close" ? client.close() : client.signOut();
    await until(() => !("data" in watch.getSnapshot()));
    assert.ok(notices.some(read => !("data" in read)), "reset publishes withdrawal before replacement evaluation");
    const remount = client.observe(idleOp, {}, { keep });
    assert.ok(!("data" in remount.getSnapshot()), "the same reset invalidates the lingering watch");
    if (reset === "adoption" || reset === "replacement") {
      await until(() => heldReads > 0);
      await resetting;
      assert.ok(commits.includes(reset === "adoption" ? "adopt" : "observe_store"), "real device reset committed");
    }
    hold = false; gate.resolve(); await resetting;
    if (reset === "adoption" || reset === "replacement") {
      await until(() => watch.getSnapshot().data === "new" && remount.getSnapshot().data === "new");
      if (keep === true) assert.deepEqual(idle.getSnapshot(), { loading: true }, "scope-ending reset closes the old lingering observation permanently");
      assert.ok(notices.every(read => read.data !== "old"), "old held replies cannot cross the reset");
    } else if (reset === "credentials") {
      await until(() => remount.getSnapshot().data === "old");
      if (keep === true) assert.deepEqual(idle.getSnapshot(), { loading: true }, "credential change ends the old lingering watch");
    } else assert.ok(!("data" in watch.getSnapshot()));
  });
}
