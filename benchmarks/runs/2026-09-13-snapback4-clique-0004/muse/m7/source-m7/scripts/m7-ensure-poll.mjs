// M7 pre-choreography step (idempotent): ensure the Weekend Plans group
// shows the contracted two-option poll the m7 choreography votes on.
// The acceptance suite runs this first; graders running choreography.mjs
// m7 standalone should run it once beforehand against the same backend.
// Usage: node scripts/m7-ensure-poll.mjs --url http://127.0.0.1:49310
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
function flag(name, fallback = null) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
}
const URL = (flag('--url', 'http://127.0.0.1:49310') || '').replace(/\/$/, '');
const MSG_ID = flag('--msgId', 'm7-choreo-poll');
const OPT_A = flag('--optA', 'm7-option-a');
const OPT_B = flag('--optB', 'm7-option-b');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(path, token, body) {
  for (let i = 0; i < 12; i++) {
    const r = await fetch(URL + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* raw */ }
    if (/RATE_LIMIT/i.test(text)) { await sleep(5000); continue; }
    return json;
  }
  throw new Error(`rate-limited ${path}`);
}

const P = JSON.parse(readFileSync('personas.json', 'utf8'));
const pw = Object.fromEntries(P.starter.map((p) => [p.id, p.password]));
const login = await post('/auth/login', null, { email: 'alice@example.com', password: pw.alice });
if (!login?.session) throw new Error('alice login failed');
const token = login.session.token;
const rowsOf = (b) => (Array.isArray(b?.data) ? b.data : b?.data?.rows ?? []);
const inbox = await post('/q/inbox', token, { args: {} });
const group = rowsOf(inbox).find((x) => x.chat?.kind === 'group' && x.chat?.name === 'Weekend Plans');
if (!group) throw new Error('Weekend Plans group not found');
const existing = await post('/q/pollOf', token, { args: { messageId: MSG_ID } });
if (existing?.data?.messageId === MSG_ID) {
  console.log(`ENSURE-POLL present: ${MSG_ID} total=${existing.data.total}`);
} else {
  const r = await post('/m/createPoll', token, {
    id: `m7-ensure-${Date.now() % 100000}`,
    args: {
      chatId: group.chatId,
      msgId: MSG_ID,
      question: 'Saturday plan: coffee first or trail first?',
      optIdA: OPT_A,
      optA: 'Coffee first',
      optIdB: OPT_B,
      optB: 'Trail first',
    },
  });
  if (r?.state === 'failed' && !r?.replayed) throw new Error(`createPoll failed: ${JSON.stringify(r?.why)}`);
  console.log(`ENSURE-POLL created: ${MSG_ID} state=${r?.state}${r?.replayed ? ' replayed' : ''}`);
}
await post('/auth/logout', token, {});
