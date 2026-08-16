import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHash, hkdfSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { createMemorySnapbackClientStore } from '../../packages/snapback-contract/index.mjs';

const vectorsUrl = new URL('./relation-activity-publication-v1.vectors.json', import.meta.url);
const vectors = JSON.parse(await readFile(vectorsUrl, 'utf8'));
assert.equal(vectors.formatVersion, 'relation-activity-publication-v1');
const receiptUrl = new URL('./relation-activity-publication-v1.receipt.json', import.meta.url);
const receiptBytes = await readFile(receiptUrl);
const receipt = JSON.parse(receiptBytes);
const carrierUrl = new URL('../../src/local-relation-activity-publication.v1.json', import.meta.url);
const carrierBytes = await readFile(carrierUrl);
const carrier = JSON.parse(carrierBytes);
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

assert.equal(receipt.repositoryLocal.status, 'passed');
assert.equal(receipt.publication.status, 'published-local-source');
assert.equal(receipt.publication.authority, 'LocalCapabilityPublicationV1');
assert.equal(receipt.publication.capabilitiesPublished, true);
assert.equal(receipt.publication.acknowledgmentRequired, true);
assert.equal(receipt.publication.artifactAuthority, false);
assert.equal(receipt.publication.hostedAuthority, false);
assert.deepEqual(receipt.publication.targetProfileIds, ['local-dev-sqlite-ibex']);
assert.deepEqual(
  receipt.publication.capabilityIds,
  ['bounded_children_v1', 'write_activity_v1'],
);
assert.deepEqual(receipt.publicPackage, {
  status: 'withheld-structured-gaps',
  buildDistribution: 'public-package',
  authority: null,
  capabilityGaps: ['bounded_children_v1', 'write_activity_v1'],
  reason: 'PackageCapabilityAttestationV1 is not embedded and release-key verified',
});

assert.equal(carrier.schemaVersion, 'snapback.local-capability-publication.v1');
assert.equal(carrier.targetProfileId, 'local-dev-sqlite-ibex');
assert.deepEqual(carrier.capabilityIds, ['bounded_children_v1', 'write_activity_v1']);
assert.equal(carrier.qualificationReceiptSha256, sha256(receiptBytes));
assert.equal(
  sha256(carrierBytes),
  'sha256:bb0e557ad2f38f68bc5db206fbe234ba5bc8df724d6bd5e8d25715cc7ee7121d',
);
for (const [source, expected] of Object.entries({
  ...carrier.executorSourceSha256,
  ...carrier.schemaSourceSha256,
})) {
  const sourceBytes = await readFile(new URL(`../../${source}`, import.meta.url));
  assert.equal(sha256(sourceBytes), expected, `${source} drifted from the local publication carrier`);
}
assert.equal(carrier.packageClosureSha256, null);
assert.equal(
  carrier.buildProvenanceRequirement,
  'source-commit-and-embedded-carrier-sha256',
);
assert.deepEqual(
  receipt.repositoryLocal.cases.map((entry) => entry.id),
  [
    'paired-store-noninterference-and-partitioned-uniqueness',
    'restore-backfill-and-central-writer-lifecycle',
    'sbbc1-cross-language-and-canonical-ordering',
    'cursor-concurrency-deletion-and-live-replace',
    'write-activity-fault-cuts',
    'retained-result-65536-65537-ack-purge',
    'first-party-queue-owner-web-react-native-expo',
  ],
);

const purpose = Buffer.from('snapback:bounded-children-cursor:xchacha20:v1');
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

const lengthFramedAad = (...values) => {
  const parts = [purpose];
  for (const value of values) {
    const bytes = Buffer.from(value);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    parts.push(length, bytes);
  }
  return Buffer.concat(parts);
};

const cursor = vectors.cursor;
const root = Buffer.from(cursor.rootHex, 'hex');
const nonce = Buffer.from(cursor.nonceHex, 'hex');
const bodyBytes = Buffer.from(JSON.stringify(cursor.body));
const key = Buffer.from(hkdfSync(
  'sha256',
  root,
  purpose,
  Buffer.from(cursor.body.keyGeneration),
  32,
));
const subkey = hchacha20(key, nonce.subarray(0, 16));
const ietfNonce = Buffer.concat([Buffer.alloc(4), nonce.subarray(16)]);
const aad = lengthFramedAad(
  cursor.body.appId,
  cursor.body.databaseId,
  cursor.body.targetProfileId,
);
const cipher = createCipheriv('chacha20-poly1305', subkey, ietfNonce, {
  authTagLength: 16,
});
cipher.setAAD(aad);
const ciphertext = Buffer.concat([cipher.update(bodyBytes), cipher.final()]);
const payload = Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]);
assert.equal(`sbbc1.${payload.toString('base64url')}`, cursor.expectedWire);

const encoded = Buffer.from(cursor.expectedWire.slice('sbbc1.'.length), 'base64url');
const decipher = createDecipheriv(
  'chacha20-poly1305',
  subkey,
  ietfNonce,
  { authTagLength: 16 },
);
decipher.setAAD(aad);
decipher.setAuthTag(encoded.subarray(encoded.length - 16));
const decoded = Buffer.concat([
  decipher.update(encoded.subarray(24, encoded.length - 16)),
  decipher.final(),
]);
assert.deepEqual(JSON.parse(decoded), cursor.body);

const compareUtf8 = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
const compareRows = (left, right) =>
  (left.position - right.position)
  || compareUtf8(left.label, right.label)
  || (Number(left.active) - Number(right.active))
  || compareUtf8(left._id, right._id);
assert.deepEqual(
  vectors.ordering.rows.toSorted(compareRows).map((row) => row._id),
  vectors.ordering.expectedIds,
);

// The Contract store is the LLP 0043 queue owner shared by the web, React
// Native, and Expo first-party arms. None supplies a caller-selected id; each
// receives the durable identity minted and retained by that queue.
const queueOwnerEvidence = {};
for (const arm of ['web', 'react-native', 'expo']) {
  const store = createMemorySnapbackClientStore();
  await store.scopeToAuth('sha256:relation-publication-user');
  await store.scopeToArtifacts({
    schemaHash: 'sha256:relation-publication-schema',
    inputsHash: 'sha256:relation-publication-inputs',
  });
  const queued = await store.enqueueMutation({
    function: 'addTask',
    args: { arm },
    authFingerprint: 'sha256:relation-publication-user',
    schemaHash: 'sha256:relation-publication-schema',
    inputsHash: 'sha256:relation-publication-inputs',
  });
  assert.match(queued.id, /^cm_/);
  const pending = await store.pendingMutations();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, queued.id);
  queueOwnerEvidence[arm] = {
    queueOwned: true,
    callerSelectedId: false,
  };
}

console.log(JSON.stringify({
  schemaVersion: 'snapback.relation-activity-publication-evidence.v1',
  status: 'passed',
  cases: {
    localSourcePublication: {
      targetProfileId: carrier.targetProfileId,
      capabilityIds: carrier.capabilityIds,
      carrierSha256: sha256(carrierBytes),
      acknowledgmentRequired: receipt.publication.acknowledgmentRequired,
      hostedAuthority: receipt.publication.hostedAuthority,
    },
    publicPackagePublication: {
      status: receipt.publicPackage.status,
      capabilityGaps: receipt.publicPackage.capabilityGaps,
    },
    crossLanguageSbbc1: 'passed',
    canonicalBoundaryOrdering: 'passed',
    firstPartyQueueOwner: queueOwnerEvidence,
  },
}));
