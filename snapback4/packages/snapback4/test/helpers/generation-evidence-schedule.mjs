// @ref LLP 3000.023#10 — program-only generation changes are hard boundaries.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { opener, q, parked, until } from './answers-stay.mjs';
import { GenerationModel } from './mixed-evidence-oracle.mjs';
const turn = () => new Promise(resolve => setImmediate(resolve));

export async function generationSchedule({ createLocalClient, host, seed, f, oldBackend, nextBackend, generationFrames, rand, clock, trace, closing }) {
  const model = new GenerationModel(), change = Promise.withResolvers(), entered = Promise.withResolvers(), failed = Promise.withResolvers();
  const old = Promise.withResolvers(), oldEntered = Promise.withResolvers(), failures = [];
  const device = opener(host, join(f.dir, `generation-${seed}`));
  const readFails = !!rand(2), releaseEarly = !!rand(2);
  let client, watch, pending, phase = 'ready', sent = false, hold = false;
  const capture = label => {
    const read = watch.getSnapshot(); trace.push([label, phase, read]);
    try { model.observe(read); } catch (e) { failures.push(e.message); }
  };
  try {
    client = await createLocalClient({ url: f.url, persona: 'bob', device: { async open(...args) {
      const core = await device.open(...args);
      return { ...core, async call(request, committed) {
        const result = await core.call(request, committed);
        if (request.op === 'query' && request.name === 'item') {
          if (hold) { hold = false; oldEntered.resolve(); await old.promise; }
          else if (phase === 'notified') {
            failures.push('old replica evaluated before program adoption');
            if (readFails) throw Error('scheduled old program evaluation failure');
          }
        }
        return result;
      } };
    } }, fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/schema') return Response.json(phase === 'recover' ? nextBackend : oldBackend);
      if (path === '/changes') {
        await Promise.race([change.promise, parked(init.signal)]);
        if (sent) return parked(init.signal);
        sent = true; model.notify(); return Response.json(generationFrames.notification);
      }
      if (path === '/probe') return parked(init.signal);
      if (path === '/sync') {
        if (phase === 'notified') { entered.resolve(); await Promise.race([failed.promise, parked(init.signal)]); throw Error('scheduled adoption sync failure'); }
        const { from, generation } = JSON.parse(init.body);
        if (phase === 'recover' && generation !== nextBackend.generation) return Response.json(generationFrames.discovery);
        const frames = phase === 'recover' ? generationFrames.after : generationFrames.before;
        return Response.json(from === 0 ? frames.snapshot : frames.empty);
      }
      if (path === '/q/item') {
        if (phase === 'notified') throw Error('scheduled program query failure');
        return Response.json(generationFrames.denied);
      }
      return fetch(input, init);
    } });
    await client.sync(); watch = client.observe(q('item'), {});
    await until(() => watch.getSnapshot().data?.body === 'image-5');
    watch.subscribe(() => capture('generation-notification'));
    hold = true; pending = client.query(q('item'), {}); await oldEntered.promise;
    if (releaseEarly) { old.resolve(); assert.equal((await pending).data?.body, 'image-5'); }
    phase = 'notified'; change.resolve(); await entered.promise;
    capture('generation-before-sync-failure');
    old.resolve(); failed.resolve(); await until(() => client.link() === 'offline');
    if (!releaseEarly) assert.equal((await pending).denied?.code, 'E_OFFLINE', 'retired one-shot refuses after adoption transport fails');
    for (let n = 0; n < 3 + rand(5); n++) await turn();
    clock.set(clock.get() + 1250); capture('generation-after-sync-failure');
    assert.equal(watch.getSnapshot().loading, true, 'failed adoption stays withdrawn');
    assert.equal((await client.query(q('item'), {})).denied?.code, 'E_OFFLINE');
    phase = 'recover'; await client.sync();
    await until(() => watch.getSnapshot().denied?.code === 'APP_DENIED', 'new program applies at the unchanged sequence');
    capture('generation-adopted');
    assert.deepEqual([...new Set(failures)], []);
  } finally {
    old.resolve(); failed.resolve(); change.resolve();
    await pending?.catch(() => {}); watch?.close();
    if (client) closing.push(client.close());
  }
}
