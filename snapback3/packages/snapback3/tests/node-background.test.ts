import assert from "node:assert/strict";
import test from "node:test";
import { BackgroundOwner } from "../src/node/background.js";
import { OwnerError, type WorkerTransport } from "../src/node/worker.js";

async function until(check: () => boolean, label: string, timeout = 1_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!check() && Date.now() < deadline) await new Promise(done => setTimeout(done, 2));
  assert(check(), label);
}

test("background starts without clients, publishes only new commits, and polls idle jobs", async () => {
  let calls = 0;
  const commits: unknown[] = [];
  const worker: WorkerTransport = { async request(method) {
    assert.equal(method, "background.turn");
    calls++;
    return { at: Date.now(), timers: [], job: null, seq: calls < 3 ? 7 : 8, nextTimerAt: null, clockQueries: {} };
  } };
  const owner = new BackgroundOwner({ worker, pollMs: 5, onCommit: value => commits.push(value), onClock: () => {} });
  owner.start({ seq: 7, generation: "g" });
  await until(() => calls >= 4, "idle owner did not poll");
  await owner.close();
  assert.deepEqual(commits, [{ seq: 8 }]);
});

test("busy background turns yield through the event loop before continuing", async () => {
  let turns = 0;
  const worker: WorkerTransport = { async request() {
    turns++;
    return { at: Date.now(), timers: [], job: { state: "running" }, seq: 1, nextTimerAt: null, clockQueries: {} };
  } };
  const owner = new BackgroundOwner({ worker, onCommit: () => {}, onClock: () => {} });
  owner.start();
  await until(() => turns === 1, "first turn did not start");
  const foregroundObserved = await new Promise<number>(done => setTimeout(() => done(turns), 0));
  await owner.close();
  assert(foregroundObserved <= 2, "foreground work sat behind an unbounded background loop");
});

test("clock renewals name only declarations whose granularity elapsed", async () => {
  let at = 1_001, turns = 0;
  const clocks: readonly string[][] = [];
  const worker: WorkerTransport = { async request() {
    turns++;
    const value = { at, timers: [], job: null, seq: 4, nextTimerAt: null,
      clockQueries: { "clock.fast": { granularityMs: 10 }, "clock.slow": { granularityMs: 100 } } };
    at += 10;
    return value;
  } };
  const owner = new BackgroundOwner({ worker, pollMs: 1, now: () => at, onCommit: () => {}, onClock: operations => clocks.push([...operations]) });
  owner.start({ seq: 4 });
  await until(() => turns >= 12, "clock owner did not advance");
  await owner.close();
  assert(clocks.some(operations => operations.includes("clock.fast")));
  assert(clocks.some(operations => operations.includes("clock.slow")));
  assert(clocks.every(operations => operations.every(operation => operation.startsWith("clock."))));
});

test("an observed foreground commit coalesces wakeups and pokes effects", async () => {
  let turns = 0, effects = 0, effectClosed = false;
  const worker: WorkerTransport = { async request() {
    turns++;
    return { at: Date.now(), timers: [], job: null, seq: 9, nextTimerAt: null, clockQueries: {} };
  } };
  const owner = new BackgroundOwner({
    worker, pollMs: 10_000, onCommit: () => {}, onClock: () => {},
    effectRunner: { poke: () => { effects++; }, close: async () => { effectClosed = true; } },
  });
  owner.start({ seq: 9 });
  await until(() => turns >= 1, "initial turn did not run");
  const before = turns;
  owner.noteCommit({ seq: 10 }); owner.noteCommit({ seq: 10 });
  await until(() => turns > before, "commit did not wake background work");
  assert.equal(effects, 1);
  await owner.close();
  assert.equal(effectClosed, true);
});

test("a runtime/store fault is terminal and cannot reuse a stale due timer as a busy loop", async () => {
  let calls = 0;
  const failures: OwnerError[] = [];
  const worker: WorkerTransport = { async request() {
    calls++;
    if (calls === 1) return { at: Date.now(), timers: [], job: null, seq: 1, nextTimerAt: 0, clockQueries: {} };
    throw new OwnerError("S3_RUNTIME", "injected SQLite timer failure");
  } };
  const owner = new BackgroundOwner({
    worker, pollMs: 1, onCommit: () => {}, onClock: () => {}, onFatal: error => failures.push(error),
  });
  owner.start();
  await until(() => failures.length === 1, "store failure did not fail the background owner");
  const stoppedAt = calls;
  await new Promise(done => setTimeout(done, 30));
  assert.equal(calls, stoppedAt, "terminal store failure kept polling");
  assert.equal(failures[0].code, "S3_RUNTIME");
  await owner.close();
});

test("one-shot owner saturation backs off without failing and then makes progress", async () => {
  let calls = 0;
  const failures: OwnerError[] = [];
  const worker: WorkerTransport = { async request() {
    calls++;
    if (calls === 1) throw new OwnerError("S3_OWNER_BUSY", "foreground capacity is full");
    return { at: Date.now(), timers: [], job: null, seq: 2, nextTimerAt: null, clockQueries: {} };
  } };
  const owner = new BackgroundOwner({
    worker, pollMs: 10_000, busyRetryMs: 1, busyRetryMaxMs: 2,
    onCommit: () => {}, onClock: () => {}, onFatal: error => failures.push(error),
  });
  owner.start();
  await until(() => calls >= 2, "background work did not progress after one busy turn");
  assert.deepEqual(failures, []);
  await owner.close();
});

test("sustained owner saturation never consumes the transport failure budget", async () => {
  let calls = 0;
  const failures: OwnerError[] = [];
  const worker: WorkerTransport = { async request() {
    calls++;
    if (calls <= 20) throw new OwnerError("S3_OWNER_BUSY", "legitimate sustained saturation");
    return { at: Date.now(), timers: [], job: null, seq: 3, nextTimerAt: null, clockQueries: {} };
  } };
  const owner = new BackgroundOwner({
    worker, pollMs: 10_000, transportRetries: 0, busyRetryMs: 1, busyRetryMaxMs: 2,
    onCommit: () => {}, onClock: () => {}, onFatal: error => failures.push(error),
  });
  owner.start();
  await until(() => calls >= 21, "background work did not progress after sustained saturation");
  assert.deepEqual(failures, []);
  await owner.close();
});

test("worker transport loss retries with bounded backoff and resets after recovery", async () => {
  let calls = 0;
  const failures: OwnerError[] = [];
  const worker: WorkerTransport = { async request() {
    calls++;
    if (calls <= 2) throw new OwnerError("S3_WORKER_EXIT", `lost child ${calls}`);
    return { at: Date.now(), timers: [], job: null, seq: 1, nextTimerAt: null, clockQueries: {} };
  } };
  const owner = new BackgroundOwner({
    worker, pollMs: 10_000, transportRetries: 2, transportRetryMs: 5, transportRetryMaxMs: 10,
    onCommit: () => {}, onClock: () => {}, onFatal: error => failures.push(error),
  });
  owner.start();
  await until(() => calls >= 3, "transport did not recover through bounded retries");
  assert.deepEqual(failures, []);
  await owner.close();
});

test("repeated worker transport loss becomes terminal after the retry budget", async () => {
  let calls = 0;
  const failures: OwnerError[] = [];
  const worker: WorkerTransport = { async request() {
    calls++;
    throw new OwnerError("S3_WORKER_IO", "transport remains unavailable");
  } };
  const owner = new BackgroundOwner({
    worker, transportRetries: 1, transportRetryMs: 5,
    onCommit: () => {}, onClock: () => {}, onFatal: error => failures.push(error),
  });
  owner.start();
  await until(() => failures.length === 1, "exhausted transport retry did not fail owner");
  assert.equal(calls, 2);
  await new Promise(done => setTimeout(done, 30));
  assert.equal(calls, 2);
  await owner.close();
});
