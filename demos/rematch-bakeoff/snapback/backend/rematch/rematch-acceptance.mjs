// Scripted acceptance checks for the Rematch core flows, run headlessly
// against the live dev server through the published Snapback client.
//
// Covers: live backend reachability + artifact identity; seeded data; text
// send + live delivery; reply pointers; reaction toggle (add/remove); typing
// ephemeral state between two clients; image upload -> attach -> public
// delivery; auth refusal for anonymous mutation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { SnapbackClient, createExternalSessionClient } from '@expo/snapback-client';
import { createAssetClient } from '@expo/snapback-client/assets';
import api, { app, ephemeral } from './snapback/generated/api.mjs';
import artifacts from './snapback/generated/artifacts.json' with { type: 'json' };

const root = resolve(import.meta.dirname, '..', '..');
const readyFile = join(root, 'run', 'dev.ready.json');
const ready = JSON.parse(readFileSync(readyFile, 'utf8'));
const BROKER = 'http://127.0.0.1:8788';

const checks = [];
const check = async (name, fn) => {
  try {
    await fn();
    checks.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    checks.push({ name, ok: false, error: String(error?.message ?? error) });
    console.log(`FAIL ${name}: ${error?.message ?? error}`);
  }
};

const mint = async (email) => {
  const response = await fetch(`${BROKER}/mint?email=${encodeURIComponent(email)}`);
  assert.equal(response.ok, true, 'broker mint reachable');
  return await response.json();
};

const sessionClient = async (email) => {
  const minted = await mint(email);
  return createExternalSessionClient(ready.serverUrl, {
    bearerToken: minted.bearerToken,
    rqsStore: null,
    offlineQueue: false,
  });
};

let ada; let grace;

await check('backend reachable + artifact identity matches generated bundle', async () => {
  ada = await sessionClient('ada@rematch.dev');
  grace = await sessionClient('grace@rematch.dev');
  const inspected = await ada.inspect();
  assert.equal(inspected.functions?.appId, artifacts.appId, 'appId');
  assert.equal(inspected.functions?.bundleHash, artifacts.bundleHash, 'bundleHash');
  assert.equal(inspected.schema?.auth?.mode, 'sessions', 'sessions mode active');
});

await check('seeded conversations, users, messages, reactions are readable', async () => {
  const conversations = await ada.query(api.listConversations, { args: {} });
  assert.ok(conversations.rows.length >= 3, 'three seeded conversations');
  const users = await ada.query(api.listUsers, { args: {} });
  assert.deepEqual(users.rows.map((row) => row.handle), ['ada', 'grace', 'kai']);
  const messages = await ada.query(api.listMessages, { args: { conversationId: 'conv_weekend_ride' } });
  assert.ok(messages.rows.length >= 4, 'seeded group history present');
  assert.ok(messages.rows.some((row) => row.replyToId === 'msg_7'), 'seeded reply pointer present');
  const reactions = await ada.query(api.listReactions, { args: { conversationId: 'conv_weekend_ride' } });
  assert.ok(reactions.rows.length >= 3, 'seeded reactions present');
});

await check('anonymous caller cannot send (auth boundary enforced)', async () => {
  const anonymous = new SnapbackClient(ready.serverUrl, { custody: 'anonymous-public', adminToken: null });
  await assert.rejects(
    anonymous.mutate(api.sendMessage, {
      args: { conversationId: 'conv_weekend_ride', senderHandle: 'ada', text: 'spoof', sentAt: Date.now() },
    }),
    (error) => /SNAPBACK_AUTH/u.test(String(error?.message ?? error)),
    'anonymous mutation refused with an auth diagnostic',
  );
});

let sentMessageId;

await check('text message send commits and is readable by another session', async () => {
  const sent = await ada.mutate(api.sendMessage, {
    args: {
      conversationId: 'conv_dm_ada_grace',
      senderHandle: 'ada',
      text: `acceptance ping ${Date.now()}`,
      sentAt: Date.now(),
    },
  });
  sentMessageId = sent.result;
  assert.ok(typeof sentMessageId === 'string' && sentMessageId.length > 0, 'message id returned');
  assert.equal(sent.changed_count, 1);
  const fromGrace = await grace.query(api.listMessages, { args: { conversationId: 'conv_dm_ada_grace' } });
  assert.ok(fromGrace.rows.some((row) => row._id === sentMessageId), 'other session reads the message');
});

await check('live query delivers a new message to a subscribed client', async () => {
  const live = await grace.liveQuery(api.listMessages, {
    args: { conversationId: 'conv_dm_ada_grace' },
    connectionId: 'acc-live-grace',
    transport: 'stream',
  });
  try {
    const before = live.rows.length;
    const text = `live delivery ${Date.now()}`;
    await ada.mutate(api.sendMessage, {
      args: { conversationId: 'conv_dm_ada_grace', senderHandle: 'ada', text, sentAt: Date.now() },
    });
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (live.rows.length > before && live.rows.some((row) => row.text === text)) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    assert.ok(live.rows.some((row) => row.text === text), 'live rows include the new message');
  } finally {
    await live.dispose?.();
  }
});

await check('reply pointer round-trip (no threads, quoted id preserved)', async () => {
  const reply = await grace.mutate(api.sendMessage, {
    args: {
      conversationId: 'conv_dm_ada_grace',
      senderHandle: 'grace',
      text: 'acceptance reply',
      replyToId: sentMessageId,
      sentAt: Date.now(),
    },
  });
  const messages = await ada.query(api.listMessages, { args: { conversationId: 'conv_dm_ada_grace' } });
  const replyRow = messages.rows.find((row) => row._id === reply.result);
  assert.equal(replyRow?.replyToId, sentMessageId, 'reply pointer stored');
  assert.ok(messages.rows.some((row) => row._id === sentMessageId), 'replied-to message still present');
});

await check('reaction toggle adds then removes', async () => {
  const add = await grace.mutate(api.toggleReaction, {
    args: { messageId: sentMessageId, conversationId: 'conv_dm_ada_grace', handle: 'grace', emoji: '🔥' },
  });
  assert.equal(add.result, 'added');
  let reactions = await ada.query(api.listReactions, { args: { conversationId: 'conv_dm_ada_grace' } });
  assert.ok(
    reactions.rows.some((row) => row.messageId === sentMessageId && row.emoji === '🔥' && row.handle === 'grace'),
    'reaction row visible',
  );
  const remove = await grace.mutate(api.toggleReaction, {
    args: { messageId: sentMessageId, conversationId: 'conv_dm_ada_grace', handle: 'grace', emoji: '🔥' },
  });
  assert.equal(remove.result, 'removed');
  reactions = await ada.query(api.listReactions, { args: { conversationId: 'conv_dm_ada_grace' } });
  assert.ok(
    !reactions.rows.some((row) => row.messageId === sentMessageId && row.emoji === '🔥' && row.handle === 'grace'),
    'reaction row removed',
  );
});

await check('typing ephemeral state flows between two clients and expires', async () => {
  const scope = { conversationId: 'conv_dm_ada_grace' };
  const seen = [];
  const observer = await ada.subscribeEphemeral(ephemeral.typing, {
    connectionId: 'acc-typing-ada',
    scope,
    onChange: () => seen.push(observer.currentEntries().map((entry) => entry.value.handle)),
  });
  const publisher = await grace.subscribeEphemeral(ephemeral.typing, {
    connectionId: 'acc-typing-grace',
    scope,
  });
  try {
    const until = async (predicate, label, timeoutMs = 10_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
      throw new Error(`${label} timed out`);
    };
    await until(() => typeof observer.currentEntries === 'function', 'observer ready', 2_000);
    await publisher.publish({ handle: 'grace', name: 'Grace Hopper' }, { ttlMs: 2_000 });
    await until(
      () => observer.currentEntries().some((entry) => entry.value.handle === 'grace'),
      'observer sees grace typing',
    );
    await publisher.delete();
    await until(
      () => !observer.currentEntries().some((entry) => entry.value.handle === 'grace'),
      'observer sees typing cleared',
    );
  } finally {
    observer.dispose?.();
    publisher.dispose?.();
  }
});

await check('image upload -> typed attach -> public rendition delivery', async () => {
  const bytes = readFileSync(join(root, 'artifacts', 'test-image.png'));
  // byte-distinct copy so asset dedup cannot collapse repeated runs
  const salted = Buffer.concat([bytes, Buffer.from(`\n<!-- ${Date.now()} -->`)]);
  const blob = new Blob([salted], { type: 'image/png' });
  const assets = createAssetClient(ada);
  const task = assets.start({
    upload: api.messageImageUpload,
    file: blob,
    declaredFilename: 'acceptance.png',
    declaredContentType: 'image/png',
  });
  const receipt = await task.done;
  assert.equal(receipt.status, 'ready', `upload ready (got ${receipt.status}: ${receipt.diagnostic?.message ?? ''})`);
  const sent = await ada.mutate(api.sendMessage, {
    args: {
      conversationId: 'conv_dm_ada_grace',
      senderHandle: 'ada',
      text: 'acceptance image',
      imageAssetId: receipt.assetId,
      sentAt: Date.now(),
    },
  });
  const messages = await grace.query(api.listMessages, { args: { conversationId: 'conv_dm_ada_grace' } });
  const imageRow = messages.rows.find((row) => row._id === sent.result);
  assert.equal(imageRow?.kind, 'image');
  assert.equal(imageRow?.image, receipt.assetId, 'typed asset reference on the row');
  let delivered = null;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    delivered = await fetch(`${ready.serverUrl}/assets/public/${receipt.assetId}/thumb`);
    if (delivered.status === 200) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  assert.equal(delivered.status, 200, 'public rendition serves');
  assert.ok((await delivered.arrayBuffer()).byteLength > 500, 'rendition bytes present');
});

await ada?.closeAuth?.().catch(() => {});
await grace?.closeAuth?.().catch(() => {});

console.log('\nACCEPTANCE SUMMARY');
for (const entry of checks) console.log(` ${entry.ok ? 'PASS' : 'FAIL'} ${entry.name}${entry.ok ? '' : ` — ${entry.error}`}`);
const failed = checks.filter((entry) => !entry.ok).length;
console.log(`${checks.length - failed}/${checks.length} passed`);
process.exit(failed === 0 ? 0 : 1);
