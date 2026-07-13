import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createMemorySnapbackClientStore } from '../../../../packages/snapback-contract/client-store.mjs';

const stream = '018f0d90-7b21-7a22-8c33-445566778899';
const authorityA = '018f0d90-7b24-7a22-8c33-445566778899';
const authorityB = '018f0d90-7b25-7a22-8c33-445566778899';
const authorityGrace = '018f0d90-7b26-7a22-8c33-445566778899';
const principal = (userId) => ({
  authMode: 'sessions',
  authorizationStreamIncarnation: stream,
  userId,
});
const descriptor = (authorityInstanceId, sessionGeneration = 1) => ({
  descriptorVersion: 1,
  authorityInstanceId,
  sessionGeneration,
});

const seed = JSON.parse(await readFile(
  new URL('../../snapback/seed.json', import.meta.url),
  'utf8',
));
const functions = JSON.parse(await readFile(
  new URL('../../snapback/generated/functions.manifest.json', import.meta.url),
  'utf8',
));

const adaHand = seed.tables.hands.filter((row) => row.ownerId === 'user_ada');
const graceHand = seed.tables.hands.filter((row) => row.ownerId === 'user_grace');
assert.deepEqual(adaHand.map(({ card }) => card), ['ace-spades', 'queen-hearts']);
assert.deepEqual(graceHand.map(({ card }) => card), ['king-clubs', 'ten-diamonds']);
assert.equal(adaHand.some(({ card }) => graceHand.some((row) => row.card === card)), false);

const handQuery = functions.functions.find(({ name }) => name === 'myHand');
assert.equal(handQuery.authRequirement, 'authenticated');
assert.equal(JSON.stringify(handQuery.runtime).includes('AuthUserId'), true);

const store = createMemorySnapbackClientStore();
await store.scopeAuthorization({
  principalScope: principal('user_ada'),
  authorityDescriptor: descriptor(authorityA),
  queryAuthorization: {},
});
await store.scopeToAuth('legacy-ada-session-a');
await store.putRetainedQuery('myHand:game_1', { rows: adaHand });
await store.enqueueMutation({
  id: 'cm_ready_ada',
  function: 'signalReady',
  args: { gameId: 'game_1', ready: true },
  ctxLedger: { version: 1, ids: ['signal_ada'], now: 1 },
  authorityDescriptor: descriptor(authorityA),
});

// Credential refresh is the same authority instance and does not strand.
await store.scopeToAuth('legacy-ada-refresh-b');
await store.scopeAuthorization({
  principalScope: principal('user_ada'),
  authorityDescriptor: descriptor(authorityA, 2),
});
assert.equal((await store.pendingMutations()).length, 1);

// A new Ada session keeps Ada's data but cannot inherit Ada's old queue.
await store.scopeToAuth('legacy-ada-session-c');
await store.scopeAuthorization({
  principalScope: principal('user_ada'),
  authorityDescriptor: descriptor(authorityB),
});
assert.deepEqual(
  (await store.getRetainedQuery('myHand:game_1')).rows.map(({ card }) => card),
  ['ace-spades', 'queen-hearts'],
);
assert.deepEqual(await store.pendingMutations(), []);
assert.equal((await store.strandedMutations())[0].id, 'cm_ready_ada');

// Grace is a different principal and receives no retained Ada hand.
await store.scopeAuthorization({
  principalScope: principal('user_grace'),
  authorityDescriptor: descriptor(authorityGrace),
});
assert.equal(await store.getRetainedQuery('myHand:game_1'), null);

console.log('card-game finite authority-scope proof: ok');
