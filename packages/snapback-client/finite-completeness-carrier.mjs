// Failure-checked finite response verification is an opt-in async arm of the
// materialization store, not part of the store constructor's initial closure.

export async function verifyFiniteCompletenessCarrierV1(carrierInput, context, verifier) {
  const [
    own,
    pageIdentityDigestV1,
    plain,
    preparePageSetManifestV1,
    prepareTrustedActivation,
    prepareWitness,
    refuse,
    requireProof,
    same,
    validatePageSetProofChain,
    validateProof,
    verifySignatureCandidate,
  ] = verifier;
  if (!plain(carrierInput)) {
    refuse('SNAPBACK_COMPLETENESS_PROOF_INVALID', 'finite completeness carrier must be an object');
  }
  const hasProof = own(carrierInput, 'completenessProof') && carrierInput.completenessProof != null;
  const hasWitness = own(carrierInput, 'authorizationWitness') && carrierInput.authorizationWitness != null;
  const hasManifest = own(carrierInput, 'pageSetManifest') && carrierInput.pageSetManifest != null;
  if (!hasProof && !hasWitness && !hasManifest) return null;
  if (!hasProof || !hasWitness) {
    refuse('SNAPBACK_COMPLETENESS_PROOF_INVALID', 'finite proof and authorization witness must be carried together');
  }
  if (!plain(context)) {
    refuse('SNAPBACK_COMPLETENESS_TRUST_MISSING', 'finite verification context is unavailable');
  }
  const proof = requireProof(carrierInput.completenessProof);
  const witness = prepareWitness(carrierInput.authorizationWitness);
  const trusted = prepareTrustedActivation(context.trustedActivation);
  if (!(context.resultBytes instanceof Uint8Array)) {
    refuse('SNAPBACK_COMPLETENESS_RESULT_INVALID', 'finite result bytes must be Uint8Array');
  }
  if (!plain(context.authorization)) {
    refuse('SNAPBACK_COMPLETENESS_WITNESS_INVALID', 'current authorization expectation is unavailable');
  }
  const pageIdentityDigest = pageIdentityDigestV1(proof.page);
  if (context.pageIdentityDigest !== undefined && context.pageIdentityDigest !== pageIdentityDigest) {
    refuse('SNAPBACK_COMPLETENESS_BINDING_INVALID', 'finite page identity does not match the requested page');
  }
  const record = {
    address: ['snapback:client-materialization-address:v1', 'finite-carrier', context.materializationKey],
    queryInstanceId: context.queryInstanceId,
    activationHash: trusted.activationHash,
    planHash: context.planHash,
    productState: { freshness: 'current' },
    authorityState: {
      expected_authorization: {
        incarnation: context.authorization.incarnation,
        epoch: context.authorization.epoch,
        version_stream: context.authorization.versionStream,
      },
    },
  };
  const fragment = {
    pageIdentityDigest,
    resultContractHash: context.resultContractHash,
    bytes: context.resultBytes,
    authorizedLeaseHash: null,
  };
  const validationContext = { ...context, authorizationWitness: witness };
  const receipt = await verifySignatureCandidate(proof, trusted);
  const receipts = new Set(receipt === null ? [] : [receipt]);
  validateProof(record, fragment, proof, validationContext, receipts);
  if (context.expectedVersion !== undefined && !same(proof.version, context.expectedVersion)) {
    refuse('SNAPBACK_COMPLETENESS_VERSION_INVALID', 'finite proof version does not match the requested version');
  }
  let pageSetManifest = null;
  if (hasManifest) {
    pageSetManifest = preparePageSetManifestV1(carrierInput.pageSetManifest);
    if (pageSetManifest === null) {
      refuse('SNAPBACK_PAGE_SET_INVALID', 'finite page-set manifest is invalid');
    }
    const priorProofs = Array.isArray(context.priorProofs)
      ? context.priorProofs.map(requireProof)
      : [];
    for (const prior of priorProofs) {
      if (await verifySignatureCandidate(prior, trusted) === null) {
        refuse('SNAPBACK_COMPLETENESS_SIGNATURE_INVALID', 'prior page proof signature is invalid');
      }
    }
    validatePageSetProofChain([...priorProofs, proof], pageSetManifest);
  }
  return Object.freeze({ proof, authorizationWitness: witness, pageSetManifest });
}
