// @ref LLP 3000.016#2.2 — expiry retry recovery and transport retain the publication rules.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalClient } from "../dist/local.js";
import { ServerClock } from "../dist/clock.js";
import { answerIdentity } from "../dist/read-observation.js";
import { processDevice } from "../dist/native.js";
import { memoryPersistence, webDevice } from "../dist/web.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const wasm = readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm"));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) {
  const end = Date.now() + 10000;
  do { if (await check()) return; await sleep(10); } while (Date.now() < end);
  assert.fail(message);
}
function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}
const source = `use personas alice
use identity guests
table permits:
  principal: principal
  expiresAt: time
  expire at .expiresAt
  by byExpiresAt: expiresAt
  read <- .principal = viewer
  sync to .principal
table notes:
  at: time
  body: text <=40
  by byTime: at, id
  public 'held pagination witness'
  sync public
table audits:
  at: time
  body: text <=40
  by byTime: at, id
  public 'remote expiry witness'
  online only
query expiryBranch():
  if exists permits['permit']:
    return false
  if exists permits['later']:
    return exists audits['a1']
  return true
query branch():
  if exists audits['a1']:
    return true
  if exists permits['permit']:
    return false
  return true
query expirySecret():
  if exists permits['permit']:
    return {secret: 'private', remote: false}
  return {secret: '', remote: exists audits['a1']}
shape pageCard = {body, at}
query expiryPage(c: cursor ?):
  if exists permits['permit']:
    return notes after c last 3 by .at pageCard
  return audits after c last 3 by .at pageCard
`;

for (const tier of ["wasm", "process"]) for (const scenario of ["chained permits", "populated watch", "server pagination", "server pagination watch", "remembered branch", "remembered branch watch", "remembered branch timer watch"]) {
  test(`expiry retry ${scenario} ${tier}`, { timeout: 30000 }, async t => {
    const directory = mkdtempSync(join(tmpdir(), "sb4-expiry-retry-"));
    mkdirSync(join(directory, "snapback"));
    writeFileSync(join(directory, "snapback/schema.q"), source);
    const child = spawn(binary, ["dev", "--port", "0", "--fresh", "--no-watch"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
    const exit = once(child, "exit");
    let log = "", url, client, live, stop;
    const localGate = gate(), serverGate = gate();
    child.stdout.on("data", data => { log += data; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
    child.stderr.on("data", data => { log += data; });
    t.after(async () => {
      localGate.release(); serverGate.release(); stop?.(); live?.close(); await client?.close();
      if (child.exitCode == null && child.signalCode == null) child.kill("SIGTERM");
      await exit; rmSync(directory, { recursive: true, force: true });
    });
    await until(() => { assert.equal(child.exitCode, null, log); return url; }, "server did not listen");
    const post = (path, body) => fetch(`${url}${path}`, { method: "POST", headers: { "x-snapback-persona": "alice" }, body: JSON.stringify(body) }).then(r => r.json());
    const deadline = Date.now() + 3600000, later = deadline + 100;
    const rows = [
      { table: "permits", row: { id: "permit", principal: "dev:alice", expiresAt: deadline } },
      { table: "permits", row: { id: "later", principal: "dev:alice", expiresAt: later } },
      ...["notes", "audits"].flatMap(table => Array.from({ length: 6 }, (_, at) => ({ table, row: { id: `a${at}`, at, body: `${table}-${at}` } }))),
    ];
    assert.equal((await post("/seed", rows)).seeded, rows.length);
    let wall, clientClock, offline = false, freezeSync = false, interceptLocal, interceptServer;
    const clock = new ServerClock(() => wall ?? Date.now());
    const fork = clock.fork.bind(clock); clock.fork = () => clientClock = fork();
    const parked = signal => new Promise((_, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    const requests = [], replies = [], serverReplies = [];
    const deviceDir = join(directory, "device"); mkdirSync(deviceDir);
    const opener = tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() })
      : processDevice({ binary, dir: deviceDir, spawn: (cmd, args) => spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] }), writeFile: async (path, text) => writeFileSync(path, text) });
    client = await createLocalClient({ url, persona: "alice", waitSeconds: 1,
      fetch: clock.wrap(async (input, init) => {
        if (offline) throw new TypeError("test offline");
        const path = new URL(input).pathname;
        if (freezeSync && ["/sync", "/changes"].includes(path)) return parked(init.signal);
        if (path.startsWith("/q/")) {
          requests.push({ path, args: JSON.parse(init.body).args });
          await interceptServer?.();
        }
        const response = await fetch(input, init);
        if (freezeSync && ["/sync", "/changes"].includes(path)) return parked(init.signal);
        if (path.startsWith("/q/")) serverReplies.push(await response.clone().json());
        return response;
      }),
      device: { open: async (...args) => {
        const core = await opener.open(...args);
        return { close: () => core.close(), call: async request => {
          const reply = await core.call(request);
          if (request.op === "query") { replies.push({ request, reply }); await interceptLocal?.(request, reply); }
          return reply;
        } };
      } },
    });
    await client.sync();
    const remembered = scenario.startsWith("remembered branch");
    if (remembered) {
      const before = await client.query({ kind: "query", name: "branch" }, {});
      assert.equal(before.data, true); assert.equal(before.fresh, true);
      assert.equal(serverReplies.at(-1).nextExpiry, null, "the server branch never reads the permit");
      assert.equal(replies.at(-1).reply.ok.data, false, "the device takes the speculative permit branch");
    }
    if (scenario === "chained permits" || remembered) { offline = true; await client.sync(); }
    freezeSync = true;
    const setBoundary = now => {
      wall = now; clock.sample(now, now, now); clientClock.sample(now, now, now);
      assert.equal(client.now(), now);
    };
    if (scenario === "remembered branch timer watch") {
      setBoundary(deadline - 100);
      const reached = gate(); let calls = 0;
      interceptLocal = async (request, reply) => {
        if (request.name !== "branch") return;
        calls++;
        assert.equal(reply.ok.unknown, true); assert.equal(reply.ok.speculative, true);
        if (calls === 1) {
          assert.equal(request.now, deadline - 100);
          assert.equal(reply.ok.nextExpiry, deadline);
        } else {
          assert.equal(request.now, deadline); assert.equal(reply.ok.nextExpiry, null);
          reached.release(); await localGate.promise;
        }
      };
      const publications = [];
      live = client.observe({ kind: "query", name: "branch" }, {});
      stop = live.subscribe(() => publications.push(live.getSnapshot()));
      await until(() => publications.length === 1, "remembered page not published before its local wakeup");
      const before = live.getSnapshot(); assert.equal(before.data, true); assert.equal(before.fresh, false);
      wall = deadline;
      await reached.promise; // Timer fired; the device reobservation is held.
      assert.equal(calls, 2);
      // @ref LLP 3000.023#3.5 — re-read start retains the answer and marks the existing episode.
      assert.deepEqual(live.getSnapshot(), { ...before, revalidating: true }, "local wakeup preserves the remembered value, freshness and age");
      assert.equal(answerIdentity(live.getSnapshot()), answerIdentity(before));
      assert.equal(publications.length, 2, "the revalidating mark notifies without a loading reset");
      localGate.release();
      await until(() => publications.length === 3 && !live.getSnapshot().revalidating, "timer reobservation did not publish its replacement");
      assert.ok(publications.every(read => read.data === true && read.fresh === false));
      assert.deepEqual(requests, [{ path: "/q/branch", args: {} }]);
      return;
    }
    if (remembered) {
      setBoundary(deadline - 1);
      const reached = gate(); let calls = 0;
      interceptLocal = async (request, reply) => {
        if (request.name !== "branch") return;
        calls++;
        assert.equal(reply.ok.unknown, true); assert.equal(reply.ok.speculative, true);
        if (calls === 1) {
          assert.equal(request.now, deadline - 1);
          assert.equal(reply.ok.data, false); assert.equal(reply.ok.nextExpiry, deadline);
          reached.release(); await localGate.promise;
        } else {
          assert.equal(request.now, deadline);
          assert.equal(reply.ok.data, true); assert.equal(reply.ok.nextExpiry, null);
        }
      };
      const publications = [];
      let pending;
      if (scenario.endsWith("watch")) {
        live = client.observe({ kind: "query", name: "branch" }, {});
        stop = live.subscribe(() => publications.push(live.getSnapshot()));
      } else pending = client.query({ kind: "query", name: "branch" }, {});
      await reached.promise; wall = deadline; localGate.release();
      if (live) {
        await until(() => calls === 2 && publications.length >= 2, "elapsed wakeup must rerun without withdrawing valid memory");
        for (const read of publications) {
          assert.equal(read.data, true, "neither the placeholder nor an immediate loading reset may replace memory");
          assert.equal(read.fresh, false);
        }
      } else {
        const read = await pending;
        assert.equal(read.data, true); assert.equal(read.fresh, false);
        assert.equal(calls, 1, "a one-shot read can publish memory without reobserving the local branch");
      }
      assert.deepEqual(requests, [{ path: "/q/branch", args: {} }]);
      return;
    }
    const paginated = scenario.startsWith("server pagination");
    const name = scenario === "chained permits" ? "expiryBranch" : scenario === "populated watch" ? "expirySecret" : "expiryPage";
    const op = { kind: "query", name }, args = paginated ? { c: null } : {};
    const publications = [];
    if (scenario === "populated watch") {
      setBoundary(deadline - 60000);
      live = client.observe(op, args);
      stop = live.subscribe(() => publications.push(live.getSnapshot()));
      await until(() => live.getSnapshot().data?.secret === "private", "watch never acquired the pre-deadline value");
      // Reattach the same observation: it still holds data, but its old timer
      // cannot reset it and conceal erroneous retention in retry transport.
      stop(); live.close(); publications.length = 0;
    }
    setBoundary(deadline - 1);
    const reachedLocal = gate(), reachedServer = gate();
    let localCalls = 0;
    interceptLocal = async (request, reply) => {
      if (request.name !== name) return;
      if (++localCalls === 1) {
        assert.equal(request.now, deadline - 1);
        assert.equal(reply.ok.nextExpiry, deadline); assert.equal(reply.ok.unknown, false);
        reachedLocal.release(); await localGate.promise;
      } else if (localCalls === 2) {
        assert.equal(request.now, deadline);
        assert.equal(reply.ok.unknown, true); assert.equal(reply.ok.speculative, true);
        assert.equal(reply.ok.nextExpiry, scenario === "chained permits" ? later : null);
      }
    };
    let pending;
    if (scenario === "server pagination") pending = client.query(op, args);
    else {
      live ??= client.observe(op, args);
      if (paginated) {
        pending = new Promise(resolve => {
          stop = live.subscribe(() => {
            const read = live.getSnapshot(); publications.push(read);
            if ("data" in read) {
              // Inspect the first page, before a clock-triggered rerun can
              // replace it and conceal a cursor lost only on the retry.
              stop(); live.close(); resolve(read);
            }
          });
        });
      } else stop = live.subscribe(() => publications.push(live.getSnapshot()));
    }
    await reachedLocal.promise;
    if (!offline) {
      interceptServer = async () => { reachedServer.release(); await serverGate.promise; };
    }
    wall = deadline; localGate.release();
    if (scenario === "chained permits") {
      await until(() => localCalls === 2 && publications.length > 0, "retry recovery never published");
      assert.deepEqual(live.getSnapshot(), { loading: true });
      wall = later;
      await until(() => live.getSnapshot().data === true, "recovered loading lost T2 and stranded the idle watch");
      assert.equal(localCalls, 3); assert.equal(requests.length, 0);
      assert.equal(replies.at(-1).request.now, later);
    } else {
      await reachedServer.promise;
      assert.equal(localCalls, 2);
      if (live) {
        assert.deepEqual(live.getSnapshot(), { loading: true }, "the expired secret must be absent throughout the server round trip");
        assert.ok(publications.length > 0);
        for (const read of publications) assert.equal("data" in read, false, "no stale rebroadcast at fallback dispatch");
      }
      assert.equal((await post("/dev/clock/advance", { duration: "2h" })).advancedMs, 7200000);
      serverGate.release();
      if (live && !paginated) {
        await until(() => live.getSnapshot().data?.remote === true && live.getSnapshot().data?.secret === "", "post-deadline server answer missing");
      } else {
        const first = await pending;
        assert.deepEqual(first.data.map(row => row.body), ["audits-5", "audits-4", "audits-3"]);
        assert.ok(first.next, "server fallback after expiry must preserve its continuation");
        interceptLocal = undefined;
        const second = await client.query(op, { c: first.next });
        assert.deepEqual(second.data.map(row => row.body), ["audits-2", "audits-1", "audits-0"]);
        assert.deepEqual(requests.map(request => request.args), [{ c: null }, { c: first.next }]);
      }
    }
  });
}
