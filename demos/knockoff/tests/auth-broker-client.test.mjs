import assert from 'node:assert/strict';
import test from 'node:test';

import { postIdentityBroker } from '../src/lib/auth-broker.ts';

test('a broker that never answers cannot leave social login pending forever', async () => {
  const neverAnswers = (_input, { signal }) => new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

  const result = Promise.race([
    postIdentityBroker('http://broker.invalid', '/v1/apple/native', {}, {
      fetchImpl: neverAnswers,
      timeoutMs: 20,
    }),
    new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error('feedback loop timed out before login settled')), 100);
    }),
  ]);

  await assert.rejects(result, /Identity broker did not answer within 20 ms/u);
});
