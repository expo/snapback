// M7 one-off hygiene: rename residue accept-* Carol profiles from this
// session's repeated suite runs so people-search 'car' fits on one page
// again (m5-a04 needs the current run's carol in the first 20 hits).
// Engine-honest: rewrites rows through the dev /seed endpoint, which
// applies validation, constraints, aggregates and sync (verified: the
// words index stays consistent). Starter profiles are never touched;
// ids, principals and handles are preserved byte-for-byte; only the
// display name loses the Carol word. Messages, media, receipts and
// reactions are not modified.
// Usage: node scripts/m7-decarol.mjs --url http://127.0.0.1:49300
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
function flag(name, fallback = null) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
}
const URL = (flag('--url', 'http://127.0.0.1:49300') || '').replace(/\/$/, '');

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
const alice = (await post('/auth/login', null, { email: 'alice@example.com', password: pw.alice })).session.token;

// Page ALL 'car' matches (page 1 is capped at 20).
const hits = [];
let c = null;
for (let i = 0; i < 10; i++) {
  const r = await post('/q/searchPeople', alice, { args: c ? { q: 'car', c } : { q: 'car' } });
  const rows = Array.isArray(r?.data) ? r.data : r?.data?.rows ?? [];
  hits.push(...rows);
  c = r?.data?.next;
  if (!c) break;
}
console.log(`car matches: ${hits.length}`);
const rows = [];
for (const p of hits) {
  if (p.handle === 'carol') continue; // fixture starter profile: never touch
  if (!/carol/i.test(p.displayName ?? '')) continue;
  const full = await post('/q/profileByHandle', alice, { args: { handle: p.handle } });
  if (!full?.data) continue;
  const f = full.data;
  rows.push({
    table: 'profiles',
    row: {
      id: f.id,
      principal: f.principal,
      displayName: (f.displayName ?? '').replace(/carol/gi, 'Tester'),
      handle: f.handle,
      bio: f.bio ?? null,
      location: f.location ?? null,
      link: f.link ?? null,
      avatar: f.avatar ?? null,
    },
  });
  await sleep(120);
}
if (rows.length) {
  const out = execFileSync('curl', ['-s', '-X', 'POST', `${URL}/seed`, '-H', 'content-type: application/json', '-d', JSON.stringify(rows)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  console.log('seed:', out.slice(0, 200));
}
const verify = await post('/q/searchPeople', alice, { args: { q: 'car' } });
const vrows = Array.isArray(verify?.data) ? verify.data : verify?.data?.rows ?? [];
console.log(`renamed=${rows.length} car matches now: ${vrows.length}: ${vrows.map((p) => p.handle).join(',')}`);
await post('/auth/logout', alice, {});
