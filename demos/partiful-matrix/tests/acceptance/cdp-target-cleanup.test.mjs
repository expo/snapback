import assert from 'node:assert/strict';
import test from 'node:test';

import { closeTargetReliably } from './cdp-target-cleanup.mjs';

test('accepts the ordinary close response without a fallback query', async () => {
  let queries = 0;
  const result = await closeTargetReliably({
    targetId: 'target-1',
    closeTarget: async () => ({ success: true }),
    listTargetsFresh: async () => {
      queries += 1;
      return [];
    },
    closeTargetFresh: async () => ({ success: true }),
  });
  assert.deepEqual(result, { recovered: false });
  assert.equal(queries, 0);
});

test('accepts a lost close response only after a fresh absence proof', async () => {
  const result = await closeTargetReliably({
    targetId: 'target-1',
    closeTarget: async () => {
      throw new Error('CDP timeout: Target.closeTarget');
    },
    listTargetsFresh: async () => [],
    closeTargetFresh: async () => ({ success: true }),
  });
  assert.deepEqual(result, {
    recovered: true,
    race: 'response-lost-after-close',
  });
});

test('uses a fresh connection to close a target retained by the stalled one', async () => {
  let inventories = 0;
  let freshCloses = 0;
  const result = await closeTargetReliably({
    targetId: 'target-1',
    closeTarget: async () => {
      throw new Error('CDP timeout: Target.closeTarget');
    },
    listTargetsFresh: async () => {
      inventories += 1;
      return inventories === 1 ? [{ targetId: 'target-1' }] : [];
    },
    closeTargetFresh: async () => {
      freshCloses += 1;
      return { success: true };
    },
  });
  assert.deepEqual(result, {
    recovered: true,
    race: 'original-connection-stalled',
  });
  assert.equal(freshCloses, 1);
});

test('fails when the target remains present after the fresh close', async () => {
  const original = new Error('CDP timeout: Target.closeTarget');
  await assert.rejects(
    closeTargetReliably({
      targetId: 'target-1',
      closeTarget: async () => {
        throw original;
      },
      listTargetsFresh: async () => [{ targetId: 'target-1' }],
      closeTargetFresh: async () => ({ success: true }),
    }),
    original,
  );
});
