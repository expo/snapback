// @ref LLP 3000.023#10 — fixture notifications precede sync, including failed sync.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { opener, q, parked, until } from './answers-stay.mjs';
import { MixedModel } from './mixed-evidence-oracle.mjs';
const turn = () => new Promise(resolve => setImmediate(resolve));

export async function notificationSchedule({ createLocalClient, answerObservation, host, seed, f, backend, frames, empty, typing, rand, clock, trace, closing }) {
  const model = new MixedModel(), change = Promise.withResolvers(), sync = Promise.withResolvers(), entered = Promise.withResolvers();
  const device = opener(host, join(f.dir, `notification-${seed}`));
  const readFails = !!rand(2), old = Promise.withResolvers(), oldEntered = Promise.withResolvers();
  let client, watch, ephemeral, phase = 'ready', sent = false, head = 1, reads = 0, hold = false;
  const failures = [];
  const capture = label => {
    const read = watch.getSnapshot(); trace.push([label, model.cut, read]);
    try { model.observe(read, clock.get()); } catch (e) { failures.push(e.message); }
  };
  try {
    client = await createLocalClient({ url: f.url, persona: 'bob', device: { async open(...args) {
      const core = await device.open(...args);
      return { ...core, async call(request, committed) {
        const result = await core.call(request, committed);
        if (request.op === 'query' && request.name === 'item') {
          if (hold) { hold = false; oldEntered.resolve(); await old.promise; }
          else if (phase === 'notified') {
            reads++;
            assert.equal(result.ok.data.body, 'image-1', 'injected notification still precedes replica publication');
            if (readFails) { model.failed(); throw Error('scheduled old replica read failure'); }
          }
        }
        return result;
      } };
    } }, fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/schema') return Response.json(backend);
      if (path === '/changes') {
        await Promise.race([change.promise, parked(init.signal)]);
        if (sent) return parked(init.signal);
        sent = true;
        model.apply(2, clock.get());
        return Response.json({ seq: frames[2].watermark, tables: ['members', 'messages'] });
      }
      if (path === '/probe') return parked(init.signal);
      if (path === '/sync') {
        if (phase === 'notified') {
          entered.resolve(); await Promise.race([sync.promise, parked(init.signal)]);
          model.failed(); throw Error('scheduled sync failure after notification');
        }
        const { from } = JSON.parse(init.body);
        return Response.json(frames.slice(1, head + 1).find(p => p.watermark > from) ?? empty[head]);
      }
      if (path === '/q/typingIn') {
        if (phase === 'offline-ephemeral') throw Error('scheduled plain ephemeral transport failure');
        // Keep the real envelope/epoch and give this fixture replay its own
        // four-second lifetime. The server fixture is captured once per host.
        return Response.json({ ...typing, seq: frames[head].watermark, head: frames[head].watermark, nextExpiry: clock.get() + 4000 });
      }
      return fetch(input, init);
    } });
    await client.sync(); watch = client.observe(q('item'), {});
    watch.subscribe(() => capture('notification-path'));
    await until(() => watch.getSnapshot().data?.body === 'image-1');
    // A pre-notification observation completion crosses the notification too.
    // Deleting answers.changed must remove its version fence AND pending cut.
    watch.close(); hold = true; watch.subscribe(() => capture('crossed-notification'));
    await oldEntered.promise;
    if (rand(2)) { old.resolve(); for (let n = 0; n < 3; n++) await turn(); }
    phase = 'notified'; change.resolve(); await entered.promise; old.resolve();
    await until(() => reads > 0);
    for (let n = 0; n < 5 + rand(5); n++) await turn();
    capture('old-replica-complete');
    clock.set(model.deadline); capture('notification-deadline');
    sync.resolve();
    await until(() => client.link() === 'offline');
    for (let n = 0; n < 5 + rand(5); n++) await turn();
    capture('failed-sync');
    assert.equal(watch.getSnapshot().loading, true, 'notification plus failed sync never reinstalls old replica');
    phase = 'recover'; head = 2; await client.sync();
    await until(() => watch.getSnapshot().data === null); capture('applied-notification');
    watch.close();

    ephemeral = client.observe(q('typingIn'), { room: 'room' });
    await until(() => ephemeral.getSnapshot().data?.length === 1);
    const confirmedAt = clock.get();
    // Expected authority and lifetime come from the injected reply above.
    // This checker never consults SDK admission, deadlines or answer identity.
    const expiry = confirmedAt + 4000;
    const captureEphemeral = () => {
      const read = ephemeral.getSnapshot(); trace.push(['ephemeral-offline', clock.get(), read]);
      if (phase !== 'offline-ephemeral') return;
      if (clock.get() < expiry && (!('data' in read) || read.data.length !== 1)) failures.push('plain offline ephemeral answer withdrawn before fixture expiry');
      if ('data' in read && (read.fresh !== false || read.since !== confirmedAt || !read.revalidating)) failures.push('plain offline ephemeral metadata differs from fixture');
    };
    ephemeral.subscribe(captureEphemeral);
    const owner = answerObservation(ephemeral.getSnapshot());
    clock.set(confirmedAt + 50 + rand(500)); phase = 'offline-ephemeral';
    await client.query(q('typingIn'), { room: 'room' });
    await until(() => !owner.running);
    for (let n = 0; n < 5 + rand(5); n++) await turn();
    captureEphemeral();
    assert.deepEqual([...new Set(failures)], []);
  } finally {
    old.resolve(); sync.resolve(); change.resolve();
    watch?.close(); ephemeral?.close();
    // close fences synchronously; only its one-second failed-follow sleep is
    // still draining. The caller bounds and awaits these shutdowns in batches.
    if (client) closing.push(client.close());
  }
}
