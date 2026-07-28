import {
  PROMOTION_PACKAGE_NAMES,
  validatePublicationAuthorityHead,
  validatePublicationLeaseIssueRequest,
} from './protocol.mjs';

export function validateObservedPriorVector(vector) {
  if (vector === null || typeof vector !== 'object' || Array.isArray(vector)) {
    throw new Error('prior vector must be an object');
  }
  const actual = Object.keys(vector).sort();
  const expected = [...PROMOTION_PACKAGE_NAMES].sort();
  if (
    actual.length !== expected.length
    || actual.some((name, index) => name !== expected[index])
  ) {
    throw new Error('prior vector must contain the exact nine-package inventory');
  }
  for (const name of PROMOTION_PACKAGE_NAMES) {
    const value = vector[name];
    if (
      value !== null
      && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value ?? '')
    ) {
      throw new Error(`prior vector ${name} is not an exact version or null`);
    }
  }
  return vector;
}

// @ref LLP 0041#unreviewed-post-round-correction-publication-lease-and-rollback
// — the request is derived from the byte-qualified candidate and a separately
// observed complete prior vector; callers cannot omit an inventory member.
export function createPublicationLeaseIssueRequest({
  ledger,
  priorVector,
  head,
  publicKey,
  authorityOrigin,
  operationId,
  publisherInstanceId,
  lifetimeSeconds = 900,
}) {
  validateObservedPriorVector(priorVector);
  validatePublicationAuthorityHead({
    head,
    publicKey,
    authorityOrigin,
  });
  const packagesByName = new Map(
    (ledger?.packages ?? []).map((row) => [row.name, row]),
  );
  const packages = PROMOTION_PACKAGE_NAMES.map((name) => {
    const candidate = packagesByName.get(name);
    if (
      !candidate
      || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(candidate.version ?? '')
    ) {
      throw new Error(`candidate ledger omitted an exact ${name} version`);
    }
    return {
      name,
      expectedPriorVersion: priorVector[name],
      newVersion: candidate.version,
    };
  });
  return validatePublicationLeaseIssueRequest({
    schemaVersion: 'snapback.publication-lease-issue-request.v2',
    authorityInstallationId: head.authorityInstallationId,
    authorityOrigin: head.authorityOrigin,
    signingKeyId: head.signingKeyId,
    operationId,
    publisherInstanceId,
    expectedPublicationEpoch: head.publicationEpoch,
    expectedHeadSha256: head.headSha256,
    candidateLedgerSha256: ledger.candidateLedgerSha256,
    candidateTag: ledger.tag,
    defaultTag: 'latest',
    lifetimeSeconds,
    packages,
  });
}
