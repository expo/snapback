// M7 snapshot comparison: pre-existing messages, media, receipts, and
// reactions intact after migration. Compares live backend state against a
// snapshot dir produced by scripts/m7-snapshot.mjs. New entities created
// after the snapshot are ignored; any missing/altered pre-existing entity
// is a DIFF.
// Usage: node scripts/m7-compare.mjs --url http://127.0.0.1:49310 --snap m7/pre-snapshot
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
function flag(name, fallback = null) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
}
const URL = (flag('--url', 'http://127.0.0.1:49310') || '').replace(/\/$/, '');
const SNAP = flag('--snap', 'm7/pre-snapshot');

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
async function getAsset(token, id) {
  const r = await fetch(`${URL}/assets/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (r.status !== 200) return { id, status: r.status };
  const buf = Buffer.from(await r.arrayBuffer());
  return { id, status: 200, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
}
function rowsOf(body) {
  const d = body?.data;
  if (Array.isArray(d)) return d;
  return d?.rows ?? [];
}
async function pageAll(token, op, args) {
  const out = [];
  let c = null;
  for (let i = 0; i < 40; i++) {
    const r = await post(`/q/${op}`, token, { args: c ? { ...args, c } : args });
    out.push(...rowsOf(r));
    const next = r?.data?.next;
    if (!next) break;
    c = next;
  }
  return out;
}

const P = JSON.parse(readFileSync('instrument/fixtures/personas.json', 'utf8'));
const pw = Object.fromEntries(P.starter.map((p) => [p.id, p.password]));
const diffs = [];
let checked = 0;
for (const f of readdirSync(SNAP).filter((x) => x.endsWith('.json') && x !== 'manifest.json')) {
  const snap = JSON.parse(readFileSync(join(SNAP, f), 'utf8'));
  const id = snap.persona;
  const login = await post('/auth/login', null, { email: `${id}@example.com`, password: pw[id] });
  if (!login?.session) { diffs.push(`${id}: login failed`); continue; }
  const token = login.session.token;
  for (const [chatId, cs] of Object.entries(snap.chats)) {
    const liveMsgs = await pageAll(token, 'threadMessages', { chatId });
    const liveById = new Map(liveMsgs.map((m) => [m.id, m]));
    for (const sm of cs.messages) {
      checked += 1;
      const lm = liveById.get(sm.id);
      if (!lm) { diffs.push(`${id}/${chatId}/${sm.id}: missing after migration`); continue; }
      for (const k of ['chatId', 'authorId', 'kind', 'body', 'caption', 'tombstoned', 'quoteId', 'viewOnce']) {
        const a = sm[k] ?? null;
        const b = lm[k] ?? null;
        const an = typeof a === 'object' && a !== null ? a.id ?? null : a;
        const bn = typeof b === 'object' && b !== null ? b.id ?? null : b;
        if (an !== bn) diffs.push(`${id}/${chatId}/${sm.id}: field ${k} ${JSON.stringify(an)} -> ${JSON.stringify(bn)}`);
      }
    }
    const liveRx = await pageAll(token, 'threadReactions', { chatId });
    const rxKey = (r) => `${r.messageId}|${r.principal}|${r.emoji}`;
    const liveRxSet = new Set(liveRx.map(rxKey));
    for (const sr of cs.reactions) {
      checked += 1;
      if (!liveRxSet.has(rxKey(sr))) diffs.push(`${id}/${chatId}: reaction ${rxKey(sr)} missing`);
    }
    const liveRc = await pageAll(token, 'threadReceipts', { chatId });
    const rcKey = (r) => `${r.messageId}|${r.principal}|${r.state}`;
    const liveRcSet = new Set(liveRc.map(rcKey));
    for (const sr of cs.receipts) {
      checked += 1;
      if (!liveRcSet.has(rcKey(sr))) diffs.push(`${id}/${chatId}: receipt ${rcKey(sr)} missing`);
    }
    await sleep(100);
  }
  for (const [aid, sa] of Object.entries(snap.assets || {})) {
    if (sa.status !== 200) continue;
    checked += 1;
    const live = await getAsset(token, aid);
    if (live.sha256 !== sa.sha256) diffs.push(`${id}: asset ${aid} hash ${sa.sha256} -> ${live.sha256} (status ${live.status})`);
  }
  await post('/auth/logout', token, {});
  await sleep(200);
}
console.log(`COMPARE checked=${checked} diffs=${diffs.length}`);
for (const d of diffs.slice(0, 30)) console.log(`DIFF ${d}`);
process.exit(diffs.length ? 1 : 0);
