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
const LEASE_DOMAIN_V2 = Buffer.from('snapback-authorized-publication-lease-v2\0');
const LEASE_DOMAIN_V3 = Buffer.from('snapback-authorized-publication-lease-v3\0');
export const LEASE_DOMAIN = Buffer.from('snapback-authorized-publication-lease-v4\0');
// The single source of truth for the generation the standing authority
// issues. Every consumer that requires "the current lease" (the authority's
// issuance path, the promote CLI's preflight pin) must reference this
// constant, never a literal: the v3 literal pin in snapback-promote.mjs
// survived the decision-9 generation bump and stranded the entire leased
// promotion path (issues/closed/20260801-promote-v3-lease-pin-refuses-v4.md).
export const CURRENT_LEASE_SCHEMA_VERSION = 'snapback.authorized-publication-lease.v4';
// A publisher validates a freshly received lease with its own clock, which can
// lag the authority's issuedAt stamp by real-world sub-second skew (HTTP-Date
// agreement is only second-granular; the first live promotion, 2026-08-08,
// refused a valid just-issued lease over ~100ms of authority-ahead skew).
// Tolerate bounded skew on the not-yet-current lower bound only — the expiry
// bound stays strict, so a lease that has genuinely expired still refuses.
export const LEASE_ISSUED_AT_SKEW_ALLOWANCE_MS = 2_000;
export const HEAD_DOMAIN = Buffer.from('snapback-publication-authority-head-v3\0');
export const RECEIPT_DOMAIN = Buffer.from(
  'snapback-publication-authority-transition-receipt-v2\0',
);
// @ref LLP 0115#open-questions — decision 9: the terminal npm family is
// @expo/snapback-* plus the exact-name umbrella @expo/snapback. v4 leases bind
// the terminal names; v2/v3 leases keep
// binding the recorded @ccheever/snapback-* interim scope so pre-migration
// artifacts stay verifiable (lineage, not history rewriting).
export const PROMOTION_PACKAGE_NAMES = Object.freeze([
  '@expo/snapback-runtime-darwin-arm64',
  '@expo/snapback-runtime-linux-x64',
  '@expo/snapback-contract',
  '@expo/snapback-client',
  '@expo/snapback-codegen',
  '@expo/snapback-vite',
  '@expo/snapback-react',
  '@expo/snapback-expo',
  '@expo/snapback-app-cli',
  '@expo/snapback-cli',
  'create-snapback-app',
  // @ref LLP 0253#s31-the-umbrella-package — append the exact-name
  // Experimental umbrella without reordering the established v4 vector.
  '@expo/snapback',
]);
export const PACKAGE_COUNT = PROMOTION_PACKAGE_NAMES.length;
// v4 terminal-family leases exist at two recorded widths: the eleven-name
// pre-umbrella closure (epochs through 0.1.20) and the twelve-name closure
// that appends @expo/snapback. Because the umbrella was appended — never
// inserted — every admitted width is an exact ordered prefix of the current
// vector, so historical records keep validating at their recorded width.
// New issues are held to the full current width by the standing authority.
export const TERMINAL_LEASE_WIDTHS = Object.freeze([11, PACKAGE_COUNT]);
export const LEGACY_PROMOTION_PACKAGE_NAMES = Object.freeze([
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
// Decision-9 lineage covers only the original nine packages that actually had
// @snapback/* and @ccheever/snapback-* identities before the terminal rename.
const PACKAGE_NAME_LINEAGE_BASIS = Object.freeze([
  '@expo/snapback-runtime-darwin-arm64',
  '@expo/snapback-runtime-linux-x64',
  '@expo/snapback-contract',
  '@expo/snapback-client',
  '@expo/snapback-codegen',
  '@expo/snapback-vite',
  '@expo/snapback-react',
  '@expo/snapback-app-cli',
  '@expo/snapback-cli',
]);
export const PACKAGE_NAME_LINEAGE = Object.freeze(Object.fromEntries(
  PACKAGE_NAME_LINEAGE_BASIS.map((name) => {
    const suffix = name.slice('@expo/snapback-'.length);
    return [name, Object.freeze({
      sourceName: `@snapback/${suffix}`,
      publishedName: `@ccheever/snapback-${suffix}`,
    })];
  }),
));
const TERMINAL_NAME_PATTERN = /^(?:@expo\/snapback-[a-z0-9-]+|@expo\/snapback|create-snapback-app)$/u;
const LEGACY_NAME_PATTERN = /^@ccheever\/snapback-[a-z0-9-]+$/u;

export const LEASE_KEYS = Object.freeze([
  'authorityInstallationId',
  'authorityOrigin',
  'candidateLedgerSha256',
  'candidateTag',
  'defaultTag',
  'expiresAt',
  'issuedAt',
  'operationId',
  'packages',
  'priorDefaultClosureReceiptSha256',
  'publicationEpoch',
  'publisherInstanceId',
  'schemaVersion',
  'signature',
  'signingKeyId',
]);
export const LEASE_PACKAGE_KEYS = Object.freeze([
  'expectedPriorVersion',
  'name',
  'newVersion',
]);
export const ISSUE_REQUEST_KEYS = Object.freeze([
  'authorityInstallationId',
  'authorityOrigin',
  'candidateLedgerSha256',
  'candidateTag',
  'defaultTag',
  'expectedHeadSha256',
  'expectedPublicationEpoch',
  'lifetimeSeconds',
  'operationId',
  'packages',
  'priorDefaultClosureReceiptSha256',
  'publisherInstanceId',
  'schemaVersion',
  'signingKeyId',
]);
const LEASE_V2_KEYS = Object.freeze(
  LEASE_KEYS.filter((key) => key !== 'priorDefaultClosureReceiptSha256'),
);
const ISSUE_REQUEST_V2_KEYS = Object.freeze(
  ISSUE_REQUEST_KEYS.filter((key) => key !== 'priorDefaultClosureReceiptSha256'),
);
export const AUTHORITY_TRANSITION_KEYS = Object.freeze([
  'authorityInstallationId',
  'authorityOrigin',
  'leaseSha256',
  'operationId',
  'outcome',
  'publicationLedgerSha256',
  'publicationEpoch',
  'publisherInstanceId',
  'schemaVersion',
  'signingKeyId',
  'vectorSha256',
]);
export const AUTHORITY_RECEIPT_KEYS = Object.freeze([
  'authorityGeneration',
  'authorityInstallationId',
  'authorityOrigin',
  'closed',
  'leaseSha256',
  'operationId',
  'outcome',
  'publicationLedgerSha256',
  'publicationEpoch',
  'publisherInstanceId',
  'schemaVersion',
  'signature',
  'signingKeyId',
  'vectorSha256',
]);
export const AUTHORITY_HEAD_KEYS = Object.freeze([
  'authorityGeneration',
  'authorityInstallationId',
  'authorityOrigin',
  'challenge',
  'expiresAt',
  'headSha256',
  'leaseSha256',
  'operationId',
  'outcome',
  'publicationEpoch',
  'publisherInstanceId',
  'schemaVersion',
  'signature',
  'signingKeyId',
  'status',
]);

const ID_PATTERN = /^[A-Za-z0-9._:-]{8,160}$/u;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/u;

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

export function normalizeAuthorityOrigin(value, { allowLoopbackHttp = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('authorityOrigin must be an absolute URL origin');
  }
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(url.hostname);
  if (
    url.protocol !== 'https:'
    && !(allowLoopbackHttp && url.protocol === 'http:' && loopback)
  ) {
    throw new Error('authorityOrigin must use HTTPS');
  }
  if (
    url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== '' && url.pathname !== '/')
    || url.origin !== value
  ) {
    throw new Error('authorityOrigin must be one canonical origin without path or credentials');
  }
  return url.origin;
}

function asEd25519PublicKey(publicKey) {
  const key = typeof publicKey === 'string' || Buffer.isBuffer(publicKey)
    ? createPublicKey(publicKey)
    : publicKey;
  if (key?.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
    throw new Error('publication authority public key must be Ed25519');
  }
  return key;
}

function asEd25519PrivateKey(privateKey) {
  const key = typeof privateKey === 'string' || Buffer.isBuffer(privateKey)
    ? createPrivateKey(privateKey)
    : privateKey;
  if (key?.type !== 'private' || key.asymmetricKeyType !== 'ed25519') {
    throw new Error('publication authority private key must be Ed25519');
  }
  return key;
}

export function publicationAuthoritySigningKeyId(publicKey) {
  const key = asEd25519PublicKey(publicKey);
  return sha256Hex(key.export({ type: 'spki', format: 'der' }));
}

function assertSignatureEncoding(signature, field) {
  if (!SIGNATURE_PATTERN.test(signature ?? '')) {
    throw new Error(`${field} must be an exact unpadded Ed25519 base64url signature`);
  }
  const decoded = Buffer.from(signature, 'base64url');
  if (decoded.byteLength !== 64 || decoded.toString('base64url') !== signature) {
    throw new Error(`${field} must be an exact unpadded Ed25519 base64url signature`);
  }
  return decoded;
}

function signEnvelope(domain, unsigned, privateKey) {
  return signValue(
    null,
    Buffer.concat([domain, Buffer.from(canonicalJcs(unsigned))]),
    asEd25519PrivateKey(privateKey),
  ).toString('base64url');
}

function verifyEnvelope(domain, signed, publicKey, field) {
  assertSignatureEncoding(signed.signature, `${field}.signature`);
  const key = asEd25519PublicKey(publicKey);
  if (signed.signingKeyId !== publicationAuthoritySigningKeyId(key)) {
    throw new Error(`${field} signing key id mismatch`);
  }
  const { signature, ...unsigned } = signed;
  const valid = verifySignature(
    null,
    Buffer.concat([domain, Buffer.from(canonicalJcs(unsigned))]),
    key,
    Buffer.from(signature, 'base64url'),
  );
  if (!valid) throw new Error(`${field} signature is invalid`);
  return signed;
}

function validateIdentifier(value, field) {
  if (!ID_PATTERN.test(value ?? '')) throw new Error(`invalid ${field}`);
}

function validateOperationBindings(value) {
  validateIdentifier(value.operationId, 'publication operationId');
  validateIdentifier(value.publisherInstanceId, 'publication publisherInstanceId');
}

function validateAuthorityBinding(value, {
  authorityInstallationId,
  authorityOrigin,
} = {}) {
  validateIdentifier(
    value.authorityInstallationId,
    'publication authorityInstallationId',
  );
  normalizeAuthorityOrigin(value.authorityOrigin, { allowLoopbackHttp: true });
  assertHexSha256(value.signingKeyId, 'signingKeyId');
  if (
    authorityInstallationId !== undefined
    && value.authorityInstallationId !== authorityInstallationId
  ) {
    throw new Error('publication authority installation mismatch');
  }
  if (
    authorityOrigin !== undefined
    && value.authorityOrigin !== normalizeAuthorityOrigin(authorityOrigin, {
      allowLoopbackHttp: true,
    })
  ) {
    throw new Error('publication authority origin mismatch');
  }
}

export function unsignedLease(lease) {
  const { signature: _signature, ...unsigned } = lease;
  return unsigned;
}

export function leaseSha256(lease) {
  return sha256Hex(canonicalJcs(lease));
}

export function validateLeasePackages(
  packages,
  field = 'publication lease',
  { packageNames = PROMOTION_PACKAGE_NAMES } = {},
) {
  const isLegacy = packageNames === LEGACY_PROMOTION_PACKAGE_NAMES;
  const namePattern = isLegacy ? LEGACY_NAME_PATTERN : TERMINAL_NAME_PATTERN;
  const admittedWidths = isLegacy
    ? [packageNames.length]
    : TERMINAL_LEASE_WIDTHS;
  if (!Array.isArray(packages) || !admittedWidths.includes(packages.length)) {
    throw new Error(
      `${field} must bind exactly ${admittedWidths.join(' or ')} packages`,
    );
  }
  const names = new Set();
  for (const [index, row] of packages.entries()) {
    requireExactKeys(row, LEASE_PACKAGE_KEYS, `${field} package ${index}`);
    if (!namePattern.test(row?.name ?? '')) {
      throw new Error(`invalid package name at index ${index}`);
    }
    if (names.has(row.name)) throw new Error(`duplicate package ${row.name}`);
    names.add(row.name);
    if (row.name !== packageNames[index]) {
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
  authorityInstallationId,
  authorityOrigin,
  candidateLedgerSha256,
  candidateTag,
  publisherInstanceId,
  priorDefaultClosureReceiptSha256,
  now = Date.now(),
}) {
  const isV4 = lease?.schemaVersion === 'snapback.authorized-publication-lease.v4';
  const isV3 = lease?.schemaVersion === 'snapback.authorized-publication-lease.v3';
  const isV2 = lease?.schemaVersion === 'snapback.authorized-publication-lease.v2';
  requireExactKeys(
    lease,
    isV3 || isV4 ? LEASE_KEYS : LEASE_V2_KEYS,
    'publication lease',
  );
  if (!isV2 && !isV3 && !isV4) {
    throw new Error('unsupported publication lease schema');
  }
  validateAuthorityBinding(lease, { authorityInstallationId, authorityOrigin });
  validateOperationBindings(lease);
  if (lease.publisherInstanceId !== publisherInstanceId) {
    throw new Error('publication lease publisher instance mismatch');
  }
  assertSafePositiveInteger(lease.publicationEpoch, 'publicationEpoch');
  assertHexSha256(lease.candidateLedgerSha256, 'candidateLedgerSha256');
  if (lease.candidateLedgerSha256 !== candidateLedgerSha256) {
    throw new Error('publication lease candidate ledger mismatch');
  }
  if (isV3 || isV4) {
    assertHexSha256(
      lease.priorDefaultClosureReceiptSha256,
      'priorDefaultClosureReceiptSha256',
    );
    if (
      priorDefaultClosureReceiptSha256 !== undefined
      && lease.priorDefaultClosureReceiptSha256
        !== priorDefaultClosureReceiptSha256
    ) {
      throw new Error('publication lease prior closure mismatch');
    }
  } else if (priorDefaultClosureReceiptSha256 !== undefined) {
    throw new Error('legacy publication lease does not bind a prior closure');
  }
  if (lease.candidateTag !== candidateTag || lease.defaultTag !== 'latest') {
    throw new Error('publication lease tag binding mismatch');
  }
  const issuedAt = parseTimestamp(lease.issuedAt, 'issuedAt');
  const expiresAt = parseTimestamp(lease.expiresAt, 'expiresAt');
  if (expiresAt <= issuedAt || expiresAt - issuedAt > 15 * 60_000) {
    throw new Error('publication lease lifetime must be in (0, 15 minutes]');
  }
  if (
    now !== null
    && (now < issuedAt - LEASE_ISSUED_AT_SKEW_ALLOWANCE_MS || now >= expiresAt)
  ) {
    throw new Error('publication lease is not current');
  }
  validateLeasePackages(lease.packages, 'publication lease', {
    packageNames: isV4
      ? PROMOTION_PACKAGE_NAMES
      : LEGACY_PROMOTION_PACKAGE_NAMES,
  });
  verifyEnvelope(
    isV4 ? LEASE_DOMAIN : (isV3 ? LEASE_DOMAIN_V3 : LEASE_DOMAIN_V2),
    lease,
    publicKey,
    'publication lease',
  );
  return lease;
}

export function signPublicationLease({ unsigned, privateKey }) {
  const isV4 = unsigned?.schemaVersion === 'snapback.authorized-publication-lease.v4';
  const isV3 = unsigned?.schemaVersion === 'snapback.authorized-publication-lease.v3';
  const isV2 = unsigned?.schemaVersion === 'snapback.authorized-publication-lease.v2';
  if (!isV2 && !isV3 && !isV4) {
    throw new Error('unsupported unsigned publication lease schema');
  }
  requireExactKeys(
    { ...unsigned, signature: '' },
    isV3 || isV4 ? LEASE_KEYS : LEASE_V2_KEYS,
    'unsigned publication lease',
  );
  validateAuthorityBinding(unsigned);
  const publicKey = createPublicKey(asEd25519PrivateKey(privateKey));
  if (unsigned.signingKeyId !== publicationAuthoritySigningKeyId(publicKey)) {
    throw new Error('unsigned publication lease signing key id mismatch');
  }
  return {
    ...unsigned,
    signature: signEnvelope(
      isV4 ? LEASE_DOMAIN : (isV3 ? LEASE_DOMAIN_V3 : LEASE_DOMAIN_V2),
      unsigned,
      privateKey,
    ),
  };
}

export function validatePublicationLeaseIssueRequest(request, expectedBinding = {}) {
  const isV4 =
    request?.schemaVersion === 'snapback.publication-lease-issue-request.v4';
  const isV3 =
    request?.schemaVersion === 'snapback.publication-lease-issue-request.v3';
  const isV2 =
    request?.schemaVersion === 'snapback.publication-lease-issue-request.v2';
  requireExactKeys(
    request,
    isV3 || isV4 ? ISSUE_REQUEST_KEYS : ISSUE_REQUEST_V2_KEYS,
    'publication lease issue request',
  );
  if (!isV2 && !isV3 && !isV4) {
    throw new Error('unsupported publication lease issue request schema');
  }
  validateAuthorityBinding(request, expectedBinding);
  validateOperationBindings(request);
  if (!Number.isSafeInteger(request.expectedPublicationEpoch)
      || request.expectedPublicationEpoch < 0) {
    throw new Error('expectedPublicationEpoch must be a non-negative safe integer');
  }
  if (request.expectedHeadSha256 !== null) {
    assertHexSha256(request.expectedHeadSha256, 'expectedHeadSha256');
  }
  assertHexSha256(request.candidateLedgerSha256, 'candidateLedgerSha256');
  if (isV3 || isV4) {
    assertHexSha256(
      request.priorDefaultClosureReceiptSha256,
      'priorDefaultClosureReceiptSha256',
    );
  }
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
  validateLeasePackages(request.packages, 'publication lease issue request', {
    packageNames: isV4
      ? PROMOTION_PACKAGE_NAMES
      : LEGACY_PROMOTION_PACKAGE_NAMES,
  });
  return request;
}

export function vectorFromLease(lease, side) {
  return Object.fromEntries(lease.packages.map((row) => [
    row.name,
    side === 'prior' ? row.expectedPriorVersion : row.newVersion,
  ]));
}

export function validatePublicationAuthorityTransition(transition, expectedBinding = {}) {
  requireExactKeys(
    transition,
    AUTHORITY_TRANSITION_KEYS,
    'publication authority transition',
  );
  if (transition.schemaVersion !== 'snapback.publication-authority-transition.v2') {
    throw new Error('unsupported publication authority transition schema');
  }
  validateAuthorityBinding(transition, expectedBinding);
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
    schemaVersion: 'snapback.publication-authority-transition.v2',
    authorityInstallationId: lease.authorityInstallationId,
    authorityOrigin: lease.authorityOrigin,
    signingKeyId: lease.signingKeyId,
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

function receiptTransition(receipt) {
  const transition = Object.fromEntries(
    AUTHORITY_TRANSITION_KEYS.map((key) => [key, receipt[key]]),
  );
  transition.schemaVersion = 'snapback.publication-authority-transition.v2';
  return transition;
}

export function validatePublicationAuthorityReceipt({
  receipt,
  transition = null,
  publicKey,
  authorityInstallationId,
  authorityOrigin,
}) {
  requireExactKeys(receipt, AUTHORITY_RECEIPT_KEYS, 'publication authority receipt');
  if (receipt.schemaVersion !== 'snapback.publication-authority-transition-receipt.v2') {
    throw new Error('unsupported publication authority receipt schema');
  }
  const retainedTransition = validatePublicationAuthorityTransition(
    receiptTransition(receipt),
    { authorityInstallationId, authorityOrigin },
  );
  assertSafePositiveInteger(receipt.authorityGeneration, 'authorityGeneration');
  if (receipt.closed !== (receipt.outcome !== 'acquired')) {
    throw new Error('publication authority transition receipt state mismatch');
  }
  verifyEnvelope(RECEIPT_DOMAIN, receipt, publicKey, 'publication authority receipt');
  if (transition !== null) {
    validatePublicationAuthorityTransition(transition, {
      authorityInstallationId,
      authorityOrigin,
    });
    for (const field of AUTHORITY_TRANSITION_KEYS.filter(
      (field) => field !== 'schemaVersion',
    )) {
      if (retainedTransition[field] !== transition[field]) {
        throw new Error(`publication authority transition receipt ${field} mismatch`);
      }
    }
  }
  return receipt;
}

export function createPublicationAuthorityReceipt({
  transition,
  authorityGeneration,
  privateKey,
}) {
  validatePublicationAuthorityTransition(transition);
  assertSafePositiveInteger(authorityGeneration, 'authorityGeneration');
  const unsigned = {
    schemaVersion: 'snapback.publication-authority-transition-receipt.v2',
    authorityInstallationId: transition.authorityInstallationId,
    authorityOrigin: transition.authorityOrigin,
    signingKeyId: transition.signingKeyId,
    authorityGeneration,
    operationId: transition.operationId,
    publicationEpoch: transition.publicationEpoch,
    publisherInstanceId: transition.publisherInstanceId,
    leaseSha256: transition.leaseSha256,
    outcome: transition.outcome,
    publicationLedgerSha256: transition.publicationLedgerSha256,
    vectorSha256: transition.vectorSha256,
    closed: transition.outcome !== 'acquired',
  };
  return {
    ...unsigned,
    signature: signEnvelope(RECEIPT_DOMAIN, unsigned, privateKey),
  };
}

export function publicationAuthorityHeadSha256(unsignedHead) {
  const {
    challenge: _challenge,
    headSha256: _headSha256,
    signature: _signature,
    schemaVersion: _schemaVersion,
    ...identity
  } = unsignedHead;
  return sha256Hex(canonicalJcs(identity));
}

export function signPublicationAuthorityHead({ unsigned, privateKey }) {
  requireExactKeys(
    { ...unsigned, signature: '' },
    AUTHORITY_HEAD_KEYS,
    'unsigned publication authority head',
  );
  return {
    ...unsigned,
    signature: signEnvelope(HEAD_DOMAIN, unsigned, privateKey),
  };
}

export function validatePublicationAuthorityHead({
  head,
  publicKey,
  authorityInstallationId,
  authorityOrigin,
  expectedChallenge,
}) {
  requireExactKeys(head, AUTHORITY_HEAD_KEYS, 'publication authority head');
  if (head.schemaVersion !== 'snapback.publication-authority-head.v3') {
    throw new Error('unsupported publication authority head schema');
  }
  validateAuthorityBinding(head, { authorityInstallationId, authorityOrigin });
  assertHexSha256(head.challenge, 'publication authority head challenge');
  if (
    expectedChallenge !== undefined
    && head.challenge !== expectedChallenge
  ) {
    throw new Error('publication authority head challenge mismatch');
  }
  if (!Number.isSafeInteger(head.authorityGeneration) || head.authorityGeneration < 0) {
    throw new Error('authorityGeneration must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(head.publicationEpoch) || head.publicationEpoch < 0) {
    throw new Error('publicationEpoch must be a non-negative safe integer');
  }
  if (head.status === 'empty') {
    if (
      head.authorityGeneration !== 0
      || head.publicationEpoch !== 0
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
  } else {
    if (!['issued', 'acquired', 'closed'].includes(head.status)) {
      throw new Error('publication authority head status is invalid');
    }
    validateOperationBindings(head);
    assertSafePositiveInteger(head.publicationEpoch, 'publicationEpoch');
    assertHexSha256(head.leaseSha256, 'leaseSha256');
    assertHexSha256(head.headSha256, 'headSha256');
    parseTimestamp(head.expiresAt, 'expiresAt');
    if (head.headSha256 !== publicationAuthorityHeadSha256(head)) {
      throw new Error('publication authority head digest mismatch');
    }
    if (
      (head.status === 'closed') !== (head.outcome !== null)
      || (head.outcome !== null && !['promoted', 'rolled-back'].includes(head.outcome))
    ) {
      throw new Error('publication authority head outcome is inconsistent');
    }
  }
  verifyEnvelope(HEAD_DOMAIN, head, publicKey, 'publication authority head');
  return head;
}
