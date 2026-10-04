// Copy to the scratch app's scripts/ before running. Synthetic feasibility
// fixture, deliberately not the calibration dataset or a calibration receipt.
import { writeFile } from 'node:fs/promises';
import { createReplayState, replayLine, parseActionLine } from './replay-engine.mjs';
import { idFrom } from 'snapback4/client';
const url = 'http://127.0.0.1:49481';
const state = createReplayState();
const actions = [
  'alice register alice@example.com NP2-fixture-only-20261004',
  'bob register bob@example.com NP2-fixture-only-20261004',
  'alice profile-set "Alice" alice "NP2 fixture" "Apartment mini" "https://example.com/alice"',
  'bob profile-set "Bob" bob "NP2 fixture" "Apartment mini" "https://example.com/bob"',
  'alice dm-create np2-alice-bob bob',
  'bob send np2-history np2-alice-bob "np2needle durable history"',
  'bob send-media np2-image np2-alice-bob image media/img-02.png "NP2 ordinary image" normal',
  'bob send-media np2-once np2-alice-bob image media/img-03.png "NP2 once image" view-once',
];
for (const action of actions) await replayLine(url, state, parseActionLine('2026-10-04T00:00:00Z ' + action));
await writeFile('../fixture.json', JSON.stringify({
  purpose: 'NP2 feasibility only', origin: url,
  conversation: idFrom('entity:np2-alice-bob'), chatValue: 'dm:bob',
  history: idFrom('entity:np2-history'), ordinary: idFrom('entity:np2-image'),
  once: idFrom('entity:np2-once'), searchToken: 'np2needle',
  queuedBodies: ['NP2 queued first 20261004', 'NP2 queued second 20261004'],
}, null, 2));
console.log('NP2 scratch fixture seeded');
for (const {client} of state.users.values()) await client.close();
