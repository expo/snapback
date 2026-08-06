// LLP 0157 §D8 / A14: an independent client-language consumer re-derives
// every Rust-emitted fixed-nonce `sbsb2` vector from HKDF, length-framed AAD,
// HChaCha20, and the platform ChaCha20-Poly1305 primitive. It also evaluates
// the decode-first/cross-authority-first outcome partition carried by the
// near-miss corpus; no Snapback cursor implementation is imported.

import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, hkdfSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const fixture = JSON.parse(await readFile(
  new URL('../fixtures/snapshot-batch-sbsb2-parity-v1.json', import.meta.url),
  'utf8',
));
const v1Fixture = JSON.parse(await readFile(
  new URL('../fixtures/snapshot-batch-sbsb1-parity-v1.json', import.meta.url),
  'utf8',
));
assert.equal(fixture.formatVersion, 'snapshot-batch-sbsb2-parity-v1');
assert.equal(fixture.purposeUtf8, 'snapback:snapshot-batch-cursor:xchacha20:v2');

const rotateLeft = (value, bits) => ((value << bits) | (value >>> (32 - bits))) >>> 0;
const hchacha20 = (key, nonce) => {
  const state = new Uint32Array(16);
  state.set([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);
  for (let index = 0; index < 8; index += 1) state[4 + index] = key.readUInt32LE(index * 4);
  for (let index = 0; index < 4; index += 1) state[12 + index] = nonce.readUInt32LE(index * 4);
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

const aad = (purpose, appId, databaseId, targetProfileId) => {
  const parts = [purpose];
  for (const value of [appId, databaseId, targetProfileId]) {
    const bytes = Buffer.from(value);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    parts.push(length, bytes);
  }
  return Buffer.concat(parts);
};

const material = (root, nonce, body, purpose) => {
  const key = Buffer.from(hkdfSync(
    'sha256', root, purpose, Buffer.from(body.keyGeneration), 32,
  ));
  return {
    subkey: hchacha20(key, nonce.subarray(0, 16)),
    nonce: Buffer.concat([Buffer.alloc(4), nonce.subarray(16)]),
  };
};

const encrypt = ({ root, nonce, body, purpose, prefix }) => {
  const plaintext = Buffer.from(JSON.stringify(body));
  const derived = material(root, nonce, body, purpose);
  const cipher = createCipheriv('chacha20-poly1305', derived.subkey, derived.nonce, {
    authTagLength: 16,
  });
  cipher.setAAD(aad(purpose, body.appId, body.databaseId, body.targetProfileId));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    plaintext,
    wire: `${prefix}.${Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]).toString('base64url')}`,
  };
};

const decrypt = ({ wire, root, body, purpose, prefix, context }) => {
  assert(wire.startsWith(`${prefix}.`), `foreign prefix for ${prefix}`);
  const payload = Buffer.from(wire.slice(prefix.length + 1), 'base64url');
  const nonce = payload.subarray(0, 24);
  const derived = material(root, nonce, body, purpose);
  const decipher = createDecipheriv('chacha20-poly1305', derived.subkey, derived.nonce, {
    authTagLength: 16,
  });
  decipher.setAAD(aad(purpose, context.appId, context.databaseId, context.targetProfileId));
  decipher.setAuthTag(payload.subarray(payload.length - 16));
  return Buffer.concat([
    decipher.update(payload.subarray(24, payload.length - 16)),
    decipher.final(),
  ]);
};

const purposeV2 = Buffer.from(fixture.purposeUtf8);
const purposeV1 = Buffer.from('snapback:snapshot-batch-cursor:xchacha20:v1');
const allCryptoVectors = [...fixture.vectors, ...fixture.nearMisses];
for (const vector of allCryptoVectors) {
  const root = Buffer.from(vector.rootHex, 'hex');
  const nonce = Buffer.from(vector.nonceHex, 'hex');
  assert.equal(root.length, 32);
  assert.equal(nonce.length, 24);
  assert.equal(vector.body.expiresAt - vector.body.issuedAt, 1_209_600_000);
  const derived = encrypt({
    root, nonce, body: vector.body, purpose: purposeV2, prefix: 'sbsb2',
  });
  assert.equal(derived.plaintext.toString('utf8'), vector.expectedPlaintext, `${vector.id} plaintext`);
  assert.equal(derived.wire, vector.expectedWire, `${vector.id} wire`);
  assert.equal(
    decrypt({
      wire: derived.wire,
      root,
      body: vector.body,
      purpose: purposeV2,
      prefix: 'sbsb2',
      context: vector.body,
    }).toString('utf8'),
    vector.expectedPlaintext,
    `${vector.id} decrypt`,
  );
}

const [mixed, allRelational, maximum] = fixture.vectors;
assert.deepEqual(mixed.body.nodes.map((node) => node.state.kind), [
  'boundary', 'relational-boundary', 'terminal', 'terminal',
]);
assert.equal(mixed.body.parentGroups.length, 1);
assert.equal(allRelational.body.parentGroups.length, 0);
assert.equal(Buffer.byteLength(maximum.expectedPlaintext), 6_099);
assert.equal(Buffer.byteLength(maximum.expectedWire), 8_192);
assert.equal(
  Buffer.byteLength(JSON.stringify(fixture.maximumTemplate.overLimitBody)),
  6_100,
);
const template = maximum.body.nodes[0].state;
assert.equal(Buffer.byteLength(template.boundary[0]), 32);
assert.equal(Buffer.byteLength(template.boundary[1]), 32);
assert.equal(JSON.stringify(template.boundary[0]).length, 194, 'NUL uses six-byte JSON escapes');
assert.equal(template.boundary[2], -9_007_199_254_740_991);
assert.deepEqual(template.boundary.slice(3), [false, true]);
assert.equal(Buffer.byteLength(template.rowId), 256);

const INVALID = 'SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID';
const RESTART = 'SNAPBACK_SNAPSHOT_BATCH_RESTART_REQUIRED';
const equalJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const classify = (vector) => {
  const { body, presentation: current } = vector;
  try {
    const plaintext = decrypt({
      wire: vector.expectedWire,
      root: Buffer.from(vector.rootHex, 'hex'),
      body,
      purpose: purposeV2,
      prefix: 'sbsb2',
      context: current,
    });
    assert.equal(plaintext.toString('utf8'), vector.expectedPlaintext);
  } catch {
    return INVALID;
  }
  // Decode validity collapses before every authenticated restart comparison.
  if (body.issuedAt > current.nowMs || body.expiresAt < current.nowMs) return INVALID;
  // Cross-authority is first inside the authenticated partition, so a genuine
  // rotation changing authority and epoch is invalid rather than restartable.
  if (body.authorityPartition !== current.authorityPartition) return INVALID;
  if (body.function !== current.function || body.planHash !== current.planHash
    || !equalJson(body.args, current.args)) return INVALID;
  if (body.parentGroups.length !== current.parentGroups.length) return INVALID;
  for (let index = 0; index < body.parentGroups.length; index += 1) {
    const prior = body.parentGroups[index];
    const now = current.parentGroups[index];
    if (prior.groupIndex !== now.groupIndex
      || prior.parentAuthorizationKeyDigest !== now.parentAuthorizationKeyDigest
      || prior.parentId !== now.parentId) return INVALID;
  }
  for (let index = 0; index < body.nodes.length; index += 1) {
    const kind = body.nodes[index].state.kind;
    const classId = current.nodeClasses[index];
    if ((kind === 'boundary' && classId !== 'bounded_children_v1')
      || (kind === 'relational-boundary' && classId !== 'relational_query_v1')) return INVALID;
    if (vector.id === 'boundary-invalid') return INVALID;
  }
  if (body.streamEpoch !== current.streamEpoch) return RESTART;
  for (let index = 0; index < body.parentGroups.length; index += 1) {
    const prior = body.parentGroups[index];
    const now = current.parentGroups[index];
    if (prior.parentIncarnation !== now.parentIncarnation
      || prior.parentVersion !== now.parentVersion) return RESTART;
  }
  throw new Error(`${vector.id} is not a near miss`);
};
for (const vector of fixture.nearMisses) {
  assert.equal(classify(vector), vector.expectedOutcome, `${vector.id} outcome partition`);
}
assert.equal(
  fixture.nearMisses.find((vector) => vector.id === 'expired-plus-changed-epoch').expectedOutcome,
  INVALID,
);

const v1Root = Buffer.from(v1Fixture.rootHex, 'hex');
const v2Root = Buffer.from(mixed.rootHex, 'hex');
for (const presentation of fixture.crossFamilyPresentations) {
  if (presentation.parentSurface === 'absent') {
    assert.deepEqual(presentation.expectedEnvelope, {
      kind: 'absent', nodes: null, continuation: null,
    });
    continue;
  }
  assert.equal(presentation.expectedOutcome, INVALID);
  const v2Surface = presentation.surface === 'snapshot-batch.v2';
  assert.throws(() => decrypt({
    wire: presentation.wire,
    root: v2Surface ? v1Root : v2Root,
    body: v2Surface ? v1Fixture.body : mixed.body,
    purpose: v2Surface ? purposeV2 : purposeV1,
    prefix: v2Surface ? 'sbsb2' : 'sbsb1',
    context: { appId: 'app', databaseId: 'db', targetProfileId: 'local' },
  }), presentation.id);
}

console.log(JSON.stringify({
  schemaVersion: 'snapback.snapshot-batch-sbsb2-parity-evidence.v1',
  status: 'passed',
  goldenVectors: fixture.vectors.length,
  nearMisses: fixture.nearMisses.length,
  crossFamilyPresentations: fixture.crossFamilyPresentations.length,
  maximumPlaintextBytes: Buffer.byteLength(maximum.expectedPlaintext),
  maximumWireBytes: Buffer.byteLength(maximum.expectedWire),
}));
