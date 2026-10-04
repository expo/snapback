// @ref LLP 3000.016#own-event-publication — settled own writes need no follower delivery turn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, mintId } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { processDevice } from '../dist/native.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { waitFor, hangBudget } from './helpers/wait.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const binary = resolve(process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4'));
const query = name => ({ kind: 'query', name });
const mutation = name => ({ kind: 'mutation', name });
const N = 25;

async function fixture(t, tier) {
  const directory = await mkdtemp(join(tmpdir(), 'sb4-following-own-'));
  await mkdir(join(directory, 'snapback'));
  // Calibration #30's starter shape: bounded sources, online-only follows,
  // a materialized Following view, and shaped 20-row pages (25 crosses a page).
  const source = readFileSync(join(root, 'crates/snapback4-lang/tests/fixtures/following-view.q'), 'utf8')
    .replace('sync public', 'sync public last 1000 by .at')
    .replace('sync public\n\ntable follows', 'sync public last 1000 by .at with own keys .actorId\n\ntable follows')
    .replace('sync public\n\nview activity', 'online only\n\nview activity')
    .replace('return feed last 20 by .at after c\n', 'return feed last 20 by .at after c { *, card: posts[.post] }\n');
  await writeFile(join(directory, 'snapback/schema.q'), 'use personas alice, bob\n' + source + `
query global(c: cursor ?):
  return activity last 20 by .at after c { *, card: posts[.post] }
`);
  const server = spawn(binary, ['dev', '--port', '0', '--fresh', '--no-watch'], {
    cwd: directory, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(server, 'exit');
  let log = '', url;
  const clients = [];
  t.after(async () => {
    await Promise.allSettled(clients.map(client => client.close()));
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGTERM');
    await exited;
    await rm(directory, { recursive: true, force: true });
  });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => {
    log += chunk;
    url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
  });
  await waitFor(() => { assert.equal(server.exitCode, null, log); return url; }, 'Following server startup');
  const open = async persona => {
    const client = tier === 'online' ? createClient({ url, persona }) : await createLocalClient({
      url, persona, device: tier === 'wasm'
        ? webDevice({ wasm: readFileSync(join(root, 'packages/snapback4/src/wasm/snapback4_device_bg.wasm')), persist: memoryPersistence() })
        : processDevice({ binary, dir: join(directory, 'device-' + persona) }),
    });
    clients.push(client);
    return client;
  };
  const author = await open('alice'), follower = await open('bob');
  assert.equal((await follower.mutate(mutation('follow'), { actor: 'dev:alice' }, { waitSeconds: 60 })).state, 'sent');
  assert.deepEqual(await pageAll(author, 'home'), []);
  assert.deepEqual(await pageAll(follower, 'home'), []);
  return { author, follower };
}

async function pageAll(client, name) {
  const rows = [];
  let c = null;
  for (let page = 0; page < 10; page++) {
    const answer = await client.query(query(name), { c });
    assert.ok(Array.isArray(answer.data), JSON.stringify(answer));
    assert.equal(answer.complete, true, JSON.stringify(answer));
    assert.ok(answer.data.every(row => row.card?.id === row.post), 'every event retains its card');
    rows.push(...answer.data);
    if (!answer.next) return rows;
    c = answer.next;
  }
  assert.fail('Following pagination did not terminate');
}

const newestFirst = rows => [...rows].sort((a, b) => b.at - a.at || (a.post < b.post ? 1 : a.post > b.post ? -1 : 0));
const ids = rows => rows.map(row => row.post);
async function post(author) {
  const postId = mintId();
  const receipt = await author.mutate(mutation('post'), { postId, parentId: null }, { waitSeconds: 60 });
  assert.equal(receipt.state, 'sent', JSON.stringify(receipt));
  return { post: postId, at: receipt.result.at };
}

for (const tier of ['online', 'process', 'wasm']) {
  test(`Following ${tier}: three unpaced bursts are complete and ordered at own settlement`, { timeout: hangBudget(150) }, async t => {
    const { author, follower } = await fixture(t, tier);
    const made = [];
    for (let trial = 1; trial <= 3; trial++) {
      const started = performance.now(), burst = [];
      for (let n = 0; n < N; n++) burst.push(await post(author));
      const settled = performance.now();
      made.push(...burst);
      // No sleep, sync, polling, drain, or other query between the last sent
      // receipt and this home read. Checking global first would hide the bug.
      const own = await pageAll(author, 'home');
      assert.deepEqual(ids(own), ids(newestFirst(made)), 'all settled own writes, newest first');
      const foreign = await pageAll(follower, 'home');
      const firstReadMs = performance.now() - settled;
      const present = new Set(ids(foreign));
      const immediateFollowerCount = burst.filter(row => present.has(row.post)).length;
      assert.deepEqual(ids(foreign), ids(newestFirst(foreign)), 'delivered subset remains ordered');
      assert.deepEqual(ids(await pageAll(author, 'global')), ids(newestFirst(made)));
      // The grader actually read B (Bob) after A (Alice) wrote. Measure that
      // separate eventual-delivery path without using it to settle the author.
      await waitFor(async () => ids(await pageAll(follower, 'home')).join() === ids(newestFirst(made)).join(),
        'follower receives the burst', { work: N });
      t.diagnostic(JSON.stringify({ tier, trial, count: N, own: burst.length,
        burstMs: settled - started, immediateFollowerCount, firstReadMs,
        followerAllMs: performance.now() - settled }));
    }
  });

  test(`Following ${tier}: each settled own write is visible before the next write`, { timeout: hangBudget(50) }, async t => {
    const { author } = await fixture(t, tier);
    const made = [];
    for (let n = 0; n < N; n++) {
      made.push(await post(author));
      assert.deepEqual(ids(await pageAll(author, 'home')), ids(newestFirst(made)));
    }
  });
}
