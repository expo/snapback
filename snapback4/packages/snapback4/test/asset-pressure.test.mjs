// Actual HTTP connection pressure against an unmodified 128-connection host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { avatarFixture } from './helpers/avatar-fixture.mjs';
import { binary } from './helpers/app-server.mjs';
const root = resolve(import.meta.dirname, '../../..');
const dist = process.env.AV_CLIENT_DIR ?? join(root, 'packages/snapback4/dist');
const { createClient } = await import(pathToFileURL(join(dist, 'client.js')));
const { createLocalClient } = await import(pathToFileURL(join(dist, 'local.js')));
const { processDevice } = await import(pathToFileURL(join(dist, 'native.js')));
const { webDevice, memoryPersistence } = await import(pathToFileURL(join(dist, 'web.js')));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('forty asset calls recover after actual connection admission pressure', { timeout: 30000 }, async t => {
  const f = await avatarFixture(t);
  for (const tier of ['online', 'process', 'wasm']) await t.test(tier, async t => {
    let attempts = 0, resets = 0, limited = 0;
    const options = { url: f.url, session: f.users.bob.session, assets: { keep: 'none', maxBytes: 0 }, fetch: async (url, init) => {
      if (!new URL(url).pathname.startsWith('/assets/')) return fetch(url, init);
      attempts++;
      try { const response = await fetch(url, init); if (response.status === 503) limited++; return response; }
      catch (error) { resets++; throw error; }
    } };
    const client = tier === 'online' ? createClient(options) : await createLocalClient({ ...options, device: tier === 'process'
      ? processDevice({ binary, dir: join(f.dir, 'pressure-process') })
      : webDevice({ wasm: readFileSync(join(dist, 'wasm/snapback4_device_bg.wasm')), persist: memoryPersistence() }) });
    t.after(() => client.close());
    // Leave at most six slots (often fewer, because the client owns live polls).
    // These are only our sockets; incomplete headers hold their admission leases.
    const sockets = [];
    t.after(() => sockets.forEach(socket => socket.destroy()));
    await Promise.all(Array.from({ length: 122 }, () => new Promise(resolve => {
      const socket = connect({ host: '127.0.0.1', port: Number(new URL(f.url).port) }); sockets.push(socket);
      socket.on('error', () => {}); socket.on('data', () => {});
      socket.once('connect', () => { socket.write('GET / HTTP/1.1\r\n'); resolve(); });
    })));
    await sleep(100);
    const release = setTimeout(() => sockets.forEach(socket => socket.destroy()), 500);
    const reads = await Promise.all(Array.from({ length: 40 }, () => client.asset(f.users.alice.avatar.id)));
    clearTimeout(release); sockets.forEach(socket => socket.destroy());
    const ready = reads.filter(read => 'url' in read).length;
    for (const read of reads) if ('url' in read) read.revoke();
    t.diagnostic(JSON.stringify({ tier, ready, attempts, resets, limited, denied: reads.filter(r => 'denied' in r).map(r => r.denied.code) }));
    if (!process.env.AV_FAULT_CONTROL) assert.equal(ready, 40);
  });
});
