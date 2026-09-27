import test from "node:test";
import assert from "node:assert/strict";
import { answerIdentity } from "../dist/read-observation.js";
import { fixture } from "./helpers/authority-fixture.mjs";

const q = { kind: "query", name: "read" };
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }

for (const keep of [undefined, false, true]) test(`seeded shared approval invariants, keep=${keep}`, async t => {
  const coverage = new Map(), opts = keep === undefined ? undefined : { keep };
  for (let seed = 1; seed <= 60; seed++) await t.test(`seed ${seed}`, async t => {
    let host = 1000, server = 1000, random = seed, serial = 0, refusalEpoch = 0, mayShowData = true;
    const pick = n => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random % n; };
    t.mock.method(Date, "now", () => host);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = fixture(t, keep ?? "default"), pending = [], records = [], trace = [];
    const rows = new WeakMap(), episodes = new WeakMap();
    let openingCheck = false;
    f.gateChecks(() => {
      const gate = { ...Promise.withResolvers(), epoch: refusalEpoch, owner: f.owner(), opening: openingCheck };
      pending.push(gate); return gate.promise;
    });
    const open = () => {
      openingCheck = true;
      const watch = f.client.observe(q, {}, opts);
      openingCheck = false;
      const record = { watch, closed: false, closedCalls: 0, last: watch.getSnapshot(), events: [] };
      watch.subscribe(() => { record.last = watch.getSnapshot(); record.events.push(record.last); });
      records.push(record);
    };
    const begin = read => {
      if (keep !== undefined || !read || !("data" in read)) return;
      const id = answerIdentity(read);
      if (!episodes.has(id)) episodes.set(id, host + 1000);
    };
    t.after(() => {
      for (const record of records) record.watch.close();
      for (const gate of pending) gate.resolve(true);
    });
    open(); open(); // Both openings precede creation of the raw owner.
    for (let step = 0; step < 240; step++) {
      const live = records.filter(record => !record.closed), owner = f.owner();
      const choices = ["open", "host", "server"];
      if (owner) choices.push("publish", "publish", "reset", "reload");
      if (pending.length) choices.push("approve", "approve", "reject");
      if (live.length) choices.push("close");
      const action = choices[pick(choices.length)];
      coverage.set(action, (coverage.get(action) ?? 0) + 1); trace.push(action);
      if (action === "open") open();
      if (action === "publish") {
        for (const record of live) begin(record.watch.getSnapshot());
        const deadline = server + 1 + pick(2200);
        f.publish(`answer ${++serial}`, { server: deadline });
        rows.set(answerIdentity(owner.snapshot), deadline);
      }
      if (action === "reload") {
        begin(owner.snapshot);
        for (const record of live) begin(record.watch.getSnapshot());
        owner.reload(); for (const notify of owner.subscribers) notify();
      }
      if (action === "approve" || action === "reject") {
        const index = pick(pending.length), [gate] = pending.splice(index, 1);
        trace[trace.length - 1] += ` ${index}@${gate.epoch}`;
        if (action === "approve") {
          if (gate.epoch === refusalEpoch) mayShowData = true;
          gate.resolve(true);
        } else {
          // A detached handle of a retired raw owner cannot revoke a later
          // owner's approvals. Opening checks address the current watch at completion.
          if (gate.opening || gate.owner === f.owner()) { refusalEpoch++; mayShowData = false; }
          gate.reject(Error(`rejection ${step}`));
        }
      }
      if (action === "close") {
        const record = live[pick(live.length)], read = record.watch.getSnapshot();
        record.identity = "data" in read ? answerIdentity(read) : undefined;
        record.closed = true; record.watch.close(); record.closedCalls = record.events.length;
      }
      if (action === "reset") {
        refusalEpoch++; mayShowData = false;
        owner.reset({ loading: true }); for (const notify of owner.subscribers) notify();
      }
      if (action === "host") {
        const elapsed = 1 + pick(1200); host += elapsed;
        // Alternate timer delivery and synchronous access with timers suspended.
        if (pick(2)) t.mock.timers.tick(elapsed);
      }
      if (action === "server") {
        server += 1 + pick(1200); f.setWall(server);
        if (pick(2)) f.clock.sample(server, server, server, `sample:${step}`);
      }
      await settle();
      for (const [index, record] of records.entries()) {
        const context = `seed=${seed}, step=${step}, facade=${index}: ${trace.join(", ")}`;
        const current = record.watch.getSnapshot();
        if (record.closed) {
          assert.equal(record.events.length, record.closedCalls, `closed facade is silent: ${context}`);
          if ("data" in current) assert.equal(answerIdentity(current), record.identity, `closed facade adopts identity: ${context}`);
        } else {
          assert.equal(current, record.last, `getter changed without callback: ${context}`);
          if (!mayShowData) assert.ok(!("data" in current), `older success undoes refusal/reset: ${context}`);
        }
        if ("data" in current) {
          const id = answerIdentity(current), row = rows.get(id), episode = episodes.get(id);
          assert.ok(row !== undefined && server < row, `identity outlives its own row: ${context}`);
          if (episode !== undefined) {
            assert.ok(host < episode, `identity outlives its own episode: ${context}`);
            assert.equal(current.revalidating, true, `retained identity lost mark: ${context}`);
          }
        }
        assert.equal(record.watch.getSnapshot(), current, `snapshot is stable: ${context}`);
      }
    }
  });
  for (const action of ["publish", "approve", "reject", "open", "close", "host", "server", "reload", "reset"])
    assert.ok(coverage.get(action) > 0, `${action} is exercised`);
});
