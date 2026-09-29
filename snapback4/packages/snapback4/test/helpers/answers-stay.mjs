import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { server, binary, until } from './app-server.mjs';
import { processDevice } from '../../dist/native.js';
import { webDevice, memoryPersistence } from '../../dist/web.js';
export const sdk = process.env.RL_TEST_SDK ? pathToFileURL(resolve(process.env.RL_TEST_SDK) + '/') : new URL('../../dist/', import.meta.url);
const { createLocalClient } = await import(new URL('local.js', sdk));
const { createClient } = await import(new URL('client.js', sdk));
export { until };
export const q = name => ({ kind: 'query', name });
export const m = name => ({ kind: 'mutation', name });
export const parked = signal => new Promise((_, reject) => {
  if (signal.aborted) reject(signal.reason);
  else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
});
export const source = `use personas alice, bob
table members:
  room: text <=40
  principal: principal
  unique room, principal
  immutable room, principal
  read <- exists members[.room, viewer]
  insert <- exists members[.room, viewer]
  delete <- allow
  sync to members[.room]
table messages:
  room: text <=40
  body: text <=200
  at: int
  by byRoom: room, at, id
  read <- exists members[.room, viewer]
  insert <- exists members[.room, viewer]
  update <- allow
  delete <- allow
  sync to members[.room]
table profiles:
  name: text
  read <- allow
  online only
query profile():
  return profiles['bob']
query mixed(cutoff: time, deny: bool):
  if now < cutoff:
    require exists profiles['bob'] else MISSING
  require deny = false or now < cutoff else APP_DENIED
  return messages['item']
query item():
  return messages['item']
query history(c: cursor?):
  return messages['room'] first 100 by byRoom after c
mutation send(body: text <=200):
  insert messages { room: 'room', body, at: 2 }
mutation edit(body: text <=200):
  update messages['item'] { body }
mutation remove():
  delete members[room = 'room', principal = 'dev:bob']
mutation restore():
  insert members { room: 'room', principal: 'dev:bob' }
mutation erase():
  delete messages['item']
`;
export async function fixture(t, program = source) {
  const f = await server(t, undefined, program);
  const post = async (path, body, persona = 'alice') => (await fetch(f.url + path, { method: 'POST', headers: { 'x-snapback-persona': persona }, body: JSON.stringify(body) })).json();
  assert.equal((await post('/seed', [
    ...['alice', 'bob'].map(p => ({ table: 'members', row: { id: p, room: 'room', principal: `dev:${p}` } })),
    { table: 'messages', row: { id: 'item', room: 'room', body: 'image-1', at: 1 } },
    { table: 'profiles', row: { id: 'bob', name: 'Bob' } },
  ])).seeded, 4);
  return { ...f, post };
}
export function opener(host, dir) {
  return host === 'process' ? processDevice({ dir, binary }) : webDevice({ wasm: readFileSync(new URL('../../src/wasm/snapback4_device_bg.wasm', import.meta.url)), persist: memoryPersistence() });
}
export async function open(t, f, host, extra = {}) {
  const options = { url: f.url, persona: 'bob', waitSeconds: 0, ...extra };
  const client = host === 'online' ? createClient(options) : await createLocalClient({ ...options, device: extra.device ?? opener(host, join(f.dir, host)) });
  t.after(() => client.close());
  if (client.sync) await client.sync();
  return client;
}
