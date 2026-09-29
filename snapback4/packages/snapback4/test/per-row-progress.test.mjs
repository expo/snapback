// @ref LLP 3000.023#10 — pending replicas resume on sync; expired server answers use paced work.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { sdk, fixture, source, opener, q, parked, until } from './helpers/answers-stay.mjs';
const { createLocalClient } = await import(new URL('local.js', sdk));
const { createClient } = await import(new URL('client.js', sdk));
const { answerObservation } = await import(new URL('read-observation.js', sdk));
const { episodeDeadline } = await import(new URL('read-episode.js', sdk));
const { ReadWork } = await import(new URL('read-work.js', sdk));

function heartbeat(signal) {
  let timer, stopped = false;
  return new Response(new ReadableStream({
    start(controller) {
      const stop = () => { if (!stopped) { stopped = true; clearInterval(timer); controller.close(); } };
      if (signal.aborted) { stop(); return; }
      timer = setInterval(() => controller.enqueue(new Uint8Array([32])), 1000);
      signal.addEventListener('abort', stop, { once: true });
    },
    cancel() { stopped = true; clearInterval(timer); },
  }));
}

for (const host of ['process', 'wasm']) for (const keep of [undefined, true, false]) for (const heldQuery of [false, true]) {
  test(`${host}: omitted change tables recover a disjoint local profile, keep=${keep}${heldQuery ? ", held" : ""}`, async t => {
    const f = await fixture(t, source.replace('  online only', '  sync public').replace('query profile():', heldQuery ? 'query profile() held:' : 'query profile():'));
    const change = Promise.withResolvers(), sync = Promise.withResolvers();
    const device = opener(host, join(f.dir, host));
    let evidence, delivered = false, held = false, reads = 0;
    const applied = [], retries = [];
    const retry = ReadWork.prototype.retry;
    t.mock.method(ReadWork.prototype, 'retry', function(watch, ms, run) {
      if (watch.op?.name === 'profile') retries.push(ms);
      return retry.call(this, watch, ms, run);
    });
    const client = await createLocalClient({ url: f.url, persona: 'bob', device: { async open(...args) {
      const core = await device.open(...args);
      return { ...core, async call(request, committed) {
        const result = await core.call(request, committed);
        if (held && request.op === 'query' && request.name === 'profile') {
          reads++; assert.equal(result.ok.data.name, 'Bob');
          assert.equal(result.ok.complete, true, 'the disjoint profile is locally complete');
        }
        if (held && request.op === 'apply') applied.push(...result.ok.touched);
        return result;
      } };
    } }, fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/changes') {
        await Promise.race([change.promise, parked(init.signal)]);
        if (delivered) return heartbeat(init.signal);
        delivered = true; return Response.json(evidence);
      }
      if (held && path === '/probe') return parked(init.signal); // Reconnect cannot mask a stranded watch.
      if (held && path === '/sync') await Promise.race([sync.promise, parked(init.signal)]);
      return fetch(input, init);
    } });
    t.after(async () => { change.resolve(); sync.resolve(); await client.close(); });
    await client.sync();
    const profile = client.observe(q('profile'), {}, { keep }), item = client.observe(q('item'), {}, { keep });
    await until(() => profile.getSnapshot().data?.name === 'Bob' && item.getSnapshot().data?.body === 'image-1');
    const owner = answerObservation(profile.getSnapshot());
    assert.deepEqual([...owner.tables], ['profiles']);
    const receipt = await f.post('/m/edit', { id: 'edit', args: { body: 'image-2' } });
    evidence = { seq: receipt.seq }; // No tables field: all watches acquire a pending cut.
    held = true; change.resolve();
    await until(() => owner.waitingForSync && !owner.running, 'pending replica awaits its cut outside a work slot');
    assert.equal(owner.changeCut, receipt.seq);
    const deadline = episodeDeadline(profile.getSnapshot());
    await delay(120); // Ordinary retries stay paced; only held queries park.
    if (heldQuery) assert.equal(reads, 0, 'held replica performs no obsolete work');
    else assert.ok(reads > 0 && reads <= 5, `pending cut spun ${reads} profile reads`);
    sync.resolve();
    await until(() => item.getSnapshot().data?.body === 'image-2', 'messages sync applied');
    assert.deepEqual([...new Set(applied)], ['messages'], 'sync does not reschedule profiles by footprint');
    await until(() => profile.getSnapshot().data?.name === 'Bob' && !profile.getSnapshot().revalidating,
      'disjoint profile settles after its pending cut clears');
    assert.ok(reads > 0, 'sync publication resumes the disjoint pending owner');
    if (heldQuery) assert.deepEqual(retries, [], 'held resumption needs no retry timer');
    else {
      assert.ok(retries.length > 0, 'ordinary pending-cut rejection keeps fallback retries');
      assert.deepEqual(retries, retries.map((_, n) => Math.min(25 * 2 ** n, 1000)), 'ordinary retries stay paced');
    }
    if (deadline !== undefined) {
      t.mock.method(Date, 'now', () => deadline + 1);
      assert.equal(profile.getSnapshot().data?.name, 'Bob', 'the retired episode cannot later strand the profile in loading');
    }
  });
}

for (const warm of [false, true]) for (const keep of [undefined, true, false]) {
  test(`online: already-expired replies recover through paced work, warm=${warm}, keep=${keep}`, async t => {
    const f = await fixture(t);
    let stale = false, replies = 0;
    let work, attempt;
    const schedule = ReadWork.prototype.schedule;
    t.mock.method(ReadWork.prototype, 'schedule', function(watch, run) {
      if (watch.op?.name === 'profile') { work = this; attempt = run; }
      return schedule.call(this, watch, run);
    });
    const retries = [], retry = ReadWork.prototype.retry;
    t.mock.method(ReadWork.prototype, 'retry', function(watch, ms, run) {
      if (watch.op?.name === 'profile') retries.push(ms);
      return retry.call(this, watch, ms, run);
    });
    const client = createClient({ url: f.url, persona: 'bob', fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/changes') return parked(init.signal);
      const response = await fetch(input, init);
      if (stale && path === '/q/profile') {
        const body = await response.json();
        return Response.json(++replies <= 5
          ? { ...body, data: { ...body.data, name: 'expired' }, nextExpiry: Date.now() - 60_000 }
          : { ...body, data: { ...body.data, name: 'current' }, nextExpiry: null });
      }
      return response;
    } });
    t.after(() => client.close());
    await client.query(q('profile'), {}); // Finish schema/session discovery.
    stale = !warm;
    const watch = client.observe(q('profile'), {}, { keep }), seen = [];
    watch.subscribe(() => seen.push(watch.getSnapshot()));
    if (warm) {
      await until(() => watch.getSnapshot().data?.name === 'Bob');
      const owner = answerObservation(watch.getSnapshot());
      await until(() => !owner.inFlight);
      stale = true;
      // Explicit plain revalidation through the captured production attempt;
      // a keep:true resubscription alone can reuse its still-current linger.
      owner.reload(); work.schedule(owner, attempt);
    }
    await until(() => watch.getSnapshot().data?.name === 'current', 'expired-body retries reach the current answer without a notification');
    assert.equal(replies, 6);
    assert.deepEqual(retries, [25, 25, 25, 25, 25], 'each expired reply returns to the paced queue');
    assert.ok(seen.every(read => read.data?.name !== 'expired'), 'expired bodies never publish');
    assert.equal(watch.getSnapshot().revalidating, undefined);
  });
}
