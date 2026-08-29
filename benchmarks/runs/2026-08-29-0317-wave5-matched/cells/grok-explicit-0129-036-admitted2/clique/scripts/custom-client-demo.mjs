#!/usr/bin/env node
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { createSnapbackAppClient } from '@expo/snapback-client';
import { app } from '../snapback/generated/app.mjs';
import api from '../snapback/generated/api.mjs';

const origin = process.env.SNAPBACK_URL ?? 'http://127.0.0.1:63200';
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function rowsOf(out) {
  if (Array.isArray(out?.rows)) return out.rows;
  if (Array.isArray(out)) return out;
  return [];
}

const client = await createSnapbackAppClient({
  app,
  url: origin,
  platform: {
    kind: 'expo-web',
    indexedDB: new IDBFactory(),
    cryptoObject: webcrypto,
    databaseName: `clique-demo-${Date.now()}`,
  },
  storagePartition: `clique-demo-${Date.now()}`,
});
for (let i = 0; i < 50; i += 1) {
  if (client.bootstrapState().status === 'ready') break;
  await wait(100);
}
const email = `demo${Date.now()}@example.com`;
await client.auth.signUpWithPassword({ email, password: 'Demo!Clique2026' });
for (let i = 0; i < 50; i += 1) {
  if (client.auth.currentPrincipal().status === 'authenticated') break;
  await wait(100);
}
await client.client.mutate(api.upsertProfile, {
  args: { displayName: 'Demo User', handle: `d${String(Date.now()).slice(-6)}`, bio: '', location: '', link: '' },
});
const chats = rowsOf(await client.client.query(api.myChats, { args: {} }));
const other = await createSnapbackAppClient({
  app,
  url: origin,
  platform: { kind: 'expo-web', indexedDB: new IDBFactory(), cryptoObject: webcrypto, databaseName: `clique-demo-b-${Date.now()}` },
  storagePartition: `clique-demo-b-${Date.now()}`,
});
for (let i = 0; i < 50; i += 1) {
  if (other.bootstrapState().status === 'ready') break;
  await wait(100);
}
await other.auth.signUpWithPassword({ email: `demob${Date.now()}@example.com`, password: 'Demo!Clique2026' });
for (let i = 0; i < 50; i += 1) {
  if (other.auth.currentPrincipal().status === 'authenticated') break;
  await wait(100);
}
const handle = `b${String(Date.now()).slice(-6)}`;
await other.client.mutate(api.upsertProfile, {
  args: { displayName: 'Demo Bob', handle, bio: '', location: '', link: '' },
});
const dm = await client.client.mutate(api.createDm, { args: { clientId: `demo-${Date.now()}`, handle } });
const chatId = dm.result?.chatId ?? dm.chatId;
const history = rowsOf(await client.client.query(api.messagesForChat, { args: { chatId } }));
await client.client.mutate(api.sendText, { args: { clientId: `demo-msg-${Date.now()}`, chatId, text: 'hello from custom client' } });
const after = rowsOf(await client.client.query(api.messagesForChat, { args: { chatId } }));
if (!after.some((row) => row.text === 'hello from custom client')) {
  throw new Error('custom client send was not visible');
}
console.log('CUSTOM CLIENT DEMO OK', { chats: chats.length, history: history.length, sent: true });
await client.dispose();
await other.dispose();
