// Generated action orders on the real server, facade, and (locally) Rust/wasm device.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { episodeDeadline } from "../dist/read-episode.js";
import { processDevice } from "../dist/native.js";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { createApp } from "../dist/app.js";
import { memorySessionStore } from "../dist/auth.js";
import { memoryPersistence, webDevice } from "../dist/web.js";
import { server, until, binary } from "./helpers/app-server.mjs";

const wasm = readFileSync(new URL("../dist/wasm/snapback4_device_bg.wasm", import.meta.url));
const op = { kind: "query", name: "list" }, edit = { kind: "mutation", name: "edit" };
const source = `use identity
table notes:
  owner: principal
  body: text
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  sync to .owner
mutation edit(body: text):
  upsert notes['private'] { owner: viewer, body }
query list():
  return notes where .owner = viewer first 20 by .id
`;
function random(seed) { return () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; }; }

for (const keep of [undefined, true]) for (const tier of ["online", "wasm", "process"]) for (const seed of [23, 44, 445]) {
  test(`createApp keep=${keep} property: ${tier}, seed ${seed}, 50ms authority`, { timeout: 120_000 }, async t => {
    const { url, dir } = await server(t, undefined, source), memory = memorySessionStore(), next = random(seed);
    let delayed = false, offline = false, authorityReads = 0, pages = 0, predictions = 0, settlements = 0;
    const opener = tier === "process" ? processDevice({ binary, dir: join(dir, "device") }) : webDevice({ wasm, persist: memoryPersistence() });
    const app = createApp({ url, sessionStore: { ...memory, async get(key) {
      if (delayed) { authorityReads++; await delay(50); }
      return memory.get(key);
    } }, ...(tier !== "online" ? { device: { async open(...args) {
      const core = await opener.open(...args);
      return { ...core, async call(request, committed) {
        const reply = await core.call(request); committed?.(reply);
        if (request.op === "admit" && reply.ok?.predicted?.length) predictions++;
        if (request.op === "settle") settlements++;
        return reply;
      } };
    } } } : {}), fetch: async (input, init) => {
      if (offline) throw Error("generated offline interval");
      const path = new URL(input).pathname;
      if (path === "/sync") pages++;
      // A short held poll lets both tiers consume actual server notifications.
      if (path === "/changes") {
        const target = new URL(input); target.searchParams.set("wait", "1");
        return fetch(target, init);
      }
      return fetch(input, init);
    } });
    let watch;
    t.after(async () => { delayed = false; offline = false; watch?.close(); await app.close(); });
    await app.ready; assert.equal((await app.auth.guest()).ok, true);
    assert.equal((await app.mutate(edit, { body: "initial" })).state, "sent");
    if (app.client.sync) await app.client.sync();
    watch = app.client.observe(op, {}, { keep });
    await until(() => watch.getSnapshot().data?.[0]?.body === "initial", "first answer");
    const snapshots = [], trace = [];
    let expectedWithdrawal = false;
    let lastAnswer;
    const record = () => {
      const read = watch.getSnapshot(), at = Date.now();
      if ("data" in read) lastAnswer = read;
      // Queue service can start the hidden deadline after the revalidating mark.
      const lastDeadline = lastAnswer && episodeDeadline(lastAnswer);
      snapshots.push({ ...read, at, deadline: lastDeadline, action: trace.at(-1), expectedWithdrawal });
    };
    let stop = watch.subscribe(record);
    delayed = true;
    const remote = async body => {
      const result = await fetch(url + "/m/edit", { method: "POST", headers: {
        authorization: `Bearer ${app.client.session().token}`,
      }, body: JSON.stringify({ id: `remote-${seed}-${body}`, args: { body } }) }).then(r => r.json());
      assert.equal(result.state, "sent", JSON.stringify(result));
    };
    // Every seed includes every action; generated shuffles and bursts vary interleavings.
    const actions = Array.from({ length: 4 }, () => ["local", "remote", "burst", "remount", ...(tier !== "online" ? ["offline"] : [])])
      .flat().map(value => ({ value, order: next() })).sort((a, b) => a.order - b.order).map(entry => entry.value);
    for (const [index, action] of actions.entries()) {
      trace.push(action);
      const body = `${index}-${action}-${next()}`;
      if (action === "remount") {
        stop(); watch.close(); watch = app.client.observe(op, {}, { keep });
        if (keep === true) assert.ok("data" in watch.getSnapshot(), `seed ${seed}, trace ${trace}`);
        else await until(() => "data" in watch.getSnapshot(), "a non-lingering remount opens a fresh watch");
        lastAnswer = undefined; stop = watch.subscribe(record);
        continue;
      }
      if (action === "local") assert.equal((await app.mutate(edit, { body })).state, "sent");
      if (action === "remote" || action === "burst") {
        if (action === "burst") for (let n = 0; n < 2 + next() % 3; n++) await remote(`${body}-intermediate-${n}`);
        await remote(body);
      }
      if (action === "offline") {
        expectedWithdrawal = true; offline = true; await app.client.sync();
        const result = await app.mutate(edit, { body });
        assert.equal(result.state, "pending");
        await until(() => watch.getSnapshot().data?.[0]?.body === body, "predicted answer through delayed authority");
        offline = false; expectedWithdrawal = false;
      }
      if (app.client.sync) await app.client.sync();
      await until(() => watch.getSnapshot().data?.[0]?.body === body, `seed ${seed}, trace ${trace}`);
      assert.ok(snapshots.every(read => "data" in read || read.expectedWithdrawal || (keep === undefined && read.deadline !== undefined && read.at >= read.deadline)), JSON.stringify({ seed, trace, snapshots }));
    }
    assert.ok(authorityReads >= actions.length);
    t.diagnostic(`inside-episode data notifications: ${snapshots.filter(read => "data" in read).length}; deadline withdrawals: ${snapshots.filter(read => read.loading && !read.expectedWithdrawal).length}`);
    if (tier !== "online") {
      assert.ok(pages > 4, "multiple real sync pages applied");
      assert.ok(predictions > 0, "real device admitted predictions");
      assert.ok(settlements > 0, "real device settled writes");
    }
    stop(); delayed = false;
    await app.close();
    assert.ok(!("data" in watch.getSnapshot()), "close is an allowed reset");
  });
}
