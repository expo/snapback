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

console.log('ok - packages/snapback-contract/error-tracking-vectors.test.mjs');
