// Review reproductions: adoption resets every snapshot before calling application code.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "../dist/client.js";
import { createLocalClient } from "../dist/local.js";
import { ServerClock } from "../dist/clock.js";
import { webDevice, memoryPersistence } from "../dist/web.js";
import { processDevice } from "../dist/native.js";
import { binary, until } from "./helpers/app-server.mjs";
import { ephemeralServer, api } from "./helpers/ephemeral-server.mjs";
const wasm = readFileSync(new URL("../dist/wasm/snapback4_device_bg.wasm", import.meta.url));
const parked = signal => new Promise((_, reject) => {
  if (signal.aborted) reject(Error("closed"));
  else signal.addEventListener("abort", () => reject(Error("closed")), { once: true });
});

for (const keep of [undefined, true]) for (const tier of ["online", "wasm", "process"]) for (const callback of ["inspect", "close", "remount"]) {
  test(`${tier} keep=${keep}: adopting watch's loading response resets everyone before a peer can ${callback}`, async t => {
    const { url, dir } = await ephemeralServer(t), gate = Promise.withResolvers();
    const clock = new ServerClock(() => 1000);
    let holding = false, adopted = false, captured, remount, callbacks = 0;
    const options = { url, persona: "bob", device: tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary, dir: join(dir, "device") }),
      fetch: clock.wrap(async (input, init) => {
        const path = new URL(input).pathname;
        if (path === "/changes") return parked(init.signal);
        const response = await fetch(input, init), json = await response.json();
        if (path !== "/q/typingIn") return Response.json(json, { status: response.status });
        const room = JSON.parse(init.body).args.room;
        if (holding && room === "owner" && !adopted) {
          adopted = true;
          return Response.json({ loading: true, tables: ["typing"], seq: json.seq, ephemeral: { incarnation: "B", epoch: 1 } });
        }
        if (holding) await gate.promise;
        return Response.json({ ...json, refresh: 100, nextExpiry: null, data: [{ principal: adopted ? "B" : "A" }], ephemeral: { incarnation: adopted ? "B" : "A", epoch: 1 } });
      }) };
    const client = tier === "online" ? createClient(options) : await createLocalClient(options);
    t.after(async () => { holding = false; gate.resolve(); await client.close(); });
    if (client.sync) await client.sync();
    const open = room => client.observe(api.typingIn, { room }, { keep });
    // The peer must be first in the interest map, to expose a one-phase loop.
    const peer = open("peer");
    await until(() => peer.getSnapshot().data?.[0]?.principal === "A");
    const owner = open("owner"), idle = open("idle");
    await until(() => owner.getSnapshot().data?.[0]?.principal === "A" && idle.getSnapshot().data?.[0]?.principal === "A");
    if (keep === true) idle.close();
    peer.subscribe(() => {
      if (!adopted || !peer.getSnapshot().loading || callbacks++) return;
      captured = [owner.getSnapshot(), idle.getSnapshot()];
      if (callback !== "inspect") owner.close();
      if (callback === "remount") { remount = open("owner"); captured.push(remount.getSnapshot()); }
    });
    holding = true;
    // The server-requested presence refresh triggers the adopting watch.
    // A clock sample without a due deadline correctly performs no query work.
    await until(() => captured, "the owner's response must adopt B and notify its peer");
    for (const snapshot of captured) assert.deepEqual(snapshot, { loading: true }, "all snapshots reset before the first callback");
    assert.deepEqual(owner.getSnapshot(), { loading: true }, "the loading owner cannot keep incarnation A");
    remount ??= open("owner");
    assert.deepEqual(remount.getSnapshot(), { loading: true }, "closing/remounting inside adoption cannot resurrect A");
    holding = false; gate.resolve();
    await until(() => remount.getSnapshot().data?.[0]?.principal === "B", "the replacement reaches B");
  });
}

for (const keep of [undefined, true]) test(`online keep=${keep}: first schema installation resets pre-discovery watches before callbacks`, async t => {
  const schema = Promise.withResolvers(), gate = Promise.withResolvers(), polls = [];
  let generation = 1, holding = false, schemaStarted = false, installed = false, captured;
  const client = createClient({ url: "http://keep-install.test", persona: "alice", fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/changes") {
      const next = Promise.withResolvers(); polls.push(next);
      return Promise.race([next.promise, parked(init.signal)]);
    }
    if (path === "/schema") {
      schemaStarted = true; await schema.promise; installed = true;
      return Response.json({ generation, schema: { tables: { typing: { ephemeral: true } }, operations: { read: { ephemeralReads: ["typing"] } } }, programs: [] });
    }
    if (path === "/q/read") {
      if (holding) await gate.promise;
      return Response.json({ data: generation, complete: true, seq: 10, tables: ["typing"], ...(installed ? { ephemeral: { incarnation: "B", epoch: 1 } } : {}) });
    }
    throw Error(path);
  } });
  t.after(async () => { schema.resolve(); gate.resolve(); await client.close(); });
  const q = { kind: "query", name: "read" }, active = client.observe(q, {}, { keep }), idle = client.observe(q, { idle: true }, { keep });
  await until(() => active.getSnapshot().data === 1 && idle.getSnapshot().data === 1 && polls.length);
  polls.shift().resolve(Response.json({ seq: 10, generation: 1, tables: [] }, { headers: { "x-snapback-ephemeral": "1" } }));
  await until(() => schemaStarted && active.getSnapshot().data === 1 && idle.getSnapshot().data === 1);
  if (keep === true) idle.close(); holding = true; generation = 2;
  active.subscribe(() => {
    if (!installed || !active.getSnapshot().loading || captured) return;
    captured = idle.getSnapshot();
    const remount = client.observe(q, { idle: true }, { keep });
    assert.deepEqual(remount.getSnapshot(), { loading: true });
  });
  schema.resolve();
  await until(() => captured, "first backend installed");
  assert.deepEqual(captured, { loading: true }, "the lingering watch resets before the active callback");
  holding = false; gate.resolve();
  await until(() => active.getSnapshot().data === 2);
});
