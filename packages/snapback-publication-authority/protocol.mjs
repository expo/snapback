import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signValue,
  verify as verifySignature,
} from 'node:crypto';

// @ref LLP 0041#unreviewed-post-round-correction-publication-lease-and-rollback
// — this module is the one package-owned wire/signature authority shared by
// the standing service and the registry publisher.
export const LEASE_DOMAIN = Buffer.from('snapback-authorized-publication-lease-v1\0');
export const PACKAGE_COUNT = 9;
export const PROMOTION_PACKAGE_NAMES = Object.freeze([
  '@ccheever/snapback-runtime-darwin-arm64',
  '@ccheever/snapback-runtime-linux-x64',
  '@ccheever/snapback-contract',
  '@ccheever/snapback-client',
  '@ccheever/snapback-codegen',
  '@ccheever/snapback-vite',
  '@ccheever/snapback-react',
  '@ccheever/snapback-app-cli',
  '@ccheever/snapback-cli',
]);

export const LEASE_KEYS = Object.freeze([
  'candidateLedgerSha256',
  'candidateTag',
  'defaultTag',
  'expiresAt',
  'issuedAt',
  'operationId',
  'packages',
  'publicationEpoch',
  'publisherInstanceId',
  'schemaVersion',
  'signature',
]);
export const LEASE_PACKAGE_KEYS = Object.freeze([
  'expectedPriorVersion',
  'name',
  'newVersion',
]);
export const ISSUE_REQUEST_KEYS = Object.freeze([
  'candidateLedgerSha256',
  'candidateTag',
  'defaultTag',
  'expectedHeadSha256',
  'expectedPublicationEpoch',
  'lifetimeSeconds',
  'operationId',
  'packages',
  'publisherInstanceId',
  'schemaVersion',
]);
export const AUTHORITY_TRANSITION_KEYS = Object.freeze([
  'leaseSha256',
  'operationId',
  'outcome',
  'publicationLedgerSha256',
  'publicationEpoch',
  'publisherInstanceId',
  'schemaVersion',
  'vectorSha256',
]);
export const AUTHORITY_RECEIPT_KEYS = Object.freeze([
  'closed',
  'leaseSha256',
  'operationId',
  'outcome',
  'publicationLedgerSha256',
  'publicationEpoch',
  'schemaVersion',
  'vectorSha256',
]);
export const AUTHORITY_HEAD_KEYS = Object.freeze([
  'authorityGeneration',
  'expiresAt',
  'headSha256',
  'leaseSha256',
  'operationId',
  'outcome',
  'publicationEpoch',
  'publisherInstanceId',
  'schemaVersion',
  'status',
]);

export function canonicalJcs(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('JCS refuses non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJcs).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJcs(value[key])}`)
      .join(',')}}`;
  }
  throw new Error(`JCS refuses ${typeof value}`);
}

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function unsignedLease(lease) {
  const { signature: _signature, ...unsigned } = lease;
  return unsigned;
}

export function leaseSha256(lease) {
  return sha256Hex(canonicalJcs(lease));
}

export function assertHexSha256(value, field) {
  if (!/^[0-9a-f]{64}$/u.test(value ?? '')) {
    throw new Error(`${field} must be lowercase sha256`);
  }
}

export function assertSafePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
}

export function parseTimestamp(value, field) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value ?? '')) {
    throw new Error(`${field} must be canonical UTC milliseconds`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${field} is not canonical`);
  }
  return parsed;
}

export function requireExactKeys(value, keys, field) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${field} has unknown or missing members`);
  }
}

function validateOperationBindings(value) {
  if (!/^[A-Za-z0-9._:-]{8,160}$/u.test(value.operationId ?? '')) {
    throw new Error('invalid publication operationId');
  }
  if (!/^[A-Za-z0-9._:-]{8,160}$/u.test(value.publisherInstanceId ?? '')) {
    throw new Error('invalid publication publisherInstanceId');
  }
}

export function validateLeasePackages(packages, field = 'publication lease') {
  if (!Array.isArray(packages) || packages.length !== PACKAGE_COUNT) {
    throw new Error(`${field} must bind exactly ${PACKAGE_COUNT} packages`);
  }
  const names = new Set();
  for (const [index, row] of packages.entries()) {
    requireExactKeys(row, LEASE_PACKAGE_KEYS, `${field} package ${index}`);
    if (!/^@ccheever\/snapback-[a-z0-9-]+$/u.test(row?.name ?? '')) {
      throw new Error(`invalid package name at index ${index}`);
    }
    if (names.has(row.name)) throw new Error(`duplicate package ${row.name}`);
    names.add(row.name);
    if (row.name !== PROMOTION_PACKAGE_NAMES[index]) {
      throw new Error(`${field} package order/inventory drift at index ${index}`);
    }
    if (
      row.expectedPriorVersion !== null
      && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(row.expectedPriorVersion ?? '')
    ) {
      throw new Error(`invalid expectedPriorVersion for ${row.name}`);
    }
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(row.newVersion ?? '')) {
      throw new Error(`invalid newVersion for ${row.name}`);
    }
  }
  return packages;
}

export function validatePublicationLease({
  lease,
  publicKey,
  candidateLedgerSha256,
  candidateTag,
  publisherInstanceId,
  now = Date.now(),
}) {
  requireExactKeys(lease, LEASE_KEYS, 'publication lease');
  if (lease?.schemaVersion !== 'snapback.authorized-publication-lease.v1') {
    throw new Error('unsupported publication lease schema');
  }
  validateOperationBindings(lease);
  if (lease.publisherInstanceId !== publisherInstanceId) {
    throw new Error('publication lease publisher instance mismatch');
  }
  assertSafePositiveInteger(lease.publicationEpoch, 'publicationEpoch');
  assertHexSha256(lease.candidateLedgerSha256, 'candidateLedgerSha256');
  if (lease.candidateLedgerSha256 !== candidateLedgerSha256) {
    throw new Error('publication lease candidate ledger mismatch');
  }
  if (lease.candidateTag !== candidateTag || lease.defaultTag !== 'latest') {
    throw new Error('publication lease tag binding mismatch');
  }
  const issuedAt = parseTimestamp(lease.issuedAt, 'issuedAt');
  const expiresAt = parseTimestamp(lease.expiresAt, 'expiresAt');
  if (expiresAt <= issuedAt || expiresAt - issuedAt > 15 * 60_000) {
    throw new Error('publication lease lifetime must be in (0, 15 minutes]');
  }
  if (now < issuedAt || now >= expiresAt) {
    throw new Error('publication lease is not current');
  }
  validateLeasePackages(lease.packages);
  if (typeof lease.signature !== 'string' || lease.signature.length < 80) {
    throw new Error('publication lease signature is missing');
  }
  const key = typeof publicKey === 'string' || Buffer.isBuffer(publicKey)
    ? createPublicKey(publicKey)
    : publicKey;
  const payload = Buffer.concat([
    LEASE_DOMAIN,
    Buffer.from(canonicalJcs(unsignedLease(lease))),
  ]);
  if (!verifySignature(null, payload, key, Buffer.from(lease.signature, 'base64url'))) {
    throw new Error('publication lease signature is invalid');
  }
  return lease;
}

export function signPublicationLease({ unsigned, privateKey }) {
  requireExactKeys(
    { ...unsigned, signature: '' },
    LEASE_KEYS,
    'unsigned publication lease',
  );
  const key = typeof privateKey === 'string' || Buffer.isBuffer(privateKey)
    ? createPrivateKey(privateKey)
    : privateKey;
  const signature = signValue(
    null,
    Buffer.concat([LEASE_DOMAIN, Buffer.from(canonicalJcs(unsigned))]),
    key,
  ).toString('base64url');
  return { ...unsigned, signature };
}

export function validatePublicationLeaseIssueRequest(request) {
  requireExactKeys(request, ISSUE_REQUEST_KEYS, 'publication lease issue request');
  if (request.schemaVersion !== 'snapback.publication-lease-issue-request.v1') {
    throw new Error('unsupported publication lease issue request schema');
  }
  validateOperationBindings(request);
  if (!Number.isSafeInteger(request.expectedPublicationEpoch)
      || request.expectedPublicationEpoch < 0) {
    throw new Error('expectedPublicationEpoch must be a non-negative safe integer');
  }
  if (request.expectedHeadSha256 !== null) {
    assertHexSha256(request.expectedHeadSha256, 'expectedHeadSha256');
  }
  assertHexSha256(request.candidateLedgerSha256, 'candidateLedgerSha256');
  if (
    !/^[a-z0-9][a-z0-9-]{7,159}$/u.test(request.candidateTag ?? '')
    || request.defaultTag !== 'latest'
  ) {
    throw new Error('publication lease issue request tag binding is invalid');
  }
  if (!Number.isSafeInteger(request.lifetimeSeconds)
      || request.lifetimeSeconds < 1
      || request.lifetimeSeconds > 15 * 60) {
    throw new Error('lifetimeSeconds must be in [1, 900]');
  }
  validateLeasePackages(request.packages, 'publication lease issue request');
  return request;
}

export function vectorFromLease(lease, side) {
  return Object.fromEntries(lease.packages.map((row) => [
    row.name,
    side === 'prior' ? row.expectedPriorVersion : row.newVersion,
  ]));
}

export function validatePublicationAuthorityTransition(transition) {
  requireExactKeys(
    transition,
    AUTHORITY_TRANSITION_KEYS,
    'publication authority transition',
  );
  if (transition.schemaVersion !== 'snapback.publication-authority-transition.v1') {
    throw new Error('unsupported publication authority transition schema');
  }
  validateOperationBindings(transition);
  assertSafePositiveInteger(transition.publicationEpoch, 'publicationEpoch');
  assertHexSha256(transition.leaseSha256, 'leaseSha256');
  assertHexSha256(transition.vectorSha256, 'vectorSha256');
  if (!['acquired', 'promoted', 'rolled-back'].includes(transition.outcome)) {
    throw new Error('unsupported publication authority transition outcome');
  }
  if (transition.outcome === 'promoted') {
    assertHexSha256(
      transition.publicationLedgerSha256,
      'publicationLedgerSha256',
    );
  } else if (transition.publicationLedgerSha256 !== null) {
    throw new Error('non-promoted authority transition cannot bind a publication ledger');
  }
  return transition;
}

export function publicationAuthorityTransition({
  lease,
  outcome,
  vector,
  publicationLedgerSha256 = null,
}) {
  const transition = {
    schemaVersion: 'snapback.publication-authority-transition.v1',
    operationId: lease.operationId,
    publicationEpoch: lease.publicationEpoch,
    publisherInstanceId: lease.publisherInstanceId,
    leaseSha256: leaseSha256(lease),
    outcome,
    publicationLedgerSha256,
    vectorSha256: sha256Hex(canonicalJcs(vector)),
  };
  return validatePublicationAuthorityTransition(transition);
}

export function validatePublicationAuthorityReceipt({ receipt, transition }) {
  validatePublicationAuthorityTransition(transition);
  requireExactKeys(receipt, AUTHORITY_RECEIPT_KEYS, 'publication authority receipt');
  if (
    receipt.schemaVersion !== 'snapback.publication-authority-transition-receipt.v1'
    || receipt.closed !== (transition.outcome !== 'acquired')
  ) {
    throw new Error('publication authority transition receipt state mismatch');
  }
  for (const field of [
    'operationId',
    'publicationEpoch',
    'leaseSha256',
    'outcome',
    'publicationLedgerSha256',
    'vectorSha256',
  ]) {
    if (receipt[field] !== transition[field]) {
      throw new Error(`publication authority transition receipt ${field} mismatch`);
    }
  }
  return receipt;
}

export function createPublicationAuthorityReceipt(transition) {
  validatePublicationAuthorityTransition(transition);
  return {
    schemaVersion: 'snapback.publication-authority-transition-receipt.v1',
    operationId: transition.operationId,
    publicationEpoch: transition.publicationEpoch,
    leaseSha256: transition.leaseSha256,
    outcome: transition.outcome,
    publicationLedgerSha256: transition.publicationLedgerSha256,
    vectorSha256: transition.vectorSha256,
    closed: transition.outcome !== 'acquired',
  };
}

export function validatePublicationAuthorityHead(head) {
  requireExactKeys(head, AUTHORITY_HEAD_KEYS, 'publication authority head');
  if (head.schemaVersion !== 'snapback.publication-authority-head.v1') {
    throw new Error('unsupported publication authority head schema');
  }
  if (!Number.isSafeInteger(head.authorityGeneration) || head.authorityGeneration < 0) {
    throw new Error('authorityGeneration must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(head.publicationEpoch) || head.publicationEpoch < 0) {
    throw new Error('publicationEpoch must be a non-negative safe integer');
  }
  if (head.status === 'empty') {
    if (
      head.publicationEpoch !== 0
      || [
        head.operationId,
        head.publisherInstanceId,
        head.leaseSha256,
        head.expiresAt,
        head.outcome,
        head.headSha256,
      ].some((value) => value !== null)
    ) {
      throw new Error('empty publication authority head is inconsistent');
    }
    return head;
  }
  if (!['issued', 'acquired', 'closed'].includes(head.status)) {
    throw new Error('publication authority head status is invalid');
  }
  validateOperationBindings(head);
  assertSafePositiveInteger(head.publicationEpoch, 'publicationEpoch');
  assertHexSha256(head.leaseSha256, 'leaseSha256');
  assertHexSha256(head.headSha256, 'headSha256');
  parseTimestamp(head.expiresAt, 'expiresAt');
  if (
    (head.status === 'closed') !== (head.outcome !== null)
    || (head.outcome !== null && !['promoted', 'rolled-back'].includes(head.outcome))
  ) {
    throw new Error('publication authority head outcome is inconsistent');
  }
  return head;
}
