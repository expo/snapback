// A kept answer's live deadlines survive commits, unavailable reads and lingering.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "../dist/client.js";
import { createLocalClient } from "../dist/local.js";
import { ServerClock } from "../dist/clock.js";
import { answerObservation } from "../dist/read-observation.js";
import { webDevice, memoryPersistence } from "../dist/web.js";
import { processDevice } from "../dist/native.js";
import { server, binary, until } from "./helpers/app-server.mjs";
const wasm = readFileSync(new URL("../dist/wasm/snapback4_device_bg.wasm", import.meta.url));
const q = { kind: "query", name: "secret" };
const edit = { kind: "mutation", name: "edit" };
const ready = data => ({ data, complete: true, fresh: true, cut: null });
const source = `use personas alice
table secrets:
  body: text
  expiresAt: time
  expire at .expiresAt
  read <- allow
  update <- allow
  sync public
query secret():
  return secrets['private']
mutation edit(body: text):
  update secrets['private'] { body }
`;
const parked = signal => new Promise((_, reject) => {
  if (signal.aborted) reject(Error("closed"));
  else signal.addEventListener("abort", () => reject(Error("closed")), { once: true });
});

for (const tier of ["wasm", "process"]) for (const deadline of ["row", "episode"]) {
  test(`${tier}: a closed raw local observation still latches its ${deadline} deadline`, async t => {
    const f = await fixture(t, tier), watch = f.client.observe(q, {});
    await until(() => watch.getSnapshot().data?.body === "private answer");
    let wall = 1000;
    t.mock.method(Date, "now", () => wall);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    if (deadline === "episode") answerObservation(watch.getSnapshot()).reload();
    watch.close();
    assert.equal(watch.getSnapshot().data.body, "private answer", "the non-resetting close preserves the last snapshot");
    if (deadline === "row") f.expire();
    else wall = 2000;
    const loading = watch.getSnapshot();
    assert.deepEqual(loading, { loading: true });
    assert.equal(watch.getSnapshot(), loading);
  });
}

async function fixture(t, tier) {
  const { url, dir } = await server(t, undefined, source);
  const post = async (path, body) => (await fetch(url + path, { method: "POST", headers: { "x-snapback-persona": "alice" }, body: JSON.stringify(body) })).json();
  const deadline = Date.now() + 60_000;
  assert.equal((await post("/seed", [{ table: "secrets", row: { id: "private", body: "private answer", expiresAt: deadline } }])).seeded, 1);
  let wall = deadline - 100, hold = false, mode = "held", reads = 0, failed = 0, target, committed = false, core, client;
  const gate = Promise.withResolvers(), held = [], polls = [];
  const clock = new ServerClock(() => wall);
  const intercept = async result => {
    reads++;
    if (!hold) return result;
    if (mode === "loading") { failed++; return { loading: true, seq: result.seq, tables: result.tables }; }
    if (mode === "failure") { failed++; throw Error("controlled failed re-read"); }
    held.push(result); await gate.promise; return result;
  };
  const opener = tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary, dir: join(dir, "device") });
  const device = { async open(...args) {
    core = await opener.open(...args);
    return { ...core, async call(request, notify) {
      const reply = await core.call(request); notify?.(reply);
      if (target && request.op === target && !reply.denied) { hold = true; committed = true; }
      if (request.op === "query") await intercept(reply);
      return reply;
    } };
  } };
  const options = { url, persona: "alice", device, fetch: clock.wrap(async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/changes") {
      const poll = Promise.withResolvers(); polls.push(poll);
      return Promise.race([poll.promise.then(json => Response.json(json)), parked(init.signal)]);
    }
    const response = await fetch(input, init), json = await response.json();
    // No wall/server sampling: the test owns the two clock domains explicitly.
    return Response.json(tier === "online" && path.startsWith("/q/") ? await intercept(json) : json, { status: response.status });
  }) };
  client = tier === "online" ? createClient(options) : await createLocalClient(options);
  t.after(async () => { hold = false; gate.resolve(); await client.close(); });
  if (client.sync) await client.sync();
  return { client, deadline, held, reads: () => reads, failed: () => failed,
    hold(value = true, nextMode = "held") { hold = value; mode = nextMode; },
    async change(operation = "apply", nextMode = "held") {
      mode = nextMode;
      if (tier === "online") {
        hold = true;
        if (operation === "notification") {
          const write = await post("/m/edit", { id: "remote-edit", args: { body: "replacement" } });
          assert.equal(write.state, "sent"); await until(() => polls.length);
          polls.shift().resolve({ seq: write.seq, store_id: write.store_id, tables: ["secrets"] });
        } else await client.mutate(edit, { body: "replacement" });
      }
      else {
        target = operation;
        if (operation === "apply") { await post("/m/edit", { id: "remote-edit", args: { body: "replacement" } }); await client.sync(); }
        else await client.mutate(edit, { body: "replacement" }, { waitSeconds: 0 });
        await until(() => committed, operation + " committed on real device");
        target = undefined;
      }
    },
    expire() { wall = deadline; },
    async deviceValue() { return (await core.call({ op: "query", name: "secret", args: {}, viewer: "dev:alice", now: wall })).ok.data; },
    async release() {
      if (tier === "online") assert.equal((await post("/dev/clock/advance", { duration: "2m" })).advancedMs, 120_000);
      hold = false; gate.resolve();
    },
  };
}

for (const tier of ["wasm", "process", "online"]) {
  for (const keep of [undefined, true]) for (const operation of tier === "online" ? ["notification"] : ["apply", "admit", "settle"]) {
    test(`${tier} keep=${keep}: expiry withdraws across ${operation} with the replacement held`, async t => {
      const f = await fixture(t, tier), watch = f.client.observe(q, {}, { keep });
      await until(() => watch.getSnapshot().data?.body === "private answer");
      await f.change(operation);
      await until(() => f.held.length);
      assert.equal(watch.getSnapshot().data?.body, operation === "settle" ? "replacement" : "private answer");
      const values = []; watch.subscribe(() => values.push(watch.getSnapshot()));
      f.expire();
      if (tier !== "online") assert.equal(await f.deviceValue(), null, "the real device has expired the row");
      await until(() => watch.getSnapshot().loading, "expiry must reset while a replacement is held");
      values.length = 0;
      await f.release();
      await until(() => watch.getSnapshot().data === null, "the post-expiry read completes");
      assert.ok(values.every(read => !read.data), "neither held payload nor retained row resurfaces");
    });
  }
  for (const mode of tier === "online" ? ["loading", "failure"] : ["failure"]) {
    test(`${tier} keep: a ${mode} re-read withdraws before the displayed deadline`, async t => {
      const f = await fixture(t, tier), watch = f.client.observe(q, {}, { keep: true });
      await until(() => watch.getSnapshot().data?.body === "private answer");
      await f.change("apply", mode);
      await until(() => f.failed() > 0);
      await until(() => watch.getSnapshot().loading, "failed whole re-read withdraws immediately");
      f.hold(true); f.expire();
      await until(() => watch.getSnapshot().loading, "failed/loading re-read left the old deadline armed");
    });
  }
  for (const expired of [false, true]) {
    test(`${tier} keep: remount ${expired ? "rejects an expired answer" : "keeps the lingering watch's deadline"}`, async t => {
      const f = await fixture(t, tier);
      let watch = f.client.observe(q, {}, { keep: true });
      await until(() => watch.getSnapshot().data?.body === "private answer");
      const before = watch.getSnapshot();
      watch.close(); f.hold();
      if (expired) { f.expire(); await until(() => watch.getSnapshot().loading, "the lingering watch expires"); }
      watch = f.client.observe(q, {}, { keep: true });
      if (expired) assert.deepEqual(watch.getSnapshot(), { loading: true }, "joins the already expired observation");
      else {
        assert.equal(watch.getSnapshot().data?.body, "private answer");
        assert.equal(watch.getSnapshot(), before, "fresh and since belong to the live snapshot");
        f.expire();
        await until(() => watch.getSnapshot().loading, "the still-armed deadline withdraws");
      }
    });
  }
}
