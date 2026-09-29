import test from 'node:test';
import { identityPublicationSchedule } from './helpers/identity-handoffs.mjs';
for (const native of [false, true]) for (const late of [false, true]) for (const reopen of [false, true]) test(`identification publication survives a delayed queue read (native=${native}, late=${late}, reopen=${reopen})`, () => identityPublicationSchedule(native, late, reopen));
import { nativePublicationOverlapSchedule } from './helpers/identity-handoffs.mjs';
test('native expiry transaction rechecks a peer identity publication', nativePublicationOverlapSchedule);
