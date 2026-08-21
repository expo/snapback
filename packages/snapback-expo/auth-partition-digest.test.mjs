import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import test from 'node:test';

import { newSeedOperationIdV1 } from '@expo/snapback-client';
import {
  authStoragePartitionIdentityHash,
} from '@expo/snapback-client/app-client-internal';

import { createExpoCryptoSha256DigestAdapter } from './expo-crypto-digest.mjs';

const vectors = Object.freeze([
  Object.freeze({
    appId: '018f0d90-7c20-7a22-8c33-445566778899',
    storagePartition: 'default',
    canonicalText: 'snapback.auth-storage-partition.v1\n["018f0d90-7c20-7a22-8c33-445566778899","default"]',
    expected: 'sha256:7058cba2da7f40ba5043e55d4542388df70d36b4090aadf96b531c04013bb47f',
  }),
  Object.freeze({
    appId: 'ffffffff-ffff-7fff-bfff-ffffffffffff',
    storagePartition: 'preview/雪-"quoted"',
    canonicalText: 'snapback.auth-storage-partition.v1\n["ffffffff-ffff-7fff-bfff-ffffffffffff","preview/雪-\\"quoted\\""]',
    expected: 'sha256:a579808770d0d2b67434313867c2c4f18fa590b4b812d4fef5ac1d3bec6e9e42',
  }),
]);

const expoCryptoModule = Object.freeze({
  CryptoDigestAlgorithm: Object.freeze({ SHA256: 'SHA-256' }),
  async digest(algorithm, input) {
    assert.equal(algorithm, 'SHA-256');
    const output = createHash('sha256').update(input).digest();
    return output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
  },
  getRandomValues(values) {
    values.fill(7);
    return values;
  },
});
test('partition identity vectors are byte-identical across WebCrypto, iOS, and Android adapters', async (t) => {
  for (const vector of vectors) {
    await t.test(vector.storagePartition, async () => {
      assert.equal(
        `snapback.auth-storage-partition.v1\n${JSON.stringify([
          vector.appId,
          vector.storagePartition,
        ])}`,
        vector.canonicalText,
      );
      assert.equal(
        await authStoragePartitionIdentityHash(vector.appId, vector.storagePartition, {
          kind: 'memory',
          cryptoObject: webcrypto,
        }),
        vector.expected,
        'WebCrypto vector',
      );
      for (const operatingSystem of ['ios', 'android']) {
        const digestAdapter = createExpoCryptoSha256DigestAdapter(expoCryptoModule);
        assert.equal(
          await authStoragePartitionIdentityHash(vector.appId, vector.storagePartition, {
            kind: 'memory',
            digestAdapter,
          }),
          vector.expected,
          `${operatingSystem} expo-crypto adapter vector`,
        );
      }
    });
  }
});

test('the digest adapter projects no secure-randomness authority', () => {
  const digestAdapter = createExpoCryptoSha256DigestAdapter(expoCryptoModule);
  assert.deepEqual(Object.keys(digestAdapter).sort(), ['digest', 'format']);
  assert.equal(digestAdapter.getRandomValues, undefined);

  const previousCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  delete globalThis.crypto;
  try {
    assert.throws(
      () => newSeedOperationIdV1(),
      (error) => error?.code === 'SNAPBACK_CLIENT_WEBCRYPTO_RNG_MISSING',
      'successful digest module admission does not satisfy the separate CSPRNG requirement',
    );
  } finally {
    if (previousCrypto === undefined) delete globalThis.crypto;
    else Object.defineProperty(globalThis, 'crypto', previousCrypto);
  }
});
