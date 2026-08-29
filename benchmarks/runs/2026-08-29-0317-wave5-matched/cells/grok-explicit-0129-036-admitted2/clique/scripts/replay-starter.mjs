#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { createAssetClient, createSnapbackAppClient } from '@expo/snapback-client';
import { app } from '../snapback/generated/app.mjs';
import api from '../snapback/generated/api.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = join(root, '../instrument/fixtures/social-messenger');
const personas = JSON.parse(readFileSync(join(fixtureRoot, 'personas.json'), 'utf8'));
const origin = process.env.SNAPBACK_URL ?? process.env.EXPO_PUBLIC_SNAPBACK_URL ?? 'http://127.0.0.1:63200';

function parseLine(line) {
  const match = line.match(/^(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/);
  if (!match) throw new Error(`bad log line: ${line}`);
  const [, ts, actor, verb, rest] = match;
  const tokens = [];
  const re = /"((?:\\.|[^"\\])*)"|(\S+)/g;
  let m;
  const src = rest.trim();
  while ((m = re.exec(src))) tokens.push(m[1] != null ? JSON.parse(`"${m[1]}"`) : m[2]);
  return { ts, actor, verb, tokens };
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitReady(client) {
  for (let i = 0; i < 50; i += 1) {
    const state = client.bootstrapState();
    if (state.status === 'ready') return;
    if (state.status === 'error' || state.status === 'blocked') {
      throw new Error(`bootstrap ${state.status}: ${state.diagnostic?.message ?? ''}`);
    }
    await wait(100);
  }
  throw new Error('bootstrap timeout');
}

async function waitAuth(client) {
  for (let i = 0; i < 50; i += 1) {
    const principal = client.auth.currentPrincipal();
    if (principal.status === 'authenticated') return principal;
    await wait(100);
  }
  throw new Error('auth timeout');
}

const clients = new Map();
const ids = { user: {}, post: {}, chat: {}, message: {} };

async function clientFor(actor) {
  if (clients.has(actor)) return clients.get(actor);
  const persona = personas.starter.find((p) => p.id === actor);
  if (!persona) throw new Error(`unknown actor ${actor}`);
  const appClient = await createSnapbackAppClient({
    app,
    url: origin,
    platform: {
      kind: 'expo-web',
      indexedDB: new IDBFactory(),
      cryptoObject: webcrypto,
      databaseName: `clique-replay-${actor}`,
    },
    storagePartition: `clique-replay:${actor}`,
  });
  await waitReady(appClient);
  try {
    await appClient.auth.signInWithPassword({ email: persona.email, password: persona.password });
  } catch {
    await appClient.auth.signUpWithPassword({ email: persona.email, password: persona.password });
  }
  await waitAuth(appClient);
  clients.set(actor, { appClient, persona });
  return clients.get(actor);
}

async function mutate(appClient, ref, args) {
  const outcome = await appClient.client.mutate(ref, { args });
  if (outcome.status === 'queued') {
    throw new Error(`queued mutation ${ref.name ?? ref.id}`);
  }
  return outcome.result ?? outcome;
}

async function uploadAsset(appClient, relPath, upload, mime) {
  const bytes = readFileSync(join(fixtureRoot, relPath));
  const file = new Blob([bytes], { type: mime });
  file.name = relPath.split('/').pop();
  const assets = createAssetClient(appClient.client);
  const task = assets.start({ upload, file });
  const snap = await task.done;
  if (snap.status !== 'ready') throw new Error(`upload ${relPath} ${snap.status}`);
  return snap.assetRef ?? snap.assetId;
}

async function uploadImage(appClient, relPath) {
  return uploadAsset(appClient, relPath, api.publicImageUpload, 'image/png');
}

async function replayLine(parsed) {
  const { actor, verb, tokens } = parsed;
  if (verb === 'register') {
    await clientFor(actor);
    return;
  }
  const { appClient, persona } = await clientFor(actor);
  if (verb === 'profile-set') {
    const [displayName, handle, bio, location, link, avatar] = tokens;
    let avatarRef;
    if (avatar) {
      try { avatarRef = await uploadImage(appClient, avatar); } catch { /* optional */ }
    }
    const result = await mutate(appClient, api.upsertProfile, {
      displayName, handle, bio, location, link, ...(avatarRef ? { avatar: avatarRef } : {}), clientId: actor,
    });
    ids.user[actor] = result.profileId ?? actor;
    return;
  }
  if (verb === 'follow') {
    const [target, op, mutationId] = tokens;
    await mutate(appClient, api.setFollow, { handle: target, op, mutationId });
    return;
  }
  if (verb === 'post') {
    const [postId, kind, ...rest] = tokens;
    if (kind === 'text') {
      const result = await mutate(appClient, api.createPost, { clientId: postId, kind: 'text', body: rest[0] ?? '' });
      ids.post[postId] = result.postId;
      return;
    }
    if (kind === 'images') {
      const body = rest[0] ?? '';
      const paths = String(rest[1] ?? '').split(',');
      const images = [];
      for (const p of paths) {
        if (!p) continue;
        images.push(await uploadImage(appClient, p));
      }
      const result = await mutate(appClient, api.createPost, { clientId: postId, kind: 'images', body, images });
      ids.post[postId] = result.postId;
      return;
    }
    if (kind === 'video') {
      const video = await uploadAsset(appClient, rest[1], api.publicVideoUpload, 'video/mp4');
      const result = await mutate(appClient, api.createPost, { clientId: postId, kind: 'video', body: rest[0] ?? '', video });
      ids.post[postId] = result.postId;
      return;
    }
  }
  if (verb === 'like') {
    const [postId, op, mutationId] = tokens;
    await mutate(appClient, api.setLike, { postId: ids.post[postId], op, mutationId });
    return;
  }
  if (verb === 'repost') {
    const [postId, op, mutationId] = tokens;
    await mutate(appClient, api.setRepost, { postId: ids.post[postId], op, mutationId });
    return;
  }
  if (verb === 'reply') {
    const [replyId, parentId, text] = tokens;
    const result = await mutate(appClient, api.createReply, { clientId: replyId, parentId: ids.post[parentId], body: text });
    ids.post[replyId] = result.postId;
    return;
  }
  if (verb === 'dm-create') {
    const [conversationId, other] = tokens;
    const result = await mutate(appClient, api.createDm, { clientId: conversationId, handle: other });
    ids.chat[conversationId] = result.chatId;
    return;
  }
  if (verb === 'group-create') {
    const [conversationId, second, name, description] = tokens;
    const result = await mutate(appClient, api.createGroup, {
      clientId: conversationId,
      name,
      description: description ?? '',
      memberHandles: [second],
    });
    ids.chat[conversationId] = result.chatId;
    return;
  }
  if (verb === 'member-add') {
    const [conversationId, member, mutationId] = tokens;
    await mutate(appClient, api.addChatMember, { chatId: ids.chat[conversationId], handle: member, mutationId });
    return;
  }
  if (verb === 'send') {
    const [messageId, conversationId, text, quoteTok] = tokens;
    let quoteId;
    if (quoteTok && String(quoteTok).startsWith('quote=')) {
      quoteId = ids.message[String(quoteTok).slice(6)];
    }
    const result = await mutate(appClient, api.sendText, {
      clientId: messageId,
      chatId: ids.chat[conversationId],
      text,
      ...(quoteId ? { quoteId } : {}),
    });
    ids.message[messageId] = result.messageId;
    return;
  }
  if (verb === 'send-media') {
    const [messageId, conversationId, mediaKind, mediaPath, caption, mode] = tokens;
    let image;
    if (mediaKind === 'image') image = await uploadImage(appClient, mediaPath);
    const result = await mutate(appClient, api.sendMedia, {
      clientId: messageId,
      chatId: ids.chat[conversationId],
      mediaKind,
      caption,
      ...(image ? { image } : {}),
      viewOnce: mode === 'view-once',
    });
    ids.message[messageId] = result.messageId;
    return;
  }
  if (verb === 'react') {
    const [messageId, emoji, mutationId] = tokens;
    await mutate(appClient, api.setReaction, { messageId: ids.message[messageId], emoji, mutationId });
    return;
  }
  throw new Error(`unsupported verb ${verb}`);
}

async function replayFile(path) {
  const lines = readFileSync(path, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  for (const line of lines) {
    const parsed = parseLine(line);
    await replayLine(parsed);
    process.stdout.write(`ok ${parsed.verb} ${parsed.actor}\n`);
  }
}

const milestone = process.argv[2] ?? 'm1';
const files = {
  m1: ['starter-m1.log'],
  m2: ['starter-m1.log', 'starter-m2.log'],
  m3: ['starter-m1.log', 'starter-m2.log', 'starter-m3.log'],
  m4: ['starter-m1.log', 'starter-m2.log', 'starter-m3.log'],
  m5: ['starter-m1.log', 'starter-m2.log', 'starter-m3.log'],
  m6: ['starter-m1.log', 'starter-m2.log', 'starter-m3.log'],
  m8: ['starter-m1.log', 'starter-m2.log', 'starter-m3.log'],
};
for (const name of files[milestone] ?? files.m1) {
  await replayFile(join(fixtureRoot, name));
}
if (['m3', 'm4', 'm5', 'm6', 'm8'].includes(milestone) && ids.chat['g-starter']) {
  const erin = await clientFor('erin');
  await mutate(erin.appClient, api.leaveChat, { chatId: ids.chat['g-starter'] });
  process.stdout.write('ok leave erin g-starter\n');
}
for (const entry of clients.values()) await entry.appClient.dispose();
console.log('REPLAY OK', milestone);
