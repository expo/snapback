// @ref LLP 0218#41-the-dispatch-union-headless-contract — Contract owns its
// own durable queue and Exact three-fact projection. Its inner transport is
// fail-loud (`queue:false`), and the additive headless discriminant is removed
// before the pre-existing mutation output enters Contract storage or callers.
export function normalizeContractMutationOutput(output) {
  if (output?.status === 'queued') {
    const error = new Error(
      'SNAPBACK_CONTRACT_INNER_MUTATION_QUEUED: queue:false transport returned queued',
    );
    error.code = 'SNAPBACK_CONTRACT_INNER_MUTATION_QUEUED';
    throw error;
  }
  if (output?.status !== 'settled') return output;
  const { status: _status, ...normalized } = output;
  return normalized;
}
