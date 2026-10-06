import fs from 'node:fs';
import crypto from 'node:crypto';
import { createFixtureDescriptor } from '../helper/fixture.mjs';
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const { origin, runId } = input;
async function responseJson(response, route) {
  if (!response.ok) throw Error(`API ${route.split('?')[0]} returned ${response.status}`);
  return response.json();
}
const credentials = who => ({ email: process.env[`CLIQUE_${who}_EMAIL`], password: process.env[`CLIQUE_${who}_PASSWORD`] });
if (process.argv[2] === 'seed') {
  let seedToken;
  const seedApi = async (route, data) => responseJson(await fetch(origin + route, {
    method: data ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(seedToken ? { Authorization: `Bearer ${seedToken}` } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}),
  }), route);
  const alice = (await seedApi('/register', credentials('ALICE'))).id;
  const bob = (await seedApi('/register', credentials('BOB'))).id;
  seedToken = (await seedApi('/login', credentials('ALICE'))).token;
  const { conversationId } = await seedApi('/conversations', { bob });
  // Ordinary public seed operations, not a preloaded client store.
  const send = (body, extra = {}) => seedApi('/send', { conversationId, body, ...extra });
  const history = await send('durable needle ' + runId.slice(0, 8));
  const bytes = fs.readFileSync(new URL('ordinary.png', import.meta.url));
  const onceBytes = fs.readFileSync(new URL('once.png', import.meta.url));
  const ordinary = await seedApi('/assets', { conversationId, bytes: bytes.toString('base64') });
  ordinary.messageId = (await send('ordinary photo', ordinary)).messageId;
  ordinary.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const viewOnce = await seedApi('/assets', { conversationId, bytes: onceBytes.toString('base64'), once: true });
  viewOnce.messageId = (await send('one view photo', { ...viewOnce, once: true })).messageId;
  viewOnce.sha256 = crypto.createHash('sha256').update(onceBytes).digest('hex');
  // These force real scrolling and recycled FlatList cells in the Release tree.
  for (let i = 0; i < 14; i++) await send('old filler ' + i);
  const f = createFixtureDescriptor({ origin, bundleId: input.bundleId, alice, bob, conversationId, chatValue: 'dm:bob',
    history: { messageId: history.messageId, body: history.body }, ordinary, viewOnce,
    search: { token: 'needle', messageId: history.messageId } }, { runId });
  if (process.env.NI_FAULT === 'wrong-fixture') f.history.messageId = f.search.messageId = crypto.randomUUID();
  console.log(JSON.stringify(f));
} else if (process.argv[2] === 'oracle') {
  // Authentication is an ordinary Bob sign-in. The history transport created
  // afterward exposes GET only and cannot post delivery/report mutations.
  const login = await responseJson(await fetch(origin + '/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials('BOB')),
  }), '/login');
  const bobRead = async route => responseJson(await fetch(origin + route, {
    method: 'GET', headers: { Authorization: `Bearer ${login.token}` },
  }), route);
  let next = 0, rows = [];
  do {
    const page = await bobRead(`/history?conversationId=${encodeURIComponent(input.conversationId)}&offset=${next}`);
    rows.push(...page.rows); next = page.next;
  } while (next !== null);
  // Preserve duplicates and authoritative order keys. No verdict and no local Alice data.
  console.log(JSON.stringify({ principal: login.principal, origin, conversationId: input.conversationId, complete: true,
    rows: rows.map(({ messageId, body, orderKey, receiptState }) => ({ messageId, body, orderKey, receiptState })) }));
} else throw Error('seed or oracle required');
