#!/usr/bin/env node

import assert from 'node:assert/strict';

import { createNonSecurityId } from '../../shared/nonsecurity-id.mjs';

const uuid = createNonSecurityId('instance', {
  randomUUID: () => '12345678-1234-1234-1234-123456789abc',
});
assert.equal(uuid, 'instance_12345678123412341234123456789abc');

let requestedWords = 0;
const insecureContext = createNonSecurityId('instance', {
  getRandomValues(words) {
    requestedWords = words.length;
    words.set([0, 1, 0xabcdef01, 0xffffffff]);
    return words;
  },
});
assert.equal(requestedWords, 4);
assert.equal(insecureContext, 'instance_0000000000000001abcdef01ffffffff');

const fallbackA = createNonSecurityId('instance', null);
const fallbackB = createNonSecurityId('instance', null);
assert.notEqual(fallbackA, fallbackB);
assert.match(fallbackA, /^instance_[a-z0-9]+_[a-z0-9]+$/);

console.log(JSON.stringify({ ok: true, cases: 3 }));
