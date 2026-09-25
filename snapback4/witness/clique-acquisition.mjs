// Acquisition-only projection of the frozen action log, not an action replay.
// The public row counts/body distributions come from the fixture. Media slots
// are null (no asset upload/auth path is included in this measurement).
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { launch, root } from './lib.mjs';
const fixture = process.env.CLIQUE_FIXTURES ?? '/home/ccheever/clique-cmp-20260925/instrument/fixtures';
const schema = process.env.CLIQUE_SCHEMA ?? '/home/ccheever/cal20-lane/snapback';
const rowFormat = process.env.ROW_FORMAT ?? 'packed';
assert.ok(['packed', 'legacy'].includes(rowFormat));
const tables = Object.fromEntries(['profiles', 'posts', 'follows', 'reposts', 'likes'].map(name => [name, new Map()]));
let at = 1700000000000;
for (const file of ['starter-m1.log', 'starter-m2.log', 'scale.log']) for (const line of readFileSync(join(fixture, file), 'utf8').trim().split('\n')) {
  if (line.startsWith('#')) continue;
  const [_date, user, verb, ...args] = [...line.matchAll(/"(?:[^"\\]|\\.)*"|\S+/g)].map(([token]) => token.startsWith('"') ? JSON.parse(token) : token);
  const actor = `dev:${user}`;
  at++;
  if (verb === 'profile-set') tables.profiles.set(actor, { id: user, principal: actor, displayName: args[0], handle: args[1], bio: args[2], location: args[3], link: args[4], avatar: null });
  if (verb === 'post' || verb === 'reply') tables.posts.set(args[0], { id: args[0], authorId: actor, parentId: verb === 'reply' ? args[1] : null, body: verb === 'reply' ? args[2] : args[2], at, removed: false, photo1: null, photo2: null, photo3: null, photo4: null, video: null });
  if (['follow', 'like', 'repost'].includes(verb)) {
    const table = verb === 'follow' ? 'follows' : verb === 'like' ? 'likes' : 'reposts';
    const key = `${user}:${args[0]}`;
    if (args[1] === 'clear') tables[table].delete(key);
    else tables[table].set(key, { id: args[2], at, ...(verb === 'follow' ? { followerId: actor, followedId: `dev:${args[0]}` } : verb === 'like' ? { principal: actor, postId: args[0] } : { actorId: actor, postId: args[0] }) });
  }
}
const counts = Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.size]));
assert.deepEqual(counts, { profiles: 1008, posts: 50228, follows: 5921, reposts: 1004, likes: 5008 });
const seed = Object.entries(tables).flatMap(([table, rows]) => [...rows.values()].map(row => ({ table, row })));
const source = mkdtempSync(join(tmpdir(), 'sb4-clique-acquisition-'));
cpSync(schema, source, { recursive: true, filter: path => !basename(path).startsWith('._') && basename(path) !== 'generated' });
writeFileSync(join(source, 'schema.q'), readFileSync(join(source, 'schema.q'), 'utf8').replace('use identity password', 'use personas alice, bob').replace(/^view following:.*\n/m, '').replace('return following last', 'return activity last'));
let witness;
try {
  witness = await launch({ seed: [], sourceDir: source });
  for (let offset = 0; offset < seed.length; offset += 2000) {
    const reply = await fetch(witness.api + '/seed', { method: 'POST', body: JSON.stringify(seed.slice(offset, offset + 2000)) }).then(r => r.json());
    assert.equal(reply.seeded, Math.min(2000, seed.length - offset), JSON.stringify(reply));
  }
  const results = [];
  for (let run = 0; run < Number(process.env.RUNS ?? 3); run++) {
    await witness.reload();
    const measured = await witness.page.evaluate(async ({ api, run, pageSize, rowFormat }) => {
      const metrics = { pages: [], applyMs: 0, wasmMs: 0, idbMs: 0, idbChanges: 0, idbSaves: 0, tables: {} };
      const original = window.WebDevice.prototype.call;
      window.WebDevice.prototype.call = function (text) {
        const op = JSON.parse(text).op, start = performance.now();
        try { return original.call(this, text); }
        finally { const ms = performance.now() - start; metrics.wasmMs += ms; if (op === 'apply') metrics.applyMs += ms; }
      };
      const persist = window.indexedDbPersistence();
      const save = persist.save;
      persist.save = async (name, changes) => { const start = performance.now(); await save(name, changes); metrics.idbMs += performance.now() - start; metrics.idbChanges += changes.length; metrics.idbSaves++; };
      const open = window.webDevice({ persist });
      const device = { async open(name, backend) {
        const store = `${name}:bench-${run}`;
        if (rowFormat === 'legacy') await new Promise((resolve, reject) => {
          const request = indexedDB.open(store, 1);
          request.onupgradeneeded = () => request.result.createObjectStore('changes', { keyPath: ['s', 'k'] });
          request.onsuccess = () => { request.result.close(); resolve(); };
          request.onerror = () => reject(request.error);
        });
        return open.open(store, backend);
      } };
      const measuredFetch = async (url, init) => {
        if (!String(url).endsWith('/sync')) return fetch(url, init);
        const body = JSON.parse(init.body);
        if (pageSize) init = { ...init, body: JSON.stringify({ ...body, limit: pageSize }) };
        const start = performance.now(), response = await fetch(url, init);
        const text = await response.text(), end = performance.now(), page = JSON.parse(text);
        metrics.pages.push({ requested: pageSize || body.limit, rows: page.events?.length ?? 0, snapshot: page.snapshot, responseMs: end - start, bytes: text.length });
        if (page.snapshot) for (const event of page.events) metrics.tables[event.table] = (metrics.tables[event.table] ?? 0) + 1;
        return new Response(text, { status: response.status, headers: response.headers });
      };
      const start = performance.now();
      const client = await window.createLocalClient({ url: api, persona: 'alice', device, fetch: measuredFetch, waitSeconds: 1 });
      metrics.wallMs = performance.now() - start; metrics.acquired = client.acquired;
      await client.close();
      return metrics;
    }, { api: witness.api, run, pageSize: Number(process.env.PAGE_SIZE ?? 0), rowFormat });
    assert.equal(measured.acquired, true);
    for (const [table, count] of Object.entries(counts)) assert.equal(measured.tables[table], count, table);
    await witness.reload();
    measured.offline = await witness.page.evaluate(async ({ api, run }) => {
      const opener = webDevice(), name = `snapback4-${encodeURIComponent(`${api}:dev:alice`)}:bench-${run}`;
      const start = performance.now();
      const client = await createLocalClient({ url: api, persona: 'alice', device: { open: (name, backend) => opener.open(`${name}:bench-${run}`, backend) },
        fetch: async () => { throw new TypeError('offline benchmark reopen'); } });
      try {
        const profile = await client.query({ kind: 'query', name: 'profile' }, { handle: 'u0001' });
        const persistedRows = (await indexedDbPersistence().load(name)).filter(c => c.s === 'r').length;
        return { ms: performance.now() - start, acquired: client.acquired, link: client.link(), profile: profile.data?.displayName, fresh: profile.fresh, persistedRows };
      } finally { await client.close(); }
    }, { api: witness.api, run });
    assert.equal(measured.offline.acquired, true);
    assert.equal(measured.offline.link, 'offline');
    assert.equal(measured.offline.profile, 'Scale User 0001');
    assert.equal(measured.offline.fresh, false);
    assert.equal(measured.offline.persistedRows, Object.values(measured.tables).reduce((sum, count) => sum + count, 0));
    results.push(measured);
    console.log(JSON.stringify({ run, ...measured }));
  }
  const output = { fixture: createHash('sha256').update(readFileSync(join(fixture, 'scale.log'))).digest('hex'), counts, rowFormat, browser: witness.page.context().browser().version(), results };
  if (process.env.OUTPUT) writeFileSync(process.env.OUTPUT, JSON.stringify(output, null, 2) + '\n');
} finally { await witness?.close(); rmSync(source, { recursive: true, force: true }); }
