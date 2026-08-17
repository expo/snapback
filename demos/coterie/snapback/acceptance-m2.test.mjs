#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '../../../packages/snapback-client/index.mjs';
import { createAssetClient } from '../../../packages/snapback-client/assets.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../../packages/snapback-contract/index.mjs';
import { startServer } from '../../_kit/server-process.mjs';

import { loadGeneratedApi, loadGeneratedJson } from './generated-artifacts.mjs';
import { chunkValues } from './functions.mjs';
import { installM1Fixtures } from './seed-m1.mjs';
import { installM2Fixtures } from './seed-m2.mjs';

const backendDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(backendDir, '..', '..', '..');
const fixtureRoot = join(repoRoot, 'benchmarks', 'fixtures', 'social-messenger');
const mediaRoot = join(fixtureRoot, 'media');
const runtimeBinary = resolve(
  process.env.SNAPBACK_RUNTIME_BINARY
    ?? '/Users/ccheever/projects/snapback/.claude/worktrees/llp0240/target/debug/snapback',
);
const api = await loadGeneratedApi();
const schema = loadGeneratedJson('schema.manifest.json');
const functions = loadGeneratedJson('functions.manifest.json');
const starterM2Digest = 'e74ec486e34ffb5d6fc0dac19d1312d3dd061c87912083be130a71e5658d3be6';

test('query operand chunking keeps the 500/501 boundary exact', () => {
  assert.deepEqual(chunkValues(Array.from({ length: 500 }, (_, index) => index), 500)
    .map((chunk) => chunk.length), [500]);
  assert.deepEqual(chunkValues(Array.from({ length: 501 }, (_, index) => index), 500)
    .map((chunk) => chunk.length), [500, 1]);
});

function code(error) {
  return error?.diagnostic?.code ?? error?.code ?? null;
}

function applicationCode(error) {
  return error?.diagnostic?.details?.appCode ?? error?.details?.appCode ?? null;
}

function passwordClient(baseUrl, clientStoreId) {
  const coordinator = new AuthCoordinator({
    appId: schema.appId,
    storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  return new SnapbackClient(baseUrl, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId,
    rqsStore: null,
    offlineQueue: false,
  });
}

async function expectAppCode(operation, expected) {
  await assert.rejects(operation, (error) => {
    assert.equal(code(error), 'SNAPBACK_APP_REFUSAL', error?.stack ?? String(error));
    assert.equal(applicationCode(error), expected, error?.stack ?? String(error));
    return true;
  });
}

async function expectCode(operation, expected) {
  await assert.rejects(operation, (error) => {
    assert.equal(code(error), expected, error?.stack ?? String(error));
    return true;
  });
}

async function requireUploadAdmission(task) {
  await new Promise((resolveAdmission, rejectAdmission) => {
    let unsubscribe = () => {};
    const timeout = setTimeout(() => {
      unsubscribe();
      rejectAdmission(new Error('timed out waiting for video upload admission'));
    }, 15_000);
    unsubscribe = task.subscribe((snapshot) => {
      if (snapshot.status === 'uploading') {
        clearTimeout(timeout);
        unsubscribe();
        task.pause();
        resolveAdmission();
      } else if (snapshot.status === 'failed' || snapshot.status === 'rejected') {
        clearTimeout(timeout);
        unsubscribe();
        rejectAdmission(new Error(`video upload was not admitted: ${JSON.stringify(snapshot.diagnostic)}`));
      }
    });
  });
}

async function eventually(assertion, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await assertion();
    } catch (error) {
      lastError = error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 40));
    }
  }
  throw new Error(`${label}: ${lastError?.message ?? 'timed out'}`, { cause: lastError });
}

async function upload(client, filename, uploadReference) {
  const bytes = readFileSync(join(mediaRoot, filename));
  const contentType = filename.endsWith('.mp4') ? 'video/mp4' : 'image/png';
  const terminal = await createAssetClient(client).start({
    upload: uploadReference,
    file: new Blob([bytes], { type: contentType }),
    declaredFilename: basename(filename),
    declaredContentType: contentType,
  }).done;
  assert.equal(terminal.status, 'ready', JSON.stringify(terminal.diagnostic ?? terminal));
  return terminal.assetId;
}

async function allPages(client, reference) {
  const output = [];
  let before;
  for (let page = 0; page < 20; page += 1) {
    const rows = (await client.query(reference, {
      args: { ...(before ? { before } : {}) },
    })).rows;
    output.push(...rows);
    if (rows.length < 20) return output;
    before = rows.at(-1).pageKey;
  }
  throw new Error('feed pagination did not terminate within twenty pages');
}

test('Coterie Snapback M2 backend', { timeout: 600_000 }, async (t) => {
  assert(existsSync(runtimeBinary), `charter-pinned runtime is missing: ${runtimeBinary}`);
  const scratch = mkdtempSync(join(tmpdir(), 'coterie-m2-'));
  const clients = [];
  const handles = [];
  let server = null;
  t.after(async () => {
    await Promise.allSettled(handles.map((handle) => handle.dispose()));
    await Promise.allSettled(clients.map((client) => client.closeAuth()));
    let stopError = null;
    try {
      await server?.stop();
    } catch (error) {
      stopError = error;
    }
    rmSync(scratch, { recursive: true, force: true });
    if (stopError) throw stopError;
  });

  const stagedRuntime = join(scratch, 'snapback-runtime');
  symlinkSync(runtimeBinary, stagedRuntime);
  const carrier = join(scratch, 'startup-artifacts.json');
  writeFileSync(carrier, `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`, {
    mode: 0o600,
  });
  server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repoRoot,
    startupArtifacts: carrier,
    serverBinary: stagedRuntime,
  });

  await installM1Fixtures({ baseUrl: server.baseUrl, runId: 'm2-acceptance-setup' });
  const personas = JSON.parse(readFileSync(join(fixtureRoot, 'personas.json'), 'utf8')).starter;
  const actors = new Map();
  for (const persona of personas.filter(({ id }) => ['alice', 'bob', 'carol', 'dave'].includes(id))) {
    const client = passwordClient(server.baseUrl, `coterie-m2-acceptance-${persona.id}`);
    clients.push(client);
    await client.authPasswordSignIn({ email: persona.email, password: persona.password });
    const profile = (await client.query(api.getMyProfile, { args: {} })).rows[0];
    actors.set(persona.id, { client, profile });
  }
  const alice = actors.get('alice');
  const bob = actors.get('bob');
  const carol = actors.get('carol');
  const dave = actors.get('dave');
  const created = { bob: [], alice: {}, carol: null, dave: null, reply: {} };

  await t.test('schema and upload manifests carry the M2 structural invariants', async () => {
    const table = (name) => schema.tables.find((candidate) => candidate.name === name);
    assert.deepEqual(table('likes').indexes.find(({ name }) => name === 'by_owner_post'), {
      name: 'by_owner_post',
      fields: ['ownerProfileId', 'postId'],
      unique: true,
    });
    assert.equal(table('reposts').indexes.find(({ name }) => name === 'by_owner_post').unique, true);
    assert.equal(table('follows').indexes.find(({ name }) => name === 'by_pair').unique, true);
    assert.equal(table('postImages').indexes.find(({ name }) => name === 'by_post_position').unique, true);
    assert.equal(table('postVideos').indexes.find(({ name }) => name === 'by_post').unique, true);
    assert.equal(table('feedEvents').indexes.find(({ name }) => name === 'by_page_key').unique, true);
    assert.deepEqual(table('posts').indexes.find(({ name }) => name === 'by_parent_page').fields, [
      'parentKey',
      'pageKey',
    ]);
    for (const tableName of ['follows', 'likes', 'reposts']) {
      assert.deepEqual(
        table(tableName).fields.find(({ name }) => name === 'clientMutationId'),
        { field_type: 'String', name: 'clientMutationId', optional: true },
      );
    }
    for (const operationName of ['setFollow', 'setLike', 'setRepost']) {
      const operation = functions.functions.find(({ exportedName }) => exportedName === operationName);
      assert.deepEqual(
        operation.argsContract.fields.find(({ name }) => name === 'mutationId'),
        {
          name: 'mutationId',
          required: false,
          value: { kind: 'string', maxBytes: 1_048_576 },
        },
      );
    }
    for (const operationName of ['setRepost', 'ensureFixtureRepost']) {
      const operation = functions.functions.find(({ exportedName }) => exportedName === operationName);
      assert(operation.refusals.includes('REPLY_REPOST_FORBIDDEN'));
    }

    const imageIntent = functions.assetUploadIntents.find(({ exportedName }) => (
      exportedName === 'postImageUpload'
    ));
    assert.deepEqual(imageIntent.accept, {
      maxBytes: 10_000_000,
      mediaTypes: ['image/jpeg', 'image/png', 'image/webp'],
    });
    const videoIntent = functions.assetUploadIntents.find(({ exportedName }) => (
      exportedName === 'postVideoUpload'
    ));
    assert.deepEqual(videoIntent.accept, {
      maxBytes: 50_000_000,
      mediaTypes: ['video/mp4'],
    });
    assert(readFileSync(join(mediaRoot, 'vid-01.mp4')).length < videoIntent.accept.maxBytes);
  });

  await t.test('video admission accepts 50 MB exactly and rejects max+1', async () => {
    const assets = createAssetClient(alice.client);
    const atLimit = assets.start({
      upload: api.postVideoUpload,
      file: new Blob([new Uint8Array(50_000_000)], { type: 'video/mp4' }),
      declaredFilename: 'at-limit.mp4',
      declaredContentType: 'video/mp4',
    });
    await requireUploadAdmission(atLimit);
    await atLimit.cancel();

    const tooLarge = assets.start({
      upload: api.postVideoUpload,
      file: new Blob([new Uint8Array(50_000_001)], { type: 'video/mp4' }),
      declaredFilename: 'too-large.mp4',
      declaredContentType: 'video/mp4',
    });
    const terminal = await tooLarge.done;
    assert.equal(terminal.status, 'failed');
    assert.equal(terminal.diagnostic?.code, 'SNAPBACK_ASSET_TRANSFER_FAILED');
    assert.equal(terminal.assetId, null, 'max+1 refuses during admission before reserving an asset');
  });

  await t.test('both feeds page 21 self posts as 20 + 1 with no duplicates or gaps', async () => {
    for (let index = 0; index < 21; index += 1) {
      created.bob.push((await bob.client.mutate(api.createPost, {
        args: {
          kind: 'text',
          body: `Pagination post ${String(index + 1).padStart(2, '0')}`,
          imageAssetIds: [],
        },
      })).result);
    }
    for (const reference of [api.globalFeed, api.followingFeed]) {
      const first = (await bob.client.query(reference, { args: {} })).rows;
      assert.equal(first.length, 20);
      const second = (await bob.client.query(reference, {
        args: { before: first.at(-1).pageKey },
      })).rows;
      assert.equal(second.length, 1);
      const itemIds = [...first, ...second].map(({ itemId }) => itemId);
      assert.equal(new Set(itemIds).size, 21);
      assert.deepEqual(
        new Set(itemIds),
        new Set(created.bob.map((postId) => `post:${postId}`)),
      );
    }
    const bobStats = (await bob.client.query(api.profileStats, {
      args: { profileId: bob.profile._id },
    })).rows[0];
    assert.equal(bobStats.followerCount, 0);
    assert.equal(bobStats.followingCount, 0);
  });

  await t.test('text, two-image, and video posts stream live to the other client', async () => {
    const live = await bob.client.liveQuery(api.globalFeed, {
      args: {},
      connectionId: 'coterie-m2-bob-global',
      transport: 'stream',
      fallbackToPoll: false,
    });
    handles.push(live);
    const imageAssetIds = [
      await upload(alice.client, 'img-04.png', api.postImageUpload),
      await upload(alice.client, 'img-05.png', api.postImageUpload),
    ];
    const videoAssetId = await upload(alice.client, 'vid-01.mp4', api.postVideoUpload);
    created.alice.text = (await alice.client.mutate(api.createPost, {
      args: {
        kind: 'text',
        body: 'Live URL https://example.com/coterie',
        imageAssetIds: [],
      },
    })).result;
    created.alice.images = (await alice.client.mutate(api.createPost, {
      args: {
        kind: 'images',
        body: 'Two fixture images.',
        imageAssetIds,
      },
    })).result;
    created.alice.video = (await alice.client.mutate(api.createPost, {
      args: {
        kind: 'video',
        body: 'The fixture video.',
        imageAssetIds: [],
        videoAssetId,
      },
    })).result;

    await eventually(() => {
      const rows = Object.fromEntries(live.rows.map((row) => [row._id, row]));
      for (const postId of Object.values(created.alice)) assert(rows[postId]);
      assert.equal(rows[created.alice.images].imageMedia.length, 2);
      assert(rows[created.alice.video].videoMedia?.asset);
      assert.equal(rows[created.alice.text].body, 'Live URL https://example.com/coterie');
      assert.equal(rows[created.alice.text].authorDisplayName, 'Alice Alvarez');
      assert(rows[created.alice.text].authorAvatar);
      assert.equal(Object.hasOwn(rows[created.alice.text], 'preview'), false);
    }, 'Bob did not receive Alice posts over the live stream');
  });

  await t.test('follow and unfollow update counts live and reproject all older posts', async () => {
    const following = await bob.client.liveQuery(api.followingFeed, {
      args: {},
      connectionId: 'coterie-m2-bob-following',
      transport: 'stream',
      fallbackToPoll: false,
    });
    const aliceStats = await alice.client.liveQuery(api.profileStats, {
      args: { profileId: alice.profile._id },
      connectionId: 'coterie-m2-alice-stats',
      transport: 'stream',
      fallbackToPoll: false,
    });
    handles.push(following, aliceStats);

    await bob.client.mutate(api.setFollow, {
      args: { profileId: alice.profile._id, following: true },
    });
    await eventually(() => {
      assert.equal(aliceStats.rows[0].followerCount, 1);
      for (const postId of Object.values(created.alice)) {
        assert(following.rows.some((row) => row._id === postId));
      }
    }, 'follow projection did not arrive live');

    await bob.client.mutate(api.setFollow, {
      args: { profileId: alice.profile._id, following: false },
    });
    await eventually(() => {
      assert.equal(aliceStats.rows[0].followerCount, 0);
      assert(following.rows.every((row) => row.authorProfileId !== alice.profile._id));
    }, 'unfollow projection did not shrink live');

    const reloadedFollowing = await allPages(bob.client, api.followingFeed);
    assert(reloadedFollowing.every((row) => row.authorProfileId !== alice.profile._id));
    assert.deepEqual(
      new Set(reloadedFollowing.map((row) => row._id)),
      new Set(created.bob),
    );
    const global = await allPages(bob.client, api.globalFeed);
    for (const postId of Object.values(created.alice)) {
      assert(global.some((row) => row._id === postId));
    }
  });

  await t.test('an unfollowed account is present only in Global', async () => {
    created.carol = (await carol.client.mutate(api.createPost, {
      args: {
        kind: 'text',
        body: 'Carol is globally visible.',
        imageAssetIds: [],
      },
    })).result;
    const global = await allPages(bob.client, api.globalFeed);
    const following = await allPages(bob.client, api.followingFeed);
    assert(global.some((row) => row._id === created.carol));
    assert(following.every((row) => row._id !== created.carol));
  });

  await t.test('following-feed chunks merge to the exact top 20 across actor sets', async () => {
    created.dave = (await dave.client.mutate(api.createPost, {
      args: { kind: 'text', body: 'Dave crosses the chunk boundary.', imageAssetIds: [] },
    })).result;
    const followed = [alice, carol, dave];
    for (const actor of followed) {
      await bob.client.mutate(api.setFollow, {
        args: {
          profileId: actor.profile._id,
          following: true,
          mutationId: `chunk-follow-${actor.profile.handle}`,
        },
      });
    }

    const chunked = (await bob.client.query(api.followingFeed, {
      args: { actorChunkSize: 3 },
    })).rows;
    const visibleActors = new Set([
      bob.profile._id,
      ...followed.map((actor) => actor.profile._id),
    ]);
    const expected = (await allPages(bob.client, api.globalFeed))
      .filter((row) => visibleActors.has(
        row.eventKind === 'repost' ? row.repostedByProfileId : row.authorProfileId,
      ))
      .slice(0, 20);
    assert.deepEqual(
      chunked.map(({ itemId }) => itemId),
      expected.map(({ itemId }) => itemId),
    );
    assert(chunked.some(({ _id }) => _id === created.dave));

    for (const actor of followed) {
      await bob.client.mutate(api.setFollow, {
        args: {
          profileId: actor.profile._id,
          following: false,
          mutationId: `chunk-unfollow-${actor.profile.handle}`,
        },
      });
    }
  });

  await t.test('like and unlike update the other client live', async () => {
    const aliceGlobal = await alice.client.liveQuery(api.globalFeed, {
      args: {},
      connectionId: 'coterie-m2-alice-like-count',
      transport: 'stream',
      fallbackToPoll: false,
    });
    handles.push(aliceGlobal);
    await bob.client.mutate(api.setLike, {
      args: { postId: created.alice.text, liked: true, mutationId: 'like-alice-text' },
    });
    await eventually(() => {
      assert.equal(aliceGlobal.rows.find((row) => row._id === created.alice.text).likeCount, 1);
    }, 'live like count did not increment');
    await bob.client.mutate(api.setLike, {
      args: { postId: created.alice.text, liked: false, mutationId: 'unlike-alice-text' },
    });
    await eventually(() => {
      assert.equal(aliceGlobal.rows.find((row) => row._id === created.alice.text).likeCount, 0);
    }, 'live like count did not decrement');
  });

  await t.test('reposts are attributed, removable, and projected by the reposter', async () => {
    await bob.client.mutate(api.setFollow, {
      args: {
        profileId: carol.profile._id,
        following: true,
        mutationId: 'follow-carol-for-reposts',
      },
    });
    const following = await bob.client.liveQuery(api.followingFeed, {
      args: {},
      connectionId: 'coterie-m2-bob-reposts',
      transport: 'stream',
      fallbackToPoll: false,
    });
    handles.push(following);
    await carol.client.mutate(api.setRepost, {
      args: { postId: created.alice.text, reposted: true, mutationId: 'carol-repost-alice' },
    });
    await eventually(() => {
      const row = following.rows.find((candidate) => (
        candidate._id === created.alice.text && candidate.eventKind === 'repost'
      ));
      assert.equal(row?.repostedByDisplayName, 'Carol Chen');
    }, 'followed-user repost was not attributed');
    await carol.client.mutate(api.setRepost, {
      args: { postId: created.alice.text, reposted: false, mutationId: 'carol-unrepost-alice' },
    });
    await eventually(() => {
      assert(following.rows.every((row) => row.repostedByProfileId !== carol.profile._id));
    }, 'repost toggle did not remove the feed event');

    await bob.client.mutate(api.setFollow, {
      args: {
        profileId: alice.profile._id,
        following: true,
        mutationId: 'follow-alice-for-dual-event',
      },
    });
    await bob.client.mutate(api.setRepost, {
      args: { postId: created.alice.text, reposted: true, mutationId: 'bob-repost-alice' },
    });
    await eventually(() => {
      const matching = following.rows.filter((row) => row._id === created.alice.text);
      assert.equal(matching.length, 2);
      assert(matching.some((row) => row.eventKind === 'post'));
      const repost = matching.find((row) => row.eventKind === 'repost');
      assert.equal(repost?.repostedByProfileId, bob.profile._id);
    }, 'follow edge and viewer repost did not produce distinct attributed events');
    await bob.client.mutate(api.setFollow, {
      args: {
        profileId: alice.profile._id,
        following: false,
        mutationId: 'unfollow-alice-after-dual-event',
      },
    });
    await eventually(() => {
      const matching = following.rows.filter((row) => row._id === created.alice.text);
      assert.equal(matching.length, 1);
      assert.equal(matching[0].eventKind, 'repost');
      assert.equal(matching[0].repostedByProfileId, bob.profile._id);
    }, 'unfollow did not remove only the direct author event');
    await bob.client.mutate(api.setRepost, {
      args: { postId: created.alice.text, reposted: false, mutationId: 'bob-unrepost-alice' },
    });
    await bob.client.mutate(api.setFollow, {
      args: {
        profileId: carol.profile._id,
        following: false,
        mutationId: 'unfollow-carol-after-reposts',
      },
    });
  });

  await t.test('reply count and direct thread update live while replies stay out of feeds', async () => {
    const thread = await alice.client.liveQuery(api.thread, {
      args: { postId: created.alice.text },
      connectionId: 'coterie-m2-alice-thread',
      transport: 'stream',
      fallbackToPoll: false,
    });
    handles.push(thread);
    created.reply.first = (await bob.client.mutate(api.createPost, {
      args: {
        kind: 'text',
        body: 'Direct reply from Bob.',
        imageAssetIds: [],
        parentId: created.alice.text,
      },
    })).result;
    created.reply.second = (await carol.client.mutate(api.createPost, {
      args: {
        kind: 'text',
        body: 'Direct reply from Carol.',
        imageAssetIds: [],
        parentId: created.alice.text,
      },
    })).result;
    created.reply.nested = (await bob.client.mutate(api.createPost, {
      args: {
        kind: 'text',
        body: 'Nested reply from Bob.',
        imageAssetIds: [],
        parentId: created.reply.first,
      },
    })).result;
    await eventually(() => {
      assert.deepEqual(
        thread.rows.map(({ _id }) => _id),
        [created.alice.text, created.reply.first, created.reply.second],
      );
      assert.equal(thread.rows[0].replyCount, 2);
      assert.equal(thread.rows[1].parentId, created.alice.text);
      assert.equal(thread.rows[2].parentId, created.alice.text);
      assert(thread.rows[1].createdAt <= thread.rows[2].createdAt);
      assert(thread.rows.every(({ _id }) => _id !== created.reply.nested));
    }, 'thread did not return exactly the direct replies in chronological order');

    await expectAppCode(
      () => bob.client.mutate(api.setRepost, {
        args: {
          postId: created.reply.first,
          reposted: true,
          mutationId: 'reply-repost-refusal',
        },
      }),
      'REPLY_REPOST_FORBIDDEN',
    );

    const [global, following, bobPosts] = await Promise.all([
      allPages(bob.client, api.globalFeed),
      allPages(bob.client, api.followingFeed),
      allPagesForProfile(bob.client, bob.profile._id),
    ]);
    const replyIds = new Set(Object.values(created.reply));
    assert(global.every((row) => !replyIds.has(row._id)));
    assert(following.every((row) => !replyIds.has(row._id)));
    assert(bobPosts.every((row) => !replyIds.has(row._id)));
  });

  await t.test('brief validation failures are declared refusals and mutations require auth', async () => {
    const acceptedBody = '😀'.repeat(500);
    const acceptedPostId = (await alice.client.mutate(api.createPost, {
      args: { kind: 'text', body: acceptedBody, imageAssetIds: [] },
    })).result;
    const acceptedPost = (await alice.client.query(api.profilePosts, {
      args: { profileId: alice.profile._id },
    })).rows.find(({ _id }) => _id === acceptedPostId);
    assert.equal(acceptedPost?.body, acceptedBody);
    await expectAppCode(
      () => alice.client.mutate(api.createPost, {
        args: { kind: 'text', body: '😀'.repeat(501), imageAssetIds: [] },
      }),
      'POST_BODY_TOO_LONG',
    );
    await expectAppCode(
      () => alice.client.mutate(api.createPost, {
        args: { kind: 'poll', body: '', imageAssetIds: [] },
      }),
      'POST_KIND_INVALID',
    );
    await expectAppCode(
      () => alice.client.mutate(api.createPost, {
        args: { kind: 'video', body: '', imageAssetIds: [] },
      }),
      'POST_KIND_MEDIA_MISMATCH',
    );
    await expectAppCode(
      () => alice.client.mutate(api.createPost, {
        args: { kind: 'images', body: '', imageAssetIds: [] },
      }),
      'POST_IMAGE_COUNT_INVALID',
    );
    await expectAppCode(
      () => alice.client.mutate(api.createPost, {
        args: { kind: 'images', body: '', imageAssetIds: ['1', '2', '3', '4', '5'] },
      }),
      'POST_IMAGE_COUNT_INVALID',
    );
    await expectAppCode(
      () => alice.client.mutate(api.createPost, {
        args: { kind: 'images', body: '', imageAssetIds: ['image'], videoAssetId: 'video' },
      }),
      'POST_MEDIA_MIXED',
    );
    await expectAppCode(
      () => alice.client.mutate(api.createPost, {
        args: {
          kind: 'text',
          body: 'Missing parent.',
          imageAssetIds: [],
          parentId: 'missing-parent',
        },
      }),
      'POST_PARENT_NOT_FOUND',
    );
    const bobStatsBefore = (await bob.client.query(api.profileStats, {
      args: { profileId: bob.profile._id },
    })).rows[0];
    await expectAppCode(
      () => bob.client.mutate(api.setFollow, {
        args: { profileId: bob.profile._id, following: true },
      }),
      'SELF_FOLLOW_FORBIDDEN',
    );
    const bobStatsAfter = (await bob.client.query(api.profileStats, {
      args: { profileId: bob.profile._id },
    })).rows[0];
    assert.equal(bobStatsAfter.followerCount, bobStatsBefore.followerCount);
    assert.equal(bobStatsAfter.followingCount, bobStatsBefore.followingCount);

    const anonymous = new SnapbackClient(server.baseUrl, {
      authClientProtocol: 1,
      custody: 'anonymous-public',
      adminToken: null,
      clientStoreId: 'coterie-m2-anonymous',
      rqsStore: null,
      offlineQueue: false,
    });
    clients.push(anonymous);
    await expectCode(
      () => anonymous.mutate(api.createPost, {
        args: { kind: 'text', body: 'Denied.', imageAssetIds: [] },
      }),
      'SNAPBACK_AUTH_REQUIRED',
    );
  });

  await t.test('fixture operations hide cross-principal misses and declare mutation refusal', async () => {
    const fixtureId = 'm2-cross-principal-probe';
    const fixtureDigest = '0'.repeat(64);
    await alice.client.mutate(api.ensureFixturePost, {
      args: {
        fixtureId,
        fixtureDigest,
        kind: 'text',
        body: 'Fixture ownership probe.',
        imageAssetIds: [],
        imageSourceDigests: [],
      },
    });
    assert.equal((await alice.client.query(api.getMyFixturePost, {
      args: { fixtureId },
    })).rows.length, 1);
    assert.equal((await bob.client.query(api.getMyFixturePost, {
      args: { fixtureId },
    })).rows.length, 0);
    await expectAppCode(
      () => bob.client.mutate(api.ensureFixturePost, {
        args: {
          fixtureId,
          fixtureDigest,
          kind: 'text',
          body: 'Fixture ownership probe.',
          imageAssetIds: [],
          imageSourceDigests: [],
        },
      }),
      'FIXTURE_OWNERSHIP_MISMATCH',
    );
  });

  await t.test('the complete M2 fixture installer is digest-verified and idempotent', async () => {
    const first = await installM2Fixtures({ baseUrl: server.baseUrl, runId: 'first' });
    const second = await installM2Fixtures({ baseUrl: server.baseUrl, runId: 'second' });
    assert.equal(first.follows.length, 12);
    assert.equal(first.posts.length, 28);
    assert.equal(first.likes.length, 8);
    assert.equal(first.reposts.length, 4);
    assert(first.follows.every(({ disposition }) => disposition === 'created'));
    assert(first.posts.every(({ disposition }) => disposition === 'created'));
    assert(first.likes.every(({ disposition }) => disposition === 'created'));
    assert(first.reposts.every(({ disposition }) => disposition === 'created'));
    assert(second.follows.every(({ disposition }) => disposition === 'matched'));
    assert(second.posts.every(({ disposition }) => disposition === 'matched'));
    assert(second.likes.every(({ disposition }) => disposition === 'matched'));
    assert(second.reposts.every(({ disposition }) => disposition === 'matched'));
    assert.deepEqual(
      second.posts.map(({ fixtureId, postId }) => ({ fixtureId, postId })),
      first.posts.map(({ fixtureId, postId }) => ({ fixtureId, postId })),
    );
    const source = readFileSync(join(fixtureRoot, 'starter-m2.log'));
    assert.equal(createHash('sha256').update(source).digest('hex'), starterM2Digest);
  });
});

async function allPagesForProfile(client, profileId) {
  const output = [];
  let before;
  for (let page = 0; page < 20; page += 1) {
    const rows = (await client.query(api.profilePosts, {
      args: { profileId, ...(before ? { before } : {}) },
    })).rows;
    output.push(...rows);
    if (rows.length < 20) return output;
    before = rows.at(-1).postPageKey;
  }
  throw new Error('profile-post pagination did not terminate within twenty pages');
}
