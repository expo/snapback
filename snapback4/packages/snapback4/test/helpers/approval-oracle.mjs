import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { answerIdentity } from "../../dist/read-observation.js";
import { fixture } from "./authority-fixture.mjs";

const q = { kind: "query", name: "read" };
const loading = () => ({ kind: "loading" });
const denied = message => ({ kind: "denied", code: "E_CLIENT", message: `Error: ${message}` });
const auth = { kind: "denied", code: "E_AUTH", message: "session ended" };
const microtasks = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

// This oracle never reads ReadApprovals, its generation, or a facade's data to
// decide what is authorized. Raw publications are inputs; checks carry the
// facade lifetime, raw owner and eligibility they had when they started.
export function approvalOracle(t, keep) {
  let host = 1000, server = 1000, device = 1000, serial = 0, fenced = false;
  const context = new AsyncLocalStorage(), owners = new Map(), records = [], pending = [], completed = [], errors = [], trace = [];
  const opts = keep === undefined ? undefined : { keep };
  t.mock.method(Date, "now", () => host);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(t, keep ?? "default", {
    bind: listener => AsyncLocalStorage.bind(listener),
    checking(promise) {
      const gate = context.getStore().lastCheck;
      // Observe only the injected check's completion, never the facade's result.
      // The extra microtask puts the model at the authority-consumer boundary:
      // a new check started by an earlier opening in this batch still precedes
      // a later refusal, even though both gates were resolved before settle().
      const completedCheck = () => queueMicrotask(() => { completed.push({ gate, error: gate.error }); finish(); });
      promise.then(completedCheck, completedCheck);
    },
    acquired(raw) {
      finish();
      const record = context.getStore();
      assert.ok(record.opened && !record.closed && !fenced, "only an eligible opening acquires a source");
      let owner = owners.get(raw);
      if (!owner) owners.set(raw, owner = { rawHandle: raw, raw: loading(), approved: loading(), epoch: 0, registered: false, retired: false });
      record.source = record.associated = owner;
    },
  });
  const currentOwner = () => owners.get(f.owner());
  const associate = owner => {
    for (const record of records) if (!record.closed && !record.source && currentOwner() === owner) record.associated = owner;
  };
  const invalidate = owner => {
    owner.epoch++;
    for (const gate of pending) if (!gate.opening && gate.owner === owner) gate.eligible = false;
  };
  const withdraw = (owner, value = loading()) => {
    invalidate(owner); owner.approved = value; owner.registered = false; associate(owner);
  };
  const mark = value => value.kind !== "data" || value.revalidating ? value
    : { ...value, revalidating: true, episode: keep === undefined ? host + 1000 : undefined };
  const rowDue = value => value.kind === "data" &&
    ((value.server !== null && server >= value.server) || (value.device !== null && device >= value.device));
  const episodeDue = value => value.kind === "data" && value.episode !== undefined && host >= value.episode;
  const latch = () => {
    for (const owner of owners.values()) {
      if (owner.retired) continue;
      if (rowDue(owner.raw) || episodeDue(owner.raw)) {
        owner.raw = loading(); withdraw(owner);
        for (const record of records) if (record.source === owner) record.latest = undefined;
      } else if (rowDue(owner.approved) || episodeDue(owner.approved)) {
        // Expiry of held A alone does not invalidate a pending check of raw B.
        owner.approved = loading(); associate(owner);
      }
    }
  };
  function finish() {
    for (const { gate, error } of completed.splice(0)) {
      const record = gate.record;
      if (error) {
        const owner = gate.opening ? record.source ?? currentOwner() ?? record.associated : gate.owner;
        let value = denied(error);
        if (gate.opening && !record.closed && owner?.approved.kind === "denied" && owner.epoch !== gate.epoch) value = owner.approved;
        if (record.closed) record.frozen = value;
        if (owner) {
          // Live source withdrawals have synchronous precedence over a late
          // authority refusal; an opening on a retired source has no such peer.
          const sourceWins = owner.raw.kind !== "data" && records.some(peer => !peer.closed && peer.source === owner);
          withdraw(owner, sourceWins ? owner.raw : value);
        }
        else record.private = value;
      } else if (!record.closed && !fenced) {
        if (gate.opening) record.opened = true; // Acquisition starts another check; this is not approval.
        else if (gate.eligible && record.latest === gate && gate.owner.epoch === gate.epoch) {
          const owner = gate.owner;
          if (owner.raw.kind === "data") {
            owner.approved = { ...owner.raw }; owner.registered = true; associate(owner);
          }
        }
      }
    }
  }
  f.gateChecks(() => {
    finish();
    const record = context.getStore();
    assert.ok(record, "every check belongs to a facade, including asynchronous refreshes");
    const opening = !record.started;
    record.started = true;
    const owner = record.source ?? record.associated;
    const gate = { ...Promise.withResolvers(), record, owner, opening, epoch: owner?.epoch, eligible: !record.closed && !fenced };
    record.lastCheck = gate;
    if (!opening) record.latest = gate;
    pending.push(gate);
    return gate.promise;
  });
  const open = () => {
    const record = { number: records.length, associated: currentOwner(), private: loading(), events: [], closed: false };
    records.push(record);
    record.watch = context.run(record, () => f.client.observe(q, {}, opts));
    record.last = record.watch.getSnapshot();
    record.watch.subscribe(() => {
      // Preserve failures outside notify()'s listener-exception isolation.
      try {
        const snapshot = record.watch.getSnapshot();
        assert.equal(record.closed, false, "closed facades never notify");
        assert.notEqual(snapshot, record.last, "duplicate intermediate callback");
        assert.equal(record.watch.getSnapshot(), snapshot, "callback snapshot equals the getter at delivery");
        record.events.push(snapshot); record.last = snapshot;
      } catch (error) { errors.push(error); }
    });
    return record;
  };
  const expected = record => {
    if (fenced) return auth;
    if (!record.closed) {
      if (record.source && record.source.raw.kind !== "data") return record.source.raw;
      return record.associated?.approved ?? record.private;
    }
    let value = record.frozen;
    const source = record.source ?? currentOwner();
    if (value.kind === "denied") return value;
    if (source?.raw.kind === "denied") return record.frozen = source.raw;
    if (!source || source.raw.kind !== "data" || value.kind !== "data" || source.raw.id !== value.id || episodeDue(value))
      return record.frozen = loading();
    return source.raw;
  };
  const assertAll = () => {
    latch();
    if (errors.length) throw errors[0];
    for (const record of records) {
      const want = expected(record), read = record.watch.getSnapshot();
      const label = `facade ${record.number}: ${trace.join(" / ")}`;
      assert.equal("data" in read ? "data" : "denied" in read ? "denied" : "loading", want.kind, label);
      if (want.kind === "data") {
        assert.equal(read.data, want.id, `approved answer: ${label}`);
        assert.equal(answerIdentity(read), want.identity, `approved identity: ${label}`);
        assert.equal(!!read.revalidating, !!want.revalidating, `revalidation: ${label}`);
        assert.ok(!rowDue(want) && !episodeDue(want), `own deadlines: ${label}`);
      }
      if (want.kind === "denied") {
        assert.equal(read.denied.code, want.code, `denial code: ${label}`);
        assert.equal(read.denied.message, want.message, `denial delivery: ${label}`);
      }
      if (!record.closed) assert.equal(read, record.last, `getter changed without callback: ${label}`);
      else assert.equal(record.events.length, record.closedCalls, `closed callbacks: ${label}`);
      assert.equal(record.watch.getSnapshot(), read, `stable getter: ${label}`);
    }
    if (errors.length) throw errors[0];
  };
  const settle = async () => { await microtasks(); finish(); assertAll(); };
  const complete = (gate, error) => {
    assert.ok(pending.includes(gate), "complete only a pending check");
    pending.splice(pending.indexOf(gate), 1);
    gate.error = error;
    trace.push(`${error ? "reject" : "approve"} f${gate.record.number} ${gate.opening ? "opening" : "refresh"}`);
    if (error) gate.reject(Error(error)); else gate.resolve(true);
  };
  const publish = (deadlines = {}) => {
    latch();
    const owner = currentOwner(), value = { kind: "data", id: `answer ${++serial}`, server: null, device: null, ...deadlines };
    trace.push(`publish ${value.id}`);
    owner.raw = value;
    if (owner.registered) {
      if (keep === false) withdraw(owner);
      else { owner.approved = mark(owner.approved); associate(owner); }
    }
    f.publish(value.id, deadlines);
    value.identity = answerIdentity(f.owner().snapshot);
  };
  const reload = () => {
    latch(); const owner = currentOwner(); trace.push("reload");
    if (keep === false) { owner.raw = loading(); withdraw(owner); }
    else { owner.raw = mark(owner.raw); if (owner.registered) owner.approved = mark(owner.approved); }
    f.owner().reload(); for (const notify of f.owner().subscribers) notify();
  };
  const reset = () => {
    const owner = currentOwner(); trace.push("reset"); owner.raw = loading(); withdraw(owner);
    f.owner().reset({ loading: true }); for (const notify of f.owner().subscribers) notify();
  };
  const retire = owner => {
    owner.retired = true; owner.raw = loading(); if (owner.registered) withdraw(owner);
  };
  const close = record => {
    latch(); trace.push(`close f${record.number}`);
    record.frozen = { ...expected(record) }; record.closed = true;
    record.watch.close(); record.closedCalls = record.events.length;
    if (record.source && !f.owner()) retire(record.source);
  };
  const time = (kind, amount, timers = false) => {
    trace.push(`${kind} ${amount}`);
    if (kind === "host") host = Math.max(0, host + amount);
    if (kind === "server") { server = Math.max(0, server + amount); device = Math.max(device, server); f.setWall(server); }
    if (kind === "device") device += amount;
    latch();
    if (kind === "device") f.clock.raiseIssued(device);
    if (timers && amount > 0) t.mock.timers.tick(amount);
  };
  const expireLinger = () => {
    const owner = currentOwner(); trace.push("linger expires"); retire(owner); t.mock.timers.tick(30_000);
  };
  const fence = () => {
    trace.push("fence"); fenced = true;
    for (const owner of owners.values()) invalidate(owner);
    f.facade.fence()();
  };
  t.after(() => {
    fenced = true;
    for (const record of records) { record.closed = true; record.watch.close(); }
    for (const gate of pending) gate.resolve(true);
  });
  return { open, publish, complete, settle, close, reload, reset, time, expireLinger, fence, pending, records, trace,
    currentOwner, clocks: () => ({ host, server, device }) };
}
