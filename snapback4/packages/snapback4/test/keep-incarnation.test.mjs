import { hangBudget } from './helpers/wait.mjs';
import { readyRead } from "../dist/read-existence.js";
import test from "node:test";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as turn } from "node:timers/promises";
import { createClient } from "../dist/client.js";
import { createLocalClient } from "../dist/local.js";
import { webDevice, memoryPersistence } from "../dist/web.js";
import { processDevice } from "../dist/native.js";
import { memorySessionStore } from "../dist/auth.js";
import { binary, until } from "./helpers/app-server.mjs";
import { ephemeralServer, api } from "./helpers/ephemeral-server.mjs";
const wasm = readFileSync(new URL("../dist/wasm/snapback4_device_bg.wasm", import.meta.url));
const original = JSON.parse(readFileSync(new URL("./chat-schema.json", import.meta.url), "utf8"));
const ready = data => (readyRead({ data, complete: true, fresh: true, cut: null, tables: [], seq: 10 }));
const parked = signal => new Promise((_, reject) => {
  if (signal.aborted) reject(Error("closed"));
  else signal.addEventListener("abort", () => reject(Error("closed")), { once: true });
});

for (const keep of [undefined, true]) for (const tier of ["wasm", "process", "online"]) test(`${tier} keep=${keep}: ephemeral incarnation retires lingering snapshots before active callbacks`, async t => {
  const { url, dir } = await ephemeralServer(t);
  const gate = Promise.withResolvers();
  let incarnation = "A", holding = false, remount, resetSnapshot, idleSnapshot;
  const fetcher = async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/changes") return parked(init.signal);
    const response = await fetch(input, init);
    if (path !== "/q/typingIn") return response;
    const room = JSON.parse(init.body).args.room;
    const json = await response.json();
    if (holding && room !== "discover") await gate.promise;
    return Response.json({ ...json, data: [{ principal: incarnation }], ephemeral: { incarnation, epoch: 1 } });
  };
  const options = { url, persona: "bob", fetch: fetcher, device: tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary, dir: join(dir, "device") }) };
  const client = tier === "online" ? createClient(options) : await createLocalClient(options);
  t.after(async () => { holding = false; gate.resolve(); await client.close(); });
  if (client.sync) await client.sync();
  const active = client.observe(api.typingIn, { room: "active" }, { keep });
  const idle = client.observe(api.typingIn, { room: "idle" }, { keep });
  await until(() => active.getSnapshot().data?.[0]?.principal === "A" && idle.getSnapshot().data?.[0]?.principal === "A");
  if (keep === true) idle.close();
  active.subscribe(() => {
    if (!holding || remount) return;
    resetSnapshot = active.getSnapshot();
    // This runs inside the incarnation adoption, before any replacement read.
    remount = client.observe(api.typingIn, { room: "idle" }, { keep });
    idleSnapshot = remount.getSnapshot();
  });
  incarnation = "B"; holding = true;
  assert.equal((await client.query(api.typingIn, { room: "discover" })).data?.[0]?.principal, "B");
  assert.deepEqual(resetSnapshot, { loading: true }, "keep cannot swallow an ephemeral reset");
  assert.ok(remount, "active watcher was notified synchronously");
  assert.deepEqual(idleSnapshot, { loading: true }, "idle A was cleared before that callback remounted it");
  holding = false; gate.resolve();
  await until(() => active.getSnapshot().data?.[0]?.principal === "B" && remount.getSnapshot().data?.[0]?.principal === "B");
});

for (const keep of [undefined, false, true]) for (const tier of ["wasm", "process"]) test(`${tier} keep=${keep}: a local read started before refreshSession never publishes its payload`, async t => {
  const dir = mkdtempSync(join(tmpdir(), "sb4-keep-credential-"));
  const opener = tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary, dir });
  const old = Promise.withResolvers(), auth = Promise.withResolvers(), delivered = Promise.withResolvers();
  let captured = false, marker = "obsolete", reads = 0;
  const session = { token: "old", kind: "user", principal: "dev:alice", expiresAt: Date.now() + 90 * 86400000 };
  const backend = { ...original, programs: [...original.programs, { name: "marker", kind: "Query", args: {}, body: [{ Return: { Literal: { String: "obsolete" } } }] }] };
  const client = await createLocalClient({ url: "http://keep-credentials.test", session, sessionStore: memorySessionStore(), device: { async open(...args) {
    const core = await opener.open(...args);
    return { ...core, async call(request, committed) {
      const reply = await core.call(request); committed?.(reply);
      if (request.op === "query" && request.name === "marker") {
        assert.equal(reply.ok.data, "obsolete", "the held read was actually evaluated by the device");
        const value = marker;
        if (++reads === 1) { captured = true; await old.promise; delivered.resolve(); }
        return { ...reply, ok: { ...reply.ok, data: value } };
      }
      return reply;
    } };
  } }, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/schema") return Response.json(backend);
    if (path === "/sync") {
      const request = JSON.parse(init.body);
      return Response.json({ snapshot: request.from === 0 && !request.stream, events: [], watermark: 10, more: false, generation: backend.generation, store_id: "A" });
    }
    if (path === "/changes") return parked(init.signal);
    if (path === "/auth/refresh") { await auth.promise; return Response.json({ session: { ...session, token: "new" } }); }
    throw Error(path);
  } });
  t.after(async () => { old.resolve(); auth.resolve(); await client.close(); rmSync(dir, { recursive: true, force: true }); });
  await client.sync();
  const watch = client.observe({ kind: "query", name: "marker" }, {}, { keep }), values = [];
  watch.subscribe(() => values.push(watch.getSnapshot()));
  await until(() => captured);
  const refreshing = client.refreshSession();
  marker = "current"; old.resolve(); await delivered.promise; await turn();
  assert.notEqual(watch.getSnapshot().data, "obsolete", "credentials fence the old local read without a store commit");
  assert.ok(values.every(read => read.data !== "obsolete"), "no transient publication of the pre-refresh payload");
  auth.resolve(); const refreshed = await refreshing; assert.equal(refreshed.ok, true, JSON.stringify(refreshed));
  await until(() => watch.getSnapshot().data === "current");
  assert.ok(values.every(read => read.data !== "obsolete"));
});

for (const keep of [undefined, false, true]) test(`online ${keep ? "keep" : "default"}: token-only first query discovers viewer and reaches an answer`, async t => {
  let reads = 0;
  const client = createClient({ url: "http://keep-token.test", token: "token", fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/changes") return parked(init.signal);
    if (path === "/q/secret") { reads++; return Response.json({ ...ready("answer"), viewer: "alice" }); }
    throw Error(path);
  } });
  t.after(() => client.close());
  const watch = client.observe({ kind: "query", name: "secret" }, {}, { keep });
  await until(() => watch.getSnapshot().data === "answer", "viewer discovery retries the fenced response");
  assert.equal(client.viewer(), "alice"); assert.equal(client.link(), "online");
  assert.equal(reads, 2, "viewer discovery fences every option");
});

for (const keep of [undefined, false, true]) test(`online keep=${keep}: live viewer discovery resets active and idle answers and retries in-flight observations`, async t => {
  let viewer = "alice", holding = false, reads = 0, remount, resetSnapshot;
  const gate = Promise.withResolvers(), polls = [];
  const client = createClient({ url: "http://keep-viewer.test", token: "token", fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/changes") { polls.push(init.signal); return parked(init.signal); }
    if (path.startsWith("/q/")) {
      reads++; const name = path.slice(3), result = { ...ready(viewer), viewer };
      if (holding && name !== "discover") await gate.promise;
      return Response.json(result);
    }
    throw Error(path);
  } });
  t.after(async () => { gate.resolve(); await client.close(); });
  const op = name => ({ kind: "query", name });
  const active = client.observe(op("active"), {}, { keep });
  await until(() => active.getSnapshot().data === "alice");
  const idle = client.observe(op("idle"), {}, { keep });
  await until(() => idle.getSnapshot().data === "alice"); if (keep === true) idle.close();
  active.subscribe(() => {
    if (!holding || remount) return;
    resetSnapshot = active.getSnapshot();
    remount = client.observe(op("idle"), {}, { keep });
  });
  viewer = "bob"; holding = true;
  const before = reads;
  await client.query(op("discover"), {});
  assert.equal(client.viewer(), "bob"); assert.equal(client.link(), "online", "viewer changes without ending the session");
  assert.deepEqual(resetSnapshot, { loading: true });
  assert.deepEqual(remount.getSnapshot(), { loading: true });
  await until(() => reads >= before + 3, "both remount and active replacement reads were scheduled");
  holding = false; gate.resolve();
  await until(() => active.getSnapshot().data === "bob" && remount.getSnapshot().data === "bob");
});

// A microtask retry loop cannot let an in-process timeout run; bound it outside.
test("signed-out observations settle without a reset retry loop", () => {
  const source = `
    import assert from "node:assert/strict";
    import { createClient } from ${JSON.stringify(new URL("../dist/client.js", import.meta.url).href)};
    const client = createClient({ url: "http://signed-out.test", fetch: async () => { throw Error("no request expected"); } });
    const stops = [];
    for (const keep of [undefined, false, true]) {
      const watch = client.observe({ kind: "query", name: "secret" }, {}, { keep });
      assert.equal(watch.getSnapshot().denied?.code, "E_AUTH");
      stops.push(watch.subscribe(() => assert.equal(watch.getSnapshot().denied?.code, "E_AUTH")));
    }
    setTimeout(async () => { for (const stop of stops) stop(); await client.close(); }, 0);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], { encoding: "utf8", timeout: hangBudget() });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
});
