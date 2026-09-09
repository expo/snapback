import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as clientEntry from '../dist/client.mjs';
import * as reactEntry from '../dist/react.mjs';
import { composeHistory } from '../dist/client-observed-test.mjs';
const { createClient, api, summarize } = clientEntry;

test('plain tier: a closed port returns transport results, never rejected promises', async () => {
  const client = createClient({ url: 'http://127.0.0.1:1' });
  try {
    const write = await client.mutation(api.messages.send, {});
    assert.equal(write.state, 'rejected');
    assert.equal(write.code, 'E_TRANSPORT');
    assert.equal(write.family, 'transport');
    assert.equal(write.retryable, true);
    const read = await client.query(api.messages.inbox, {});
    assert.equal(read.state, 'refused');
    assert.equal(read.family, 'transport');
    assert.equal(read.retryable, true);
  } finally { await client.close(); }
});

test('plain tier: persona selects the dev authority', async () => {
  const client = createClient({ url: 'http://127.0.0.1:1', persona: 'alice' });
  try { assert.equal(client.snapshot.persona, 'alice'); } finally { await client.close(); }
});

test('plain tier: continuation and partial fields are always present', () => {
  for (const view of [{ state: 'hydrating', live: false }, { state: 'complete', live: true, data: [], next: 'cursor', seq: 1 }]) {
    const value = summarize(view, 'connected');
    assert.equal(value.next, view.next ?? null);
    assert.equal(value.partial, false);
    if (value.receipt) assert.equal(value.receipt.state, 'complete');
  }
});

test('plain tier: history and drafts never expose an unusable composite', () => {
  const primary = { ...summarize({ state: 'partial', data: { count: 99 }, live: false, seq: 1, reason: 'never-held' }, 'offline'), items: [] };
  const history = { ...summarize({ state: 'complete', data: [], live: false, seq: 1, next: null }, 'offline'), items: [] };
  const value = composeHistory(primary, history);
  assert.equal(value.itemsFrom, 'history');
  assert.equal(value.data, undefined);
  assert.equal(value.partial, true);
  const drafts = composeHistory(primary, undefined);
  assert.equal(drafts.data, undefined);
  assert.equal(drafts.partial, false);
});

test('plain tier: public exports have one read hook and no thrown refusal type', () => {
  assert.equal(typeof reactEntry.usePage, 'function');
  assert.equal('useSubscription' in reactEntry, false);
  assert.equal('RefusalError' in clientEntry, false);
  assert.equal('isRefusalError' in clientEntry, false);
  assert.equal('SnapbackRefusal' in clientEntry, false);
  assert.equal('isSnapbackRefusal' in clientEntry, false);
});

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { RealOwnerHarness } from './owner-harness.ts';
import { sharedConsumers } from '../src/internal.js';
import { attachItems } from '../dist/client-observed-test.mjs';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const waitFor = async (condition: () => boolean) => {
  for (let n = 0; n < 200; n++) {
    if (condition()) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
  assert.fail('live hook did not reach the expected state');
};

test('plain tier: run catches transport and supplied-client refusals into last', async () => {
  const client = createClient({ url: 'http://127.0.0.1:1' });
  let mutation: any, renderer: TestRenderer.ReactTestRenderer | undefined;
  function Probe() { mutation = reactEntry.useMutation(api.messages.send); return null; }
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(reactEntry.SnapbackProvider,
      { client, children: React.createElement(Probe) })); });
    await act(async () => {
      const result = await mutation.run({});
      assert.equal(result.state, 'rejected'); assert.equal(result.family, 'transport'); assert.equal(result.retryable, true);
    });
    assert.equal(mutation.last.code, 'E_TRANSPORT'); assert.equal(mutation.inFlight, false);
    client.mutation = async () => { throw { code: 'NO_ACCESS', family: 'rule', message: 'not allowed', site: 'send', extra: 'private' }; };
    await act(async () => {
      assert.deepEqual(await mutation.run({}), { state: 'rejected', code: 'NO_ACCESS', family: 'rule', message: 'not allowed', site: 'send' });
    });
    assert.equal(mutation.last.code, 'NO_ACCESS'); assert.equal(mutation.inFlight, false);
  } finally { if (renderer) await act(async () => { renderer!.unmount(); }); await client.close(); }
});

test('plain tier: a wire rejection exposes only the single refusal shape', async () => {
  const client = createClient({ url: 'http://refusal.test', fetch: async () => Response.json({
    state: 'rejected', code: 'NO_ACCESS', family: 'rule', message: 'not allowed', site: 'send',
    which: 'private', op: 'messages.send', shape: 'private', cap: 50,
  }) });
  try { assert.deepEqual(await client.mutation(api.messages.send, {}), {
    state: 'rejected', code: 'NO_ACCESS', family: 'rule', message: 'not allowed', site: 'send',
  }); } finally { await client.close(); }
});

test('plain tier: missing/null cursors share an observation and normalize item membership', async () => {
  const client = createClient({ url: 'http://127.0.0.1:1' });
  const a = client.observe(api.messages.inbox, {}), b = client.observe(api.messages.inbox, { c: null });
  const off = [a.subscribe(() => {}), b.subscribe(() => {})];
  try {
    assert.equal(sharedConsumers(client, api.messages.inbox, {}), 2);
    assert.equal(sharedConsumers(client, api.messages.inbox, { c: null }), 2);
    const items = clientEntry.defineItems(api.messages.inbox, { table: 'messages', select: row => row,
      create: { target: clientEntry.mutationTarget(api.messages.send, 'messages'), belongs: (_args, q) => q.c === null,
        draft: args => ({ body: args.body }) } });
    const inputs = { entries: [{ intent: 'i', op: 'messages.send', args: { body: 'draft' }, ids: [], state: 'queued' }], observations: new Map(), predicted: new Map() };
    const missing = attachItems(items, {}, undefined, inputs);
    const explicit = attachItems(items, { c: null }, undefined, inputs);
    assert.equal(missing.length, 1);
    assert.deepEqual(missing, explicit);
  } finally { off.forEach(fn => fn()); await client.close(); }
});

test('plain tier: run resolves rule rejections and clears last on auth or operation changes', async () => {
  const owner = await RealOwnerHarness.create({ fullChat: true });
  const client = createClient({ url: owner.url, persona: 'charlie' });
  let mutation: any, renderer: TestRenderer.ReactTestRenderer | undefined;
  function Probe({ op }: { op: any }) { mutation = reactEntry.useMutation(op); return null; }
  const render = (op: any) => React.createElement(reactEntry.SnapbackProvider, { client, children: React.createElement(Probe, { op }) });
  try {
    await act(async () => { renderer = TestRenderer.create(render(api.deliveries.post)); });
    await act(async () => {
      const result = await mutation.run({ conversationId: 'conversation-1', body: 'refused' });
      assert.equal(result.state, 'rejected'); assert.equal(result.family, 'rule', JSON.stringify(result)); assert.equal(result.code, 'NOT_MEMBER');
    });
    assert.equal(mutation.last.code, 'NOT_MEMBER');
    assert.deepEqual(Object.keys(mutation).sort(), ['can', 'inFlight', 'last', 'run']);
    await act(async () => { renderer!.update(render(api.deliveries.edit)); });
    assert.equal(mutation.last, undefined);
    await act(async () => { await mutation.run({ messageId: 'missing', body: 'edit', baseBody: '' }); });
    assert.equal(mutation.last.state, 'rejected');
    // Persona providers change client identity; bearer login changes a client's auth generation.
    const bearer = createClient({ url: owner.url });
    await act(async () => { renderer!.update(React.createElement(reactEntry.SnapbackProvider, { client: bearer, children: React.createElement(Probe, { op: api.deliveries.post }) })); });
    await act(async () => { await mutation.run({ conversationId: 'conversation-1', body: 'refused' }); });
    assert.equal(mutation.last.state, 'rejected');
    await act(async () => { await bearer.auth.guest(); });
    assert.equal(mutation.last, undefined);
    await act(async () => { renderer!.unmount(); }); renderer = undefined;
    await bearer.close();
  } finally { if (renderer) await act(async () => { renderer!.unmount(); }); await client.close(); await owner.close(); if (owner.owned) delete process.env.SNAPBACK_URL; }
});

test('plain tier: usePage keeps three search pages live, rebinds boundaries and resets args', async () => {
  const owner = await RealOwnerHarness.create({ fullChat: true });
  const client = createClient({ url: owner.url, persona: 'alice' });
  let paged: any, renderer: TestRenderer.ReactTestRenderer | undefined;
  function Probe({ term }: { term: string }) { paged = reactEntry.usePage(api.messages.search, { term }); return null; }
  function CustomCursor() { paged = reactEntry.usePage(api.integration.inboxProjected, {}, { cursor: 'after' }); return null; }
  const render = (term: string) => React.createElement(reactEntry.SnapbackProvider, { client, children: React.createElement(Probe, { term }) });
  try {
    const rows = [];
    for (let i = 0; i < 43; i++) {
      const result = await client.mutation(api.deliveries.post, { conversationId: 'conversation-1', body: `needle ${i}` });
      assert.equal(result.state, 'committed'); rows.push(result.data.id);
    }
    await act(async () => { renderer = TestRenderer.create(render('needle')); });
    await waitFor(() => paged.status === 'ready');
    assert.equal(paged.items.length, 20); assert.equal(paged.pages.length, 1); assert.equal(paged.hasMore, true);
    await act(async () => { paged.loadMore(); });
    await waitFor(() => paged.status === 'ready' && paged.pages.length === 2);
    assert.equal(paged.items.length, 40);
    await act(async () => { paged.loadMore(); });
    await waitFor(() => paged.status === 'ready' && paged.pages.length === 3);
    assert.equal(paged.items.length, 43); assert.equal(paged.hasMore, false);
    const first = paged.pages[0].data[0];
    await act(async () => { assert.equal((await client.mutation(api.deliveries.edit, { messageId: first.id, body: 'needle edited', baseBody: first.body })).state, 'committed'); });
    await waitFor(() => paged.pages[0].data.some(row => row.body === 'needle edited'));
    await act(async () => { assert.equal((await client.mutation(api.deliveries.post, { conversationId: 'conversation-1', body: 'needle newest' })).state, 'committed'); });
    await waitFor(() => paged.items.length === 44 && paged.status === 'ready');
    assert.equal(new Set(paged.items.map(row => row.id)).size, 44, 'moving live boundaries neither duplicate nor lose rows');
    await act(async () => { renderer!.update(render('absent')); });
    assert.equal(paged.pages.length, 1);
    await waitFor(() => paged.status === 'ready');
    assert.deepEqual(paged.items, []); assert.equal(paged.hasMore, false);
    await act(async () => { renderer!.update(React.createElement(reactEntry.SnapbackProvider,
      { client, children: React.createElement(CustomCursor) })); });
    await waitFor(() => paged.status === 'ready');
    assert.equal(paged.items.length, 1); assert.equal(paged.pages.length, 1);
    await act(async () => { paged.loadMore(); });
    await waitFor(() => paged.status === 'ready' && paged.pages.length === 2);
    assert.equal(paged.items.length, 2); assert.equal(new Set(paged.items.map(row => row.id)).size, 2);
  } finally { if (renderer) await act(async () => { renderer!.unmount(); }); await client.close(); await owner.close(); if (owner.owned) delete process.env.SNAPBACK_URL; }
});
