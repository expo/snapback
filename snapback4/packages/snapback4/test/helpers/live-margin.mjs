// @ref LLP 3000.023#12 — measure publication through real device commits.
import { fixture, source, opener, q, m, until } from './answers-stay.mjs';
import { createLocalClient } from '../../dist/local.js';
import { answerObservation } from '../../dist/read-observation.js';
import { episodeDeadline } from '../../dist/read-episode.js';
import { inspect } from '../../dist/inspection.js';
import { join } from 'node:path';

export const marginSource = source + `
table reactions:
  room: text <=40
  emoji: text <=40
  by byRoom: room, id
  read <- exists members[.room, viewer]
  insert <- allow
  update <- allow
  delete <- allow
  sync to members[.room]
query reactions():
  return reactions['room'] first 100 by byRoom
query decoration(slot: int):
  return reactions['room'] first 100 by byRoom
mutation setReaction(emoji: text <=40):
  upsert reactions['reaction'] { room: 'room', emoji }
mutation clearReaction():
  delete reactions['reaction']
mutation tombstone():
  update messages['item'] { body: '' }
`;

export async function marginFixture(t, host, source = marginSource) {
  const f = await fixture(t, source), events = [];
  const record = (kind, data = {}) => events.push({ at: performance.now(), kind, ...data });
  const states = [];
  async function client(persona) {
    const state = { offline: false, hold: undefined, queryHold: undefined };
    states.push(state);
    const device = opener(host, join(f.dir, persona));
    const c = await createLocalClient({ url: f.url, persona, device: { async open(...args) {
      const core = await device.open(...args);
      return { ...core, async call(request, committed) {
        const traced = ['query', 'apply', 'admit', 'settle'].includes(request.op);
        if (traced) record('device-start', { persona, op: request.op, name: request.name });
        const result = await core.call(request, reply => {
          if (traced) record('device-commit', { persona, op: request.op, name: request.name, reply });
          committed?.(reply);
        });
        if (traced) record('device-end', { persona, op: request.op, name: request.name, reply: result });
        if (request.op === 'query' && state.queryHold) await state.queryHold(request);
        return result;
      } };
    } }, fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (state.offline) throw Error('controlled offline');
      record('http-start', { persona, path });
      const response = await fetch(input, init);
      // Forward heartbeat chunks immediately, and parse only at EOF. Buffering
      // the whole held poll ahead of the SDK would trip its silence watchdog.
      if (response.body && (['/sync', '/changes'].includes(path) || path.startsWith('/m/'))) {
        let body = ''; const decoder = new TextDecoder();
        const stream = response.body.pipeThrough(new TransformStream({
          transform(chunk, controller) { body += decoder.decode(chunk, { stream: true }); controller.enqueue(chunk); },
          async flush() { record('http-end', { persona, path, body: JSON.parse(body + decoder.decode()), timing: response.headers.get('server-timing') }); if (path === '/sync' && state.hold) await state.hold; },
        }));
        return new Response(stream, { status: response.status, headers: response.headers });
      }
      return response;
    } });
    t.after(() => c.close()); await c.sync();
    inspect(c);
    return { client: c, state };
  }
  const a = await client('alice'), b = await client('bob');
  function watch(client, persona, name, args = {}) {
    const w = client.observe(q(name), args);
    const capture = () => record('observation', { persona, name, read: w.getSnapshot(), deadline: episodeDeadline(w.getSnapshot()) });
    w.subscribe(capture); t.after(() => w.close()); capture();
    return w;
  }
  return { ...f, a, b, events, record, watch, q, m, until, owner: w => answerObservation(w.getSnapshot()) };
}
