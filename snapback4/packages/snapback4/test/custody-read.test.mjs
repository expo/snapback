import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryCustody } from '../dist/query-custody.js';
import { custodyReads, releaseCustody } from './helpers/custody-read.mjs';
import { hangBudget } from './helpers/wait.mjs';

function fixture(t) {
  const abort = new AbortController(), listeners = new Set();
  let held = true;
  const custody = new QueryCustody(() => null,
    async () => held ? [{ op: 'write', predictable: false }] : [],
    notify => { listeners.add(notify); return () => listeners.delete(notify); },
    () => null, async () => {}, () => false);
  t.after(() => abort.abort());
  return {
    wait: () => custody.wait('read', {}, abort.signal),
    release() { held = false; for (const notify of listeners) notify(); },
    read: custodyReads(t),
  };
}

// Wait entry can precede public settlement by microtasks or queued macrotasks.
// Both fulfillment and rejection must prevent the actual gate opening, even
// when a healthy sibling is first or POST has already been released.
for (const phase of ['POST', 'apply']) for (const outcome of ['answer', 'rejection']) {
  for (const delay of [0, 2, 8, 64, 'setTimeout(0)', 'two immediates']) {
    const scheduling = typeof delay === 'number' ? `${delay} microtasks` : delay;
    test(`custody release: late ${outcome} after ${scheduling} before ${phase}`, { timeout: hangBudget() }, async t => {
      const f = fixture(t), publish = Promise.withResolvers();
      const healthy = f.read({ async query() { await f.wait(); return { data: 'observed' }; } }, { name: 'healthy' }, {});
      const broken = f.read({ async query() {
        void f.wait().catch(() => {});
        await publish.promise;
        if (delay === 'setTimeout(0)') await new Promise(resolve => setTimeout(resolve, 0));
        else if (delay === 'two immediates') {
          await new Promise(resolve => setImmediate(resolve));
          await new Promise(resolve => setImmediate(resolve));
        } else for (let i = 0; i < delay; i++) await Promise.resolve();
        if (outcome === 'rejection') throw new Error('early rejection');
        return { data: 'unchanged' };
      } }, { name: 'broken' }, {});
      // Observe rejection immediately; it still marks this read settled.
      void broken.promise.catch(() => {});
      void healthy.promise.catch(() => {});
      await Promise.all([healthy.withheld(), broken.withheld()]);
      let postReleased = false, applyReleased = false;
      if (phase === 'apply') await releaseCustody([healthy, broken], () => { postReleased = true; });
      publish.resolve();
      await assert.rejects(releaseCustody([healthy, broken], () => {
        if (phase === 'POST') postReleased = true;
        else applyReleased = true;
        f.release();
      }), { code: 'ERR_ASSERTION', message: 'broken: settled while custody was held\n\ntrue !== false\n' });
      assert.equal(postReleased, phase === 'apply');
      assert.equal(applyReleased, false);
    });
  }
}

test('custody release: original and fresh reads stay held across POST and apply', { timeout: hangBudget() }, async t => {
  const f = fixture(t), client = { async query() { await f.wait(); return { data: 'observed' }; } };
  const original = f.read(client, { name: 'read' }, {});
  await original.withheld();
  let posted = false;
  await releaseCustody([original], () => { posted = true; });
  assert.equal(posted, true);
  const fresh = f.read(client, { name: 'read' }, {});
  await fresh.withheld();
  await releaseCustody([original, fresh], () => f.release());
  assert.deepEqual(await Promise.all([original.promise, fresh.promise]), [{ data: 'observed' }, { data: 'observed' }]);
});
