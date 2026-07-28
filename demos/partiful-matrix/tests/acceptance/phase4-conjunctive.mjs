// @ref LLP 0063#sequence — Phase 4 claims are conjunctive: a retained
// passing subcheck cannot offset or erase a red sibling.
export async function runConjunctiveSubchecks(claimId, checks) {
  const observations = [];
  for (const [subcheckId, check] of checks) {
    try {
      observations.push({
        subcheckId,
        status: 'pass',
        details: (await check()) ?? null,
      });
    } catch (error) {
      observations.push({
        subcheckId,
        status: 'red',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const failures = observations.filter(({ status }) => status !== 'pass');
  if (failures.length > 0) {
    const error = new Error(
      `${claimId} failed ${failures.length}/${observations.length} conjunctive subchecks: `
        + failures.map(({ subcheckId, error: message }) => `${subcheckId}: ${message}`).join('; '),
    );
    error.diagnostic = {
      code: 'PARTITIME_PHASE4_CONJUNCT_FAILED',
      claimId,
      subchecks: observations,
    };
    throw error;
  }

  return Object.fromEntries(
    observations.map(({ subcheckId, details }) => [subcheckId, details]),
  );
}
