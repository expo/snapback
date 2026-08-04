// LLP 0157 §D8 / oracle A4: independent Rust/JS encoders reproduce one
// committed fixed-nonce `sbsb1` vector, freezing the exact plaintext bytes and
// the HKDF/length-framed-AAD/XChaCha20-Poly1305 envelope. The Rust arm
// consumes the SAME fixture (src/snapshot_batch_cursor.rs,
// fixed_nonce_golden_vector_and_exact_order); this side failing means the two
// serializers or envelopes have drifted.
//
// @ref LLP 0157#sbsb1-plaintext-and-budget — the closed member order and the
//   fixed-nonce parity obligation this consumer demonstrates.

import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, hkdfSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const fixtureUrl = new URL('../fixtures/snapshot-batch-sbsb1-parity-v1.json', import.meta.url);
const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));
assert.equal(fixture.formatVersion, 'snapshot-batch-sbsb1-parity-v1');

const purpose = Buffer.from('snapback:snapshot-batch-cursor:xchacha20:v1');
const rotateLeft = (value, bits) => ((value << bits) | (value >>> (32 - bits))) >>> 0;
const hchacha20 = (key, nonce) => {
  const state = new Uint32Array(16);
  state.set([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);
  for (let index = 0; index < 8; index += 1) {
    state[4 + index] = key.readUInt32LE(index * 4);
  }
  for (let index = 0; index < 4; index += 1) {
    state[12 + index] = nonce.readUInt32LE(index * 4);
  }
  const quarterRound = (a, b, c, d) => {
    state[a] = (state[a] + state[b]) >>> 0;
    state[d] = rotateLeft((state[d] ^ state[a]) >>> 0, 16);
    state[c] = (state[c] + state[d]) >>> 0;
    state[b] = rotateLeft((state[b] ^ state[c]) >>> 0, 12);
    state[a] = (state[a] + state[b]) >>> 0;
    state[d] = rotateLeft((state[d] ^ state[a]) >>> 0, 8);
    state[c] = (state[c] + state[d]) >>> 0;
    state[b] = rotateLeft((state[b] ^ state[c]) >>> 0, 7);
  };
  for (let round = 0; round < 10; round += 1) {
    quarterRound(0, 4, 8, 12);
    quarterRound(1, 5, 9, 13);
    quarterRound(2, 6, 10, 14);
    quarterRound(3, 7, 11, 15);
    quarterRound(0, 5, 10, 15);
    quarterRound(1, 6, 11, 12);
    quarterRound(2, 7, 8, 13);
    quarterRound(3, 4, 9, 14);
  }
  const output = Buffer.alloc(32);
  [0, 1, 2, 3, 12, 13, 14, 15].forEach((word, index) => {
    output.writeUInt32LE(state[word], index * 4);
  });
  return output;
};

// The fixture's body is written in §D8's exact member order with
// JCS-canonical embedded values, so plain JSON serialization of the parsed
// object IS the independent plaintext derivation on this side.
const plaintext = Buffer.from(JSON.stringify(fixture.body));
assert.equal(plaintext.toString('utf8'), fixture.expectedPlaintext);
assert.equal(
  fixture.body.expiresAt - fixture.body.issuedAt,
  1_209_600_000,
);

const root = Buffer.from(fixture.rootHex, 'hex');
const nonce = Buffer.from(fixture.nonceHex, 'hex');
assert.equal(root.length, 32);
assert.equal(nonce.length, 24);
const key = Buffer.from(hkdfSync(
  'sha256',
  root,
  purpose,
  Buffer.from(fixture.body.keyGeneration),
  32,
));
const subkey = hchacha20(key, nonce.subarray(0, 16));
const ietfNonce = Buffer.concat([Buffer.alloc(4), nonce.subarray(16)]);
const aadParts = [purpose];
for (const value of [
  fixture.body.appId,
  fixture.body.databaseId,
  fixture.body.targetProfileId,
]) {
  const bytes = Buffer.from(value);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  aadParts.push(length, bytes);
}
const aad = Buffer.concat(aadParts);

const cipher = createCipheriv('chacha20-poly1305', subkey, ietfNonce, {
  authTagLength: 16,
});
cipher.setAAD(aad);
const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const wire = `sbsb1.${Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]).toString('base64url')}`;
assert.equal(wire, fixture.expectedWire);

const encoded = Buffer.from(fixture.expectedWire.slice('sbsb1.'.length), 'base64url');
const decipher = createDecipheriv('chacha20-poly1305', subkey, ietfNonce, {
  authTagLength: 16,
});
decipher.setAAD(aad);
decipher.setAuthTag(encoded.subarray(encoded.length - 16));
const decoded = Buffer.concat([
  decipher.update(encoded.subarray(24, encoded.length - 16)),
  decipher.final(),
]);
assert.equal(decoded.toString('utf8'), fixture.expectedPlaintext);

console.log(JSON.stringify({
  schemaVersion: 'snapback.snapshot-batch-sbsb1-parity-evidence.v1',
  status: 'passed',
  plaintextBytes: plaintext.length,
  wireBytes: wire.length,
}));
