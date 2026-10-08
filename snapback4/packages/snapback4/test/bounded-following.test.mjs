import { captureStdout } from './helpers/server-output.mjs';
import { waitFor as awaitState, hangBudget } from './helpers/wait.mjs';
// @ref LLP 3000.016#5 — the real wasm and native clients never publish a missing card or advance past it.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, symlinkSync } from "node:fs";
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
async function until(check, message) { return awaitState(check, message); }
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
async function fixture(t, tier, sync = "sync public last 3 by .at", configure = source => source, native = false) {
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
  writeFileSync(join(directory, "snapback/schema.q"), "use personas alice, bob, quiet, reader\n" + configure(source));
  if (native) {
    cpSync(join(root, "native-fixtures/following"), join(directory, "snapback/native"), { recursive: true });
    const manifest = join(directory, "snapback/native/Cargo.toml");
    writeFileSync(manifest, readFileSync(manifest, "utf8").replace("../../crates/snapback4-native", join(root, "crates/snapback4-native")));
    mkdirSync(join(directory, "snapback/generated"));
    mkdirSync(join(root, "target/native-fixture"), { recursive: true });
    symlinkSync(join(root, "target/native-fixture"), join(directory, "snapback/generated/native-target"), "dir");
  }
  const child = spawn(binary, ["dev", "--port", "0", "--fresh", "--no-watch"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  const readStdout = captureStdout(child);
  const exited = once(child, "exit");
  let log = "", url;
  for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { log += data; url ??= readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0]; });
  const clients = [], releases = [];
  t.after(async () => {
    releases.forEach(release => release());
    await Promise.allSettled(clients.map(client => client.close()));
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await exited;
    rmSync(directory, { recursive: true, force: true });
  });
  await until(() => { assert.equal(child.exitCode, null, log); return url; }, "server did not listen", native ? 90000 : 15000);
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
    const control = { offline: false, holdWrites: false, holdSync: false, failQueries: false, holdQueries: false, queries: [], observed: [], core: null };
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
        if (path.startsWith("/q/")) {
          control.queries.push({ path, ...JSON.parse(init.body) });
          if (control.failQueries) throw new TypeError("query transport failed");
        }
        const response = await fetch(input, init);
        if (path === "/sync" && control.holdSync) await new Promise(resolve => releases.push(resolve));
        if (path.startsWith("/q/") && control.holdQueries) await new Promise(resolve => releases.push(resolve));
        return response;
      },
    });
    clients.push(client);
    return Object.assign(control, { client });
  };
  return { open, request, mutate, seed: async rows => {
    const result = await fetch(url + "/seed", { method: "POST", body: JSON.stringify(rows) }).then(r => r.json());
    assert.equal(result.seeded, rows.length, JSON.stringify(result));
  }, backend: async () => (await fetch(url + "/schema", { headers: { "x-snapback-persona": "bob" } })).json(), releaseSync: () => releases.splice(0).forEach(release => release()) };
}

for (const tier of ["wasm", "native"]) {
  test(`event slots ${tier}: owned-event fallback waits for the source prediction`, { timeout: hangBudget(19) }, async t => {
    const f = await fixture(t, tier, undefined, source => source.replace("sync public\n\ntable follows", "sync public last 3 by .at\n\ntable follows") + `
query ownedEvent(eventId: id):
  return feedPosts[eventId]
query ownedEvents():
  return feedPosts last 10 by .at
table eventSwitch:
  enabled: bool
  public 'conditional event witness'
  insert <- true
  online only
mutation enableEvents():
  insert eventSwitch { id: 'gate', enabled: true }
query conditionalEvents():
  if exists eventSwitch['gate']:
    return feedPosts last 10 by .at
  return []
query conditionalEventsHeld():
  held = posts['p3']
  if exists eventSwitch['gate']:
    return feedPosts last 10 by .at
  return []
`), bob = await f.open("bob");
    await f.mutate("enableEvents", "bob", {});
    const input = { eventId: "p3" };
    assert.equal((await bob.client.query(query("ownedEvent"), input)).data.id, "p3");
    bob.offline = true; await bob.client.sync();
    assert.equal((await bob.client.query(query("ownedEvent"), input)).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
    assert.equal((await bob.client.query(query("ownedEvents"), {})).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
    bob.offline = false; await bob.client.sync(); bob.holdWrites = true;
    await bob.client.mutate(mutation("post"), { postId: "own-event", parentId: null, at: 30 });
    const queued = (await bob.core.call({ op: "queued" })).ok;
    assert.ok(queued.some(q => q.predictable && q.predicted.some(row => row.startsWith("posts/"))));
    assert.ok(queued.every(q => q.predicted.every(row => !row.startsWith("feedPosts/"))), "partial events have no predicted owned row");
    const before = bob.queries.length;
    assert.equal((await bob.client.query(query("ownedEvent"), input)).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
    assert.equal((await bob.client.query(query("ownedEvents"), {})).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
    assert.equal((await bob.client.query(query("conditionalEvents"), {})).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
    assert.equal((await bob.client.query(query("conditionalEventsHeld"), {})).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY", "an unrelated held post cannot validate the speculative branch");
    const branch = bob.observed.at(-1);
    assert.deepEqual(branch.data, []);
    assert.equal(branch.unknown, true); assert.equal(branch.speculative, true); assert.ok(branch.tables.includes("posts"));
    assert.equal(bob.queries.length, before, "executed and possible event reads depend on the predicted source slot");
    bob.holdWrites = false;
    await until(async () => { await bob.client.sync(); return (await bob.core.call({ op: "queued" })).ok.length === 0; }, "source prediction was not observed");
    assert.ok((await bob.client.query(query("ownedEvents"), {})).data.some(row => row.postId === "own-event"));
    bob.failQueries = true;
    assert.equal((await bob.client.query(query("ownedEvent"), input)).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
  });

  test(`event slots ${tier}: rejected owned events cannot make a speculative scan publishable`, { timeout: hangBudget(11) }, async t => {
    // Both source kinds are full: the scan must visit held owned rows, then
    // reject them on the unknown filter, rather than withhold a partial table.
    const f = await fixture(t, tier, "sync public", source => source + `
table eventSwitch:
  enabled: bool
  public 'filtered event witness'
  insert <- true
  online only
mutation enableEvents():
  insert eventSwitch { id: 'gate', enabled: true }
query filteredEvents():
  return feedPosts last 10 by .at where exists eventSwitch['gate']
`);
    await f.mutate("enableEvents", "bob", {});
    const bob = await f.open("bob");
    assert.ok((await bob.client.query(query("filteredEvents"), {})).data.length > 0, "the server gate selects real events");
    bob.holdWrites = true;
    await bob.client.mutate(mutation("post"), { postId: "own-filtered", parentId: null, at: 30 });
    const queued = (await bob.core.call({ op: "queued" })).ok;
    assert.ok(queued.some(q => q.predictable && q.predicted.some(row => row.startsWith("feedPosts/"))), "the scan intersects a pending owned-event prediction");
    const before = bob.queries.length;
    assert.equal((await bob.client.query(query("filteredEvents"), {})).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
    const scan = bob.observed.at(-1);
    assert.deepEqual(scan.data, []); assert.equal(scan.unknown, true); assert.equal(scan.speculative, true);
    assert.equal("held" in scan, false, "query-wide held provenance has been removed");
    assert.equal(bob.queries.length, before, "the prediction fence prevents a server replacement");
    bob.holdWrites = false;
    await until(async () => { await bob.client.sync(); return (await bob.core.call({ op: "queued" })).ok.length === 0; }, "filtered prediction was not observed");
    assert.ok((await bob.client.query(query("filteredEvents"), {})).data.some(row => row.postId === "own-filtered"));
  });

  test(`bounded Following ${tier}: unrelated held reads cannot validate speculative refusals or empty pages`, { timeout: hangBudget(9) }, async t => {
    const f = await fixture(t, tier, undefined, source => source + `
table notes:
  body: text <=40
  public 'guard witness'
  insert <- true
  sync public
table audit:
  body: text <=40
  public 'guard witness'
  online only
table eventSwitch:
  enabled: bool
  public 'unknown filter witness'
  online only
mutation addNote(id: id):
  return insert notes { id, body: 'predicted' }
query guarded():
  ignored = notes[id = 'n2']
  return audit[id = 'a1'] ! else NOT_FOUND
query conditionalEvents():
  held = posts['p3']
  if exists eventSwitch['gate']:
    return feedPosts last 10 by .at
  return []
query filteredEvents():
  return feedPosts last 10 by .at where exists eventSwitch['gate']
query speculativePage():
  return posts last 10 by .at { post: .id, online: exists connected[.authorId] }
`);
    await f.seed([
      { table: "notes", row: { id: "n2", body: "held" } },
      { table: "audit", row: { id: "a1", body: "server" } },
      { table: "eventSwitch", row: { id: "gate", enabled: true } },
    ]);
    const bob = await f.open("bob");
    for (const name of ["guarded", "conditionalEvents", "filteredEvents", "speculativePage"]) {
      const answer = await bob.client.query(query(name), {});
      if (name === "guarded") assert.equal(answer.data.id, "a1");
      else assert.ok(answer.data.length > 0, "server takes the true gate branch");
    }
    bob.holdWrites = true;
    await bob.client.mutate(mutation("post"), { postId: "own-gated", parentId: null, at: 20 });
    await bob.client.mutate(mutation("addNote"), { id: "own-note" });
    const entries = (await bob.core.call({ op: "queued" })).ok;
    for (const table of ["posts", "notes"]) assert.ok(entries.some(e => e.predictable && e.observed_seq == null && e.predicted.some(row => row.startsWith(table + "/"))));
    for (const offline of [false, true]) {
      bob.offline = offline; await bob.client.sync();
      for (const name of ["guarded", "conditionalEvents", "filteredEvents", "speculativePage"]) {
        const before = bob.queries.length;
        assert.equal((await bob.client.query(query(name), {})).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY", name);
        const raw = bob.observed.at(-1);
        assert.equal(raw.unknown, true); assert.equal(raw.speculative, true);
        if (name === "guarded") assert.equal(raw.denied.code, "NOT_FOUND");
        else if (name === "speculativePage") {
          // Z removes partial-kind owned rows; use the held source images to
          // retain U's distinct nonempty speculative-projection witness.
          assert.ok(raw.data.length > 0, "a nonempty page can still contain placeholder values");
          assert.ok(raw.data.some(row => row.post === "own-gated"), "even a prediction cannot validate speculative presence");
          assert.ok(raw.data.every(row => row.online === true));
        } else if (name === "filteredEvents") {
          // Z's partial owned-table read withholds before the scan. The fully
          // synced event-slot case above separately exercises rejected rows.
          assert.equal(raw.loading, true); assert.equal("data" in raw, false);
        } else assert.deepEqual(raw.data, []);
        assert.equal(bob.queries.length, before, "neither a server nor remembered answer can pass the fence");
      }
    }
  });

  test(`bounded Following ${tier}: unknown conditions preserve static and helper dependencies`, { timeout: hangBudget(17) }, async t => {
    const f = await fixture(t, tier, "sync public", source => source.replace("sync public\n\ntable follows", "online only\n\ntable follows") + `
table switches:
  enabled: bool
  public 'routing witness'
  insert <- true
  online only
mutation enable():
  return insert switches { id: 'gate', enabled: true }
fn conditionalRows(c: cursor ?):
  return feed last 20 by .at after c { *, card: reposts[.actor, .post] }
query conditionalFeed(c: cursor ?):
  if exists switches['gate']:
    return feed last 20 by .at after c { *, card: reposts[.actor, .post] }
  return []
query conditionalOriginal(postId: posts):
  if exists switches['gate']:
    return posts[postId]
  return null
query conditionalHelper(c: cursor ?):
  if exists switches['gate']:
    return conditionalRows(c)
  return []
`);
    await f.mutate("enable", "bob", {});
    const bob = await f.open("bob"), input = { c: null };
    // Confirm the server has a different, nonempty branch before predicting.
    for (const name of ["conditionalFeed", "conditionalHelper"]) {
      assert.ok((await bob.client.query(query(name), input)).data.length > 0);
    }
    bob.holdWrites = true;
    await bob.client.mutate(mutation("post"), { postId: "own/conditional", parentId: null, at: 20 });
    const entries = (await bob.core.call({ op: "queued" })).ok;
    assert.ok(entries.some(e => e.predictable && e.observed_seq == null && e.predicted.some(row => row.startsWith("feedFeed/"))));
    for (const offline of [false, true]) {
      bob.offline = offline; await bob.client.sync();
      assert.equal((await bob.client.query(query("conditionalOriginal"), { postId: "own/conditional" })).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY", "an unknown branch cannot publish a placeholder or replace a prediction");
      for (const name of ["conditionalFeed", "conditionalHelper"]) {
        const before = bob.queries.length;
        const read = await bob.client.query(query(name), input);
        assert.equal(read.denied?.code, offline ? "E_OFFLINE" : "E_QUERY_RETRY");
        const raw = bob.observed.at(-1);
        assert.deepEqual(raw.data, []); assert.equal(raw.unknown, true);
        assert.deepEqual(raw.tables, ["switches"]);
        assert.equal(bob.queries.length, before, "unknown branches cannot authorize a server replacement");
      }
    }
    bob.offline = false; await bob.client.sync(); bob.holdSync = true; bob.holdWrites = false;
    await until(async () => (await bob.core.call({ op: "queued" })).ok.some(e => e.sent_seq != null && e.observed_seq == null), "conditional prediction not acknowledged");
    assert.equal((await bob.client.query(query("conditionalHelper"), input)).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
    bob.holdSync = false; f.releaseSync();
    await until(async () => { await bob.client.sync(); return (await bob.core.call({ op: "queued" })).ok.length === 0; }, "conditional prediction not observed");
    assert.ok((await bob.client.query(query("conditionalHelper"), input)).data.some(row => row.post === "own/conditional"));
  });

  test(`bounded Following ${tier}: a scalar cut before the feed keeps its possible reads fenced`, { timeout: hangBudget(5) }, async t => {
    const f = await fixture(t, tier, "sync public", source => source + `
table events:
  at: time
  public 'scalar cut witness'
  sync public
query countedFeed(c: cursor ?):
  n = count(events)
  return feed last 20 by .at after c { *, post: posts[.post] }
`);
    for (let start = 0; start < 8193; start += 512) {
      await f.seed(Array.from({ length: Math.min(512, 8193 - start) }, (_, i) => ({ table: "events", row: { id: `e${start + i}`, at: start + i } })));
    }
    const bob = await f.open("bob"); bob.holdWrites = true;
    await bob.client.mutate(mutation("post"), { postId: "own-cut", parentId: null, at: 20 });
    const before = bob.queries.length;
    assert.equal((await bob.client.query(query("countedFeed"), { c: null })).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
    const raw = bob.observed.at(-1);
    assert.equal(raw.loading, true); assert.equal(raw.unknown, false); assert.equal(raw.complete, false);
    assert.deepEqual(raw.tables, ["events"], "the scalar cap skipped the following statements");
    assert.equal(bob.queries.length, before, "static feed/posts reads fence server fallback despite the executed subset");
  });

  test(`bounded Following ${tier}: a known branch wins over static server routing`, { timeout: hangBudget(7) }, async t => {
    const f = await fixture(t, tier, "sync public", source => source.replace("sync public\n\ntable follows", "online only\n\ntable follows") + `
table switches:
  enabled: bool
  public 'routing witness'
  insert <- true
  sync public
mutation enable():
  return insert switches { id: 'gate', enabled: true }
query conditionalFeed(c: cursor ?):
  if exists switches['gate']:
    return feed last 20 by .at after c { *, card: reposts[.actor, .post] }
  return []
`);
    const bob = await f.open("bob");
    // The server learns this branch after acquisition. The parked stream leaves
    // local absence known; `runs: server` does not authorize the other branch.
    await f.mutate("enable", "alice", {});
    bob.holdWrites = true; bob.holdSync = true;
    await bob.client.mutate(mutation("post"), { postId: "own-known", parentId: null, at: 20 });
    const program = (await f.backend()).programs.find(p => p.name === "conditionalFeed");
    assert.equal(program.runs, "server");
    const remote = await f.request("/q/conditionalFeed", "bob", { c: null });
    assert.ok(remote.data.length > 0); assert.ok(remote.data.every(row => row.post !== "own-known"));
    const before = bob.queries.length;
    const local = await bob.client.query(query("conditionalFeed"), { c: null });
    assert.deepEqual(local.data, []); assert.equal(local.complete, true);
    assert.equal(bob.observed.at(-1).unknown, false); assert.deepEqual(bob.observed.at(-1).tables, ["switches"]);
    assert.equal(bob.queries.length, before, "known local branch always wins, even after narrowing possible reads");
  });

  test(`bounded Following ${tier}: a speculative profile withholds while a non-speculative page keeps predicted rows`, { timeout: hangBudget(13) }, async t => {
    const f = await fixture(t, tier, undefined, source => source + `
table profiles:
  name: text <=40
  at: time
  by byTime: at, id
  public 'profile witness'
  insert <- true
  sync public last 1 by .at
table remoteProfiles:
  name: text <=40
  public 'remote profile witness'
  insert <- true
  online only
mutation profile(id: id, at: time):
  insert profiles { id, name: 'profile', at }
  return insert remoteProfiles { id, name: 'remote' }
query withProfile():
  rows = feed last 2 by .at { *, post: posts[.post] }
  return { rows, profile: profiles['old'] }
query partialWithProfile():
  rows = feed last 2 by .at { *, post: posts[.post] }
  return { rows, profiles: profiles last 10 by .at }
query remoteProfile():
  return remoteProfiles['old']
`);
    await f.mutate("profile", "bob", { id: "old", at: 1 });
    await f.mutate("profile", "bob", { id: "new", at: 2 });
    const bob = await f.open("bob");
    bob.failQueries = true;
    const failed = await bob.client.query(query("withProfile"), {});
    assert.equal(failed.denied.code, "E_OFFLINE", "an unfenced speculative profile cannot publish its placeholder");
    assert.equal(bob.client.link(), "offline");
    bob.failQueries = false; await bob.client.sync(); bob.holdWrites = true;
    await bob.client.mutate(mutation("post"), { postId: "own-profile", parentId: null, at: 20 });
    const before = bob.queries.length;
    const answer = await bob.client.query(query("withProfile"), {});
    assert.equal(answer.denied?.code, "E_QUERY_RETRY", "an unrelated held page cannot validate a speculative profile");
    const raw = bob.observed.at(-1); assert.equal(raw.unknown, true); assert.notEqual(raw.loading, true);
    assert.equal(raw.speculative, true);
    assert.equal(bob.queries.length, before, "a prediction fences speculative profile recovery");
    const partial = await bob.client.query(query("partialWithProfile"), {});
    assert.equal(partial.data.rows[0].post.id, "own-profile"); assert.equal(partial.data.rows[0].pending, true);
    assert.equal(partial.complete, false); assert.equal(Object.hasOwn(bob.observed.at(-1), "speculative"), false);
    const profile = await bob.client.query(query("remoteProfile"), {});
    // LLP 3000.023 §11: post cannot affect remoteProfiles; the served answer settles.
    assert.deepEqual(profile.data, { id: "old", name: "remote" });
    assert.equal(profile.complete, true);
    assert.equal(bob.queries.at(-1).path, "/q/remoteProfile", "unrelated profiles are not fenced by a pending post");
    bob.offline = true; await bob.client.sync();
    const offline = await bob.client.query(query("withProfile"), {});
    assert.equal(offline.denied?.code, "E_OFFLINE");
    const offlinePartial = await bob.client.query(query("partialWithProfile"), {});
    assert.equal(offlinePartial.data.rows[0].post.id, "own-profile"); assert.equal(offlinePartial.complete, false);
  });

  test(`bounded Following ${tier}: a late card miss and oversized withheld output still use fallback`, { timeout: hangBudget(6) }, async t => {
    const f = await fixture(t, tier, undefined, source => source.replace("sync public\n\ntable follows", "sync public last 3 by .at\n\ntable follows") + `
query cappedCard(postId: posts):
  for i in range(0, 8192):
    burn = posts['p3']
  return { card: posts[postId] }
query cappedRepost(postId: posts):
  for i in range(0, 8192):
    burn = posts['p3']
  return { card: reposts[viewer, postId] }
query oversized(postId: posts, payload: text <=600):
  card = posts[postId]
  padding = []
  for i in range(0, 2048):
    padding = padding + [payload]
  return { card, padding }
`), bob = await f.open("bob");
    const cases = [["cappedCard", { postId: "old" }], ["cappedRepost", { postId: "p0" }], ["oversized", { postId: "old", payload: "x".repeat(600) }]];
    bob.offline = true; await bob.client.sync();
    for (const [name, input] of cases) {
      assert.equal((await bob.client.query(query(name), input)).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
      const raw = bob.observed.at(-1);
      assert.equal(raw.loading, true); assert.equal(raw.unknown, true);
      assert.equal("data" in raw, false); assert.equal("next" in raw, false);
      assert.equal(raw.denied, undefined);
    }
    bob.offline = false; await bob.client.sync();
    for (const [name, input] of cases) {
      const before = bob.queries.length;
      const online = await bob.client.query(query(name), input);
      assert.equal(bob.queries.length, before + 1);
      assert.deepEqual(bob.queries.at(-1), { path: `/q/${name}`, args: input });
      if (name === "oversized") assert.equal(online.denied.code, "E_BOUND", "the actual server output stays bounded");
      else assert.equal(online.cut, "meter");
    }
  });

  test(`bounded Following ${tier}: untaken online-only card branches remain answerable when held`, { timeout: hangBudget(5) }, async t => {
    const f = await fixture(t, tier, "online only", source => source + `
query conditional(want: bool, postId: posts) held:
  if want:
    return exists posts[postId]
  return false
query conditionalGet(want: bool, postId: posts) held:
  if want:
    return posts[postId]
  return null
`), bob = await f.open("bob");
    for (const offline of [false, true]) {
      bob.offline = offline; await bob.client.sync();
      for (const [name, data] of [["conditional", false], ["conditionalGet", null]]) {
        const before = bob.queries.length;
        const skipped = await bob.client.query(query(name), { want: false, postId: "p3" });
        assert.equal(skipped.data, data); assert.equal(skipped.complete, true);
        const required = await bob.client.query(query(name), { want: true, postId: "p3" });
        assert.equal(required.denied?.code, offline ? "E_OFFLINE" : "E_QUERY_RETRY");
        assert.equal(required.denied.retryable, true, "changing want makes this held query answerable without a program change");
        assert.equal(bob.queries.length, before, "held queries never dispatch, including their executed card reads");
      }
    }
  });

  test(`bounded Following ${tier}: composed reads withhold the entire answer across the prediction fence`, { timeout: hangBudget(13) }, async t => {
    const f = await fixture(t, tier, undefined, source => source + `
query composed(c: cursor ?):
  rows = feed last 20 by .at after c { *, post: posts[.post] }
  edges = follows first 20
  return { rows, edges }
`), bob = await f.open("bob");
    const op = query("composed"), input = { c: null };
    bob.offline = true; await bob.client.sync();
    assert.equal((await bob.client.query(op, input)).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
    bob.offline = false; await bob.client.sync(); bob.holdWrites = true;
    await bob.client.mutate(mutation("post"), { postId: "own-composed", parentId: null, at: 20 });
    assert.ok((await bob.core.call({ op: "queued" })).ok.some(e => e.predictable));
    const before = bob.queries.length;
    assert.equal((await bob.client.query(op, input)).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
    assert.equal(bob.queries.length, before);
    bob.holdWrites = false;
    await until(async () => { await bob.client.sync(); return (await bob.core.call({ op: "queued" })).ok.length === 0; }, "composed prediction not observed");
    const answer = await bob.client.query(op, input);
    assert.ok(answer.data.rows.some(row => row.post.id === "own-composed"));
    assert.ok(answer.data.rows.some(row => row.post.id === "old"));
    bob.failQueries = true;
    assert.equal((await bob.client.query(op, input)).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
  });

  test(`bounded Following ${tier}: exact offline pages, original-cursor fallback and quiet authors`, { timeout: hangBudget(18) }, async t => {
    const f = await fixture(t, tier), bob = await f.open("bob");
    const first = await bob.client.query(query("cards"), { c: null });
    assert.equal(first.complete, true);
    assert.deepEqual(first.data.map(row => row.post.id), ["p3", "p2"]);
    const input = { c: first.next };
    assert.ok(input.c);
    bob.offline = true; await bob.client.sync();
    assert.deepEqual((await bob.client.query(query("cards"), { c: null })).data.map(row => row.post.id), ["p3", "p2"]);
    assert.equal((await bob.client.query(query("cards"), input)).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
    assert.equal((await bob.client.query(query("required"), { postId: "old" })).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
    const local = bob.observed.find(read => read.request.name === "cards" && read.request.args.c === input.c);
    assert.equal(local.loading, true); assert.equal(local.unknown, true);
    assert.equal("data" in local, false); assert.equal("next" in local, false);
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
    assert.equal((await reader.client.query(query("cards"), { c: null })).denied?.code, reader.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
    reader.offline = false; await reader.client.sync();
    assert.equal((await reader.client.query(query("cards"), { c: null })).data[0].post.id, "old");
  });

  test(`bounded Following ${tier}: a predicted post fences fallback until observation`, { timeout: hangBudget(14) }, async t => {
    const f = await fixture(t, tier), bob = await f.open("bob");
    bob.holdWrites = true;
    const write = await bob.client.mutate(mutation("post"), { postId: "own", parentId: null, at: 20 });
    assert.equal(write.state, "pending");
    const queued = (await bob.core.call({ op: "queued" })).ok;
    assert.equal(queued[0].predictable, true);
    const metadata = await bob.client.query(query("wideMetadata"), {});
    assert.equal(metadata.data[0].post, "own"); assert.equal(metadata.data[0].pending, true);
    const before = bob.queries.length;
    assert.equal((await bob.client.query(query("wide"), { c: null })).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
    assert.equal(bob.queries.length, before, "no fallback can drop the predicted row");
    bob.holdSync = true; bob.holdWrites = false;
    // Let the outbox acknowledge, while retaining its actual sync response.
    await until(async () => (await bob.core.call({ op: "queued" })).ok.some(entry => entry.sent_seq != null && entry.observed_seq == null), "write was not acknowledged before observation");
    assert.equal(bob.client.link(), "online");
    assert.equal((await bob.client.query(query("wide"), { c: null })).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
    assert.equal(bob.queries.length, before);
    bob.holdSync = false; f.releaseSync();
    await until(async () => { await bob.client.sync(); return (await bob.core.call({ op: "queued" })).ok.length === 0; }, "write was not observed");
    const answer = await bob.client.query(query("wide"), { c: null });
    assert.ok(answer.data.some(row => row.post.id === "own"));
    assert.ok(answer.data.some(row => row.post.id === "old"));
    assert.ok(bob.queries.length > before);
    assert.deepEqual(answer.data, (await f.request("/q/wide", "bob", { c: null })).data);
  });

  test(`bounded Following ${tier}: online-only cards withhold offline`, { timeout: hangBudget(8) }, async t => {
    const f = await fixture(t, tier, "online only", source => source + "\nquery globalRows():\n  return posts last 2 by .at\n"), bob = await f.open("bob");
    assert.equal((await bob.client.query(query("cards"), { c: null })).data.length, 2);
    const global = await bob.client.query(query("globalRows"), {});
    bob.offline = true; await bob.client.sync();
    assert.equal((await bob.client.query(query("cards"), { c: null })).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
    assert.equal((await bob.client.query(query("home"), { c: null })).complete, true);
    const partial = await bob.client.query(query("globalRows"), {});
    assert.deepEqual(partial.data, global.data); assert.equal(partial.fresh, false);
    assert.ok(partial.since > 0, "an empty online-only scan recovers its last server answer");
  });

  test(`bounded Following ${tier}: repost prediction needs a held original`, { timeout: hangBudget(4) }, async t => {
    const f = await fixture(t, tier), bob = await f.open("bob");
    bob.holdWrites = true;
    for (const [postId, predicts] of [["p0", false], ["p3", true]]) {
      const write = await bob.client.mutate(mutation("repost"), { postId, at: 20 });
      assert.equal(write.state, "pending");
      const entry = (await bob.core.call({ op: "queued" })).ok.find(entry => entry.id === write.id);
      assert.equal(entry.predictable, predicts);
      assert.equal(entry.predicted.length > 0, predicts);
    }
  });

  test(`bounded Following ${tier}: held cards and transport failures stay withheld`, { timeout: hangBudget(8) }, async t => {
    const f = await fixture(t, tier, undefined, source => source + "\nquery heldCards(c: cursor ?) held:\n  return feed last 2 by .at after c { *, post: posts[.post] }\n"), bob = await f.open("bob");
    const first = await bob.client.query(query("cards"), { c: null }), input = { c: first.next };
    const before = bob.queries.length;
    assert.equal((await bob.client.query(query("heldCards"), input)).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
    assert.equal(bob.queries.length, before, "held queries never dispatch");
    assert.equal((await bob.client.query(query("cards"), input)).data.length, 2);
    bob.failQueries = true;
    assert.equal((await bob.client.query(query("cards"), input)).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY", "a remembered answer cannot mask transport failure");
    bob.offline = true; await bob.client.sync();
    assert.equal((await bob.client.query(query("cards"), input)).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
  });

  test(`bounded Following ${tier}: online-only repost cards use the prediction fence before server routing`, { timeout: hangBudget(17) }, async t => {
    const f = await fixture(t, tier, "sync public", source => source.replace("sync public\n\ntable follows", "online only\n\ntable follows") + "\nquery repostCards(c: cursor ?):\n  return feed last 20 by .at after c { *, repostCard: reposts[.actor, .post] }\n"), bob = await f.open("bob");
    const op = query("repostCards"), input = { c: null };
    assert.ok("data" in await bob.client.query(op, input));
    bob.offline = true; await bob.client.sync();
    assert.equal((await bob.client.query(op, input)).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY", "no remembered online-only cards");
    bob.offline = false; await bob.client.sync(); bob.holdWrites = true;
    assert.equal((await bob.client.mutate(mutation("post"), { postId: "own", parentId: null, at: 20 })).state, "pending");
    assert.equal((await bob.core.call({ op: "queued" })).ok[0].predictable, true);
    const before = bob.queries.length;
    assert.equal((await bob.client.query(op, input)).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
    assert.equal(bob.queries.length, before);
    bob.holdSync = true; bob.holdWrites = false;
    await until(async () => (await bob.core.call({ op: "queued" })).ok.some(e => e.sent_seq != null && e.observed_seq == null), "prediction not acknowledged");
    assert.equal((await bob.client.query(op, input)).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
    assert.equal(bob.queries.length, before);
    bob.holdSync = false; f.releaseSync();
    await until(async () => { await bob.client.sync(); return (await bob.core.call({ op: "queued" })).ok.length === 0; }, "prediction not observed");
    assert.ok((await bob.client.query(op, input)).data.some(row => row.post === "own"));
    bob.failQueries = true;
    assert.equal((await bob.client.query(op, input)).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
  });

  test(`bounded Following ${tier}: a response racing prediction admission is invalidated`, { timeout: hangBudget(6) }, async t => {
    const f = await fixture(t, tier), bob = await f.open("bob");
    bob.holdQueries = true;
    const result = bob.client.query(query("wide"), { c: null });
    await until(() => bob.queries.length > 0, "fallback not dispatched");
    bob.holdWrites = true;
    await bob.client.mutate(mutation("post"), { postId: "racing", parentId: null, at: 20 });
    bob.holdQueries = false; f.releaseSync();
    assert.equal((await result).denied?.code, "E_QUERY_RETRY", "the response predating admission cannot replace a prediction");
    assert.equal((await bob.client.query(query("wideMetadata"), {})).data[0].post, "racing");
  });

  test(`bounded Following ${tier}: repost horizon misses withhold but full-source nulls remain data`, { timeout: hangBudget(6) }, async t => {
    const point = "\nquery repostPoint(actor: principal, postId: posts):\n  return reposts[actor, postId]\nquery optional(postId: posts):\n  return posts[postId]\n";
    const f = await fixture(t, tier, "sync public", source => source.replace("sync public\n\ntable follows", "sync public last 1 by .at\n\ntable follows") + point), bob = await f.open("bob");
    const input = { actor: "dev:bob", postId: "p3" };
    assert.equal((await bob.client.query(query("repostPoint"), input)).data, null);
    bob.offline = true; await bob.client.sync();
    assert.equal((await bob.client.query(query("repostPoint"), input)).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
    assert.equal((await bob.client.query(query("optional"), { postId: "missing" })).data, null);
  });

  test(`bounded Following ${tier}: inbox floors use all routing branches and preserve meter prefixes`, { timeout: hangBudget(27) }, async t => {
    const extra = `
mutation bulk(at: time):
  for n in range(0, 200):
    insert posts { authorId: viewer, parentId: null, at: at + n }
query inbox(c: cursor ?):
  return feed last 200 by .at after c
query crossing(c: cursor ?):
  return feed last 201 by .at after c
query heldCrossing(c: cursor ?) held:
  return feed last 201 by .at after c
query cut(c: cursor ?):
  for i in range(0, 8):
    burn = posts first 1000
  return feed last 300 by .at after c
`;
    const f = await fixture(t, tier, "sync public", source => source + extra);
    for (let n = 0; n < 6; n++) await f.mutate("bulk", "alice", { at: 1000 + n * 200 });
    const alice = await f.open("alice");
    alice.offline = true; await alice.client.sync();
    const cut = await alice.client.query(query("cut"), { c: null });
    assert.equal(cut.complete, false); assert.equal(cut.cut, "meter");
    assert.ok(cut.next && cut.data.length > 0 && cut.data.length < 300);
    let c = null;
    for (let n = 0; n < 4; n++) {
      const page = await alice.client.query(query("inbox"), { c });
      assert.equal(page.complete, true); assert.equal(page.data.length, 200); c = page.next;
    }
    const input = { c }, edge = await alice.client.query(query("inbox"), input);
    assert.equal(edge.complete, true); assert.equal(edge.data.length, 200); assert.ok(edge.next);
    assert.equal((await alice.client.query(query("inbox"), { c: edge.next })).denied?.code, alice.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
    assert.equal((await alice.client.query(query("crossing"), input)).denied?.code, alice.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
    alice.offline = false; await alice.client.sync();
    const before = alice.queries.length;
    assert.equal((await alice.client.query(query("heldCrossing"), input)).denied?.code, alice.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
    assert.equal(alice.queries.length, before);
    const answered = await alice.client.query(query("crossing"), input);
    assert.deepEqual(answered.data, (await f.request("/q/crossing", "alice", input)).data);
    assert.equal(answered.data.length, 201);
    assert.ok(alice.queries.some(q => q.path === "/q/crossing" && q.args.c === c));
    alice.failQueries = true;
    assert.equal((await alice.client.query(query("crossing"), input)).denied?.code, alice.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
    alice.failQueries = false; await alice.client.sync(); alice.holdWrites = true;
    await alice.client.mutate(mutation("post"), { postId: "floor-pending", parentId: null, at: 3000 });
    const sent = alice.queries.length;
    assert.equal((await alice.client.query(query("crossing"), input)).denied?.code, alice.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
    assert.equal(alice.queries.length, sent);
    alice.holdSync = true; alice.holdWrites = false;
    await until(async () => (await alice.core.call({ op: "queued" })).ok.some(e => e.sent_seq != null && e.observed_seq == null), "inbox prediction not acknowledged");
    assert.equal((await alice.client.query(query("crossing"), input)).denied?.code, alice.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
    assert.equal(alice.queries.length, sent);
    alice.holdSync = false; f.releaseSync();
    await until(async () => { await alice.client.sync(); return (await alice.core.call({ op: "queued" })).ok.length === 0; }, "inbox prediction not observed");
    assert.equal((await alice.client.query(query("crossing"), input)).data.length, 201);
    alice.holdWrites = true;
    await alice.client.mutate(mutation("follow"), { actor: "dev:quiet" });
    assert.ok((await alice.core.call({ op: "queued" })).ok.every(e => e.predictable === false));
    assert.equal((await alice.client.query(query("crossing"), input)).denied?.code, "E_QUERY_RETRY", "a one-shot cannot acknowledge an unobserved nonpredictable intent");
  });
}

test("bounded Following native query module: executed dependencies fence fallback until prediction observation", { timeout: hangBudget(26) }, async t => {
  const f = await fixture(t, "native", undefined, source => source + `
query native_cards(postId: posts, c: text <=2000 ?): native
query native_held(postId: posts, c: text <=2000 ?) held: native
`, true), bob = await f.open("bob");
  assert.ok((await bob.core.call({ op: "state" })).ok.native, "the actual guest module is installed");
  const program = (await bob.core.call({ op: "backend" })).ok.programs.find(p => p.name === "native_cards");
  assert.equal(program.native, true); assert.deepEqual(program.body, [], "there are no static Quarry dependencies");
  const first = await bob.client.query(query("native_cards"), { postId: "p3", c: null });
  assert.deepEqual(first.data.rows.map(row => row.postId), ["p3", "p2"]);
  assert.ok(first.data.next);
  const input = { postId: "old", c: first.data.next }, op = query("native_cards");
  const raw = (await bob.core.call({ op: "query", name: op.name, viewer: "dev:bob", args: input, now: Date.now() })).ok;
  assert.equal(raw.loading, true, `native_query must propagate query_unavailable: ${JSON.stringify(raw)}`);
  assert.equal(raw.unknown, true); assert.equal("data" in raw, false); assert.equal("next" in raw, false);
  assert.equal(raw.speculative, true, "native card misses carry engine provenance");
  assert.ok(raw.tables.includes("posts") && raw.tables.includes("feedFeed"));
  bob.offline = true; await bob.client.sync();
  assert.equal((await bob.client.query(op, input)).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
  assert.equal((await bob.client.query(op, { postId: "p3", c: null })).data.original.id, "p3", "held native reads still answer offline");
  bob.offline = false; await bob.client.sync();
  const beforeHeld = bob.queries.length;
  assert.equal((await bob.client.query(query("native_held"), input)).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
  assert.equal(bob.queries.length, beforeHeld);
  const remote = await bob.client.query(op, input);
  assert.equal(remote.data.original.id, "old");
  assert.equal(remote.data.rows.length, 2);
  assert.ok(remote.data.rows.every(row => !first.data.rows.some(previous => previous.id === row.id)), "the original cursor must advance the native scan");
  assert.deepEqual(remote.data, (await f.request("/q/native_cards", "bob", input)).data);
  assert.deepEqual(bob.queries.at(-1), { path: "/q/native_cards", args: input });
  bob.failQueries = true;
  assert.equal((await bob.client.query(op, input)).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY", "no remembered server answer on transport failure");
  bob.failQueries = false; await bob.client.sync(); bob.holdWrites = true;
  const pending = await bob.client.mutate(mutation("post"), { postId: "own-native", parentId: null, at: 20 });
  assert.equal(pending.state, "pending");
  assert.ok((await bob.core.call({ op: "queued" })).ok.some(e => e.predictable && e.observed_seq == null));
  const before = bob.queries.length;
  assert.equal((await bob.client.query(op, input)).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
  assert.equal(bob.queries.length, before, "server data cannot replace an unobserved native prediction");
  bob.holdSync = true; bob.holdWrites = false;
  await until(async () => (await bob.core.call({ op: "queued" })).ok.some(e => e.sent_seq != null && e.observed_seq == null), "native prediction not acknowledged");
  assert.equal((await bob.client.query(op, input)).denied?.code, bob.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY");
  assert.equal(bob.queries.length, before);
  bob.holdSync = false; f.releaseSync();
  await until(async () => { await bob.client.sync(); return (await bob.core.call({ op: "queued" })).ok.length === 0; }, "native prediction not observed");
  const observed = await bob.client.query(op, { ...input, c: null });
  assert.ok(observed.data.rows.some(row => row.postId === "own-native"));
  assert.equal(observed.data.original.id, "old");
  assert.deepEqual(observed.data, (await f.request("/q/native_cards", "bob", { ...input, c: null })).data);
});
