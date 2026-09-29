import { readyRead } from "../dist/read-presence.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalReads } from '../dist/local-reads.js';
import { ReadObservation } from '../dist/read-observation.js';

test('a local commit unconditionally retires retained answers and in-flight publication', async () => {
  const reads = new LocalReads(), watch = Object.assign(new ReadObservation(), { expiryTimer: null });
  watch.publish(readyRead({ data: ['private'], complete: true, cut: null, fresh: true }));
  let release;
  const fetch = watch.fetch(() => new Promise(resolve => { release = resolve; }), () => {}, { retain: true });
  assert.equal(watch.kept, true);
  reads.serverAnswers.set("read:{}", { read: watch.snapshot, at: 1, nextExpiry: null, tables: new Set(["private"]) }, { seq: 0, ticket: reads.serverAnswers.begin() });
  assert.ok(reads.serverAnswers.get("read:{}"), "the answer was remembered");
  reads.clear([watch]);
  assert.equal(reads.serverAnswers.get("read:{}"), undefined, "a local commit retires remembered answers too");
  assert.equal(reads.revision, 1);
  assert.deepEqual(watch.snapshot, { loading: true });
  release({ read: readyRead({ data: ['private'], complete: true, cut: null, fresh: true }) });
  assert.deepEqual((await fetch).read, { loading: true });
  assert.deepEqual(watch.snapshot, { loading: true });
});

test('clearing starts the order again: a replaced store\'s first answer is remembered at any cut', () => {
  const reads = new LocalReads();
  reads.serverAnswers.delete("read:{}", { seq: 100, ticket: reads.serverAnswers.begin() });
  reads.clear([]);
  reads.serverAnswers.set("read:{}", { read: readyRead({ data: ['new store'], complete: true, cut: null, fresh: true }), at: 1, nextExpiry: null, tables: new Set() }, { seq: 1, ticket: reads.serverAnswers.begin() });
  assert.deepEqual(reads.serverAnswers.get("read:{}")?.read.data, ['new store'], "the old store's cut 100 orders nothing after a clear");
});
