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

// The multi-rejection carrier is still one failure record. JavaScript pins
// Rust's first-ordered authority, the complete queue-ordered carrier facts,
// and the singular observation/group/count/exemplar semantics together.
const multi = carrier.multiRejection;
const multiEncoded = encodeFingerprintV1(multi.fingerprintInput);
const multiSha256 = createHash('sha256').update(multiEncoded).digest();
assert.equal(multi.details.fp_branch, 'exception');
assert.equal(multi.details.fp_version, corpus.fingerprintVersion);
assert.equal(multi.details.fp_hash, lowerHex(multiSha256.subarray(0, 16)));
assert.equal(multi.details.errorClass, 'TypeError');
assert.equal(multi.details.messageTemplate, 'first rejection <digits>');
assert.equal(multi.fingerprintInput.errorClass, multi.details.rejectionCarriers[0].errorClass);
assert.deepEqual(
  multi.details.rejectionCarriers,
  [
    {
      errorClass: 'TypeError',
      message: 'first rejection 123',
      messageExtractionTruncated: false,
      stack: 'at first (handler.js:1:1)',
      stackExtractionTruncated: false,
    },
    {
      errorClass: 'RangeError',
      message: 'second rejection 456',
      messageExtractionTruncated: false,
      stack: 'at second (handler.js:2:1)',
      stackExtractionTruncated: false,
    },
  ],
);
assert.deepEqual(multi.expectedSemantics, {
  observationCount: 1,
  groupMembershipCount: 1,
  occurrenceIncrement: 1,
  exemplarCount: 1,
});
assert.equal(
  new TextEncoder().encode(JSON.stringify(multi.details)).byteLength,
  multi.serializedBytes,
);
assert.ok(multi.serializedBytes <= carrier.limits.detailsBytes);

console.log('ok - packages/snapback-contract/error-tracking-vectors.test.mjs');
