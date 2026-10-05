import fs from 'node:fs';
import crypto from 'node:crypto';
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const { origin, runId } = input;
let token;
async function api(route, data) {
  const response = await fetch(origin + route, { method: data ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  if (!response.ok) throw Error(`API ${route.split('?')[0]} returned ${response.status}`);
  return response.json();
}
const credentials = who => ({ email: process.env[`CLIQUE_${who}_EMAIL`], password: process.env[`CLIQUE_${who}_PASSWORD`] });
if (process.argv[2] === 'seed') {
  const alice = (await api('/register', credentials('ALICE'))).id;
  const bob = (await api('/register', credentials('BOB'))).id;
  token = (await api('/login', credentials('ALICE'))).token;
  const { conversationId } = await api('/conversations', { bob });
  // Ordinary public seed operations, not a preloaded client store.
  const send = (body, extra = {}) => api('/send', { conversationId, body, ...extra });
  const history = await send('durable needle ' + runId.slice(0, 8));
  const bytes = fs.readFileSync(new URL('ordinary.png', import.meta.url));
  const onceBytes = fs.readFileSync(new URL('once.png', import.meta.url));
  const ordinary = await api('/assets', { conversationId, bytes: bytes.toString('base64') });
  ordinary.messageId = (await send('ordinary photo', ordinary)).messageId;
  ordinary.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const viewOnce = await api('/assets', { conversationId, bytes: onceBytes.toString('base64'), once: true });
  viewOnce.messageId = (await send('one view photo', { ...viewOnce, once: true })).messageId;
  viewOnce.sha256 = crypto.createHash('sha256').update(onceBytes).digest('hex');
  // These force real scrolling and recycled FlatList cells in the Release tree.
  for (let i = 0; i < 14; i++) await send('old filler ' + i);
  const f = { protocol: 'clique-native/1', runId, origin, bundleId: input.bundleId, alice, bob, conversationId, chatValue: 'dm:bob',
    history: { messageId: history.messageId, body: history.body }, ordinary, viewOnce,
    search: { token: 'needle', messageId: history.messageId }, queuedBodies: [`${runId}:first`, `${runId}:second`] };
  if (process.env.NI_FAULT === 'wrong-fixture') f.history.messageId = f.search.messageId = crypto.randomUUID();
  console.log(JSON.stringify(f));
} else if (process.argv[2] === 'oracle') {
  const login = await api('/login', credentials('BOB')); token = login.token;
  let next = 0, rows = [];
  do {
    const page = await api(`/history?conversationId=${encodeURIComponent(input.conversationId)}&offset=${next}`);
    rows.push(...page.rows); next = page.next;
  } while (next !== null);
  // Preserve duplicates and authoritative order keys. No verdict and no local Alice data.
  console.log(JSON.stringify({ principal: login.principal, origin, conversationId: input.conversationId, complete: true,
    rows: rows.map(({ messageId, body, orderKey, receiptState }) => ({ messageId, body, orderKey, receiptState })) }));
} else throw Error('seed or oracle required');
