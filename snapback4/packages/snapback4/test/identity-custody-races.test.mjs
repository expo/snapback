import test from 'node:test';
import { nativeCustodySchedule, onlineExpirySchedule } from './helpers/identity-custody-model.mjs';
test('native state reads cannot replace another admission attempt CAS token', () => nativeCustodySchedule('read-overlap'));
for (let variant = 0; variant < 6; variant++) test(`deferred and ordinary custody compare exact input atomically (variant=${variant})`, () => nativeCustodySchedule('dedup', variant));
for (const settled of [false, true]) test(`online expiry recovers a peer outcome (settled=${settled})`, () => onlineExpirySchedule(settled));
for (const store of ['original-store', 'replacement-store']) test(`online successful late probe preserves peer dispatch (${store})`, () => onlineExpirySchedule(false, 0, store));
