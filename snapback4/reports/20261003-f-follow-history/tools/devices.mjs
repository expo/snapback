// Replay real server pages; no HTTP/network latency is implied by these timings.
import { createReadStream, readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { webDevice, memoryPersistence } from '../../../packages/snapback4/dist/web.js';
import { processDevice } from '../../../packages/snapback4/dist/native.js';
const [directory] = process.argv.slice(2);
assert.ok(directory, 'pass the FOLLOW_HISTORY_OUT directory');
const root = new URL('../../../', import.meta.url);
const wasm = readFileSync(new URL('packages/snapback4/src/wasm/snapback4_device_bg.wasm', root));
const ok = r => { assert.equal(r.denied, undefined, JSON.stringify(r)); return r.ok; };
for (const file of process.env.FOLLOW_HISTORY_STRESS ? ['stress-device'] : ['window-cold', 'all-cold']) {
 let expected, expectedPages;
 if (process.env.FOLLOW_HISTORY_STRESS) {
  expectedPages = JSON.parse(readFileSync(join(directory, 'stress-pages.json'), 'utf8'));
  for await (const line of createInterface({ input: createReadStream(join(directory, `${file}.ndjson`)) })) {
   const data = JSON.parse(line);if (data.check === 'complete') expected = data.expected;
  }
  assert.ok(expected, 'the server trace must include its completed-page oracle');
 }
 for (const tier of ['wasm', 'process']) {
  const dir = mkdtempSync(join(tmpdir(), 'history-scale-device-'));
  const opener = tier === 'wasm' ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary: process.env.SNAPBACK4_BIN ?? new URL('target/debug/snapback4', root).pathname, dir });
  let core, pages = 0, initial, before, initialMs, firstComplete, checkedPages = 0, streamBytes = 0, peakBytes = 0, peakWasmHeap = 0;const started = performance.now();
  try {
   for await (const line of createInterface({ input: createReadStream(join(directory, `${file}.ndjson`)) })) {
    const data = JSON.parse(line);
    if (data.backend) { core = await opener.open('reader', data.backend);before = performance.now(); }
    else if (data.check) {
     const query = ok(await core.call({ op: 'query', name: 'home', viewer: 'reader', args: { c: null }, now: 10010 }));
     if (data.check === 'pending') {
      assert.ok(query.loading && !query.complete, JSON.stringify(query));
      initial = ok(await core.call({ op: 'residency' }));initialMs = performance.now() - before;
      await core.close();core = await opener.open('reader', null);
     } else { assert.ok(query.complete && !query.loading, JSON.stringify(query));assert.deepEqual(query.data, data.expected); }
    } else {
     ok(await core.call({ op: 'apply', page: data, first: pages === 0 }));pages++;
     streamBytes += Buffer.byteLength(line);
     if (expectedPages) {
      const resident = ok(await core.call({ op: 'residency' }));
      peakBytes = Math.max(peakBytes, resident.totalBytes);peakWasmHeap = Math.max(peakWasmHeap, resident.wasmHeapBytes ?? 0);
     }
     if (!data.snapshot && expectedPages) {
      const query = ok(await core.call({ op: 'query', name: 'home', viewer: 'reader', args: { c: null }, now: 10010 }));
      // A remaining stream suffix can be irrelevant after the image fence.
      // Any published complete answer must already match the server oracle.
      if (query.complete && !query.loading) {
       assert.deepEqual(query.data, expected, 'premature complete page differs from the surviving above-floor copies');
       firstComplete ??= { pages, watermark: data.watermark, imagesAt: data.images_at, more: data.more };
      }
      let current = query, withheld = false;
      for (let n = 0; n < expectedPages.length; n++) {
       if (current.loading || !current.complete) { withheld = true; break; }
       assert.deepEqual(current.data, expectedPages[n], `stream page ${pages}, result page ${n}: complete archive page omitted or reordered rows`);
       checkedPages++;
       assert.ok(current.next, 'the server archive continues past this acquired floor');
       current = ok(await core.call({ op: 'query', name: 'home', viewer: 'reader', args: { c: current.next }, now: 10010 }));
      }
      assert.ok(withheld, 'crossing the fixed floor must withhold before the 4,000-row oracle ends');
     }
    }
   }
   const residency = ok(await core.call({ op: 'residency' }));
   const query = ok(await core.call({ op: 'query', name: 'home', viewer: 'reader', args: { c: null }, now: 10010 }));
   assert.ok(query.complete && !query.loading, JSON.stringify(query));
   const result = { file, tier, pages, streamBytes, initial, initialMs, firstComplete, checkedPages, peakBytes, peakWasmHeap, applyMs: performance.now() - before, wallMs: performance.now() - started, residency };
   console.log(JSON.stringify(result));writeFileSync(join(directory, `${file}-${tier}.json`), JSON.stringify(result, null, 2));
  } finally { await core?.close();rmSync(dir, { recursive: true, force: true }); }
 }
}
