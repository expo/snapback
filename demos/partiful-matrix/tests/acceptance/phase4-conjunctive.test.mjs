import assert from 'node:assert/strict';
import test from 'node:test';

import { runConjunctiveSubchecks } from './phase4-conjunctive.mjs';

test('returns every passing conjunct by stable subcheck id', async () => {
  const result = await runConjunctiveSubchecks('STEP4.UI.KEYBOARD', [
    ['create', async () => ({ created: true })],
    ['menu', async () => ({ moved: true })],
  ]);

  assert.deepEqual(result, {
    create: { created: true },
    menu: { moved: true },
  });
});

test('continues after a red conjunct and retains structured partial evidence', async () => {
  const calls = [];
  await assert.rejects(
    runConjunctiveSubchecks('STEP4.UI.KEYBOARD', [
      ['create', async () => {
        calls.push('create');
        throw new Error('text carrier did not populate fields');
      }],
      ['menu', async () => {
        calls.push('menu');
        return { moved: true };
      }],
      ['wall', async () => {
        calls.push('wall');
        throw new Error('pending state absent');
      }],
    ]),
    (error) => {
      assert.equal(error.diagnostic.code, 'PARTITIME_PHASE4_CONJUNCT_FAILED');
      assert.equal(error.diagnostic.claimId, 'STEP4.UI.KEYBOARD');
      assert.deepEqual(error.diagnostic.subchecks, [
        {
          subcheckId: 'create',
          status: 'red',
          error: 'text carrier did not populate fields',
        },
        {
          subcheckId: 'menu',
          status: 'pass',
          details: { moved: true },
        },
        {
          subcheckId: 'wall',
          status: 'red',
          error: 'pending state absent',
        },
      ]);
      return true;
    },
  );
  assert.deepEqual(calls, ['create', 'menu', 'wall']);
});
