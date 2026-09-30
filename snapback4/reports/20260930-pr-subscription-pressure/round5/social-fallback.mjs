// Exact social starter schema/queries on real devices. Run from snapback4/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { server } from '../../../packages/snapback4/test/helpers/app-server.mjs';
import { open, opener, q, parked, sdk } from '../../../packages/snapback4/test/helpers/answers-stay.mjs';
const { RememberedAnswers } = await import(new URL('local-reads.js', sdk));
const program = readFileSync('crates/snapback4/src/verbs/init/social/schema.q', 'utf8');
const output = process.env.PR_SOCIAL_OUT;
const samples = [];
for (const tier of ['wasm', 'process']) for (const horizon of [false, true]) test(`${tier}: social ${horizon ? 'outside' : 'inside'} acquired horizons`, async t => {
  const f = await server(t, undefined, program);
  const post = async (path, body, persona = 'alice') => (await fetch(f.url + path, { method: 'POST', headers: { 'x-snapback-persona': persona }, body: JSON.stringify(body) })).json();
  const mutate = async (name, args, persona = 'alice') => {
    const result = await post('/m/' + name, { id: crypto.randomUUID(), args }, persona);
    assert.equal(result.state, 'sent', JSON.stringify(result)); return result.result;
  };
  await mutate('saveProfile', { name: 'Alice' });
  await mutate('saveProfile', { name: 'Bob' }, 'bob');
  const conversation = await mutate('createConversation', { title: 'Friends' });
  await mutate('add', { conversation, principal: 'dev:bob' });
  const message = await mutate('send', { conversation, text: 'coffee old message', photo: null });
  const direct = await mutate('openDirect', { id: 'direct', other: 'dev:bob' });
  const item = await mutate('post', { body: 'social post' }, 'bob');
  await mutate('follow', { principal: 'dev:bob' });
  if (horizon) {
    const rows = Array.from({ length: 501 }, (_, n) => [
      { table: 'profiles', row: { id: `zz-profile-${String(n).padStart(4, '0')}`, principal: `dev:extra${n}`, name: `Extra ${n}`, avatar: null } },
      { table: 'messages', row: { id: `later-message-${n}`, conversation, sender: 'dev:alice', ordinal: n + 2, recipients: 1, text: `coffee later ${n}`, photo: null, at: Date.now() + n } },
    ]).flat();
    assert.equal((await post('/seed', rows)).seeded, rows.length);
  }
  let offline = false, memory;
  const requests = [], pages = [], applies = [];
  const baseDevice = opener(tier, join(f.dir, "measurement"));
  const oldSet = RememberedAnswers.prototype.set;
  t.mock.method(RememberedAnswers.prototype, 'set', function (...args) { memory = this; return oldSet.apply(this, args); });
  const client = await open(t, f, tier, { persona: 'alice', device: { async open(...args) { const core = await baseDevice.open(...args); return { ...core, async call(req, commit) { const result = await core.call(req, commit); if (req.op === 'apply') applies.push({ watermark: req.page.watermark, captured: req.page.captured_watermark, ...result.ok }); return result; } }; } }, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/changes') return parked(init.signal);
    if (offline) throw Error('social offline');
    if (path.startsWith('/q/')) requests.push(path);
    const result = await fetch(input, init);
    if (path === '/sync') { const page = await result.clone().json(); pages.push({ watermark: page.watermark, events: page.events?.length }); }
    return result;
  } });
  const flows = [
    ['inbox', {}], ['conversationScreen', { conversation }], ['receiptMember', { conversation }],
    ['history', { conversation }], ['messageReceipts', { conversation }], ['profile', { principal: 'dev:alice' }],
    ['directConversation', { other: 'dev:bob' }], ['directPeer', { conversation: direct }],
    ['feed', {}], ['postState', { post: item.id }], ['messagePhoto', { id: message }],
    ['search', { q: 'coffee' }], ['searchChat', { conversation, q: 'coffee' }], ['typingIn', { conversation }],
  ];
  const readFlows = async phase => {
    const values = [];
    for (const [name, args] of flows) {
      const count = requests.length, start = performance.now(), read = await client.query(q(name), args);
      values.push({ name, phase, ready: 'data' in read, denied: read.denied?.code, complete: read.complete, fresh: read.fresh,
        rows: Array.isArray(read.data) ? read.data.length : undefined, queryRequests: requests.length - count, ms: +(performance.now() - start).toFixed(3) });
    }
    return values;
  };
  await readFlows('warm');
  // Let the real delivery reporter settle, then refill the two horizon fallbacks.
  await delay(300); await client.sync();
  const online = await readFlows('online');
  const rememberedBefore = memory?.size ?? 0;
  offline = true;
  const unchangedOffline = await readFlows('offline before advance');
  offline = false; await client.sync(); await readFlows('refill');
  const beforeAdvance = memory?.size ?? 0, pageStart = pages.length, applyStart = applies.length;
  // Another principal's online-only edge produces a global watermark without
  // touching this viewer's materialized Following partition.
  await mutate('follow', { principal: 'dev:carol' }, 'bob');
  await client.sync();
  const publication = pages.slice(pageStart);
  assert.ok(publication.length > 0 && publication.every(page => page.events === 0), JSON.stringify(publication));
  const rememberedAfter = memory?.size ?? 0;
  offline = true;
  const afterAdvance = await readFlows('offline after empty advance');
  offline = false; await client.sync();
  const recovered = await readFlows('online recovery');
  const result = { tier, horizon, rememberedBefore, beforeAdvance, rememberedAfter, publication, applies: applies.slice(applyStart), online, unchangedOffline, afterAdvance, recovered };
  samples.push(result); t.diagnostic(JSON.stringify(result));
  if (output) writeFileSync(output, JSON.stringify({ sdk: sdk.href, schema: 'crates/snapback4/src/verbs/init/social/schema.q', samples }, null, 2));
  for (const rows of [online, recovered]) assert.ok(rows.every(row => row.ready), JSON.stringify(rows));
});
