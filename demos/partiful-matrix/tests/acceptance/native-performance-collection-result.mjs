import assert from 'node:assert/strict';

export function validateNativePerformanceCollectionResult(
  aggregate,
  { cohort, quick },
) {
  assert.equal(aggregate.cohort, cohort, 'native aggregate cohort drifted');

  if (quick) {
    assert.equal(
      aggregate.claimEligible,
      false,
      'quick native aggregate became claim-eligible',
    );
    assert(
      aggregate.cells?.['react-expo:ios:snapback'],
      'quick aggregate omitted React',
    );
    assert(
      aggregate.cells?.['exact-contract:ios:snapback'],
      'quick aggregate omitted Exact',
    );
    return;
  }

  assert.equal(
    aggregate.claimEligible,
    true,
    `native ${cohort} aggregate is not claim-eligible`,
  );
  assert(
    aggregate.outcome === 'pass' || aggregate.outcome === 'red',
    `native ${cohort} aggregate has invalid outcome ${aggregate.outcome}`,
  );
  assert.equal(
    aggregate.ok,
    aggregate.outcome === 'pass',
    `native ${cohort} aggregate outcome disagrees with ok`,
  );

  if (cohort === 'calibration') {
    assert.equal(
      aggregate.ok,
      true,
      'native calibration did not derive a complete threshold set',
    );
    return;
  }

  assert.equal(
    aggregate.holdoutValidation?.rows?.length,
    4,
    'native holdout omitted governed threshold rows',
  );
  assert.equal(
    aggregate.holdoutValidation?.ok,
    aggregate.ok,
    'native holdout verdict disagrees with threshold rows',
  );
}
