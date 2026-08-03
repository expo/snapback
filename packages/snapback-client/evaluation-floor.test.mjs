import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  SNAPBACK_LOCAL_EVALUATION_DIAGNOSTICS,
  SNAPBACK_LOCAL_EVALUATION_UNADMITTED,
  refuseLocalEvaluation,
} from './evaluation-floor.mjs';
import { createMaterializationTestHarness } from './materialization-test-support.mjs';
import { createFileRqsResumeStore } from './rqs-store-file.mjs';

test('S6 pre-gate floor registers one refusal and serves retained bytes opaquely', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'snapback-evaluation-floor-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const handle = createFileRqsResumeStore({ directory, clientStoreId: 'client-store-1' });
  await handle.whenLockSettled();
  t.after(() => handle.close());

  assert.deepEqual(
    SNAPBACK_LOCAL_EVALUATION_DIAGNOSTICS[SNAPBACK_LOCAL_EVALUATION_UNADMITTED],
    {
      code: 'SNAPBACK_LOCAL_EVALUATION_UNADMITTED',
      severity: 'error',
      subsystem: 'client-store',
      message: 'local evaluation over retained fragments is not admitted',
    },
  );

  const harness = await createMaterializationTestHarness(handle, 'evaluation-floor', {
    storageProfile: 'durable-fragments-v1',
    freshness: 'retained',
    bytes: new TextEncoder().encode('[{"_id":"opaque","secretShape":{"n":1}}]'),
  });
  const record = await harness.establish();
  const expectedFence = harness.fence(record);
  const before = await harness.store.readOpaqueSnapshot(harness.address, expectedFence);
  assert.deepEqual(before, harness.bytes, 'owner-produced bytes are returned exactly');

  let evaluatorCalled = false;
  const request = new Proxy({
    format: 'snapback.result-transform.v1',
    evaluate() { evaluatorCalled = true; },
  }, {
    get() { throw new Error('the refusal floor must not inspect a transform request'); },
    ownKeys() { throw new Error('the refusal floor must not enumerate a transform request'); },
  });
  await assert.rejects(
    harness.store.evaluateLocal(harness.address, request),
    (error) => (
      error.code === SNAPBACK_LOCAL_EVALUATION_UNADMITTED
      && error.diagnostic?.details?.fallback === 'opaque-snapshot'
      && error.diagnostic?.details?.evaluationProfile === 'unadmitted'
    ),
  );
  assert.equal(evaluatorCalled, false);
  assert.deepEqual(
    await harness.store.readOpaqueSnapshot(harness.address, expectedFence),
    harness.bytes,
    'refusal does not rewrite, project, or consume the retained fragment',
  );

  assert.throws(
    () => refuseLocalEvaluation({ kind: 'source-row-local-evaluation' }),
    { code: SNAPBACK_LOCAL_EVALUATION_UNADMITTED },
    'non-TransformPlan local evaluation requests hit the same closed floor',
  );
});
