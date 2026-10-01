import { waitFor as awaitState, hangBudget } from './helpers/wait.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLocalClient} from '../dist/local.js';
import {memoryPersistence, webDevice} from '../dist/web.js';
import {processDevice} from '../dist/native.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const binary = resolve(process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) { return awaitState(check, message); }

for (const host of ['wasm', 'native']) test(`Following unfollow/repost repeats in one ${host} session`, {timeout: hangBudget(48)}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sb4-unfollow-'));
  await mkdir(join(directory, 'snapback'));
  const source = readFileSync(join(root, 'crates/snapback4-lang/tests/fixtures/following-view.q'), 'utf8');
  await writeFile(join(directory, 'snapback/schema.q'), source + '\nquery followsActor(actor: principal):\n  return exists follows[viewer, actor]\n');
  const server = spawn(binary, ['dev', '--port', '0', '--fresh', '--no-watch'], {cwd:directory, stdio:['ignore', 'pipe', 'pipe']});
  const exited = once(server, 'exit');
  let log = '', url, client, core, observation, offline = false, holdSync;
  for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { log += chunk; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
  try {
    await until(() => { assert.equal(server.exitCode, null, log); return url; }, 'server startup');
    const request = async (path, args, persona = 'bob') => {
      const response = await fetch(url + path, {method:'POST', headers:{'x-snapback-persona':persona, 'content-type':'application/json'}, body:JSON.stringify({args})});
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      assert.equal(result.denied, undefined, JSON.stringify(result));
      return result;
    };
    const opener = host === 'wasm'
      ? webDevice({wasm:readFileSync(join(root, 'packages/snapback4/src/wasm/snapback4_device_bg.wasm')), persist:memoryPersistence()})
      : processDevice({binary, dir:join(directory, 'device')});
    client = await createLocalClient({url, persona:'bob', device:{open:async (...args) => { core = await opener.open(...args); return core; }},
      fetch:async (...args) => {
        if (offline) throw new TypeError('held delivery');
        const response = await fetch(...args);
        if (holdSync && String(args[0]).endsWith('/sync')) {
          const held = holdSync;
          holdSync = undefined;
          held.enter(await response.clone().json());
          await held.release;
        }
        if (offline) throw new TypeError('held delivery');
        return response;
      }});
    const query = {kind:'query', name:'cards'};
    observation = client.observe(query, {c:null});
    observation.subscribe(() => {});
    const check = async label => {
      // Foreign delivery may commit between two reads. Quiesce its queue before
      // comparing cuts; the Rust model separately compares undrained pages.
      const advanced = await fetch(url + '/dev/clock/advance', {method:'POST', body:JSON.stringify({duration:'1ms'})}).then(r => r.json());
      assert.equal(advanced.advancedMs, 1, JSON.stringify(advanced));
      const online = await request('/q/cards', {c:null});
      // sync() can join a round already in flight before the delivery commit.
      // Compare only after the replica reaches the online query's cut. A
      // missing row at that watermark still fails the equality below.
      await until(async () => {
        await client.sync();
        return (await core.call({op:'state'})).ok.watermark >= online.seq;
      }, `${label}: replica did not reach server sequence ${online.seq}`);
      const local = await core.call({op:'query', name:'cards', viewer:'dev:bob', args:{c:null}, now:Date.now()});
      assert.deepEqual(local.ok?.data, online.data, `${label}: device`);
      assert.deepEqual((await client.query(query, {c:null})).data, online.data, `${label}: client`);
      await until(() => JSON.stringify(observation.getSnapshot().data) === JSON.stringify(online.data), `${label}: observation ${JSON.stringify(observation.getSnapshot())} != ${JSON.stringify(online.data)}`);
      return online.data;
    };
    const mutate = async (name, args) => {
      const result = await client.mutate({kind:'mutation', name}, args);
      assert.notEqual(result.state, 'failed', JSON.stringify(result));
      await until(async () => { await client.sync(); return (await client.write(result.id)).state === 'sent'; }, `settle ${name}`);
      return check(name);
    };
    for (let cycle = 0; cycle < 3; cycle++) {
      const postId = `original-${cycle}`;
      assert.equal((await request('/m/post', {postId, parentId:null}, 'alice')).state, 'sent');
      await mutate('follow', {actor:'dev:alice'});
      await mutate('unfollow', {actor:'dev:alice'});
      const cards = await mutate('repost', {postId});
      assert.ok(cards.every(row => row.repost && row.actor === 'dev:bob'), JSON.stringify(cards));
      assert.equal(cards.length, 1);
      assert.equal(cards[0].post.id, postId);
      await mutate('unrepost', {postId});
    }
    // Calibration #20's harness leaves this edge present at the end of each
    // successful attempt. Its next attempt samples the new card with an always
    // true predicate, then skips unfollow when that not-yet-delivered card is
    // absent. Absence of an event is not proof of absence of a follow edge.
    await mutate('follow', {actor:'dev:alice'});
    // Force the same overlap as the intermittent native failure: an explicit
    // sync joins a response captured before the remote write and its delivery.
    let enter, release;
    const entered = new Promise(resolve => { enter = resolve; });
    holdSync = {enter, release:new Promise(resolve => { release = resolve; })};
    const olderRound = client.sync();
    const olderPage = await entered;
    try {
      const receipt = await request('/m/post', {postId:'overlapping-original', parentId:null}, 'alice');
      assert.ok(olderPage.watermark < receipt.seq);
      assert.ok(olderPage.events.every(row => row.id !== 'overlapping-original'));
      const joinedRound = client.sync();
      release();
      await Promise.all([olderRound, joinedRound]);
      assert.ok((await check('sync overlapping a remote commit')).some(row => row.post.id === 'overlapping-original'));
    } finally { release(); }
    offline = true;
    assert.equal((await request('/m/post', {postId:'held-original', parentId:null}, 'alice')).state, 'sent');
    const before = (await core.call({op:'query', name:'cards', viewer:'dev:bob', args:{c:null}, now:Date.now()})).ok;
    assert.ok(before.data.every(row => row.post.id !== 'held-original'));
    const edge = (await core.call({op:'query', name:'followsActor', viewer:'dev:bob', args:{actor:'dev:alice'}, now:Date.now()})).ok;
    assert.equal(edge.data, true, 'the current edge contradicts the harness inference');
    assert.equal((await request('/q/followsActor', {actor:'dev:alice'})).data, true);
    offline = false;
    await client.sync();
    const both = (await mutate('repost', {postId:'held-original'})).filter(row => row.post.id === 'held-original');
    assert.equal(both.length, 2, 'without an unfollow, both cards are correct');
    assert.deepEqual(both.map(row => row.repost).sort(), [false, true]);
    const after = (await mutate('unfollow', {actor:'dev:alice'})).filter(row => row.post.id === 'held-original');
    assert.equal(after.length, 1);
    assert.equal(after[0].repost, true, 'an explicit unfollow removes only the original');
    // The native Rust model covers independent receipt/sync orders and full
    // pagination. This seeded walk also exercises the actual Wasm codec and
    // the SDK's invalidation, outbox and subscribed query on both adapters.
    let seed = 0x3000013, following = false;
    const posts = ['original-0', 'original-1', 'original-2', 'held-original'];
    const reposts = new Set(['held-original']);
    for (let step = 0; step < 100; step++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0;
      switch (seed % 5) {
        case 0: case 1:
          await mutate(following ? 'unfollow' : 'follow', {actor:'dev:alice'});
          following = !following;
          break;
        case 2: case 3: {
          const postId = posts[(seed >>> 4) % posts.length];
          await mutate(reposts.has(postId) ? 'unrepost' : 'repost', {postId});
          if (!reposts.delete(postId)) reposts.add(postId);
          break;
        }
        default: {
          const postId = `random-${step}`;
          posts.push(postId);
          if (seed & 8) await mutate('post', {postId, parentId:null});
          else {
            assert.equal((await request('/m/post', {postId, parentId:null}, 'alice')).state, 'sent');
            await check(`remote post ${step}`);
          }
        }
      }
    }
  } finally {
    observation?.close();
    await client?.close();
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGTERM');
    await exited;
    await rm(directory, {recursive:true, force:true});
  }
});
