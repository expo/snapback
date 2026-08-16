#!/usr/bin/env node
// Headless acceptance for the media-post demo backend: sign in as a test
// persona, commit a three-item image/video post through the generated
// media command, and read the ordered collection back. Run against a live
// launcher (`node scripts/dev-server.mjs --reset`), origin via
// MEDIA_POST_ORIGIN (default http://127.0.0.1:4431).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '@expo/snapback-client';
import { createCommandClient } from '@expo/snapback-client/commands';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract';

import { MEDIA_POST_PERSONAS } from '../personas.mjs';
import app from '../snapback/generated/app.mjs';
import api from '../snapback/generated/api.mjs';

const origin = process.env.MEDIA_POST_ORIGIN ?? 'http://127.0.0.1:4431';
const persona = MEDIA_POST_PERSONAS[0];

// Valid 1x1 PNG fixture, plus the same bounded ISO-BMFF shape as the Rust
// video finalizer fixtures (tests/acceptance/familiar-video-asset-v1.mjs).
const png = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixture-1x1.png'));

function box(kind, payload) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8, 0);
  header.write(kind, 4, 4, 'ascii');
  return Buffer.concat([header, payload]);
}

function smallMp4() {
  const ftyp = Buffer.concat([
    Buffer.from('isom', 'ascii'),
    Buffer.alloc(4),
    Buffer.from('isommp42', 'ascii'),
  ]);
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(2000, 16);
  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(640 << 16, 76);
  tkhd.writeUInt32BE(480 << 16, 80);
  const moov = box('moov', Buffer.concat([
    box('mvhd', mvhd),
    box('trak', box('tkhd', tkhd)),
  ]));
  return Buffer.concat([box('ftyp', ftyp), moov, box('mdat', Buffer.alloc(32, 0x5a))]);
}

const mp4 = smallMp4();

const coordinator = new AuthCoordinator({
  appId: 'media-happy-post',
  storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
  broadcastChannelFactory: null,
  hintStorage: null,
});
const client = new SnapbackClient(origin, {
  authCoordinator: coordinator,
  authInvalidationProtocol: 1,
  authorityDescriptorProtocol: 1,
  authorizedLeaseProtocol: 1,
  clientStoreId: 'headless-command-acceptance',
  rqsStore: null,
});

try {
  await client.authPasswordSignIn({ email: persona.email, password: persona.password });

  const commands = createCommandClient(client);
  const task = commands.start(app.commands.createPost, {
    body: 'headless acceptance post',
    media: [
      new Blob([png], { type: 'image/png' }),
      new Blob([png], { type: 'image/png' }),
      new Blob([mp4], { type: 'video/mp4' }),
    ],
  });

  const phases = new Set();
  task.subscribe(() => phases.add(task.snapshot().status));
  const done = await task.done;
  const settled = task.snapshot();
  assert.equal(
    settled.status,
    'committed',
    `task settled ${settled.status}: ${JSON.stringify(settled.diagnostic ?? done ?? null)}`,
  );
  const postId = settled.result?._id ?? settled.parentId ?? done?._id ?? done;
  assert.ok(postId, 'committed task reports the parent post id');

  const feed = await client.query(api.listPosts, { args: {} });
  const post = feed.rows.find((row) => row._id === (postId._id ?? postId));
  assert.ok(post, 'committed post is readable in the feed');

  const media = await client.query(api.postMediaList, { args: { parentId: post._id } });
  // Bounded-children queries are ordinary query outputs with one exact
  // parent envelope in `rows`; the ordered collection lives inside it.
  const collection = Array.isArray(media.rows) ? media.rows[0] : media;
  assert.equal(collection?.kind, 'visible', 'collection parent is visible');
  const children = collection.children ?? collection.items;
  assert.equal(children.length, 3, 'all three items committed');
  assert.deepEqual(
    children.map((item) => item.media.kind),
    ['image', 'image', 'video'],
    'server-admitted kinds preserve input order',
  );
  const itemIds = new Set(children.map((item) => item.itemId ?? item._id));
  assert.equal(itemIds.size, 3, 'stable distinct item identities');

  console.log('HEADLESS_COMMAND_ACCEPTANCE_PASS', {
    post: post._id,
    kinds: children.map((item) => item.media.kind),
    phases: [...phases],
  });
} finally {
  await client.closeAuth();
}
