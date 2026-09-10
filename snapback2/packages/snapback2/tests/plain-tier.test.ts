import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as clientEntry from '../dist/client.mjs';
import * as reactEntry from '../dist/react.mjs';
import { composeHistory } from '../dist/client-observed-test.mjs';
import { itemInputs } from '../dist/image-runtime.mjs';
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
  const { fakeOwner } = await import('./fake-owner.ts');
  const owner = fakeOwner({ cursorArg: 'c' });
  const client = createClient({ url: 'http://cursor.test', fetch: owner.fetch });
  await client.manifest();
  const a = client.observe(api.messages.inbox, {}), b = client.observe(api.messages.inbox, { c: null });
  const off = [a.subscribe(() => {}), b.subscribe(() => {})];
  try {
    assert.equal(sharedConsumers(client, api.messages.inbox, {}), 2);
    assert.equal(sharedConsumers(client, api.messages.inbox, { c: null }), 2);
    const items = clientEntry.defineItems(api.messages.inbox, { table: 'messages', select: row => row,
      create: { target: clientEntry.mutationTarget(api.messages.send, 'messages'), belongs: (_args, q) => q.c == null,
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
    await act(async () => { renderer = TestRenderer.create(render(api.messages.send)); });
    await act(async () => {
      const result = await mutation.run({ conversationId: 'conversation-1', body: 'refused' });
      assert.equal(result.state, 'rejected'); assert.equal(result.family, 'rule', JSON.stringify(result)); assert.equal(result.code, 'NOT_MEMBER');
    });
    assert.equal(mutation.last.code, 'NOT_MEMBER');
    assert.deepEqual(Object.keys(mutation).sort(), ['can', 'inFlight', 'last', 'run']);
    await act(async () => { renderer!.update(render(api.messages.edit)); });
    assert.equal(mutation.last, undefined);
    await act(async () => { await mutation.run({ messageId: 'missing', body: 'edit', baseBody: '' }); });
    assert.equal(mutation.last.state, 'rejected');
    // Persona providers change client identity; bearer login changes a client's auth generation.
    const bearer = createClient({ url: owner.url });
    await act(async () => { renderer!.update(React.createElement(reactEntry.SnapbackProvider, { client: bearer, children: React.createElement(Probe, { op: api.messages.send }) })); });
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
      const result = await client.mutation(api.messages.send, { conversationId: 'conversation-1', body: `needle ${i}` });
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
    await act(async () => { assert.equal((await client.mutation(api.messages.edit, { messageId: first.id, body: 'needle edited', baseBody: first.body })).state, 'committed'); });
    await waitFor(() => paged.pages[0].data.some(row => row.body === 'needle edited'));
    await act(async () => { assert.equal((await client.mutation(api.messages.send, { conversationId: 'conversation-1', body: 'needle newest' })).state, 'committed'); });
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

test('plain tier: an Astra-shaped projected feed keeps its owner continuation through local refresh', async (context) => {
  const { mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileRangeStore } = await import('../dist/test.mjs');
  const priorOwnerUrl = process.env.SNAPBACK_URL;
  const owner = await RealOwnerHarness.create({ forceOwned: true, fullChat: true, prepare: async root => {
    const schema = join(root, 'snapback/schema.q');
    await writeFile(schema, `${await readFile(schema, 'utf8')}
table astraPosts:
  author: principal
  body: text 1..500
  parent: astraPosts ?
  at: time
  by byParentTime: parent, at, id
  by byAuthorParentTime: author, parent, at, id
  public
  insert <- .author = viewer
  delete <- .author = viewer

table astraFeedEntries:
  actor: principal
  post: astraPosts
  repost: bool
  at: time
  unique byActorPost: actor, post, repost
  by byTime: at, id
  by byActorTime: actor, at, id
  public
  insert <- .actor = viewer
  update <- deny
  delete <- .actor = viewer

table astraLikes:
  actor: principal
  post: astraPosts
  at: time
  unique byActorPost: actor, post
  public
  insert <- .actor = viewer
  update <- deny
  delete <- .actor = viewer

maintain astraLikeCounts: count astraLikes by post
  read <- allow
maintain astraReplyCounts: count astraPosts by parent
  read <- allow
maintain astraRepostCounts: count astraFeedEntries by post, repost
  read <- allow
`);
    await writeFile(join(root, 'snapback/carrier.q'), `shape card = {
  entry: .,
  post: astraPosts[.post] {
    post: .,
    author: profiles[.author] { displayName, handle },
    likes: astraLikeCounts[.id],
    replies: astraReplyCounts[.id],
    reposts: astraRepostCounts[.id, true],
    liked: exists astraLikes[viewer, .id],
    reposted: exists astraFeedEntries[viewer, .id, true],
  },
  actor: profiles[.actor] { displayName, handle },
}

query global(c: cursor ?):
  return astraFeedEntries[] after c last 20 by byTime card

query following(c: cursor ?):
  page = merge astraFeedEntries after c last 20 by byActorTime:
    [viewer]
    [f.followed] for f in follows[viewer] first 50 by byFollower
  return page card

query own(author: principal, c: cursor ?):
  page = astraPosts[author, null] after c last 20 by byAuthorParentTime
  return page {
    post: .,
    author: profiles[.author] { displayName, handle },
    likes: astraLikeCounts[.id],
    replies: astraReplyCounts[.id],
    reposts: astraRepostCounts[.id, true],
    liked: exists astraLikes[viewer, .id],
    reposted: exists astraFeedEntries[viewer, .id, true],
  }

mutation publish(body: text <=500):
  row = insert astraPosts { author: viewer, body, parent: null, at: now }
  insert astraFeedEntries { actor: viewer, post: row.id, repost: false, at: now }
  return row

mutation remove(entry: astraFeedEntries):
  delete astraFeedEntries[entry]
  return true
`);
  } });
  const directory = await mkdtemp(join(tmpdir(), 'snapback-feed-page-'));
  const aliceStore = fileRangeStore(join(directory, 'alice'));
  const bobStore = fileRangeStore(join(directory, 'bob'));
  const writer = createClient({ url: owner.url, persona: 'alice' });
  const bobWriter = createClient({ url: owner.url, persona: 'bob' });
  const cursors: unknown[] = [];
  const advancedCursors = new Set<string>();
  let advanceCursorSequence = false;
  const observingFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const requests: any[] = [];
    if (url.pathname.endsWith('/api/subscribe'))
      requests.push({ op: url.searchParams.get('op'), args: JSON.parse(url.searchParams.get('args')!) });
    else if (url.pathname.endsWith('/api/query')) requests.push(JSON.parse(String(init?.body)));
    else if (url.pathname.endsWith('/api/live/control')) {
      const control = JSON.parse(String(init?.body));
      for (const addition of control.add ?? []) {
        const path = new URL(addition.path, url);
        requests.push({ op: path.searchParams.get('op'), args: JSON.parse(path.searchParams.get('args')!) });
      }
    }
    for (const request of requests) {
      const cursor = request.args.c;
      cursors.push(cursor);
      if (advanceCursorSequence && typeof cursor === 'string') {
        const key = `${request.op}:${cursor}`;
        if (advancedCursors.has(key)) continue;
        advancedCursors.add(key);
        const advanced = await writer.mutation(api.messages.send,
          { conversationId: 'conversation-1', body: `feed cursor ${advancedCursors.size}` });
        assert.equal(advanced.state, 'committed', JSON.stringify(advanced));
      }
    }
    return fetch(input, init);
  };
  let client: any = createClient({ url: owner.url, persona: 'alice', fetch: observingFetch, offline: { store: aliceStore } });
  const bob: any = createClient({ url: owner.url, persona: 'bob', fetch: observingFetch, offline: { store: bobStore } });
  let cold: any, colder: any, raw: any;
  const events: any[] = [], mounted: Array<{ close(): Promise<void> }> = [];
  const mount = async (reader: any, op: any, initialArgs: any) => {
    let paged: any, args = initialArgs, renderer: TestRenderer.ReactTestRenderer | undefined, closed = false;
    function Probe({ value }: { value: any }) { paged = reactEntry.usePage(op, value); return null; }
    const render = () => React.createElement(reactEntry.SnapbackProvider,
      { client: reader, children: React.createElement(Probe, { value: args }) });
    await act(async () => { renderer = TestRenderer.create(render()); });
    const handle = {
      get current() { return paged; },
      async update(value: any) { args = value; await act(async () => { renderer!.update(render()); }); },
      async close() { if (!closed) { closed = true; await act(async () => { renderer!.unmount(); }); } },
    };
    mounted.push(handle);
    return handle;
  };
  const walk = async (reader: any, op: any, args: any) => {
    const ids: string[] = [];
    let c: string | null = null;
    for (let page = 0; page < 10; page++) {
      const result = await reader.query(op, { ...args, c });
      assert.ok(result.state === 'complete' || result.state === 'capped', JSON.stringify(result));
      ids.push(...result.data.map((row: any) => row.entry?.id ?? row.post?.id ?? row.id));
      c = result.next;
      if (c === null) return ids;
    }
    assert.fail('feed did not terminate within ten pages');
  };
  const loadAll = async (view: Awaited<ReturnType<typeof mount>>, expected: string[],
    witness?: { reader: any; op: string; args: any }) => {
    const settleSuccessor = async (advances: number, pages: number) => {
      if (!witness) {
        await waitFor(() => view.current.status === 'ready' && view.current.pages.length === pages);
        return;
      }
      await waitFor(() => advancedCursors.size > advances);
      let held: any, local: any;
      for (let n = 0; n < 200; n++) {
        held = await witness.reader.offlineRuntime.store.answer(witness.op, { ...witness.args, c: null });
        local = await witness.reader.offlineRuntime.twin.evaluate(witness.op, { ...witness.args, c: null });
        if (local?.seq > held?.seq) break;
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
      }
      assert.ok(local.seq > held.seq,
        `the successor response advances only the store-wide sequence (${held.seq}->${local.seq}; requests ${JSON.stringify(cursors.slice(-4))})`);
      assert.deepEqual(itemInputs(local)?.selection, itemInputs(held)?.selection,
        'the head still names its exact qualified owner selection');
      assert.deepEqual(await witness.reader.offlineRuntime.store.outbox.all(), []);
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
      await waitFor(() => view.current.status === 'ready' && view.current.pages.length === pages
        && view.current.pages[pages - 1].data !== undefined);
    };
    await waitFor(() => view.current.status === 'ready');
    assert.deepEqual(view.current.pages.map((page: any) => page.data?.length), [20]);
    assert.equal(view.current.hasMore, true);
    let advances = advancedCursors.size;
    await act(async () => { view.current.loadMore(); });
    await settleSuccessor(advances, 2);
    assert.deepEqual(view.current.pages.map((page: any) => page.data?.length), [20, 20]);
    assert.equal(view.current.hasMore, true);
    advances = advancedCursors.size;
    await act(async () => { view.current.loadMore(); });
    await settleSuccessor(advances, 3);
    assert.deepEqual(view.current.pages.map((page: any) => page.data?.length), [20, 20, 5]);
    assert.equal(view.current.hasMore, false);
    assert.deepEqual(view.current.items.map((row: any) => row.entry?.id ?? row.post?.id ?? row.id), expected);
    assert.equal(new Set(view.current.items.map((row: any) => row.entry?.id ?? row.post?.id ?? row.id)).size, 45);
  };
  try {
    for (let i = 0; i < 45; i++) {
      const result = await writer.mutation(api.carrier.publish, { body: `page-${String(i).padStart(2, '0')}` });
      assert.equal(result.state, 'committed', JSON.stringify(result));
    }
    const expectedGlobal = await walk(writer, api.carrier.global, {});
    const expectedFollowing = await walk(bobWriter, api.carrier.following, {});
    const expectedOwn = await walk(writer, api.carrier.own, { author: 'dev:alice' });
    assert.deepEqual([expectedGlobal.length, expectedFollowing.length, expectedOwn.length], [45, 45, 45]);
    await Promise.all([client.ready, bob.ready]);
    const { subscribe } = await import('../src/internal.js');
    raw = subscribe(client, api.carrier.global, { c: null }, (event: any) => events.push(event));
    const global = await mount(client, api.carrier.global, {});
    await waitFor(() => global.current.pages[0]?.data?.length === 20 && global.current.hasMore);
    assert.deepEqual(await client.offlineRuntime.store.outbox.all(), [], 'owner page starts without local writes');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
    const held = await client.offlineRuntime.store.answer('carrier.global', { c: null });
    const local = await client.offlineRuntime.twin.evaluate('carrier.global', { c: null });
    const targetRanges = held?.receipt?.ranges ?? [];
    for (const table of ['astraLikeCounts', 'astraReplyCounts', 'astraRepostCounts'])
      assert.equal(targetRanges.filter((range: any) => range.table === table).length, 20, `${table} range custody`);
    assert.equal(held?.receipt?.absences.filter(([table]: [string]) => table.startsWith('astra')).length, 60);
    const server = events.findLast(event => event.live === true && event.source !== 'twin' && event.state === 'capped');
    context.diagnostic(`owner=${server?.state}/${server?.seq}/next:${!!server?.next}; held=${held?.state}/${held?.reason}/${held?.seq}/next:${!!held?.next}; twin=${local?.state}/${local?.seq}/${local?.sites?.map((site: any) => `${site.site}:${site.reason}`).join(',')}`);
    assert.equal(server?.state, 'capped');
    assert.equal(typeof server?.next, 'string');
    assert.equal(held?.state, 'capped');
    assert.equal(held?.next, server.next);
    assert.equal(held?.receipt?.ranges.find((range: any) => range.site === 'carrier.global.0')?.stop, 'Limit');
    assert.equal(local?.state, 'partial');
    assert.ok(local?.sites?.length > 0);
    assert.ok(local?.sites?.every((site: any) => site.reason === 'computed-key'));
    assert.equal(global.current.pages[0].receipt?.state, 'capped');
    assert.equal(global.current.pages[0].next, server.next);
    const unrelated = { intent: 'unrelated-chat-prediction',grant: 'test',offset: 0,count: 0,ids: [],
      op: 'messages.send',args: { conversationId: 'conversation-1',body: 'unrelated' },issuedSeq: 1,
      state: 'queued' as const,predicted: true,createdAt: Date.now(),updatedAt: Date.now() };
    await act(async () => { await client.offlineRuntime.store.commit({
      outbox: { put: [unrelated] },overlay: { put: { [unrelated.intent]: [] } },
    }); });
    await waitFor(() => global.current.pages[0].receipt?.state === 'partial');
    assert.equal(global.current.hasMore,false,
      'an unrelated active prediction conservatively withholds the owner continuation');
    await act(async () => { await client.offlineRuntime.store.commit({
      outbox: { remove: [unrelated.intent] },overlay: { remove: [unrelated.intent] },
    }); });
    await waitFor(() => global.current.pages[0].receipt?.state === 'capped' && global.current.hasMore);
    advanceCursorSequence = true;
    await loadAll(global, expectedGlobal, { reader: client, op: 'carrier.global', args: {} });

    const following = await mount(bob, api.carrier.following, { c: null });
    await loadAll(following, expectedFollowing, { reader: bob, op: 'carrier.following', args: {} });
    await following.close();
    const own = await mount(client, api.carrier.own, { author: 'dev:alice' });
    await loadAll(own, expectedOwn, { reader: client, op: 'carrier.own', args: { author: 'dev:alice' } });
    await own.update({ author: 'dev:bob' });
    await waitFor(() => own.current.status === 'ready' && own.current.items.length === 0);
    assert.equal(own.current.pages.length, 1, 'changing author resets the old continuation chain');
    assert.equal(own.current.hasMore, false);
    await own.close();

    await act(async () => {
      await client.offline();
    });
    assert.deepEqual(global.current.items.map((row: any) => row.entry.id), expectedGlobal,
      'the durable owner page remains traversable while disconnected');

    let changed: string[] = [];
    await act(async () => {
      await client.online();
      const inserted = await writer.mutation(api.carrier.publish, { body: 'new live head' });
      assert.equal(inserted.state, 'committed');
      assert.equal((await writer.mutation(api.carrier.remove, { entry: expectedGlobal[19] })).state, 'committed');
      changed = await walk(writer, api.carrier.global, {});
    });
    assert.equal(changed.length, 45);
    await waitFor(() => JSON.stringify(global.current.items.map((row: any) => row.entry.id)) === JSON.stringify(changed));
    await waitFor(() => global.current.pages[0].receipt?.state === 'capped'
      && typeof global.current.pages[0].next === 'string');
    assert.equal(global.current.pages.length, 3);
    assert.equal(new Set(global.current.items.map((row: any) => row.entry.id)).size, 45,
      'moving the live page boundary neither duplicates nor loses rows');
    assert.equal(cursors.some(cursor => typeof cursor === 'string' && cursor.startsWith('h1.')), false,
      'local cursors never reach query or subscription transport');

    raw.close(); raw = undefined;
    await global.close();
    await client.close(); client = undefined;
    const requestsBeforeCold = cursors.length;
    cold = createClient({ url: owner.url, persona: 'alice', startOffline: true, fetch: observingFetch, offline: { store: aliceStore } });
    await cold.ready;
    const coldHeld = await cold.offlineRuntime.store.answer('carrier.global', { c: null });
    const coldLocal = await cold.offlineRuntime.twin.evaluate('carrier.global', { c: null });
    context.diagnostic(`cold held=${coldHeld?.state}/${coldHeld?.seq}/next:${!!coldHeld?.next}; local=${coldLocal?.state}/${coldLocal?.seq}/selection:${itemInputs(coldLocal)?.selection?.through}`);
    const reopened = await mount(cold, api.carrier.global, {});
    await loadAll(reopened, changed);
    assert.equal(cursors.length, requestsBeforeCold, 'cold usePage reads only the durable carrier');
    await reopened.close();

    const fakeGrant = {
      id: 'cold-removal-grant',
      from: 's2id-0000000000000000000000000000000a-0000000000000001',
      count: 16, mintedAt: Date.now(), expiresAt: Date.now() + 60_000,
    };
    cold.offlineRuntime.noteGrant({ grant: fakeGrant }, 'dev:alice');
    await cold.offlineRuntime.adoptPendingGrant();
    let queuedRemoval: any;
    await act(async () => {
      queuedRemoval = await cold.mutation(api.carrier.remove, { entry: changed[0] });
    });
    assert.equal(queuedRemoval.state, 'queued');
    const entry = await cold.offlineRuntime.store.outbox.get(queuedRemoval.intent);
    assert.ok(entry);
    await act(async () => {
      await cold.offlineRuntime.store.commit({ outbox: { put: [{
        ...entry, state: 'committed', response: { state: 'committed', seq: 49, data: true }, updatedAt: Date.now(),
      }] } });
    });
    await cold.close(); cold = undefined;
    colder = createClient({ url: owner.url, persona: 'alice', startOffline: true, fetch: observingFetch, offline: { store: aliceStore } });
    await colder.ready;
    const removal = await mount(colder, api.carrier.global, {});
    await waitFor(() => removal.current.status === 'ready');
    assert.equal(removal.current.pages[0].receipt?.state, 'partial');
    assert.equal(removal.current.hasMore, false);
    assert.equal(removal.current.items.some((row: any) => row.entry.id === changed[0]), false,
      'a committed removal overlay survives same-principal cold reopen until owner retirement');
    await removal.close();
  } finally {
    raw?.close(); for (const view of mounted) await view.close();
    await colder?.close(); await cold?.close(); await client?.close(); await bob.close(); await writer.close(); await bobWriter.close(); await owner.close();
    await rm(directory, { recursive: true, force: true });
    if (priorOwnerUrl === undefined) delete process.env.SNAPBACK_URL;
    else process.env.SNAPBACK_URL = priorOwnerUrl;
  }
});
