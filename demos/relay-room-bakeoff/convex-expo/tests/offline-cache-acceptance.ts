import { ConvexHttpClient } from 'convex/browser';

import { api } from '../convex/_generated/api';
import { readCachedSnapshot, writeCachedSnapshot } from '../src/lib/cache';

const url = process.env.EXPO_PUBLIC_CONVEX_URL;
if (!url) throw new Error('EXPO_PUBLIC_CONVEX_URL is missing; run convex dev once');

const client = new ConvexHttpClient(url);
const users = await client.query(api.relay.users, {});
const ada = users.find((user) => user.handle === 'ada');
if (!ada) throw new Error('Seeded Ada user is missing');
const conversations = await client.query(api.relay.conversationsForUser, { userId: ada._id });
const engine = conversations.find((conversation) => conversation.title === 'Engine Room');
if (!engine) throw new Error('Seeded Engine Room is missing');
const liveRows = await client.query(api.relay.messages, { conversationId: engine._id });

const values = new Map<string, string>();
const coldStorage = {
  getItem(key: string) { return values.get(key) ?? null; },
  setItem(key: string, value: string) { values.set(key, value); },
};
const key = `relay.convex.messages.${engine._id}`;
writeCachedSnapshot(key, liveRows, coldStorage);

// Drop the network client reference and reconstruct only from the persistence
// seam the Expo hook uses on a cold, disconnected launch.
const retainedRows = readCachedSnapshot<typeof liveRows>(key, coldStorage);
if (!retainedRows || retainedRows.length !== liveRows.length) throw new Error('Cached message snapshot did not survive cold reconstruction');
if (!retainedRows.some((row) => row.replyToId)) throw new Error('Reply pointers were not retained');
if (!retainedRows.some((row) => row.imageUrl)) throw new Error('Image message metadata was not retained');

console.log(JSON.stringify({
  ok: true,
  source: 'app-owned-snapshot',
  liveRows: liveRows.length,
  coldRows: retainedRows.length,
  replyPointers: retainedRows.filter((row) => row.replyToId).length,
  imageMessages: retainedRows.filter((row) => row.imageUrl).length,
}, null, 2));
