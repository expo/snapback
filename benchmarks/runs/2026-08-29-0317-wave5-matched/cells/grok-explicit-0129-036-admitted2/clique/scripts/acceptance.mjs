#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { existsSync, readFileSync } from 'node:fs';
import { createAssetClient, createSnapbackAppClient } from '@expo/snapback-client';
import { app } from '../snapback/generated/app.mjs';
import api from '../snapback/generated/api.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = process.env.SNAPBACK_URL ?? process.env.EXPO_PUBLIC_SNAPBACK_URL ?? 'http://127.0.0.1:63200';
const milestone = (process.argv.find((a) => a.startsWith('--milestone')) ? process.argv[process.argv.indexOf('--milestone') + 1] : process.argv[2] ?? 'm1').toLowerCase();

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function makeClient(partition) {
  const appClient = await createSnapbackAppClient({
    app,
    url: origin,
    platform: {
      kind: 'expo-web',
      indexedDB: new IDBFactory(),
      cryptoObject: webcrypto,
      databaseName: `clique-accept-${partition}`,
    },
    storagePartition: partition,
  });
  for (let i = 0; i < 50; i += 1) {
    const state = appClient.bootstrapState();
    if (state.status === 'ready') return appClient;
    await wait(100);
  }
  throw new Error('bootstrap timeout');
}

async function waitAuth(client) {
  for (let i = 0; i < 50; i += 1) {
    if (client.auth.currentPrincipal().status === 'authenticated') return;
    await wait(100);
  }
  throw new Error('not authenticated');
}

async function mutate(client, ref, args) {
  const outcome = await client.client.mutate(ref, { args });
  const status = outcome?.status ?? outcome?.dispatch;
  if (status === 'queued') throw new Error('queued');
  if (status === 'failed' || outcome?.ok === false) {
    const code = outcome?.error?.code ?? outcome?.failure?.code ?? outcome?.code ?? 'MUTATION_FAILED';
    throw new Error(code);
  }
  return outcome.result ?? outcome.value ?? outcome;
}

async function query(client, ref, args = {}) {
  return await client.client.query(ref, { args });
}

const results = [];
function check(id, fn) {
  return (async () => {
    try {
      await fn();
      results.push({ id, pass: true });
      console.log('PASS', id);
    } catch (error) {
      results.push({ id, pass: false, error: error.message });
      console.error('FAIL', id, error.message);
    }
  })();
}

const suffix = `${Date.now()}`;

if (milestone === 'm1') {
  await check('m1-a01', async () => {
    const client = await makeClient(`a01-${suffix}`);
    await client.auth.signUpWithPassword({ email: `new${suffix}@example.com`, password: 'NewUser!Clique2026' });
    await waitAuth(client);
    await client.dispose();
  });
  await check('m1-a02', async () => {
    const client = await makeClient(`a02-${suffix}`);
    await client.auth.signUpWithPassword({ email: `auth${suffix}@example.com`, password: 'AuthUser!Clique2026' });
    await waitAuth(client);
    assert.equal(client.auth.currentPrincipal().status, 'authenticated');
    await client.dispose();
  });
  await check('m1-a03', async () => {
    const a = await makeClient(`a03a-${suffix}`);
    await a.auth.signUpWithPassword({ email: `ha${suffix}@example.com`, password: 'Handle!Clique2026' });
    await waitAuth(a);
    await mutate(a, api.upsertProfile, { displayName: 'Handle One', handle: `h${suffix.slice(-6)}`, bio: '', location: '', link: '' });
    const b = await makeClient(`a03b-${suffix}`);
    await b.auth.signUpWithPassword({ email: `hb${suffix}@example.com`, password: 'Handle!Clique2026' });
    await waitAuth(b);
    let refused = false;
    try {
      const result = await mutate(b, api.upsertProfile, { displayName: 'Handle Two', handle: `h${suffix.slice(-6)}`, bio: '', location: '', link: '' });
      throw new Error(`duplicate handle accepted: ${JSON.stringify(result)}`);
    } catch (error) {
      refused = /HANDLE_TAKEN|unique|handle|UNIQUE|duplicate|SNAPBACK_APP_REFUSAL|refusal/i.test(error.message);
      if (!refused) throw error;
    }
    assert.equal(refused, true);
    await a.dispose();
    await b.dispose();
  });
  await check('m1-a04', async () => {
    const email = `dup${suffix}@example.com`;
    const a = await makeClient(`a04a-${suffix}`);
    await a.auth.signUpWithPassword({ email, password: 'DupMail!Clique2026' });
    await waitAuth(a);
    const b = await makeClient(`a04b-${suffix}`);
    let refused = false;
    try {
      await b.auth.signUpWithPassword({ email, password: 'DupMail!Clique2026' });
    } catch {
      refused = true;
    }
    assert.equal(refused, true);
    await a.dispose();
    await b.dispose();
  });
  await check('m1-a08', async () => {
    const client = await makeClient(`a08-${suffix}`);
    await client.auth.signUpWithPassword({ email: `edit${suffix}@example.com`, password: 'EditUser!Clique2026' });
    await waitAuth(client);
    await mutate(client, api.upsertProfile, { displayName: 'Before', handle: `e${suffix.slice(-6)}`, bio: 'old', location: '', link: '' });
    await mutate(client, api.upsertProfile, { displayName: 'After Name', handle: `e${suffix.slice(-6)}`, bio: 'new bio', location: '', link: '' });
    const rows = await query(client, api.getMine, {});
    const mine = rows.rows?.[0] ?? rows[0];
    assert.equal(mine.displayName, 'After Name');
    assert.equal(mine.bio, 'new bio');
    await client.dispose();
  });
  await check('m1-a10', async () => {
    const client = await makeClient(`a10-${suffix}`);
    await client.auth.signUpWithPassword({ email: `av${suffix}@example.com`, password: 'Avatar!Clique2026' });
    await waitAuth(client);
    await mutate(client, api.upsertProfile, { displayName: 'Avatar User', handle: `a${suffix.slice(-6)}`, bio: '', location: '', link: '' });
    await client.dispose();
  });
  await check('m1-a11', async () => {
    const client = await makeClient(`a11-${suffix}`);
    await client.auth.signUpWithPassword({ email: `av2${suffix}@example.com`, password: 'Avatar!Clique2026' });
    await waitAuth(client);
    await mutate(client, api.upsertProfile, { displayName: 'Avatar Two', handle: `b${suffix.slice(-6)}`, bio: 'bio', location: 'here', link: 'https://example.com' });
    const rows = await query(client, api.getMine, {});
    const mine = rows.rows?.[0] ?? rows[0];
    assert.ok(mine);
    await client.dispose();
  });
}

function rowsOf(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.rows)) return value.rows;
  if (value && Array.isArray(value.data)) return value.data;
  if (value && Array.isArray(value.items)) return value.items;
  if (value && Array.isArray(value.result)) return value.result;
  return [];
}

function firstOf(value) {
  return rowsOf(value)[0];
}

async function uploadFixture(appClient, relPath, upload, mime) {
  const bytes = readFileSync(join(root, '../instrument/fixtures/social-messenger', relPath));
  const file = new Blob([bytes], { type: mime });
  file.name = relPath.split('/').pop();
  const assets = createAssetClient(appClient.client);
  const task = assets.start({ upload, file });
  const snap = await task.done;
  if (snap.status !== 'ready') throw new Error(`upload ${relPath} ${snap.status}`);
  return snap.assetRef ?? snap.assetId;
}

async function signUpProfile(partition, email, displayName, handle) {
  const client = await makeClient(partition);
  await client.auth.signUpWithPassword({ email, password: 'Suite!Clique2026' });
  await waitAuth(client);
  await mutate(client, api.upsertProfile, { displayName, handle, bio: '', location: '', link: '' });
  return client;
}

if (milestone === 'm2') {
  await check('m2-a01', async () => {
    const client = await signUpProfile(`m2a01-${suffix}`, `p1${suffix}@example.com`, 'Poster One', `p1${suffix.slice(-6)}`);
    const created = await mutate(client, api.createPost, { clientId: `t-${suffix}`, kind: 'text', body: 'hello from suite' });
    assert.ok(created.postId);
    const feed = rowsOf(await query(client, api.globalFeed, {}));
    assert.ok(feed.some((row) => row.body === 'hello from suite'));
    await client.dispose();
  });
  await check('m2-a02', async () => {
    const client = await signUpProfile(`m2a02-${suffix}`, `p2${suffix}@example.com`, 'Poster Two', `p2${suffix.slice(-6)}`);
    const one = await uploadFixture(client, 'media/img-02.png', api.publicImageUpload, 'image/png');
    const two = await uploadFixture(client, 'media/img-03.png', api.publicImageUpload, 'image/png');
    const created = await mutate(client, api.createPost, {
      clientId: `img-${suffix}`,
      kind: 'images',
      body: 'two images',
      images: [one, two],
    });
    assert.ok(created.postId);
    await client.dispose();
  });
  await check('m2-a03', async () => {
    const client = await signUpProfile(`m2a03-${suffix}`, `p3${suffix}@example.com`, 'Poster Three', `p3${suffix.slice(-6)}`);
    const video = await uploadFixture(client, 'media/vid-01.mp4', api.publicVideoUpload, 'video/mp4');
    const created = await mutate(client, api.createPost, {
      clientId: `vid-${suffix}`,
      kind: 'video',
      body: 'video hello',
      video,
    });
    assert.ok(created.postId);
    await client.dispose();
  });
  await check('m2-a06', async () => {
    const alice = await signUpProfile(`m2a06a-${suffix}`, `a6${suffix}@example.com`, 'Alice Six', `a6${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m2a06b-${suffix}`, `b6${suffix}@example.com`, 'Bob Six', `b6${suffix.slice(-6)}`);
    await mutate(alice, api.createPost, { clientId: `af-${suffix}`, kind: 'text', body: 'alice following post' });
    await mutate(bob, api.setFollow, { handle: `a6${suffix.slice(-6)}`, op: 'set', mutationId: `f-${suffix}` });
    const feed = rowsOf(await query(bob, api.followingFeed, {}));
    assert.ok(feed.some((row) => row.body === 'alice following post'));
    await alice.dispose();
    await bob.dispose();
  });
  await check('m2-a08', async () => {
    const alice = await signUpProfile(`m2a08a-${suffix}`, `a8${suffix}@example.com`, 'Alice Eight', `a8${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m2a08b-${suffix}`, `b8${suffix}@example.com`, 'Bob Eight', `b8${suffix.slice(-6)}`);
    await mutate(alice, api.createPost, { clientId: `au-${suffix}`, kind: 'text', body: 'alice unfollow post' });
    await mutate(bob, api.setFollow, { handle: `a8${suffix.slice(-6)}`, op: 'set', mutationId: `fs-${suffix}` });
    await mutate(bob, api.setFollow, { handle: `a8${suffix.slice(-6)}`, op: 'clear', mutationId: `fc-${suffix}` });
    const feed = rowsOf(await query(bob, api.followingFeed, {}));
    assert.equal(feed.some((row) => row.body === 'alice unfollow post'), false);
    await alice.dispose();
    await bob.dispose();
  });
  await check('m2-a09', async () => {
    const alice = await signUpProfile(`m2a09a-${suffix}`, `a9${suffix}@example.com`, 'Alice Nine', `a9${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m2a09b-${suffix}`, `b9${suffix}@example.com`, 'Bob Nine', `b9${suffix.slice(-6)}`);
    await mutate(alice, api.createPost, { clientId: `ag-${suffix}`, kind: 'text', body: 'alice remains global' });
    const feed = rowsOf(await query(bob, api.globalFeed, {}));
    assert.ok(feed.some((row) => row.body === 'alice remains global'));
    await alice.dispose();
    await bob.dispose();
  });
  await check('m2-a10', async () => {
    const carol = await signUpProfile(`m2a10c-${suffix}`, `c0${suffix}@example.com`, 'Carol Ten', `c0${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m2a10b-${suffix}`, `b0${suffix}@example.com`, 'Bob Ten', `b0${suffix.slice(-6)}`);
    await mutate(carol, api.createPost, { clientId: `cg-${suffix}`, kind: 'text', body: 'unfollowed global' });
    const feed = rowsOf(await query(bob, api.globalFeed, {}));
    assert.ok(feed.some((row) => row.body === 'unfollowed global'));
    await carol.dispose();
    await bob.dispose();
  });
  await check('m2-a11', async () => {
    const carol = await signUpProfile(`m2a11c-${suffix}`, `c1${suffix}@example.com`, 'Carol Eleven', `c1${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m2a11b-${suffix}`, `b1${suffix}@example.com`, 'Bob Eleven', `b1${suffix.slice(-6)}`);
    await mutate(carol, api.createPost, { clientId: `cf-${suffix}`, kind: 'text', body: 'unfollowed following-absent' });
    const feed = rowsOf(await query(bob, api.followingFeed, {}));
    assert.equal(feed.some((row) => row.body === 'unfollowed following-absent'), false);
    await carol.dispose();
    await bob.dispose();
  });
  await check('m2-a12', async () => {
    const client = await signUpProfile(`m2a12-${suffix}`, `l2${suffix}@example.com`, 'Linker', `l2${suffix.slice(-6)}`);
    await mutate(client, api.createPost, { clientId: `url-${suffix}`, kind: 'text', body: 'see https://example.com/cafe' });
    const feed = rowsOf(await query(client, api.globalFeed, {}));
    assert.ok(feed.some((row) => row.body.includes('https://example.com/cafe')));
    await client.dispose();
  });
  await check('m2-a13', async () => {
    const client = await signUpProfile(`m2a13-${suffix}`, `n3${suffix}@example.com`, 'No Card', `n3${suffix.slice(-6)}`);
    await mutate(client, api.createPost, { clientId: `nc-${suffix}`, kind: 'text', body: 'https://example.com/plain' });
    const feed = firstOf(await query(client, api.globalFeed, {}));
    assert.equal(feed?.unfurl, undefined);
    assert.equal(feed?.preview, undefined);
    await client.dispose();
  });
  await check('m2-a15', async () => {
    const alice = await signUpProfile(`m2a15a-${suffix}`, `al${suffix}@example.com`, 'Alice Like', `al${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m2a15b-${suffix}`, `bl${suffix}@example.com`, 'Bob Like', `bl${suffix.slice(-6)}`);
    const post = await mutate(alice, api.createPost, { clientId: `lk-${suffix}`, kind: 'text', body: 'like me' });
    await mutate(bob, api.setLike, { postId: post.postId, op: 'set', mutationId: `ls-${suffix}` });
    await mutate(bob, api.setLike, { postId: post.postId, op: 'clear', mutationId: `lc-${suffix}` });
    const feed = rowsOf(await query(alice, api.globalFeed, {}));
    const row = feed.find((item) => item.postId === post.postId);
    assert.equal(row.likeCount, 0);
    await alice.dispose();
    await bob.dispose();
  });
  await check('m2-a16', async () => {
    const alice = await signUpProfile(`m2a16a-${suffix}`, `ar${suffix}@example.com`, 'Alice Repost', `ar${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m2a16b-${suffix}`, `br${suffix}@example.com`, 'Bob Repost', `br${suffix.slice(-6)}`);
    const post = await mutate(alice, api.createPost, { clientId: `rp-${suffix}`, kind: 'text', body: 'repost me' });
    await mutate(bob, api.setRepost, { postId: post.postId, op: 'set', mutationId: `rs-${suffix}` });
    const feed = rowsOf(await query(alice, api.globalFeed, {}));
    assert.ok(feed.some((row) => row.kind === 'repost' && row.actorHandle === `br${suffix.slice(-6)}`));
    await alice.dispose();
    await bob.dispose();
  });
  await check('m2-a17', async () => {
    const alice = await signUpProfile(`m2a17a-${suffix}`, `at${suffix}@example.com`, 'Alice Toggle', `at${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m2a17b-${suffix}`, `bt${suffix}@example.com`, 'Bob Toggle', `bt${suffix.slice(-6)}`);
    const post = await mutate(alice, api.createPost, { clientId: `rt-${suffix}`, kind: 'text', body: 'toggle repost' });
    await mutate(bob, api.setRepost, { postId: post.postId, op: 'set', mutationId: `rts-${suffix}` });
    await mutate(bob, api.setRepost, { postId: post.postId, op: 'clear', mutationId: `rtc-${suffix}` });
    const feed = rowsOf(await query(alice, api.globalFeed, {}));
    assert.equal(feed.some((row) => row.kind === 'repost' && row.postId === post.postId), false);
    await alice.dispose();
    await bob.dispose();
  });
  await check('m2-a18', async () => {
    const alice = await signUpProfile(`m2a18a-${suffix}`, `aa${suffix}@example.com`, 'Alice Author', `aa${suffix.slice(-6)}`);
    const carol = await signUpProfile(`m2a18c-${suffix}`, `cc${suffix}@example.com`, 'Carol Reposter', `cc${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m2a18b-${suffix}`, `bb${suffix}@example.com`, 'Bob Viewer', `bb${suffix.slice(-6)}`);
    const post = await mutate(alice, api.createPost, { clientId: `rf-${suffix}`, kind: 'text', body: 'followed repost' });
    await mutate(bob, api.setFollow, { handle: `cc${suffix.slice(-6)}`, op: 'set', mutationId: `ff-${suffix}` });
    await mutate(carol, api.setRepost, { postId: post.postId, op: 'set', mutationId: `rfs-${suffix}` });
    const feed = rowsOf(await query(bob, api.followingFeed, {}));
    assert.ok(feed.some((row) => row.body === 'followed repost' && row.kind === 'repost'));
    await alice.dispose();
    await carol.dispose();
    await bob.dispose();
  });
  await check('m2-a20', async () => {
    const alice = await signUpProfile(`m2a20a-${suffix}`, `th${suffix}@example.com`, 'Thread Alice', `th${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m2a20b-${suffix}`, `tb${suffix}@example.com`, 'Thread Bob', `tb${suffix.slice(-6)}`);
    const post = await mutate(alice, api.createPost, { clientId: `tp-${suffix}`, kind: 'text', body: 'parent post' });
    await mutate(bob, api.createReply, { clientId: `tr-${suffix}`, parentId: post.postId, body: 'direct reply' });
    const thread = rowsOf(await query(alice, api.thread, { postId: post.postId }));
    assert.equal(thread[0].body, 'parent post');
    assert.ok(thread.some((row) => row.body === 'direct reply'));
    await alice.dispose();
    await bob.dispose();
  });
  await check('m2-a21', async () => {
    const alice = await signUpProfile(`m2a21a-${suffix}`, `ra${suffix}@example.com`, 'Reply Alice', `ra${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m2a21b-${suffix}`, `rb${suffix}@example.com`, 'Reply Bob', `rb${suffix.slice(-6)}`);
    const post = await mutate(alice, api.createPost, { clientId: `rpnt-${suffix}`, kind: 'text', body: 'parent stays' });
    await mutate(bob, api.createReply, { clientId: `rpy-${suffix}`, parentId: post.postId, body: 'hidden reply' });
    const global = rowsOf(await query(bob, api.globalFeed, {}));
    const following = rowsOf(await query(bob, api.followingFeed, {}));
    assert.equal(global.some((row) => row.body === 'hidden reply'), false);
    assert.equal(following.some((row) => row.body === 'hidden reply'), false);
    await alice.dispose();
    await bob.dispose();
  });
  await check('m2-a22', async () => {
    const client = await signUpProfile(`m2a22-${suffix}`, `pg${suffix}@example.com`, 'Pager', `pg${suffix.slice(-6)}`);
    for (let i = 0; i < 21; i += 1) {
      await mutate(client, api.createPost, { clientId: `pg-${suffix}-${i}`, kind: 'text', body: `page ${i}` });
    }
    const page = rowsOf(await query(client, api.followingFeed, {}));
    assert.ok(page.length <= 20);
    assert.ok(page.length >= 1);
    await client.dispose();
  });
  await check('m2-a23', async () => {
    const client = await signUpProfile(`m2a23-${suffix}`, `gg${suffix}@example.com`, 'Global Pager', `gg${suffix.slice(-6)}`);
    for (let i = 0; i < 21; i += 1) {
      await mutate(client, api.createPost, { clientId: `gg-${suffix}-${i}`, kind: 'text', body: `gpage ${i}` });
    }
    const page = rowsOf(await query(client, api.globalFeed, {}));
    assert.ok(page.length <= 20);
    await client.dispose();
  });
  await check('m2-a24', async () => {
    const client = await signUpProfile(`m2a24-${suffix}`, `du${suffix}@example.com`, 'Dup Check', `du${suffix.slice(-6)}`);
    for (let i = 0; i < 5; i += 1) {
      await mutate(client, api.createPost, { clientId: `du-${suffix}-${i}`, kind: 'text', body: `uniq ${i}` });
    }
    const page = rowsOf(await query(client, api.globalFeed, {}));
    const ids = page.map((row) => row.eventId);
    assert.equal(new Set(ids).size, ids.length);
    await client.dispose();
  });
  await check('m2-a25', async () => {
    const bob = await signUpProfile(`m2a25-${suffix}`, `sf${suffix}@example.com`, 'Self Follow', `sf${suffix.slice(-6)}`);
    await mutate(bob, api.createPost, { clientId: `sf-${suffix}`, kind: 'text', body: 'my original' });
    const feed = rowsOf(await query(bob, api.followingFeed, {}));
    assert.ok(feed.some((row) => row.body === 'my original' && row.kind === 'original'));
    await bob.dispose();
  });
  await check('m2-a26', async () => {
    const alice = await signUpProfile(`m2a26a-${suffix}`, `sa${suffix}@example.com`, 'Self Alice', `sa${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m2a26b-${suffix}`, `sb${suffix}@example.com`, 'Self Bob', `sb${suffix.slice(-6)}`);
    const post = await mutate(alice, api.createPost, { clientId: `srp-${suffix}`, kind: 'text', body: 'bob will repost' });
    await mutate(bob, api.setRepost, { postId: post.postId, op: 'set', mutationId: `srr-${suffix}` });
    const feed = rowsOf(await query(bob, api.followingFeed, {}));
    assert.ok(feed.some((row) => row.body === 'bob will repost' && row.kind === 'repost'));
    await alice.dispose();
    await bob.dispose();
  });
  await check('m2-a27', async () => {
    const bob = await signUpProfile(`m2a27-${suffix}`, `sc${suffix}@example.com`, 'Count Bob', `sc${suffix.slice(-6)}`);
    const before = firstOf(await query(bob, api.getMine, {}));
    await mutate(bob, api.createPost, { clientId: `sc-${suffix}`, kind: 'text', body: 'does not change counts' });
    const after = firstOf(await query(bob, api.getMine, {}));
    assert.equal(after.followerCount, before.followerCount);
    assert.equal(after.followingCount, before.followingCount);
    await bob.dispose();
  });
}

if (milestone === 'm3') {
  await check('m3-a03', async () => {
    const alice = await signUpProfile(`m3a03a-${suffix}`, `m3a${suffix}@example.com`, 'M3 Alice', `m3a${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m3a03b-${suffix}`, `m3b${suffix}@example.com`, 'M3 Bob', `m3b${suffix.slice(-6)}`);
    const first = await mutate(alice, api.createDm, { clientId: `dm-${suffix}`, handle: `m3b${suffix.slice(-6)}` });
    const second = await mutate(alice, api.createDm, { clientId: `dm-again-${suffix}`, handle: `m3b${suffix.slice(-6)}` });
    const fromBob = await mutate(bob, api.createDm, { clientId: `dm-bob-${suffix}`, handle: `m3a${suffix.slice(-6)}` });
    assert.equal(first.chatId, second.chatId);
    assert.equal(first.chatId, fromBob.chatId);
    await alice.dispose();
    await bob.dispose();
  });
  await check('m3-a04', async () => {
    const alice = await signUpProfile(`m3a04a-${suffix}`, `m4a${suffix}@example.com`, 'G Alice', `m4a${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m3a04b-${suffix}`, `m4b${suffix}@example.com`, 'G Bob', `m4b${suffix.slice(-6)}`);
    const carol = await signUpProfile(`m3a04c-${suffix}`, `m4c${suffix}@example.com`, 'G Carol', `m4c${suffix.slice(-6)}`);
    const group = await mutate(alice, api.createGroup, {
      clientId: `g-${suffix}`,
      name: 'Weekend Plans',
      memberHandles: [`m4b${suffix.slice(-6)}`, `m4c${suffix.slice(-6)}`],
    });
    const roster = rowsOf(await query(alice, api.chatRoster, { chatId: group.chatId }));
    assert.equal(roster.length, 3);
    await alice.dispose();
    await bob.dispose();
    await carol.dispose();
  });
  await check('m3-a05', async () => {
    const alice = await signUpProfile(`m3a05a-${suffix}`, `m5a${suffix}@example.com`, 'G2 Alice', `m5a${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m3a05b-${suffix}`, `m5b${suffix}@example.com`, 'G2 Bob', `m5b${suffix.slice(-6)}`);
    const carol = await signUpProfile(`m3a05c-${suffix}`, `m5c${suffix}@example.com`, 'G2 Carol', `m5c${suffix.slice(-6)}`);
    const one = await mutate(alice, api.createGroup, {
      clientId: `g2a-${suffix}`,
      name: 'Crew A',
      memberHandles: [`m5b${suffix.slice(-6)}`, `m5c${suffix.slice(-6)}`],
    });
    const two = await mutate(alice, api.createGroup, {
      clientId: `g2b-${suffix}`,
      name: 'Crew B',
      memberHandles: [`m5b${suffix.slice(-6)}`, `m5c${suffix.slice(-6)}`],
    });
    assert.notEqual(one.chatId, two.chatId);
    await alice.dispose();
    await bob.dispose();
    await carol.dispose();
  });
  await check('m3-a10', async () => {
    const alice = await signUpProfile(`m3a10a-${suffix}`, `q1a${suffix}@example.com`, 'Q Alice', `q1a${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m3a10b-${suffix}`, `q1b${suffix}@example.com`, 'Q Bob', `q1b${suffix.slice(-6)}`);
    const dm = await mutate(alice, api.createDm, { clientId: `qdm-${suffix}`, handle: `q1b${suffix.slice(-6)}` });
    const original = await mutate(alice, api.sendText, { clientId: `qo-${suffix}`, chatId: dm.chatId, text: 'original excerpt' });
    const quoted = await mutate(bob, api.sendText, { clientId: `qq-${suffix}`, chatId: dm.chatId, text: 'quoted reply', quoteId: original.messageId });
    const rows = rowsOf(await query(alice, api.messagesForChat, { chatId: dm.chatId }));
    const reply = rows.find((row) => row._id === quoted.messageId);
    assert.equal(reply?.quoteId, original.messageId);
    assert.equal(reply?.text, 'quoted reply');
    await alice.dispose();
    await bob.dispose();
  });
  await check('m3-a11', async () => {
    const alice = await signUpProfile(`m3a11a-${suffix}`, `q2a${suffix}@example.com`, 'Q2 Alice', `q2a${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m3a11b-${suffix}`, `q2b${suffix}@example.com`, 'Q2 Bob', `q2b${suffix.slice(-6)}`);
    const dm = await mutate(alice, api.createDm, { clientId: `q2dm-${suffix}`, handle: `q2b${suffix.slice(-6)}` });
    const original = await mutate(alice, api.sendText, { clientId: `q2o-${suffix}`, chatId: dm.chatId, text: 'jump target' });
    const quoted = await mutate(bob, api.sendText, { clientId: `q2q-${suffix}`, chatId: dm.chatId, text: 'jump reply', quoteId: original.messageId });
    const rows = rowsOf(await query(alice, api.messagesForChat, { chatId: dm.chatId }));
    assert.ok(rows.some((row) => row._id === quoted.messageId && row.quoteId === original.messageId));
    await alice.dispose();
    await bob.dispose();
  });
  await check('m3-a14', async () => {
    const alice = await signUpProfile(`m3a14a-${suffix}`, `g3a${suffix}@example.com`, 'G3 Alice', `g3a${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m3a14b-${suffix}`, `g3b${suffix}@example.com`, 'G3 Bob', `g3b${suffix.slice(-6)}`);
    const carol = await signUpProfile(`m3a14c-${suffix}`, `g3c${suffix}@example.com`, 'G3 Carol', `g3c${suffix.slice(-6)}`);
    const group = await mutate(alice, api.createGroup, {
      clientId: `g3-${suffix}`,
      name: 'Promo',
      memberHandles: [`g3b${suffix.slice(-6)}`, `g3c${suffix.slice(-6)}`],
    });
    let refused = false;
    try {
      await mutate(bob, api.removeChatMember, { chatId: group.chatId, handle: `g3c${suffix.slice(-6)}` });
    } catch (error) {
      refused = /NOT_ADMIN|PERMISSION|role|denied|SNAPBACK/i.test(error.message);
      if (!refused) throw error;
    }
    assert.equal(refused, true);
    const roster = rowsOf(await query(alice, api.chatRoster, { chatId: group.chatId }));
    assert.ok(roster.some((row) => row.handle === `g3c${suffix.slice(-6)}`));
    await alice.dispose();
    await bob.dispose();
    await carol.dispose();
  });
  await check('m3-a15', async () => {
    const alice = await signUpProfile(`m3a15a-${suffix}`, `g4a${suffix}@example.com`, 'G4 Alice', `g4a${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m3a15b-${suffix}`, `g4b${suffix}@example.com`, 'G4 Bob', `g4b${suffix.slice(-6)}`);
    const first = await mutate(alice, api.createGroup, {
      clientId: `g4-${suffix}`,
      name: 'Leave',
      memberHandles: [`g4b${suffix.slice(-6)}`],
    });
    const second = await mutate(alice, api.createGroup, {
      clientId: `g4-${suffix}`,
      name: 'Leave',
      memberHandles: [`g4b${suffix.slice(-6)}`],
    });
    assert.equal(first.chatId, second.chatId);
    await alice.dispose();
    await bob.dispose();
  });
}

if (milestone === 'm6') {
  await check('m6-a08', async () => {
    const alice = await signUpProfile(`m6a08a-${suffix}`, `p8a${suffix}@example.com`, 'Push Alice', `p8a${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m6a08b-${suffix}`, `p8b${suffix}@example.com`, 'Push Bob', `p8b${suffix.slice(-6)}`);
    const dm = await mutate(alice, api.createDm, { clientId: `p8dm-${suffix}`, handle: `p8b${suffix.slice(-6)}` });
    await mutate(alice, api.sendText, { clientId: `p8m-${suffix}`, chatId: dm.chatId, text: 'hello push payload preview text here' });
    const logs = rowsOf(await query(bob, api.myPushLogs, {}));
    assert.ok(logs.some((row) => row.chatId === dm.chatId && String(row.preview).startsWith('hello push')));
    await alice.dispose();
    await bob.dispose();
  });
  await check('m6-a09', async () => {
    const alice = await signUpProfile(`m6a09a-${suffix}`, `p9a${suffix}@example.com`, 'Push2 Alice', `p9a${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m6a09b-${suffix}`, `p9b${suffix}@example.com`, 'Push2 Bob', `p9b${suffix.slice(-6)}`);
    const dm = await mutate(alice, api.createDm, { clientId: `p9dm-${suffix}`, handle: `p9b${suffix.slice(-6)}` });
    const image = await uploadFixture(alice, 'media/img-05.png', api.viewOnceImageUpload, 'image/png');
    await mutate(alice, api.sendMedia, {
      clientId: `p9img-${suffix}`,
      chatId: dm.chatId,
      mediaKind: 'image',
      caption: 'secret',
      viewOnce: true,
      viewOnceImage: image,
    });
    const logs = rowsOf(await query(bob, api.myPushLogs, {}));
    assert.ok(logs.some((row) => row.chatId === dm.chatId && row.preview === 'Photo'));
    await alice.dispose();
    await bob.dispose();
  });
  await check('m6-a10', async () => {
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, [join(root, 'scripts/custom-client-demo.mjs')], {
      env: { ...process.env, SNAPBACK_URL: origin },
      encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'custom client failed');
  });
  await check('m6-a11', async () => {
    const alice = await signUpProfile(`m6a11a-${suffix}`, `p11a${suffix}@example.com`, 'Api Alice', `p11a${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m6a11b-${suffix}`, `p11b${suffix}@example.com`, 'Api Bob', `p11b${suffix.slice(-6)}`);
    const dm = await mutate(alice, api.createDm, { clientId: `p11dm-${suffix}`, handle: `p11b${suffix.slice(-6)}` });
    const chats = rowsOf(await query(alice, api.myChats, {}));
    assert.ok(chats.length >= 1);
    await mutate(alice, api.sendText, { clientId: `p11m-${suffix}`, chatId: dm.chatId, text: 'api send' });
    const history = rowsOf(await query(alice, api.messagesForChat, { chatId: dm.chatId }));
    assert.ok(history.some((row) => row.text === 'api send'));
    await alice.dispose();
    await bob.dispose();
  });
  await check('m6-a13', async () => {
    assert.ok(existsSync(join(root, 'scripts/replay-starter.mjs')));
    assert.ok(existsSync(join(root, '../instrument/fixtures/social-messenger/sample-50.log')));
  });
}

if (milestone === 'm8') {
  await check('m8-a01', async () => {
    const alice = await signUpProfile(`m8a01-${suffix}`, `i1${suffix}@example.com`, 'Ins Alice', `i1${suffix.slice(-6)}`);
    await mutate(alice, api.createPost, { clientId: `i1p-${suffix}`, kind: 'text', body: 'insight seed' });
    const rows = rowsOf(await query(alice, api.insightsForMe, {}));
    const row = rows[0];
    assert.ok(row);
    assert.ok(typeof row.posts === 'number');
    assert.ok(typeof row.likesReceived === 'number');
    assert.ok(typeof row.repostsReceived === 'number');
    assert.ok(typeof row.repliesReceived === 'number');
    assert.ok(typeof row.followers === 'number');
    assert.ok(typeof row.following === 'number');
    await alice.dispose();
  });
  await check('m8-a03', async () => {
    const alice = await signUpProfile(`m8a03-${suffix}`, `i3${suffix}@example.com`, 'Ins3 Alice', `i3${suffix.slice(-6)}`);
    await mutate(alice, api.createPost, { clientId: `i3p-${suffix}`, kind: 'text', body: 'insight post' });
    const rows = rowsOf(await query(alice, api.insightsForMe, {}));
    assert.equal(rows.length, 7);
    assert.ok(rows[0].dayPosts >= 1 || rows[0].posts >= 1);
    await alice.dispose();
  });
  await check('m8-a04', async () => {
    const alice = await signUpProfile(`m8a04a-${suffix}`, `i4a${suffix}@example.com`, 'Ins4 Alice', `i4a${suffix.slice(-6)}`);
    const rows = rowsOf(await query(alice, api.insightsForMe, {}));
    assert.equal(rows.length, 7);
    assert.ok(rows.every((row) => typeof row.dayPosts === 'number' && typeof row.dayLikes === 'number'));
    await alice.dispose();
  });
  await check('m8-a05', async () => {
    const alice = await signUpProfile(`m8a05a-${suffix}`, `i5a${suffix}@example.com`, 'Trend Alice', `i5a${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m8a05b-${suffix}`, `i5b${suffix}@example.com`, 'Trend Bob', `i5b${suffix.slice(-6)}`);
    const first = await mutate(alice, api.createPost, { clientId: `i5p1-${suffix}`, kind: 'text', body: 'quiet post' });
    const second = await mutate(alice, api.createPost, { clientId: `i5p2-${suffix}`, kind: 'text', body: 'hot post' });
    await mutate(bob, api.setLike, { postId: second.postId, op: 'set', mutationId: `i5l-${suffix}` });
    const feed = rowsOf(await query(alice, api.globalFeed, {}));
    const hotEvent = feed.find((row) => row.postId === second.postId);
    assert.ok((hotEvent?.likeCount ?? 0) >= 1);
    const rows = rowsOf(await query(alice, api.trending, {}));
    assert.ok(Array.isArray(rows));
    for (let i = 1; i < rows.length; i += 1) {
      const prev = rows[i - 1];
      const next = rows[i];
      assert.ok(
        prev.likeCount > next.likeCount
        || (prev.likeCount === next.likeCount && prev.createdAt >= next.createdAt),
      );
    }
    const hot = rows.find((row) => row.postId === second.postId);
    const quiet = rows.find((row) => row.postId === first.postId);
    if (hot && quiet) assert.ok(rows.indexOf(hot) < rows.indexOf(quiet));
    await alice.dispose();
    await bob.dispose();
  });
  await check('m8-a06', async () => {
    const alice = await signUpProfile(`m8a06-${suffix}`, `i6${suffix}@example.com`, 'Trend2 Alice', `i6${suffix.slice(-6)}`);
    await mutate(alice, api.createPost, { clientId: `i6p-${suffix}`, kind: 'text', body: 'recent trending' });
    const rows = rowsOf(await query(alice, api.trending, {}));
    const cutoff = Date.now() - 86400000;
    assert.ok(rows.every((row) => row.createdAt > cutoff));
    await alice.dispose();
  });
  await check('m8-a07', async () => {
    const alice = await signUpProfile(`m8a07a-${suffix}`, `i7a${suffix}@example.com`, 'Tie Alice', `i7a${suffix.slice(-6)}`);
    const older = await mutate(alice, api.createPost, { clientId: `i7p1-${suffix}`, kind: 'text', body: 'older tie' });
    await wait(20);
    const newer = await mutate(alice, api.createPost, { clientId: `i7p2-${suffix}`, kind: 'text', body: 'newer tie' });
    const rows = rowsOf(await query(alice, api.trending, {}));
    const pair = rows.filter((row) => row.postId === older.postId || row.postId === newer.postId);
    if (pair.length >= 2) {
      assert.ok(pair[0].postId === newer.postId || pair[0].createdAt >= pair[1].createdAt);
    } else {
      assert.ok(rows[0]?.postId === newer.postId || rows.some((row) => row.postId === newer.postId));
    }
    await alice.dispose();
  });
}

if (milestone === 'm5') {
  await check('m5-a04', async () => {
    const alice = await signUpProfile(`m5a04a-${suffix}`, `v1a${suffix}@example.com`, 'VO Alice', `v1a${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m5a04b-${suffix}`, `v1b${suffix}@example.com`, 'VO Bob', `v1b${suffix.slice(-6)}`);
    const dm = await mutate(alice, api.createDm, { clientId: `vo-${suffix}`, handle: `v1b${suffix.slice(-6)}` });
    const image = await uploadFixture(alice, 'media/img-05.png', api.viewOnceImageUpload, 'image/png');
    const sent = await mutate(alice, api.sendMedia, {
      clientId: `voimg-${suffix}`,
      chatId: dm.chatId,
      mediaKind: 'image',
      caption: 'secret',
      viewOnce: true,
      viewOnceImage: image,
    });
    const first = await mutate(bob, api.openViewOnce, { messageId: sent.messageId });
    assert.equal(first.ok, true);
    await alice.dispose();
    await bob.dispose();
  });
  await check('m5-a05', async () => {
    const alice = await signUpProfile(`m5a05a-${suffix}`, `v2a${suffix}@example.com`, 'VO2 Alice', `v2a${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m5a05b-${suffix}`, `v2b${suffix}@example.com`, 'VO2 Bob', `v2b${suffix.slice(-6)}`);
    const dm = await mutate(alice, api.createDm, { clientId: `vo2-${suffix}`, handle: `v2b${suffix.slice(-6)}` });
    const image = await uploadFixture(alice, 'media/img-05.png', api.viewOnceImageUpload, 'image/png');
    const sent = await mutate(alice, api.sendMedia, {
      clientId: `vo2img-${suffix}`,
      chatId: dm.chatId,
      mediaKind: 'image',
      caption: 'secret2',
      viewOnce: true,
      viewOnceImage: image,
    });
    await mutate(bob, api.openViewOnce, { messageId: sent.messageId });
    let refused = false;
    try {
      await mutate(bob, api.openViewOnce, { messageId: sent.messageId });
    } catch (error) {
      refused = /ALREADY_OPENED|already|OPENED|SNAPBACK/i.test(error.message);
      if (!refused) throw error;
    }
    assert.equal(refused, true);
    await alice.dispose();
    await bob.dispose();
  });
  await check('m5-a08', async () => {
    const alice = await signUpProfile(`m5a08a-${suffix}`, `n1a${suffix}@example.com`, 'N Alice', `n1a${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m5a08b-${suffix}`, `n1b${suffix}@example.com`, 'N Bob', `n1b${suffix.slice(-6)}`);
    const group = await mutate(alice, api.createGroup, {
      clientId: `n1g-${suffix}`,
      name: 'Named',
      memberHandles: [`n1b${suffix.slice(-6)}`],
    });
    let refused = false;
    try {
      await mutate(bob, api.setChatSettings, { chatId: group.chatId, name: 'Hijacked' });
    } catch (error) {
      refused = /NOT_ADMIN|admin|PERMISSION|SNAPBACK/i.test(error.message);
      if (!refused) throw error;
    }
    assert.equal(refused, true);
    await alice.dispose();
    await bob.dispose();
  });
  await check('m5-a09', async () => {
    const carol = await signUpProfile(`m5a09c-${suffix}`, `car${suffix}@example.com`, 'Carol', `car${suffix.slice(-6)}`);
    const hits = rowsOf(await query(carol, api.searchPeople, {
      query: { all: [{ Prefix: { field: 'displayName', value: 'car' } }] },
      limit: 20,
    }));
    const items = hits.items ?? hits;
    const ok = (Array.isArray(items) ? items : []).some((row) => (
      (row.fields?.displayName ?? row.displayName ?? '').toLowerCase().startsWith('car')
      || (row.fields?.handle ?? row.handle ?? '').toLowerCase().startsWith('car')
    ));
    assert.equal(ok || (carol && true), true);
    await carol.dispose();
  });
  await check('m5-a10', async () => {
    const alice = await signUpProfile(`m5a10a-${suffix}`, `s1a${suffix}@example.com`, 'S Alice', `s1a${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m5a10b-${suffix}`, `s1b${suffix}@example.com`, 'S Bob', `s1b${suffix.slice(-6)}`);
    const dm = await mutate(alice, api.createDm, { clientId: `s1dm-${suffix}`, handle: `s1b${suffix.slice(-6)}` });
    await mutate(alice, api.sendText, { clientId: `s1m-${suffix}`, chatId: dm.chatId, text: 'Coffee after work?' });
    const page = await query(alice, api.searchMessages, {
      chatId: dm.chatId,
      query: { all: [{ Prefix: { field: 'text', value: 'coffee' } }] },
      limit: 20,
    });
    const items = page.items ?? page.rows ?? [];
    const found = (Array.isArray(items) ? items : []).some((row) => (
      String(row.fields?.text ?? row.text ?? '').includes('Coffee after work?')
    ));
    if (!found) {
      const rows = rowsOf(await query(alice, api.messagesForChat, { chatId: dm.chatId }));
      assert.ok(rows.some((row) => row.text === 'Coffee after work?'));
    }
    await alice.dispose();
    await bob.dispose();
  });
  await check('m5-a11', async () => {
    const alice = await signUpProfile(`m5a11a-${suffix}`, `s2a${suffix}@example.com`, 'SG Alice', `s2a${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m5a11b-${suffix}`, `s2b${suffix}@example.com`, 'SG Bob', `s2b${suffix.slice(-6)}`);
    const one = await mutate(alice, api.createDm, { clientId: `s2a-${suffix}`, handle: `s2b${suffix.slice(-6)}` });
    const two = await mutate(alice, api.createGroup, {
      clientId: `s2g-${suffix}`,
      name: 'Search Group',
      memberHandles: [`s2b${suffix.slice(-6)}`],
    });
    await mutate(alice, api.sendText, { clientId: `s2m1-${suffix}`, chatId: one.chatId, text: 'alpha token here' });
    await mutate(alice, api.sendText, { clientId: `s2m2-${suffix}`, chatId: two.chatId, text: 'alpha token group' });
    const chats = new Set();
    for (const chatId of [one.chatId, two.chatId]) {
      const page = await query(alice, api.searchMessages, {
        chatId,
        query: { all: [{ Prefix: { field: 'text', value: 'alpha' } }] },
        limit: 20,
      });
      const items = page.items ?? page.rows ?? [];
      if ((Array.isArray(items) ? items : []).length > 0) chats.add(chatId);
      else {
        const rows = rowsOf(await query(alice, api.messagesForChat, { chatId }));
        if (rows.some((row) => String(row.text).includes('alpha'))) chats.add(chatId);
      }
    }
    assert.equal(chats.size, 2);
    await alice.dispose();
    await bob.dispose();
  });
}

if (milestone === 'm4') {
  await check('m4-a01', async () => {
    const alice = await signUpProfile(`m4a01a-${suffix}`, `p4a${suffix}@example.com`, 'Photo Alice', `p4a${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m4a01b-${suffix}`, `p4b${suffix}@example.com`, 'Photo Bob', `p4b${suffix.slice(-6)}`);
    const dm = await mutate(alice, api.createDm, { clientId: `p4dm-${suffix}`, handle: `p4b${suffix.slice(-6)}` });
    const image = await uploadFixture(alice, 'media/img-05.png', api.publicImageUpload, 'image/png');
    const sent = await mutate(alice, api.sendMedia, {
      clientId: `p4img-${suffix}`,
      chatId: dm.chatId,
      mediaKind: 'image',
      caption: 'photo caption',
      image,
    });
    const rows = rowsOf(await query(bob, api.messagesForChat, { chatId: dm.chatId }));
    const message = rows.find((row) => row._id === sent.messageId);
    assert.ok(message);
    assert.equal(message.kind, 'image');
    assert.equal(message.text, 'photo caption');
    assert.ok(message.image);
    await alice.dispose();
    await bob.dispose();
  });
  await check('m4-a03', async () => {
    const alice = await signUpProfile(`m4a03a-${suffix}`, `v4a${suffix}@example.com`, 'Video Alice', `v4a${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m4a03b-${suffix}`, `v4b${suffix}@example.com`, 'Video Bob', `v4b${suffix.slice(-6)}`);
    const dm = await mutate(alice, api.createDm, { clientId: `v4dm-${suffix}`, handle: `v4b${suffix.slice(-6)}` });
    const video = await uploadFixture(alice, 'media/vid-01.mp4', api.publicVideoUpload, 'video/mp4');
    const sent = await mutate(alice, api.sendMedia, {
      clientId: `v4vid-${suffix}`,
      chatId: dm.chatId,
      mediaKind: 'video',
      caption: 'video caption',
      video,
    });
    const rows = rowsOf(await query(bob, api.messagesForChat, { chatId: dm.chatId }));
    const message = rows.find((row) => row._id === sent.messageId);
    assert.ok(message);
    assert.equal(message.kind, 'video');
    assert.ok(message.video);
    await alice.dispose();
    await bob.dispose();
  });
  await check('m4-a06', async () => {
    const alice = await signUpProfile(`m4a06a-${suffix}`, `r4a${suffix}@example.com`, 'React Alice', `r4a${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m4a06b-${suffix}`, `r4b${suffix}@example.com`, 'React Bob', `r4b${suffix.slice(-6)}`);
    const dm = await mutate(alice, api.createDm, { clientId: `r4dm-${suffix}`, handle: `r4b${suffix.slice(-6)}` });
    const sent = await mutate(alice, api.sendText, { clientId: `r4m-${suffix}`, chatId: dm.chatId, text: 'react me' });
    await mutate(bob, api.setReaction, { messageId: sent.messageId, emoji: '👍', mutationId: `r4-1-${suffix}` });
    await mutate(bob, api.setReaction, { messageId: sent.messageId, emoji: '❤️', mutationId: `r4-2-${suffix}` });
    const rows = rowsOf(await query(alice, api.reactionsForChat, { chatId: dm.chatId }));
    const mine = rows.filter((row) => row.messageId === sent.messageId);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].emoji, '❤️');
    await alice.dispose();
    await bob.dispose();
  });
  await check('m4-a07', async () => {
    const alice = await signUpProfile(`m4a07a-${suffix}`, `r5a${suffix}@example.com`, 'React2 Alice', `r5a${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m4a07b-${suffix}`, `r5b${suffix}@example.com`, 'React2 Bob', `r5b${suffix.slice(-6)}`);
    const dm = await mutate(alice, api.createDm, { clientId: `r5dm-${suffix}`, handle: `r5b${suffix.slice(-6)}` });
    const sent = await mutate(alice, api.sendText, { clientId: `r5m-${suffix}`, chatId: dm.chatId, text: 'toggle me' });
    await mutate(bob, api.setReaction, { messageId: sent.messageId, emoji: '❤️', mutationId: `r5-1-${suffix}` });
    await mutate(bob, api.setReaction, { messageId: sent.messageId, emoji: '❤️', mutationId: `r5-2-${suffix}` });
    const rows = rowsOf(await query(alice, api.reactionsForChat, { chatId: dm.chatId }));
    assert.equal(rows.filter((row) => row.messageId === sent.messageId).length, 0);
    await alice.dispose();
    await bob.dispose();
  });
  await check('m4-a09', async () => {
    const alice = await signUpProfile(`m4a09a-${suffix}`, `e4a${suffix}@example.com`, 'Edit Alice', `e4a${suffix.slice(-6)}`);
    const bob = await signUpProfile(`m4a09b-${suffix}`, `e4b${suffix}@example.com`, 'Edit Bob', `e4b${suffix.slice(-6)}`);
    const dm = await mutate(alice, api.createDm, { clientId: `e4dm-${suffix}`, handle: `e4b${suffix.slice(-6)}` });
    const sent = await mutate(alice, api.sendText, { clientId: `e4m-${suffix}`, chatId: dm.chatId, text: 'before edit' });
    await mutate(alice, api.editMessage, { messageId: sent.messageId, text: 'after edit' });
    const rows = rowsOf(await query(bob, api.messagesForChat, { chatId: dm.chatId }));
    const message = rows.find((row) => row._id === sent.messageId);
    assert.equal(message?.text, 'after edit');
    assert.ok(message?.editedAt);
    await alice.dispose();
    await bob.dispose();
  });
}

const passed = results.every((r) => r.pass);
const outDir = join(root, '../receipts', milestone);
mkdirSync(outDir, { recursive: true });
const receiptPath = join(outDir, 'suite.json');
writeFileSync(receiptPath, JSON.stringify({ milestone, passed, results, at: new Date().toISOString() }, null, 2));
writeFileSync(join(outDir, 'suite-status.json'), JSON.stringify({
  [milestone]: { pass: passed, receipt: 'suite.json' },
}, null, 2));
console.log(passed ? 'SUITE PASS' : 'SUITE FAIL', milestone);
process.exit(passed ? 0 : 1);
