// @ref LLP 3000.016.000#4-publication-and-devices — replay the actual server's interrupted-copy trace on both hosts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { processDevice } from '../dist/native.js';

const root = new URL('../../../', import.meta.url);
const trace = JSON.parse(readFileSync(new URL('target/following-history-device.json', root), 'utf8'));
const wasm = readFileSync(new URL('packages/snapback4/src/wasm/snapback4_device_bg.wasm', root));
const ok = r => { assert.equal(r.denied, undefined, JSON.stringify(r)); return r.ok; };
for (const tier of ['wasm', 'process']) {
  test(`experimental history ${tier}: cold halfway, normalized completion, refollow, removal and restart`, { timeout: 120000 }, async t => {
    const dir = mkdtempSync(join(tmpdir(), 'sb4-history-'));
    const opener = tier === 'wasm' ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary: process.env.SNAPBACK4_BIN ?? new URL('target/debug/snapback4', root).pathname, dir });
    let core = await opener.open('reader', trace.backend);
    t.after(async () => { await core.close(); rmSync(dir, { recursive: true, force: true }); });
    const started = performance.now(); let acquireMs, initialBytes, finalBytes;
    for (const step of trace.steps) {
      if (step.reopen) { await core.close(); core = await opener.open('reader', null); }
      else if (step.op) ok(await core.call(step));
      else {
        const q = ok(await core.call({ op: 'query', name: 'home', viewer: 'reader', args: { c: null }, now: 5000 }));
        if (step.mustWithhold) assert.ok(q.loading && !q.complete, 'normalized retirement must wait for the image fence');
        if (step.check === 'pending') {
          assert.ok(q.loading && !q.complete, JSON.stringify(q));
          acquireMs = performance.now() - started;
          initialBytes = ok(await core.call({ op: 'residency' }));
          assert.equal(initialBytes.tables.feedFeed.rows, 1000);
        }
        if (step.check === 'complete') {
          assert.ok(q.complete && !q.loading, JSON.stringify(q));
          finalBytes = ok(await core.call({ op: 'residency' }));
          let next = q.next, withheld = false;
          while (next) {
            const older = ok(await core.call({ op: 'query', name: 'home', viewer: 'reader', args: { c: next }, now: 5000 }));
            if (older.loading) { withheld = true; assert.ok(older.next == null); break; }
            next = older.next;
          }
          assert.ok(withheld, 'the original fixed floor still withholds older pages');
        }
        if (q.complete && !q.loading) assert.deepEqual(q.data, trace.expected, 'completion must not precede the surviving above-floor copies');
      }
    }
    const result = { tier, acquireMs, completeMs: performance.now() - started, snapshotWireBytes: trace.snapshotWireBytes, initialBytes, finalBytes };
    console.log('HISTORY_DEVICE', JSON.stringify(result));
    if (process.env.FOLLOW_HISTORY_DEVICE_METRICS) writeFileSync(join(process.env.FOLLOW_HISTORY_DEVICE_METRICS, `${tier}.json`), JSON.stringify(result, null, 2));
  });
}
