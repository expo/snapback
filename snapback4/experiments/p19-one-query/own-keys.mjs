// This demonstrates existing whole-owner partition semantics, not automatic
// compiler lowering or a new wire protocol. Read only a P19 census of a copy.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const here = import.meta.dirname, sb4 = resolve(here, '../..'), version = process.argv[2];
assert.ok(['published', 'main'].includes(version));
const work = join(here, '.work', version), app = join(work, 'app');
const pkg = version === 'published' ? join(work, 'node_modules/snapback4') : join(sb4, 'packages/snapback4');
const binary = version === 'published' ? join(work, 'node_modules/snapback4-linux-x64/snapback4') : join(sb4, 'target/debug/snapback4');
const { createLocalClient } = await import(join(pkg, 'dist/local.js'));
const { processDevice } = await import(join(pkg, 'dist/native.js'));
const { createClient, mintId } = await import(join(pkg, 'dist/client.js'));
const { login } = await import(join(pkg, 'dist/auth.js'));
const census = JSON.parse(readFileSync(join(here, 'results/census.json')));
const source = readFileSync(join(here, 'builder.q'), 'utf8') + readFileSync(join(here, 'probes.q'), 'utf8') + readFileSync(join(here, 'own-keys.q'), 'utf8');
writeFileSync(join(app, 'snapback/schema.q'), source);
let output = '', offline = false, local, online, server;
const records = [];
try {
  server = spawn(binary, ['dev', '--port', '0', '--no-watch', '--replay'], { cwd: app, stdio: ['ignore', 'pipe', 'pipe'] });
  records.push({ stage: 'start', pid: server.pid });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', b => { output += b; appendFileSync(join(work, 'own-keys-server.log'), b); });
  let url;
  for (let i = 0; i < 6000 && !url; i++) { assert.equal(server.exitCode, null, output.slice(-3000)); url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; if (!url) await delay(30); }
  assert.ok(url);
  const seed = [...census.likes.u0500_keys.map(row => ({ table: 'p19LikeKeys', row })), ...census.reposts.u0500_keys.map(row => ({ table: 'p19RepostKeys', row }))];
  const seeded = await fetch(url + '/seed', { method: 'POST', body: JSON.stringify(seed) }).then(r => r.json());
  assert.equal(seeded.seeded, seed.length, JSON.stringify(seeded));
  const evidence = process.env.P19_EVIDENCE ?? '/home/ccheever/sb4-intent/rg-evidence/lane';
  const line = readFileSync(join(evidence, 'instrument/fixtures/scale.log'), 'utf8').split('\n').find(x => / u0500 register /.test(x));
  const tokens = line.match(/"(?:[^"\\]|\\.)*"|\S+/g).map(t => t.startsWith('"') ? JSON.parse(t) : t);
  const signed = await login(url, tokens[3], tokens[4]); assert.ok(signed.ok);
  online = createClient({ url, session: signed.session });
  local = await createLocalClient({ url, session: signed.session, device: processDevice({ binary, dir: join(work, 'devices/own-keys'), spawn: (...args) => { const child = spawn(...args); records.push({ stage: 'device', pid: child.pid }); return child; } }), fetch: (input, init) => {
    if (offline) return Promise.reject(new TypeError('P19 offline'));
    if (new URL(input).pathname === '/changes') return new Promise((_, reject) => {
      if (init?.signal?.aborted) return reject(init.signal.reason);
      init?.signal?.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
    return fetch(input, init);
  } });
  await local.sync(); await local.sync();
  const residency = await local.residency();
  records.push({ stage: 'residency', likes: residency.tables.p19LikeKeys, reposts: residency.tables.p19RepostKeys, totalBytes: residency.totalBytes });
  const absent = mintId(), present = census.likes.u0500_keys[0].post;
  const op = { kind: 'query', name: 'p19OwnedState' };
  offline = true; await local.sync();
  for (const [label, post] of [['absent', absent], ['present', present]]) {
    const read = await local.query(op, { post });
    assert.equal(read.complete, true); assert.equal(read.fresh, false);
    assert.equal(read.data.liked, label === 'present');
    records.push({ stage: label, read });
  }
  const removed = await online.mutate({ kind: 'mutation', name: 'p19RemoveLike' }, { post: present });
  assert.equal(removed.state, 'sent');
  const stale = await local.query(op, { post: present }); assert.equal(stale.data.liked, true); assert.equal(stale.fresh, false);
  records.push({ stage: 'offline-after-remote-delete', read: stale });
  offline = false; await local.sync(); await local.sync(); offline = true; await local.sync();
  const deleted = await local.query(op, { post: present }); assert.equal(deleted.data.liked, false); assert.equal(deleted.complete, true); assert.equal(deleted.fresh, false);
  records.push({ stage: 'synced-delete-offline', read: deleted });
  records.push({ stage: 'finished', pass: true });
} catch (error) { records.push({ stage: 'failure', message: error.stack }); process.exitCode = 1; }
finally {
  await local?.close(); await online?.close();
  if (server?.exitCode === null) { const closed = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); await closed; }
  writeFileSync(join(here, 'results', version + '-own-keys.json'), JSON.stringify(records, null, 2) + '\n');
}
