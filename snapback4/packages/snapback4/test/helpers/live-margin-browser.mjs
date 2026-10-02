import React, { useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { SnapbackProvider, useQuery, usePage } from 'lm-sdk/react';
import { createLocalClient } from 'lm-sdk/local';
import { webDevice } from 'lm-sdk/web';
import { answerObservation } from 'lm-sdk/read-observation';
import { episodeDeadline } from 'lm-sdk/read-episode';
import { inspect } from 'lm-sdk/inspection';
import { waitFor } from './wait.mjs';

const q = name => ({ kind: 'query', name }), m = name => ({ kind: 'mutation', name });
const reactionsOp = q('reactions'), historyOp = q('history'), decorationOp = q('decoration');
const events = [], clients = [], watches = [];
let phase = 'opening', trial = -1;
const record = (kind, data = {}) => events.push({ at: performance.now(), phase, trial, kind, ...data });
const plain = read => JSON.parse(JSON.stringify(read));
const rendered = new Map();
let root, decorationCommits = 0;
window.lmClock = () => performance.now();
window.lmOpen = async (pressure = 120) => {
  for (const persona of ['alice', 'bob']) {
    const state = { offline: false }, device = webDevice();
    const client = await createLocalClient({ url: location.origin + '/backend', persona, device: { async open(...args) {
      const core = await device.open(...args);
      return { ...core, async call(request, committed) {
        const traced = ['query', 'apply', 'admit', 'settle'].includes(request.op);
        if (traced) record('device-start', { persona, op: request.op, name: request.name });
        const reply = await core.call(request, result => {
          if (traced) record('device-commit', { persona, op: request.op, name: request.name, preserved: result.preserved, published: result.ok?.published });
          committed?.(result);
        });
        if (traced) record('device-end', { persona, op: request.op, name: request.name, loading: reply.ok?.loading, complete: reply.ok?.complete });
        if (request.op === 'query' && state.hold) await state.hold;
        return reply;
      } };
    } }, fetch: async (input, init) => {
      if (state.offline) throw Error('controlled offline');
      const path = new URL(input).pathname.slice('/backend'.length);
      record('http-start', { persona, path });
      const response = await fetch(input, init);
      // Preserve streaming heartbeats. The wrapper reports when the SDK reads
      // the final chunk, without teeing or buffering the stream before delivery.
      if (!response.body) return response;
      let body = '';
      const decoder = new TextDecoder();
      const stream = response.body.pipeThrough(new TransformStream({
        transform(chunk, controller) { body += decoder.decode(chunk, { stream: true }); controller.enqueue(chunk); },
        flush() {
          let json; try { json = JSON.parse(body + decoder.decode()); } catch {}
          record('http-end', { persona, path, request: response.headers.get('x-lm-request'), seq: json?.seq, watermark: json?.watermark, preserved: json?.preserved });
        },
      }));
      return new Response(stream, { status: response.status, headers: response.headers });
    } });
    await client.sync(); inspect(client); clients.push({ client, state, persona });
  }
  for (const { client, persona } of clients) {
    // Put the measured reads behind all competing owners in insertion order.
    for (const [name, args] of [...Array.from({ length: pressure }, (_, slot) => ['decoration', { slot }]), ['reactions', {}], ['history', { c: null }]]) {
      const watch = client.observe(q(name), args); watches.push(watch);
      if (name !== 'decoration') watch.subscribe(() => record('observation', { persona, name, read: plain(watch.getSnapshot()), deadline: episodeDeadline(watch.getSnapshot()) }));
      else watch.subscribe(() => {});
    }
  }
  await waitFor(() => watches.every(w => 'data' in w.getSnapshot()), 'all observations opened', { work: watches.length });
  for (const watch of watches) {
    const owner = answerObservation(watch.getSnapshot()), old = owner.reload.bind(owner);
    if (owner.op.name === 'decoration') continue;
    owner.reload = (...args) => { record('invalidate', { name: owner.op.name, bounded: args[0] === true, queued: args[1]?.queued }); return old(...args); };
  }
  function Decoration({ slot }) {
    const read = useQuery(decorationOp, { slot });
    useLayoutEffect(() => { decorationCommits++; });
    return React.createElement('span', { 'data-slot': slot }, 'data' in read ? read.data.map(x => x.emoji).join(',') : 'loading');
  }
  function View({ persona }) {
    const reactions = useQuery(reactionsOp, {}), history = usePage(historyOp, {});
    useLayoutEffect(() => {
      const read = { reactions: plain(reactions), history: plain(history.read), items: history.items.map(x => x.body) };
      rendered.set(persona, read); record('render', { persona, ...read });
    });
    return React.createElement('section', { 'data-persona': persona },
      React.createElement('div', { 'data-reactions': true }, 'data' in reactions ? reactions.data.map(x => x.emoji).join(',') : 'loading'),
      React.createElement('ol', null, history.items.map(x => React.createElement('li', { key: x.id }, x.body))),
      React.createElement('aside', null, Array.from({ length: pressure }, (_, slot) => React.createElement(Decoration, { key: slot, slot }))));
  }
  root = createRoot(document.getElementById('root'));
  root.render(React.createElement(React.Fragment, null, ...clients.map(({ client, persona }) => React.createElement(SnapbackProvider, { key: persona, client }, React.createElement(View, { persona })))));
  await waitFor(() => rendered.size === 2, 'initial React commit');
  phase = 'ready'; return { observations: watches.length };
};
window.lmRun = async (n = 20) => {
  const [a, b] = clients;
  for (let i = 0; i < n; i++) for (const [name, args, expected] of [
    ['setReaction', { emoji: 'heart' }, 'heart'], ['setReaction', { emoji: 'smile' }, 'smile'], ['clearReaction', {}, undefined],
    ['tombstone', {}, ''], ['edit', { body: 'image-1' }, 'image-1'],
  ]) {
    phase = name === 'setReaction' ? args.emoji === 'heart' ? 'set' : 'replace' : name;
    trial++; record('trial-start', { cycle: i });
    const result = await a.client.mutate(m(name), args);
    if (result.state !== 'sent') throw Error(JSON.stringify(result));
    record('mutation-return', { seq: result.seq });
    await waitFor(() => {
      const read = rendered.get('bob')?.[name === 'tombstone' || name === 'edit' ? 'history' : 'reactions'];
      return read && 'data' in read && !read.revalidating && (name === 'tombstone' || name === 'edit' ? read.data.find(x => x.id === 'item')?.body === expected : read.data[0]?.emoji === expected);
    }, 'cross-client rendered replacement');
    record('trial-end');
    // This is settlement, not a post-write forced sync of the receiver.
    await waitFor(async () => (await a.client.pendingWrites()).length === 0, 'sender custody settled');
  }
  phase = 'done'; return { events, decorationCommits, inspections: clients.map(x => ({ persona: x.persona, ...inspect(x.client) })) };
};
window.lmOffline = async (n = 20) => {
  for (let i = 0; i < n; i++) {
    phase = 'offline'; trial++; record('trial-start', { cycle: i });
    for (const x of clients) x.state.offline = true;
    await Promise.all(clients.map(x => x.client.sync()));
    await Promise.all(clients.map((x, who) => x.client.mutate(m('send'), { body: `offline-${i}-${who}` }, { waitSeconds: 0 })));
    await waitFor(() => clients.every((x, who) => rendered.get(x.persona).history.data?.some(row => row.body === `offline-${i}-${who}`)), 'own offline prediction');
    phase = 'settling'; record('reconnect');
    for (const x of clients) x.state.offline = false;
    await Promise.all(clients.map(x => x.client.sync()));
    await waitFor(() => clients.every(x => !rendered.get(x.persona).history.revalidating && [0, 1].every(who => rendered.get(x.persona).history.data?.some(row => row.body === `offline-${i}-${who}`))), 'both sends rendered on both devices');
    await waitFor(async () => (await Promise.all(clients.map(x => x.client.pendingWrites()))).every(xs => !xs.length), 'both outboxes settled');
    record('trial-end');
  }
  phase = 'done'; return { events, decorationCommits, inspections: clients.map(x => ({ persona: x.persona, ...inspect(x.client) })) };
};
window.lmClose = async () => { root?.unmount(); watches.forEach(w => w.close()); await Promise.all(clients.map(x => x.client.close())); };
