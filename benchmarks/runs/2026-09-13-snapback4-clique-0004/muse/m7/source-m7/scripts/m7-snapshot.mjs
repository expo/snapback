// M7 pre/post snapshot exporter: custom-client API over the M6 field
// manifest (API.md section 5), one file per persona plus a hash manifest.
// Usage: node scripts/m7-snapshot.mjs --url http://127.0.0.1:49310 --out m7/pre-snapshot
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
function flag(name, fallback = null) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
}
const URL = (flag('--url', 'http://127.0.0.1:49310') || '').replace(/\/$/, '');
const OUT = flag('--out', 'm7/pre-snapshot');

const PERSONAS = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace', 'henry'];
const passes = JSON.parse(readFileSync('instrument/fixtures/personas.json', 'utf8'));
const pwById = new Map((passes.starter || []).map((p) => [p.id, p.password]));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, token, body) {
  for (let i = 0; i < 12; i++) {
    const r = await fetch(URL + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* keep raw */ }
    if (/RATE_LIMIT/i.test(text)) { await sleep(5000); continue; }
    return { status: r.status, json, text };
  }
  throw new Error(`rate-limited POST ${path}`);
}

async function getAsset(token, id) {
  const r = await fetch(`${URL}/assets/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (r.status !== 200) return { id, status: r.status };
  const buf = Buffer.from(await r.arrayBuffer());
  return {
    id,
    status: 200,
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
  };
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
    const rows = rowsOf(r.json);
    out.push(...rows);
    const next = r.json?.data?.next;
    if (!next) break;
    c = next;
  }
  return out;
}

async function exportPersona(id) {
  const email = `${id}@example.com`;
  const password = pwById.get(id);
  if (!password) throw new Error(`no fixture password for ${id}`);
  let session = null;
  for (let i = 0; i < 12; i++) {
    const r = await post('/auth/login', null, { email, password });
    if (r.json?.session) { session = r.json.session; break; }
    if (!/RATE_LIMIT/i.test(JSON.stringify(r.json))) break;
    await sleep(5000);
  }
  if (!session) throw new Error(`login failed for ${id}`);
  const token = session.token;
  const me = (await post('/q/me', token, {})).json?.data ?? null;
  const inbox = await pageAll(token, 'inbox', {});
  const chats = {};
  const assetIds = new Set();
  const collectAssets = (m) => {
    for (const k of ['photo', 'photoOnce', 'clip', 'poster']) {
      const ref = m?.[k];
      const aid = typeof ref === 'string' ? ref : ref?.id;
      if (aid && k !== 'photoOnce') assetIds.add(aid);
      else if (aid) assetIds.add(`once:${aid}`);
    }
    const av = m?.author?.avatar;
    const avid = typeof av === 'string' ? av : av?.id;
    if (avid) assetIds.add(avid);
  };
  for (const mem of inbox) {
    const chatId = mem.chatId;
    const detail = (await post('/q/chatDetail', token, { args: { chatId } })).json?.data ?? null;
    const messages = await pageAll(token, 'threadMessages', { chatId });
    const reactions = await pageAll(token, 'threadReactions', { chatId });
    const receipts = await pageAll(token, 'threadReceipts', { chatId });
    for (const m of messages) collectAssets(m);
    chats[chatId] = { membership: mem, detail, messages, reactions, receipts };
    await sleep(120);
  }
  const assets = {};
  for (const aid of assetIds) {
    if (aid.startsWith('once:')) {
      assets[aid] = { id: aid.slice(5), status: 'skipped-viewonce' };
      continue;
    }
    assets[aid] = await getAsset(token, aid);
    await sleep(60);
  }
  // End the session so snapshot logins leave no live tokens behind.
  await post('/auth/logout', token, {});
  return { persona: id, exportedAt: Date.now(), me, inbox, chats, assets };
}

mkdirSync(OUT, { recursive: true });
const manifest = { url: URL, exportedAt: Date.now(), files: {} };
for (const id of PERSONAS) {
  const snap = await exportPersona(id);
  const path = join(OUT, `${id}.json`);
  writeFileSync(path, `${JSON.stringify(snap, null, 1)}\n`);
  manifest.files[`${id}.json`] = createHash('sha256').update(readFileSync(path)).digest('hex');
  console.log(`snapshot ${id}: chats=${Object.keys(snap.chats).length} assets=${Object.keys(snap.assets).length}`);
  await sleep(300);
}
writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
console.log(`SNAPSHOT done -> ${OUT}`);
