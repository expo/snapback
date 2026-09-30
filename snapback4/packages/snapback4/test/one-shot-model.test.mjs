// @ref LLP 3000.023#11 — the oracle stores admitted values, not SDK read state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { setup, q, m, until } from './helpers/one-shot.mjs';

for (const tier of ['wasm', 'process']) test(`${tier}: seeded one-shot/write/link/deadline/close model`, { timeout: 120_000 }, async t => {
  let random = 0x515330;
  const pick = n => { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; return (random >>> 0) % n; };
  const coverage = new Set();
  for (let session = 0; session < 12; session++) {
    await t.test(`session ${session}`, async t => {
      const realNow = Date.now; let offset = 0, deadlineNext = false;
      t.mock.method(Date, 'now', () => realNow() + offset);
      const gates = [];
      t.after(() => gates.forEach(g => g.resolve()));
      const f = await setup(t, tier, { fetch: async (path, init, send) => {
        const response = await send();
        if (path !== '/q/profile' || !deadlineNext) return response;
        const json = await response.json(); json.nextExpiry = Date.now() + 60_000;
        return Response.json(json);
      } });
      let admitted = 0, closed = false;
      const trace = [], inflight = [];
      async function write() {
        const value = admitted + 1;
        const outcome = await f.client.mutate(m('edit'), { body: String(value) }, { waitSeconds: 0 });
        assert.ok(['sent', 'pending'].includes(outcome.state), JSON.stringify(outcome));
        admitted = value; trace.push(`write ${value}`); coverage.add('write');
      }
      function start(name = 'item') {
        const floor = admitted, started = performance.now();
        trace.push(`query ${name} after ${floor}`); coverage.add('query');
        const result = f.client.query(q(name), {}).then(read => {
          assert.ok(performance.now() - started < 30_000, trace.join(' / '));
          assert.equal('loading' in read, false, trace.join(' / '));
          if ('data' in read) {
            if (name === 'item') {
              const value = read.data.body === 'image-1' ? 0 : Number(read.data.body);
              assert.ok(value >= floor && value <= admitted, `${value} outside [${floor},${admitted}]: ${trace.join(' / ')}`);
            } else assert.equal(read.data?.name, 'Bob');
          } else assert.ok(['E_OFFLINE', 'E_QUERY_RETRY', 'E_CLOSED', 'E_AUTH'].includes(read.denied.code), JSON.stringify(read));
          return read;
        });
        inflight.push(result); return result;
      }
      await write();
      for (let event = 0; event < 18; event++) {
        const choice = pick(6);
        if (choice === 0) await write();
        if (choice === 1) start();
        if (choice === 2) {
          const gate = Promise.withResolvers(); gates.push(gate);
          let reached = false;
          f.controls.boundary = async () => { if (reached) return; reached = true; await gate.promise; };
          const read = start(); await until(() => reached); await write(); gate.resolve(); await read;
          delete f.controls.boundary; coverage.add('concurrent-write');
        }
        if (choice === 3) {
          await f.offline(); trace.push('offline'); coverage.add('offline');
          await write();
          const read = await start(); assert.equal(read.data?.body, String(admitted), 'device reflects the admitted offline prediction');
        }
        if (choice === 4) {
          f.link(true); await f.client.sync(); trace.push('online'); coverage.add('online');
          const read = await start(); assert.equal(read.data?.body, String(admitted));
        }
        if (choice === 5) {
          f.link(true); await f.client.sync();
          deadlineNext = true; let crossed = false;
          f.controls.boundary = async () => {
            if (crossed) return; crossed = true; offset += 120_000; deadlineNext = false;
          };
          await start('profile'); delete f.controls.boundary;
          trace.push('expiry'); coverage.add('expiry');
        }
      }
      const gate = Promise.withResolvers(); gates.push(gate); let reached = false;
      f.controls.boundary = async () => { reached = true; await gate.promise; };
      const final = start(); await until(() => reached);
      closed = true; trace.push('close'); coverage.add('close');
      const closing = f.client.close();
      const watchdog = new AbortController();
      try {
        const read = await Promise.race([final, delay(2000, undefined, { signal: watchdog.signal }).then(() => { throw Error(`close did not settle: ${trace.join(' / ')}`); })]);
        assert.equal(read.denied?.code, 'E_CLOSED');
      } finally { watchdog.abort(); gate.resolve(); }
      await closing; await Promise.all(inflight);
      assert.equal(closed, true);
    });
  }
  assert.deepEqual([...coverage].sort(), ['query', 'write', 'concurrent-write', 'offline', 'online', 'expiry', 'close'].sort());
});
