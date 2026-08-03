// Independent JavaScript proof of the Rust-generated LLP 0156 vectors.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodeFingerprintV1, lowerHex } from './error-tracking-vectors.mjs';

const corpus = JSON.parse(readFileSync(fileURLToPath(new URL(
  '../../schemas/error-fingerprint.vectors-v1.json',
  import.meta.url,
)), 'utf8'));
const carrier = JSON.parse(readFileSync(fileURLToPath(new URL(
  '../../schemas/error-carrier.fixtures-v1.json',
  import.meta.url,
)), 'utf8'));

assert.equal(corpus.artifactVersion, 1);
assert.equal(corpus.fingerprintVersion, 1);
assert.ok(corpus.vectors.length >= 7);

for (const vector of corpus.vectors) {
  const encoded = encodeFingerprintV1(vector.input);
  const sha256 = createHash('sha256').update(encoded).digest();
  assert.equal(lowerHex(encoded), vector.encodedHex, `${vector.name}: encoding`);
  assert.equal(lowerHex(sha256), vector.sha256, `${vector.name}: sha256`);
  assert.equal(lowerHex(sha256.subarray(0, 16)), vector.fingerprintHash, `${vector.name}: hash`);
}

const absent = corpus.vectors.find((vector) => vector.name === 'absent-name');
const empty = corpus.vectors.find((vector) => vector.name === 'empty-name');
assert.ok(absent && empty);
assert.notEqual(absent.fingerprintHash, empty.fingerprintHash);

// The Rust allocator's language-neutral carrier fixture is replayed here so
// JavaScript pins the same canonical UTF-8 byte accounting and priority cut:
// required stamps and the earlier allowlist field survive, appDetails drops
// whole, then template/message survive before the stack consumes the tail.
const allocation = carrier.allocation;
assert.equal(new TextEncoder().encode(JSON.stringify(allocation.details)).byteLength, allocation.serializedBytes);
assert.equal(allocation.serializedBytes, carrier.limits.detailsBytes);
assert.equal(allocation.details.platformCode, 'SNAPBACK_HANDLER_FAILED');
assert.equal(allocation.details.fp_hash, '0123456789abcdef0123456789abcdef');
assert.equal(allocation.details.attempt, 3);
assert.equal(Object.hasOwn(allocation.details, 'appDetails'), false);
assert.equal(allocation.details.detailFlags.appDetailsDropped, true);
assert.equal(allocation.details.detailFlags.messageTemplateTruncated, false);
assert.equal(allocation.details.detailFlags.messageTruncated, false);
assert.equal(allocation.details.detailFlags.stackTruncated, true);

console.log('ok - packages/snapback-contract/error-tracking-vectors.test.mjs');
