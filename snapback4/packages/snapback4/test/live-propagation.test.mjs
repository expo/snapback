// @ref LLP 3000.023#10 — change evidence wakes dependent observations without a sampling timer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetch } from 'undici';
import { createLocalClient } from '../dist/local.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { processDevice } from '../dist/native.js';
import { server, binary, until } from './helpers/app-server.mjs';

const fixture = readFileSync(new URL('../../../reports/20260929-ll-live-latency/tools/fixture.q', import.meta.url), 'utf8')
  .replace('use identity password', 'use personas alice, bob').replace('  update <- .principal = viewer\n  sync to members[.room]', '  update <- .principal = viewer\n  delete <- allow\n  sync to members[.room]') + `
query decorated(message: messages, c: cursor ?):
  m = messages[message] ! else NOT_FOUND
  return { text: m.text, author: profiles[principal = m.sender].name, reactions: reactions where .message = message first 50 by .principal after c }
mutation removeMember(): server
  delete members['bob']
`;
const q = name => ({ kind: 'query', name });
// tick(0) pumps host zero-delay I/O and queue yields, never elapsed time, retries,
// retention deadlines, presence sampling or network watchdogs.
async function eventTurns(t, predicate, label) {
  const limit = performance.now() + 10000;
  while (!predicate() && performance.now() < limit) { t.mock.timers.tick(0); await new Promise(resolve => setImmediate(resolve)); }
  assert.ok(predicate(), label);
}
const cases = ['child-add', 'child-replace', 'child-remove', 'parent', 'joined-profile', 'authorization', 'unknown-footprint'].map(scenario => ({ scenario }));
cases.push({ scenario: 'child-add', held: true }, { scenario: 'child-remove', held: true }, { scenario: 'unknown-footprint', held: true }, { scenario: 'child-add', keep: false }, { scenario: 'child-add', keep: true }, { scenario: 'child-add', expire: true }, { scenario: 'child-add', keep: true, expire: true });
for (const tier of ['process', 'wasm']) for (const { scenario, keep, expire, held } of cases) {
  test(`${tier}: ${scenario} keep=${keep} expire=${!!expire}${held ? ' held=true' : ''} drives mounted reads from change through apply without elapsed timers`, async t => {
    const { url, dir } = await server(t, '', held ? fixture.replace('query decorated(message: messages, c: cursor ?):', 'query decorated(message: messages, c: cursor ?) held:').replace('query reactionRows(message: messages, c: cursor ?):', 'query reactionRows(message: messages, c: cursor ?) held:') : fixture);
    const post = async (path, body) => fetch(url + path, { method: 'POST', headers: { 'x-snapback-persona': 'alice' }, body: JSON.stringify(body) }).then(r => r.json());
    const rows = [
      { table: 'profiles', row: { id: 'alice', principal: 'dev:alice', name: 'Alice' } },
      { table: 'rooms', row: { id: 'room', title: 'Room' } },
      ...['alice', 'bob'].map(name => ({ table: 'members', row: { id: name, room: 'room', principal: 'dev:' + name } })),
      { table: 'messages', row: { id: 'anchor', room: 'room', sender: 'dev:alice', ordinal: 1, text: 'original' } },
    ];
    if (scenario === 'child-replace' || scenario === 'child-remove') rows.push({ table: 'reactions', row: { id: 'r', message: 'anchor', principal: 'dev:alice', emoji: 'old' } });
    assert.equal((await post('/seed', rows)).seeded, rows.length);
    let deliver, holdSync = false, releaseSync, queries = 0, syncStarted = false;
    const underlying = tier === 'process' ? processDevice({ binary, dir: join(dir, 'device') }) : webDevice({ wasm: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)), persist: memoryPersistence() });
    const client = await createLocalClient({ url, persona: 'bob', device: { async open(...args) {
      const core = await underlying.open(...args);
      return { ...core, async call(request, committed) { if (request.op === 'query') queries++; return core.call(request, committed); } };
    } }, fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/changes') return new Promise((resolve, reject) => { deliver = resolve; init.signal.addEventListener('abort', () => reject(Error('closed')), { once: true }); });
      if (path === '/sync' && holdSync) { syncStarted = true; await new Promise(resolve => { releaseSync = resolve; }); }
      return fetch(input, init);
    } });
    t.after(() => { releaseSync?.(); return client.close(); });
    await client.sync();
    const decorated = client.observe(q('decorated'), { message: 'anchor', c: null }, { keep }); decorated.subscribe(() => {});
    const reactions = client.observe(q('reactionRows'), { message: 'anchor', c: null }); reactions.subscribe(() => {});
    t.after(() => { decorated.close(); reactions.close(); });
    await until(() => decorated.getSnapshot().data?.text === 'original' && reactions.getSnapshot().data && deliver, 'initial observations and poll');
    // Existence follows each value across the publication cut, including a held
    // watch that never evaluates the old replica while waiting for sync.
    const initialExistence = scenario === 'child-replace' || scenario === 'child-remove' ? 'present' : 'absent';
    assert.equal(reactions.getSnapshot().existence, initialExistence);
    const publications = [];
    reactions.subscribe(() => publications.push(reactions.getSnapshot()));
    // Let the queue's current zero-delay turn finish before freezing host time.
    await new Promise(resolve => setTimeout(resolve, 10));
    const head = await fetch(url + '/changes?since=0&wait=0', { headers: { 'x-snapback-persona': 'bob' } }).then(r => r.json());
    const previousQueries = queries;
    const operation = scenario.startsWith('child') ? 'setReaction' : scenario === 'parent' ? 'editMessage' : scenario === 'authorization' ? 'removeMember' : 'editProfile';
    const args = scenario.startsWith('child') ? { message: 'anchor', emoji: scenario === 'child-remove' ? null : 'new' }
      : scenario === 'parent' ? { id: 'anchor', text: 'changed' } : scenario === 'authorization' ? {} : { name: 'Changed' };
    // Commit before freezing timers; receiver learns only through the controlled poll completion.
    assert.equal((await post('/m/' + operation, { id: crypto.randomUUID(), args })).state, 'sent');
    // Use the real commit footprint after the seed; both feed production and
    // receiver dependency tracking must work for the causal assertion to pass.
    const change = await fetch(url + '/changes?since=' + head.seq + '&wait=0', { headers: { 'x-snapback-persona': 'bob' } }).then(r => r.json());
    assert.ok(change.seq > head.seq);
    assert.ok(change.tables.includes(scenario.startsWith('child') ? 'reactions' : scenario === 'parent' ? 'messages' : scenario === 'authorization' ? 'members' : 'profiles'));
    if (scenario === 'unknown-footprint') delete change.tables;
    holdSync = true;
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
    deliver(Response.json(change));
    await eventTurns(t, () => syncStarted, 'the change immediately requests sync');
    if (keep === false) assert.equal(decorated.getSnapshot().loading, true);
    else assert.equal(decorated.getSnapshot().revalidating, true);
    if (scenario !== 'joined-profile' && scenario !== 'authorization') assert.equal(reactions.getSnapshot().revalidating, true);
    if (scenario === 'joined-profile') assert.equal(reactions.getSnapshot().revalidating, undefined, 'known disjoint dependencies stay quiet');
    // Only held queries forbid fallback regardless of the next branch/coverage.
    if (held) assert.equal(queries, previousQueries, 'held reads park before apply');
    else await eventTurns(t, () => queries > previousQueries, 'ordinary reads retain their fallback evaluation');
    const beforeApply = queries;
    if (expire) {
      t.mock.timers.tick(1000);
      assert.equal(decorated.getSnapshot().loading, true, 'waiting for sync keeps the one-second bound');
    }
    releaseSync(); holdSync = false;
    await eventTurns(t, () => {
      const read = decorated.getSnapshot();
      if (scenario === 'authorization') return read.denied?.code === 'NOT_FOUND';
      if (!read.data || read.revalidating) return false;
      return scenario.startsWith('child') ? (scenario === 'child-remove' ? read.data.reactions.length === 0 : read.data.reactions[0]?.emoji === 'new')
        : scenario === 'parent' ? read.data.text === 'changed' : read.data.author === 'Changed';
    }, 'apply re-evaluates and publishes the dependent observation');
    assert.ok(queries > beforeApply, 'publication is caused by a new evaluation');
    assert.equal(decorated.getSnapshot().loading, undefined);
    if (scenario === 'unknown-footprint') await eventTurns(t, () => !reactions.getSnapshot().revalidating, 'unknown notification wakes a parked disjoint watch after its cut applies');
    if (scenario.startsWith('child')) {
      const expected = scenario === 'child-remove' ? 'absent' : 'present';
      await eventTurns(t, () => reactions.getSnapshot().existence === expected && !reactions.getSnapshot().revalidating,
        'resumed live read recomputes existence from the new answer');
      assert.ok(publications.some(read => read.existence === expected && !read.revalidating));
      for (const read of publications) if ('data' in read) {
        if (read.data.length) assert.equal(read.existence, 'present', 'new rows never inherit the previous empty word');
        else if (!read.revalidating) assert.equal(read.existence, 'absent', 'completed empty replacement proves absence');
        else assert.ok(['absent', 'partial'].includes(read.existence), 'pending facts may demote retained empty answers');
      }
    }
    if (scenario === 'authorization') assert.equal('existence' in decorated.getSnapshot(), false, 'refusal drops the prior word');
    t.mock.timers.reset();
  });
}
