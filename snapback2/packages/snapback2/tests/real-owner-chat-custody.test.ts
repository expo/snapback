import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createClient, api } from '../dist/client.mjs';
import { fileRangeStore } from '../dist/test.mjs';
import { subscribe } from '../src/internal.js';
import { RealOwnerHarness } from './owner-harness.ts';

const fixture = fileURLToPath(new URL('../templates/chat/snapback', import.meta.url));
const group = 'conversation-1';
const declaration = 'deliver to memberships[.conversationId] as deliveries with receipts';
async function until(read: () => Promise<any>, accepts: (value: any) => boolean, label: string) {
  let value: any;
  for (let n = 0; n < 300; n++) {
    value = await read();
    if (accepts(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(`${label}: ${JSON.stringify(value)}`);
}
async function control(owner: RealOwnerHarness, path: string, body?: unknown) {
  const info = JSON.parse(await readFile(join(owner.root!, '.snapback/owner.json'), 'utf8'));
  const response = await fetch(owner.url + '/control/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-snapback-control': info.secret, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json(); assert(response.ok, JSON.stringify(result)); return result;
}
async function manifest(owner: RealOwnerHarness) {
  return fetch(owner.url + '/api/manifest', { headers: { 'X-Snapback-As': 'alice' } }).then(r => r.json());
}
async function warm(client: any) {
  const drain = subscribe(client, api.messages.inbox, { c: null }, () => {}, { drain: true });
  await drain.until((value: any) => value.live === true && value.caughtUp === true, 10000);
  await client.outbox.drain();
  return drain;
}
async function pages(client: any, op: any, args = {}) {
  const rows: any[] = []; let c: string | null = null;
  do {
    const result: any = await client.query(op, { ...args, c });
    assert(Array.isArray(result.data), JSON.stringify(result)); rows.push(...result.data); c = result.next;
  } while (c);
  return rows;
}
async function installSchema(owner: RealOwnerHarness, source: string) {
  const before: any = await control(owner, 'status');
  await writeFile(join(owner.root!, 'snapback/schema.q'), source);
  return until(() => control(owner, 'status'), value => value.status === 'ready' && value.generation !== before.generation, 'schema successor');
}

// @ref LLP 1019#acceptance — the shipped template owns the offline bar and historical custody.
for (const evolve of [false, true]) test(`chat historical custody ${evolve ? 'across a cap successor' : 'without a successor'}: departed recipients receive unsend and expiry tombstones`, { timeout: 60000 }, async () => {
  const owner = await RealOwnerHarness.create({ forceOwned: true, fixture, prepare: root =>
    writeFile(join(root, 'snapback/custody.q'), `query events(c: cursor ?):
  return deliveries[viewer] after c first 50 by byRecipient
`) });
  const root = await mkdtemp(join(tmpdir(), 'chat-custody-'));
  const alice = createClient({ url: owner.url, persona: 'alice' });
  let bob: any = createClient({ url: owner.url, persona: 'bob', offline: { store: fileRangeStore(root) } });
  const carol = createClient({ url: owner.url, persona: 'carol' });
  let drain: any;
  try {
    await Promise.all([alice.ready, bob.ready, carol.ready]);
    const third: any = await alice.mutation(api.groups.memberAdd, { conversationId: group, principal: 'dev:charlie' }); assert.equal(third.state, 'committed');
    const disappearing: any = await alice.mutation(api.messages.send, { conversationId: group, body: 'expires after departure', expiresAt: Date.now() + 3600000 });
    const unsent: any = await alice.mutation(api.messages.send, { conversationId: group, body: 'unsent after departure' });
    assert.equal(disappearing.state, 'committed'); assert.equal(unsent.state, 'committed');
    drain = await warm(bob); drain.close(); drain = undefined; await bob.offline();
    assert.equal((await alice.mutation(api.groups.memberRemove, { conversationId: group, membershipId: 'membership-2' })).state, 'committed');
    assert.equal((await alice.mutation(api.groups.memberRemove, { conversationId: group, membershipId: third.data.id })).state, 'committed');
    assert.equal((await alice.mutation(api.groups.memberAdd, { conversationId: group, principal: 'dev:carol' })).state, 'committed');
    const history: any = await carol.query(api.messages.history, { conversationId: group, c: null });
    assert(history.data.some((row: any) => row.id === unsent.data.id), 'joiner sees prior live history');
    const view: any = await carol.query(api.messages.conversationView, { conversationId: group });
    assert(view.data.messages.some((row: any) => row.message?.id === unsent.data.id), 'the screen composite includes prior history for a joiner');
    const log: any = await carol.query(api.messages.inbox, { c: null }); assert.equal(log.data.length, 0, 'join is not original delivery');
    if (evolve) {
      const schemaPath = join(owner.root!, 'snapback/schema.q');
      const original = await readFile(schemaPath, 'utf8');
      const lowered = original.replace('cap 50 by conversationId', 'cap 2 by conversationId');
      const successor: any = await installSchema(owner, lowered);
      assert.equal((await manifest(owner)).tables.messages.deliver.audience, 3);
      assert.equal(successor.successor.audienceBounds.deliveries, 3);
      const audience = lowered.match(/table memberships:[^]*?(?=\ntable messages:)/)![0].replace('table memberships:', 'table audiences:');
      await writeFile(schemaPath, lowered.replace('deliver to memberships[', 'deliver to audiences[') + '\n' + audience);
      await until(() => control(owner, 'status'), s => s.status?.refused?.some((r: any) => r.code === 'E_SUCCESSOR_DESTRUCTIVE'), 'destructive custody plan');
      assert.equal((await manifest(owner)).tables.messages.deliver.target, 'memberships', 'unapproved plan keeps predecessor');
      await writeFile(schemaPath, lowered);
      await until(() => control(owner, 'status'), s => s.status === 'ready', 'restore accepted declaration');
    }
    assert.equal((await alice.mutation(api.messages.unsend, { messageId: unsent.data.id })).state, 'committed');
    await alice.close(); await carol.close(); await bob.close();
    await control(owner, 'clock', { advanceMs: 3600001 });
    bob = createClient({ url: owner.url, persona: 'bob', offline: { store: fileRangeStore(root) } }); await bob.ready;
    // Metadata-only delivery cannot prove a point absence on messages: only the
    // generated removed-event tombstone may evict the bodies already held.
    drain = subscribe(bob, api.custody.events, { c: null }, () => {}, { drain: true });
    await drain.until((v: any) => v.data?.some((r: any) => r.row === disappearing.data.id && r.kind === 'removed'), 10000);
    const events = await pages(bob, api.custody.events);
    for (const id of [unsent.data.id, disappearing.data.id]) assert(events.some(r => r.row === id && r.kind === 'removed'), `removed event for ${id}`);
    const verifier = createClient({ url: owner.url, persona: 'alice' });
    try {
      await verifier.ready;
      const senderEvents = await pages(verifier, api.custody.events);
      for (const id of [unsent.data.id, disappearing.data.id]) assert(senderEvents.some(r => r.row === id && r.kind === 'removed'), `sender removed event for ${id}`);
    } finally { await verifier.close(); }
    drain.close(); drain = undefined; await bob.offline(); bob = await bob.restart();
    const held = await pages(bob, api.messages.inbox);
    for (const id of [unsent.data.id, disappearing.data.id]) assert(!held.some(r => r.message?.id === id), `body ${id} evicted after cold restart`);
    assert(held.some(r => r.message?.body === 'Welcome'), 'other departed history remains held');
    assert.equal((await manifest(owner)).tables.messages.deliver.audience, evolve ? 3 : 50);
  } finally { drain?.close(); await Promise.all([alice.close(), bob.close(), carol.close()]); await owner.close(); await rm(root, { recursive: true, force: true }); }
});

test('chat old edit outside the live tail reaches cold thread and search without a duplicate bubble', { timeout: 60000 }, async () => {
  const owner = await RealOwnerHarness.create({ forceOwned: true, fixture });
  const root = await mkdtemp(join(tmpdir(), 'chat-old-edit-'));
  const alice = createClient({ url: owner.url, persona: 'alice' });
  const reads: string[] = [];
  let bob: any = createClient({ url: owner.url, persona: 'bob', offline: { store: fileRangeStore(root) }, fetch: async (input, init) => {
    if (new URL(String(input)).pathname === '/api/query' && init?.body) reads.push(JSON.parse(String(init.body)).op);
    return fetch(input, init);
  } });
  let drain: any;
  try {
    await Promise.all([alice.ready, bob.ready]);
    for (let n = 0; n < 105; n++) assert.equal((await alice.mutation(api.messages.send, { conversationId: group, body: `page ${n}` })).state, 'committed');
    drain = await warm(bob); assert(!reads.includes('messages.thread')); drain.close(); drain = undefined; await bob.offline();
    const edit: any = await alice.mutation(api.messages.edit, { messageId: 'message-1', body: 'quasar refreshed', baseBody: 'Welcome' }); assert.equal(edit.state, 'committed');
    const authoritative: any = await alice.query(api.messages.search, { term: 'quasar', c: null });
    assert.equal(typeof authoritative.data[0].editedAt, 'number');
    await bob.online(); drain = await warm(bob); drain.close(); drain = undefined; await bob.offline(); bob = await bob.restart();
    const before = reads.length, thread = await pages(bob, api.messages.thread, { conversationId: group });
    assert.equal(thread.length, 106); const bubble = thread.filter(r => r.row === 'message-1'); assert.equal(bubble.length, 1);
    assert.equal(bubble[0].message.body, 'quasar refreshed'); assert.equal(bubble[0].message.editedAt, authoritative.data[0].editedAt);
    const search: any = await bob.query(api.messages.search, { term: 'quasar', c: null });
    assert.deepEqual(search.data.map((r: any) => r.id), ['message-1']); assert.equal(search.data[0].editedAt, bubble[0].message.editedAt);
    assert.equal(reads.length, before, 'cold reads issue no transport');
  } finally { drain?.close(); await Promise.all([alice.close(), bob.close()]); await owner.close(); await rm(root, { recursive: true, force: true }); }
});

for (const bootstrap of [false, true]) test(`chat successor installs ${bootstrap ? 'bootstrapped' : 'empty'} custody, raises A, and plans retarget/removal`, { timeout: 60000 }, async () => {
  let originalSchema = '', originalOps = '', originalAccess = '';
  const withoutLogQueries = (ops: string) => ops.replace(/query (?:inbox|thread|receipts|conversationView)\([^]*?(?=\n(?:query|mutation|schedule) |$)/g, '');
  const owner = await RealOwnerHarness.create({ forceOwned: true, fixture, prepare: async root => {
    originalSchema = await readFile(join(root, 'snapback/schema.q'), 'utf8');
    originalOps = await readFile(join(root, 'snapback/messages.q'), 'utf8');
    originalAccess = await readFile(join(root, 'snapback/access.q'), 'utf8');
    // These successor fixtures intentionally remove the template's read programs.
    // Its application journeys belong to the complete template, tested separately.
    await rm(join(root, 'snapback/tests'), { recursive: true, force: true });
    await writeFile(join(root, 'snapback/schema.q'), originalSchema.replace(`  ${declaration}\n`, ''));
    await writeFile(join(root, 'snapback/messages.q'), withoutLogQueries(originalOps));
    await writeFile(join(root, 'snapback/access.q'), originalAccess);
  } });
  const bob = createClient({ url: owner.url, persona: 'bob' });
  try {
    await bob.ready;
    assert.equal((await bob.query(api.messages.history, { conversationId: group, c: null })).data.length, 1);
    const schemaPath = join(owner.root!, 'snapback/schema.q'), opsPath = join(owner.root!, 'snapback/messages.q'), accessPath = join(owner.root!, 'snapback/access.q');
    await writeFile(accessPath, originalAccess); await writeFile(opsPath, originalOps);
    const schema = originalSchema.replace(declaration, declaration + (bootstrap ? ' bootstrap' : ''));
    const installed = await installSchema(owner, schema);
    const inbox: any = await bob.query(api.messages.inbox, { c: null });
    assert.equal(inbox.data.length, bootstrap ? 1 : 0);
    if (bootstrap) assert.equal(inbox.data[0].message.body, 'Welcome');
    const logs = (await readFile(join(owner.root!, '.snapback/log.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const applied = logs.filter(line => line.successor === 'applied');
    assert(applied.some(line => line.report?.to === installed.generation), JSON.stringify(applied));
    if (bootstrap) assert.match(JSON.stringify(applied), /bootstrap approximates send-time audiences/);
    await writeFile(accessPath, originalAccess.replace('first 50 by byConversationPrincipal', 'first 60 by byConversationPrincipal'));
    const raised = await installSchema(owner, schema.replace('cap 50 by conversationId', 'cap 60 by conversationId'));
    assert.equal(raised.successor.audienceBounds.deliveries, 60);
    assert.equal((await manifest(owner)).tables.messages.deliver.audience, 60);
    assert.equal((await bob.query(api.messages.inbox, { c: null })).data.length, bootstrap ? 1 : 0, 'bootstrap is one-shot');
    const acceptedSchema = await readFile(schemaPath, 'utf8');
    const audience = acceptedSchema.match(/table memberships:[^]*?(?=\ntable messages:)/)![0].replace('table memberships:', 'table audiences:');
    await writeFile(schemaPath, acceptedSchema.replace('deliver to memberships[', 'deliver to audiences[') + '\n' + audience);
    const planned = await until(() => control(owner, 'status'), s => s.status?.refused?.some((r: any) => r.code === 'E_SUCCESSOR_DESTRUCTIVE'), 'retarget requires a plan');
    assert.equal(planned.generation, raised.generation);
    assert.equal((await manifest(owner)).tables.messages.deliver.target, 'memberships');
    await writeFile(schemaPath, acceptedSchema);
    await until(() => control(owner, 'status'), s => s.status === 'ready', 'restore target');
    await writeFile(opsPath, withoutLogQueries(originalOps));
    await writeFile(accessPath, originalAccess.replace('first 50 by byConversationPrincipal', 'first 60 by byConversationPrincipal'));
    await writeFile(schemaPath, acceptedSchema.replace(`  ${declaration}${bootstrap ? ' bootstrap' : ''}\n`, ''));
    const removed = await until(() => control(owner, 'status'), s => s.status?.refused?.some((r: any) => r.code === 'E_SUCCESSOR_DESTRUCTIVE'), 'removal requires a plan');
    assert.equal(removed.generation, raised.generation);
    const files = (await readdir(join(owner.root!, '.snapback'))).filter(name => name.startsWith('migration-'));
    const plans = await Promise.all(files.map(name => readFile(join(owner.root!, '.snapback', name), 'utf8')));
    assert(plans.some(plan => plan.includes('deliveries')), JSON.stringify(plans));
  } finally { await bob.close(); await owner.close(); }
});

test('chat removal is delivered to an original recipient who left before unsend', async () => {
  const owner = await RealOwnerHarness.create({ forceOwned: true, fixture });
  const alice = createClient({ url: owner.url, persona: 'alice' });
  const bob = createClient({ url: owner.url, persona: 'bob' });
  try {
    await Promise.all([alice.ready, bob.ready]);
    const sent: any = await alice.mutation(api.messages.send, { conversationId: group, body: 'original audience' });
    assert.equal(sent.state, 'committed');
    assert.equal((await alice.mutation(api.groups.memberRemove, { conversationId: group, membershipId: 'membership-2' })).state, 'committed');
    assert.equal((await alice.mutation(api.messages.unsend, { messageId: sent.data.id })).state, 'committed');
    const log: any = await bob.query(api.messages.inbox, { c: null });
    assert.equal(log.data.filter((row: any) => row.kind === 'removed').length, 1, 'departed Bob receives one removal event');
  } finally { await Promise.all([alice.close(), bob.close()]); await owner.close(); }
});

test('a joiner pages all prior live history through both shipped reads without retroactive deliveries', async () => {
  const owner = await RealOwnerHarness.create({ forceOwned: true, fixture });
  const alice = createClient({ url: owner.url, persona: 'alice' });
  const carol = createClient({ url: owner.url, persona: 'carol' });
  try {
    await Promise.all([alice.ready, carol.ready]);
    const ids = ['message-1'];
    for (let n = 0; n < 105; n++) {
      const sent: any = await alice.mutation(api.messages.send, { conversationId: group, body: `prior ${n}` });
      assert.equal(sent.state, 'committed'); ids.push(sent.data.id);
    }
    assert.equal((await alice.mutation(api.groups.memberAdd, { conversationId: group, principal: 'dev:carol' })).state, 'committed');
    const history = await pages(carol, api.messages.history, { conversationId: group });
    assert.deepEqual(history.map(r => r.id).sort(), [...ids].sort());
    const composite: string[] = []; let c: string | null = null; let preview: unknown;
    do {
      const view: any = await carol.query(api.messages.conversationView, { conversationId: group, c });
      assert.equal(view.data.count, 106);
      preview ??= view.data.preview; assert.deepEqual(view.data.preview, preview);
      composite.push(...view.data.messages.map((r: any) => r.message.id)); c = view.next;
    } while (c);
    assert.deepEqual(composite.sort(), [...ids].sort());
    assert.deepEqual(await pages(carol, api.messages.inbox), []);
  } finally { await Promise.all([alice.close(), carol.close()]); await owner.close(); }
});

for (const evolve of [false, true]) test(`metadata-only departed removal evicts leased photo bytes and retains unrelated custody ${evolve ? 'across a successor' : 'without a successor'}`, async () => {
  const owner = await RealOwnerHarness.create({ forceOwned: true, fixture, prepare: root =>
    writeFile(join(root, 'snapback/custody.q'), 'query events(c: cursor ?):\n  return deliveries[viewer] after c first 50 by byRecipient\n') });
  const root = await mkdtemp(join(tmpdir(), 'chat-custody-bytes-'));
  const alice = createClient({ url: owner.url, persona: 'alice' });
  let bob: any = createClient({ url: owner.url, persona: 'bob', offline: { store: fileRangeStore(root) } });
  let drain: any;
  try {
    await Promise.all([alice.ready, bob.ready]);
    const bytes = await readFile(join(fixture, 'tests/fixtures/photo.jpg'));
    const sent: any[] = [];
    for (let n = 0; n < 2; n++) {
      const message: any = await alice.mutation(api.messages.sendPhoto, { conversationId: group, photo: new File([bytes], 'photo.jpg', { type: 'image/jpeg' }) });
      assert.equal(message.state, 'committed'); sent.push(message.data);
    }
    drain = await warm(bob); const urls: string[] = [];
    for (const message of sent) {
      const url = await bob.assetUrl(message.photo, { width: message.photo.width });
      assert((await bob.assetBlob(url, { viewing: {} })).size > 0); urls.push(url);
    }
    drain.close(); drain = undefined; await bob.offline();
    assert.equal((await alice.mutation(api.groups.memberRemove, { conversationId: group, membershipId: 'membership-2' })).state, 'committed');
    if (evolve) await installSchema(owner, (await readFile(join(owner.root!, 'snapback/schema.q'), 'utf8')).replace('cap 50 by conversationId', 'cap 2 by conversationId'));
    const sender = createClient({ url: owner.url, persona: 'alice' });
    try { await sender.ready; const removed = await sender.mutation(api.messages.unsend, { messageId: sent[0].id });
      assert.equal(removed.state, 'committed', JSON.stringify(removed)); } finally { await sender.close(); }
    await bob.close(); bob = createClient({ url: owner.url, persona: 'bob', offline: { store: fileRangeStore(root) } }); await bob.ready;
    drain = subscribe(bob, api.custody.events, { c: null }, () => {}, { drain: true });
    await drain.until((v: any) => v.data?.some((r: any) => r.row === sent[0].id && r.kind === 'removed'), 10000);
    drain.close(); drain = undefined; await bob.offline(); bob = await bob.restart();
    const held = await pages(bob, api.messages.inbox);
    assert(!held.some(r => r.message?.id === sent[0].id));
    assert(held.some(r => r.message?.id === sent[1].id));
    await assert.rejects(bob.assetBlob(urls[0]));
    assert((await bob.assetBlob(urls[1])).size > 0);
  } finally { drain?.close(); await Promise.all([alice.close(), bob.close()]); await owner.close(); await rm(root, { recursive: true, force: true }); }
});
