// @ref LLP 3000.016#5 — the real wasm and native clients never publish a missing card or advance past it.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";
import { webDevice, memoryPersistence } from "../dist/web.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const wasm = readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm"));
const query = name => ({ kind: "query", name });
const mutation = name => ({ kind: "mutation", name });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) {
  const deadline = Date.now() + 15000;
  do { if (await check()) return; await sleep(10); } while (Date.now() < deadline);
  assert.fail(message);
}
function parked(signal) {
  let cleanup;
  return new Response(new ReadableStream({
    start(controller) {
      const timer = setInterval(() => controller.enqueue(new Uint8Array([32, 10])), 500);
      const abort = () => { cleanup(); controller.error(signal.reason); };
      cleanup = () => { clearInterval(timer); signal.removeEventListener("abort", abort); };
      if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
    }, cancel() { cleanup(); },
  }));
}
async function fixture(t, tier, sync = "sync public last 3 by .at") {
  const directory = mkdtempSync(join(tmpdir(), "sb4-bounded-following-"));
  mkdirSync(join(directory, "snapback"));
  let source = readFileSync(join(root, "crates/snapback4-lang/tests/fixtures/following-view.q"), "utf8");
  source = source.replace("sync public", sync) // originals bounded, repost unique-pair absence remains knowable
    .replace("mutation post(postId: id, parentId: posts ?):", "mutation post(postId: id, parentId: posts ?, at: time):")
    .replace("parentId, at: now", "parentId, at")
    .replace("mutation repost(postId: posts):", "mutation repost(postId: posts, at: time):")
    .replace("actorId: viewer, postId, at: now", "actorId: viewer, postId, at")
    .replaceAll("last 20 by .at", "last 2 by .at");
  source += "\nquery wide(c: cursor ?):\n  return feed last 20 by .at after c { *, post: posts[.post] }\nquery wideMetadata():\n  return feed last 20 by .at\nquery required(postId: posts):\n  p = posts[postId] ! else MISSING\n  return p\n";
  writeFileSync(join(directory, "snapback/schema.q"), "use personas alice, bob, quiet, reader\n" + source);
  const child = spawn(binary, ["dev", "--port", "0", "--fresh", "--no-watch"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  let log = "", url;
  for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { log += data; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
  const clients = [], releases = [];
  t.after(async () => {
    releases.forEach(release => release());
    await Promise.allSettled(clients.map(client => client.close()));
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await exited;
    rmSync(directory, { recursive: true, force: true });
  });
  await until(() => { assert.equal(child.exitCode, null, log); return url; }, "server did not listen");
  const request = async (path, persona, args) => {
    const response = await fetch(url + path, { method: "POST", headers: { "x-snapback-persona": persona, "content-type": "application/json" }, body: JSON.stringify({ args }) });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
  const mutate = async (op, persona, args) => {
    const result = await request("/m/" + op, persona, args);
    assert.equal(result.state, "sent", JSON.stringify(result));
    return result;
  };
  await mutate("post", "quiet", { postId: "old", parentId: null, at: 1 });
  for (let n = 0; n < 4; n++) await mutate("post", "alice", { postId: `p${n}`, parentId: null, at: n + 10 });
  await mutate("repost", "bob", { postId: "old", at: 11 });
  await mutate("follow", "bob", { actor: "dev:alice" });
  await mutate("follow", "reader", { actor: "dev:quiet" });
  const open = async persona => {
    const control = { offline: false, holdWrites: false, holdSync: false, queries: [], observed: [], core: null };
    const opener = tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary, dir: join(directory, `device-${persona}`) });
    const client = await createLocalClient({ url, persona, waitSeconds: 1,
      device: { open: async (...args) => {
        const core = await opener.open(...args); control.core = core;
        return { close: () => core.close(), call: async (...args) => {
          const reply = await core.call(...args);
          if (args[0].op === "query") control.observed.push({ request: args[0], ...reply.ok });
          return reply;
        } };
      } },
      fetch: async (input, init) => {
        if (control.offline) throw new TypeError("offline witness");
        const path = new URL(input).pathname;
        if (path === "/changes") return parked(init.signal);
        if (path.startsWith("/m/") && control.holdWrites) return Response.json({ denied: { code: "E_BUSY", family: "transport", message: "held by witness", retryable: true } });
        if (path.startsWith("/q/")) control.queries.push({ path, ...JSON.parse(init.body) });
        const response = await fetch(input, init);
        if (path === "/sync" && control.holdSync) await new Promise(resolve => releases.push(resolve));
        return response;
      },
    });
    clients.push(client);
    return Object.assign(control, { client });
  };
  return { open, request, mutate, releaseSync: () => releases.splice(0).forEach(release => release()) };
}

for (const tier of ["wasm", "native"]) {
  test(`bounded Following ${tier}: exact offline pages, original-cursor fallback and quiet authors`, { timeout: 30000 }, async t => {
    const f = await fixture(t, tier), bob = await f.open("bob");
    const first = await bob.client.query(query("cards"), { c: null });
    assert.equal(first.complete, true);
    assert.deepEqual(first.data.map(row => row.post.id), ["p3", "p2"]);
    const input = { c: first.next };
    assert.ok(input.c);
    bob.offline = true; await bob.client.sync();
    assert.deepEqual((await bob.client.query(query("cards"), { c: null })).data.map(row => row.post.id), ["p3", "p2"]);
    assert.deepEqual(await bob.client.query(query("cards"), input), { loading: true });
    assert.deepEqual(await bob.client.query(query("required"), { postId: "old" }), { loading: true });
    const local = bob.observed.find(read => read.request.name === "cards" && read.request.args.c === input.c);
    assert.equal(local.loading, true); assert.equal(local.unknown, true);
    assert.equal("data" in local, false); assert.equal(local.next, null);
    const watch = bob.client.observe(query("cards"), input);
    const unwatch = watch.subscribe(() => {});
    t.after(unwatch);
    await until(() => "loading" in watch.getSnapshot(), "offline page was not withheld");
    bob.offline = false; await bob.client.sync();
    const online = await bob.client.query(query("cards"), input);
    const expected = await f.request("/q/cards", "bob", input);
    assert.deepEqual(online.data, expected.data); assert.equal(online.next, expected.next);
    assert.ok(online.data.some(row => row.post.id === "old"));
    assert.ok(bob.queries.some(request => request.path === "/q/cards" && request.args.c === input.c));
    await until(() => "data" in watch.getSnapshot(), "watch did not recover online");
    assert.deepEqual(watch.getSnapshot().data, expected.data);

    const reader = await f.open("reader");
    reader.offline = true; await reader.client.sync();
    assert.equal((await reader.client.query(query("home"), { c: null })).complete, true);
    assert.deepEqual(await reader.client.query(query("cards"), { c: null }), { loading: true });
    reader.offline = false; await reader.client.sync();
    assert.equal((await reader.client.query(query("cards"), { c: null })).data[0].post.id, "old");
  });

  test(`bounded Following ${tier}: a predicted post fences fallback until observation`, { timeout: 30000 }, async t => {
    const f = await fixture(t, tier), bob = await f.open("bob");
    bob.holdWrites = true;
    const write = await bob.client.mutate(mutation("post"), { postId: "own", parentId: null, at: 20 });
    assert.equal(write.state, "pending");
    const queued = (await bob.core.call({ op: "queued" })).ok;
    assert.equal(queued[0].predictable, true);
    const metadata = await bob.client.query(query("wideMetadata"), {});
    assert.equal(metadata.data[0].post, "own"); assert.equal(metadata.data[0].pending, true);
    const before = bob.queries.length;
    assert.deepEqual(await bob.client.query(query("wide"), { c: null }), { loading: true });
    assert.equal(bob.queries.length, before, "no fallback can drop the predicted row");
    bob.holdSync = true; bob.holdWrites = false;
    // Let the outbox acknowledge, while retaining its actual sync response.
    await until(async () => (await bob.core.call({ op: "queued" })).ok.some(entry => entry.sent_seq != null && entry.observed_seq == null), "write was not acknowledged before observation");
    assert.equal(bob.client.link(), "online");
    assert.deepEqual(await bob.client.query(query("wide"), { c: null }), { loading: true });
    assert.equal(bob.queries.length, before);
    bob.holdSync = false; f.releaseSync();
    await until(async () => { await bob.client.sync(); return (await bob.core.call({ op: "queued" })).ok.length === 0; }, "write was not observed");
    const answer = await bob.client.query(query("wide"), { c: null });
    assert.ok(answer.data.some(row => row.post.id === "own"));
    assert.ok(answer.data.some(row => row.post.id === "old"));
    assert.ok(bob.queries.length > before);
    assert.deepEqual(answer.data, (await f.request("/q/wide", "bob", { c: null })).data);
  });

  test(`bounded Following ${tier}: online-only cards withhold offline`, { timeout: 30000 }, async t => {
    const f = await fixture(t, tier, "online only"), bob = await f.open("bob");
    assert.equal((await bob.client.query(query("cards"), { c: null })).data.length, 2);
    bob.offline = true; await bob.client.sync();
    assert.deepEqual(await bob.client.query(query("cards"), { c: null }), { loading: true });
    assert.equal((await bob.client.query(query("home"), { c: null })).complete, true);
  });
}
