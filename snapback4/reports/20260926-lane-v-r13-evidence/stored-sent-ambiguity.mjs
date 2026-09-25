// Supplemental review counterexample, not a claim that old false-sent history
// is repaired. Both histories have the same unqualified legacy custody shape.
// Run from snapback4/: node reports/20260926-lane-v-r13-evidence/stored-sent-ambiguity.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { devServer, root } from '../../witness/lib.mjs';
import { createLocalClient } from '../../packages/snapback4/dist/local.js';
import { webDevice, memoryPersistence } from '../../packages/snapback4/dist/web.js';
import { mintId } from '../../packages/snapback4/dist/client.js';

const source = `use personas alice
table counters:
  admin: bool
  total: int
  public 'stored sent ambiguity'
  update <- allow
  sync
mutation bump():
  require counters['audit'].admin = true else NOT_ADMIN
  a = counters['audit'] ! else NOT_FOUND
  update counters[a] { total: a.total + 1 }
query total():
  return counters['audit'].total
`;
const headers = { 'x-snapback-persona': 'alice', 'content-type': 'application/json' };
const ok = reply => { assert.equal(reply.denied, undefined); return reply.ok; };
for (const admin of [false, true]) {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-sent-ambiguity-'));
  const sourceDir = join(dir, 'snapback'); mkdirSync(sourceDir); writeFileSync(join(sourceDir, 'schema.q'), source);
  const host = await devServer({ sourceDir, seed: [{ table: 'counters', row: { id: 'audit', admin, total: 0 } }] });
  const persist = memoryPersistence(), opener = webDevice({ persist,
    wasm: readFileSync(join(root, 'packages/snapback4/src/wasm/snapback4_device_bg.wasm')) });
  let client, core, online = true, posts = 0;
  const open = () => createLocalClient({ url: host.api, persona: 'alice', waitSeconds: 0,
    device: { open: async (...args) => core = await opener.open(...args) },
    fetch: async (input, init) => {
      if (new URL(input).pathname.startsWith('/m/')) posts++;
      if (!online) throw new TypeError('original backend unavailable on reopen');
      return fetch(input, init);
    },
  });
  try {
    client = await open();
    const binding = ok(await core.call({ op: 'sync_state', capture: false })).store_id, id = mintId();
    const outcome = await fetch(host.api + '/m/bump', { method: 'POST', headers,
      body: JSON.stringify({ id, args: {}, newIds: [], store_id: binding }) }).then(r => r.json());
    assert.equal(outcome.state, admin ? 'sent' : 'failed');
    const db = new DatabaseSync(join(host.app, '.snapback4/store.sqlite'));
    let seq;
    try { seq = db.prepare('SELECT seq FROM _ops WHERE principal = ? AND id = ?').get('dev:alice', id).seq; }
    finally { db.close(); }
    online = false; await client.sync();
    ok(await core.call({ op: 'enqueue', entry: { id, seq: 1, op: 'bump', args: {}, viewer: 'dev:alice', now: Date.now(),
      new_ids: [], predicted: [], predictable: false, observed_seq: seq, receipt_store: { id: binding } } }));
    // false: the R11 bug persisted a manufactured success.
    // true: the real response was persisted before a failed outbox settlement.
    ok(await core.call({ op: 'keep_write', value: JSON.stringify({ state: 'sent', id, seq, replayed: true }) }));
    await client.close(); client = await open();
    const receipt = await client.write(id);
    assert.equal(receipt.state, 'sent'); assert.equal(posts, 0);
    const audit = await fetch(host.api + '/q/total', { method: 'POST', headers, body: '{}' }).then(r => r.json());
    assert.equal(audit.data, admin ? 1 : 0);
    console.log(JSON.stringify({ source: admin ? 'genuine saved success, settlement aborted' : 'R11 false success',
      shape: 'sent history + observed_seq + receipt_store.id, no success_seq', server: outcome.state,
      refusal: outcome.why?.code, recovered: receipt.state, replayPosts: posts, audit: audit.data }));
  } finally { await client?.close(); await host.close(); rmSync(dir, { recursive: true, force: true }); }
}
