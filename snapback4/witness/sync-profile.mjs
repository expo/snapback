// Diagnostic preload for the unchanged Node scale witness. Writes timing and
// physical IDB work beside SS_PROFILE; use --cpu-prof for sampled wasm stacks.
// SS_PROFILE=target/profile node --import ./witness/sync-profile.mjs witness/sync-scale.mjs ...
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { WebDevice } from '../packages/snapback4/dist/wasm/snapback4_device.js';
import { IDBDatabase, IDBObjectStore } from 'fake-indexeddb';
const output = process.env.SS_PROFILE;
if (!output) throw new Error('SS_PROFILE is required');
const start = performance.now(), calls = [], transactions = [], json = {};
const monotonicStartMs = Number(process.hrtime.bigint()) / 1e6;
let phase = 'host';
for (const method of ['parse', 'stringify']) {
  const original = JSON[method];
  JSON[method] = function (...args) {
    const at = performance.now();
    try { return original.apply(this, args); }
    finally {
      const metric = json[`${phase}.${method}`] ??= { calls: 0, ms: 0 };
      metric.calls++; metric.ms += performance.now() - at;
    }
  };
}
for (const method of ['call', 'drain']) {
  const original = WebDevice.prototype[method];
  WebDevice.prototype[method] = function (...args) {
    const request = method === 'call' ? JSON.parse(args[0]) : undefined;
    const at = performance.now(), before = phase;
    phase = `wasm.${request?.op ?? method}`;
    let result;
    try { return result = original.apply(this, args); }
    finally {
      calls.push({ op: request?.op ?? method, rows: request?.page?.events?.length,
        snapshot: request?.page?.snapshot, catchup: request?.page?.snapshot_catchup,
        at: at - start, ms: performance.now() - at, inputChars: args[0]?.length, outputChars: result?.length });
      phase = before;
    }
  };
}
const active = new WeakMap();
const transaction = IDBDatabase.prototype.transaction;
IDBDatabase.prototype.transaction = function (...args) {
  const tx = transaction.apply(this, args), at = performance.now();
  const metric = { at: at - start, mode: tx.mode, ms: 0, gets: 0, puts: 0, deletes: 0, bytes: 0, issueMs: 0, stores: {} };
  transactions.push(metric); active.set(tx, metric);
  for (const event of ['complete', 'abort']) tx.addEventListener(event, () => {
    metric.ms = performance.now() - at; metric.outcome = event;
  });
  return tx;
};
for (const [method, count] of [['get', 'gets'], ['put', 'puts'], ['delete', 'deletes']]) {
  const original = IDBObjectStore.prototype[method];
  IDBObjectStore.prototype[method] = function (...args) {
    const metric = active.get(this.transaction);
    if (metric) {
      metric[count]++;
      if (method === 'put') {
        const bytes = Buffer.byteLength(JSON.stringify(args[0]));
        metric.bytes += bytes;
        const store = metric.stores[args[0].s] ??= { puts: 0, bytes: 0 };
        store.puts++; store.bytes += bytes;
      }
    }
    const at = performance.now(), before = phase;
    phase = `idb.${method}`;
    try { return original.apply(this, args); }
    finally { if (metric) metric.issueMs += performance.now() - at; phase = before; }
  };
}
process.on('exit', () => writeFileSync(`${output}.json`, JSON.stringify({ monotonicStartMs, calls, transactions, json }, null, 2)));
