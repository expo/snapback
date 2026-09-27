import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../dist/app.js";
import { keepSession, memorySessionStore } from "../dist/auth.js";
import { ServerClock } from "../dist/clock.js";
import { RememberedAnswers } from "../dist/local-reads.js";
import { modelBackend, modelDevice, modelPage } from "./helpers/app-model-device.mjs";
import { until } from "./helpers/app-server.mjs";

test("createApp wasm: held expiry fences late HTTP memory before rollback, preserving newer B", async t => {
  const url = "http://app-kept-memory.test", wall = Date.now(), deadline = wall + 3_600_000;
  const memory = memorySessionStore(), gate = Promise.withResolvers(), replacement = Promise.withResolvers();
  let clock = new ServerClock(() => wall), holding = false, queries = 0, failedReads = false, cache;
  const fork = clock.fork.bind(clock); clock.fork = () => clock = fork();
  // Observe the real cache, then inject the exact write an older delayed HTTP
  // body would attempt. Its higher server cut must not bypass expiry's barrier.
  const set = RememberedAnswers.prototype.set;
  t.mock.method(RememberedAnswers.prototype, "set", function (...args) { cache = this; return set.apply(this, args); });
  await keepSession(url, { kind: "user", token: "alice", principal: "alice", expiresAt: wall + 90 * 86400000 }, memory);
  const app = createApp({ url, device: modelDevice(), sessionStore: { ...memory, async get(key) {
    if (holding) await gate.promise;
    return memory.get(key);
  } }, fetch: clock.wrap(async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/schema") return Response.json(modelBackend);
    if (path === "/probe") return Response.json({ ok: true, principal: "alice", store_id: "session-model-store", seq: 1 });
    if (path === "/sync") return Response.json(modelPage(1, JSON.parse(init.body)));
    if (path === "/changes") return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Error("closed")), { once: true }));
    if (path === "/q/viewer") {
      if (failedReads) throw Error("offline after rollback");
      const first = ++queries === 1;
      if (!first) { await replacement.promise; holding = true; }
      return Response.json({ data: first ? "A" : "B", complete: true, tables: ["remote"], seq: 1,
        nextExpiry: first ? deadline : deadline + 3_600_000, refresh: 250 });
    }
    throw Error(path);
  }) });
  t.after(async () => { holding = false; gate.resolve(); replacement.resolve(); await app.close(); });
  assert.equal((await app.ready).ok, true);
  const op = { kind: "query", name: "viewer" }, watch = app.client.observe(op, {}, { keep: true });
  watch.subscribe(() => {});
  await until(() => watch.getSnapshot().data === "A");
  const key = "viewer:{}", old = cache.get(key), oldTicket = cache.begin();
  await until(() => queries === 2, "background replacement reaches transport");
  replacement.resolve();
  await until(() => cache.get(key)?.read.data === "B", "raw B replaces memory while authority waits");
  assert.equal(watch.getSnapshot().data, "A");
  const seen = [];
  watch.subscribe(() => {
    seen.push(watch.getSnapshot());
    if (watch.getSnapshot().loading) clock.sample(wall, wall, wall, "clock:2");
  });
  clock.sample(deadline, wall, wall, "clock:1");
  assert.deepEqual(watch.getSnapshot(), { loading: true });
  assert.ok(seen.some(read => read.loading));
  assert.equal(cache.get(key)?.read.data, "B", "newer memory is still unexpired");
  cache.set(key, old, { seq: 100, ticket: oldTicket });
  assert.equal(cache.get(key)?.read.data, "B", "old body cannot reinstall A, even at a higher cut");
  failedReads = true; holding = false; gate.resolve();
  await until(() => watch.getSnapshot().data === "B", "approved replacement or offline recovery remains B");
  assert.equal((await app.client.query(op, {})).data, "B", "public recovery cannot resurrect expired A");
  watch.close();
});
