import { readFileSync } from 'node:fs';
import { server } from './app-server.mjs';
import { webDevice, memoryPersistence } from '../../src/web.ts';
export { until } from './app-server.mjs';
export const source = `use identity
use personas alice, bob
table notes:
  owner: principal
  body: text <=200
  read <- allow
  insert <- .owner = viewer
  sync public
mutation add(body: text <=200):
  insert notes { owner: viewer, body }
query list():
  return notes first 100 by byId
table typing:
  room: text <=40
  principal: principal
  unique room, principal
  cap 50 by room
  read <- allow
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  ephemeral 4s
mutation setTyping(room: text <=40):
  upsert typing[room = room, principal = viewer] { room, principal: viewer }
mutation stopTyping(room: text <=40):
  delete typing[room = room, principal = viewer]
query typingIn(room: text <=40):
  return typing where .room = room and .principal != viewer by .principal { principal }
table durableTyping:
  room: text <=40
  principal: principal
  expiresAt: time
  unique room, principal
  cap 50 by room
  read <- allow
  insert <- .principal = viewer
  update <- .principal = viewer
  expire at .expiresAt
  sync public
mutation setDurableTyping(room: text <=40):
  upsert durableTyping[room = room, principal = viewer] { room, principal: viewer, expiresAt: now + 4000 }
query durableTypingIn(room: text <=40):
  return durableTyping where .room = room and .principal != viewer by .principal { principal }
`;
export const api = {
  setTyping: { kind: 'mutation', name: 'setTyping', ephemeral: true, renews: true, renewMs: 1000 },
  stopTyping: { kind: 'mutation', name: 'stopTyping', ephemeral: true, renewMs: 1000 },
  typingIn: { kind: 'query', name: 'typingIn', runs: 'server', ephemeralReads: ['typing'] },
  list: { kind: 'query', name: 'list' }, add: { kind: 'mutation', name: 'add' },
  setDurableTyping: { kind: 'mutation', name: 'setDurableTyping' },
  durableTypingIn: { kind: 'query', name: 'durableTypingIn' },
};
export const ephemeralServer = t => server(t, undefined, source);
export const device = () => webDevice({ wasm: readFileSync(new URL('../../src/wasm/snapback4_device_bg.wasm', import.meta.url)), persist: memoryPersistence() });
