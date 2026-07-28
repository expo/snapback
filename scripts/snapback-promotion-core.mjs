import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from 'node:crypto';

const LEASE_DOMAIN = Buffer.from('snapback-authorized-publication-lease-v1\0');
const PACKAGE_COUNT = 9;
const PROMOTION_PACKAGE_NAMES = [
  '@ccheever/snapback-runtime-darwin-arm64',
  '@ccheever/snapback-runtime-linux-x64',
  '@ccheever/snapback-contract',
  '@ccheever/snapback-client',
  '@ccheever/snapback-codegen',
  '@ccheever/snapback-vite',
  '@ccheever/snapback-react',
  '@ccheever/snapback-app-cli',
  '@ccheever/snapback-cli',
];
const LEASE_KEYS = [
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
];
const LEASE_PACKAGE_KEYS = ['expectedPriorVersion', 'name', 'newVersion'];
const AUTHORITY_TRANSITION_KEYS = [
  'leaseSha256',
  'operationId',
  'outcome',
  'publicationLedgerSha256',
  'publicationEpoch',
  'publisherInstanceId',
  'schemaVersion',
  'vectorSha256',
];
const AUTHORITY_RECEIPT_KEYS = [
  'closed',
  'leaseSha256',
  'operationId',
  'outcome',
  'publicationLedgerSha256',
  'publicationEpoch',
  'schemaVersion',
  'vectorSha256',
];
const POST_PROMOTION_LEDGER_KEYS = [
  'candidateTag',
  'defaultTag',
  'finalVector',
  'latestRootReceipts',
  'operationId',
  'packages',
  'postPromotionLedgerSha256',
  'previousLedgerSha256',
  'publicationEpoch',
  'publisherInstanceId',
  'schemaVersion',
  'tagEvents',
];
const POST_PROMOTION_PACKAGE_KEYS = [
  'candidateTarballSha256',
  'defaultTagVersion',
  'name',
  'registryIntegrity',
  'registryTarballSha256',
  'sourceName',
  'version',
];

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

function assertHexSha256(value, field) {
  if (!/^[0-9a-f]{64}$/.test(value ?? '')) throw new Error(`${field} must be lowercase sha256`);
}

function assertSafePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
}

function parseTimestamp(value, field) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value ?? '')) {
    throw new Error(`${field} must be canonical UTC milliseconds`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${field} is not canonical`);
  }
  return parsed;
}

function requireExactKeys(value, keys, field) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
      || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${field} has unknown or missing members`);
  }
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
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(lease.operationId ?? '')) {
    throw new Error('invalid publication operationId');
  }
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(lease.publisherInstanceId ?? '')) {
    throw new Error('invalid publication publisherInstanceId');
  }
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
  if (now < issuedAt || now >= expiresAt) throw new Error('publication lease is not current');
  if (!Array.isArray(lease.packages) || lease.packages.length !== PACKAGE_COUNT) {
    throw new Error(`publication lease must bind exactly ${PACKAGE_COUNT} packages`);
  }
  const names = new Set();
  for (const [index, row] of lease.packages.entries()) {
    requireExactKeys(row, LEASE_PACKAGE_KEYS, `publication lease package ${index}`);
    if (!/^@ccheever\/snapback-[a-z0-9-]+$/.test(row?.name ?? '')) {
      throw new Error(`invalid package name at index ${index}`);
    }
    if (names.has(row.name)) throw new Error(`duplicate package ${row.name}`);
    names.add(row.name);
    if (row.name !== PROMOTION_PACKAGE_NAMES[index]) {
      throw new Error(`publication lease package order/inventory drift at index ${index}`);
    }
    if (row.expectedPriorVersion !== null
        && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(row.expectedPriorVersion ?? '')) {
      throw new Error(`invalid expectedPriorVersion for ${row.name}`);
    }
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(row.newVersion ?? '')) {
      throw new Error(`invalid newVersion for ${row.name}`);
    }
  }
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

export function vectorFromLease(lease, side) {
  return Object.fromEntries(lease.packages.map((row) => [
    row.name,
    side === 'prior' ? row.expectedPriorVersion : row.newVersion,
  ]));
}

function vectorsEqual(left, right, names) {
  return names.every((name) => (left[name] ?? null) === (right[name] ?? null));
}

function changedNames(before, after, names) {
  return names.filter((name) => (before[name] ?? null) !== (after[name] ?? null));
}

function requireLeaseHead(head, lease) {
  if (head?.operationId !== lease.operationId
      || head?.publicationEpoch !== lease.publicationEpoch
      || head?.leaseSha256 !== leaseSha256(lease)) {
    throw new Error('external publication lease head drifted');
  }
}

function requireCurrentLease(lease, now) {
  const issuedAt = parseTimestamp(lease.issuedAt, 'issuedAt');
  const expiresAt = parseTimestamp(lease.expiresAt, 'expiresAt');
  if (now < issuedAt || now >= expiresAt) {
    throw new Error('publication lease expired during vector transition');
  }
}

export function publicationAuthorityTransition({
  lease,
  outcome,
  vector,
  publicationLedgerSha256 = null,
}) {
  if (!['acquired', 'promoted', 'rolled-back'].includes(outcome)) {
    throw new TypeError('unsupported publication authority transition outcome');
  }
  const vectorSha256 = sha256Hex(canonicalJcs(vector));
  if (outcome === 'promoted') {
    assertHexSha256(publicationLedgerSha256, 'publicationLedgerSha256');
  } else if (publicationLedgerSha256 !== null) {
    throw new TypeError('non-promoted authority transition cannot bind a publication ledger');
  }
  return {
    schemaVersion: 'snapback.publication-authority-transition.v1',
    operationId: lease.operationId,
    publicationEpoch: lease.publicationEpoch,
    publisherInstanceId: lease.publisherInstanceId,
    leaseSha256: leaseSha256(lease),
    outcome,
    publicationLedgerSha256,
    vectorSha256,
  };
}

export function validatePublicationAuthorityReceipt({
  receipt,
  transition,
}) {
  requireExactKeys(transition, AUTHORITY_TRANSITION_KEYS, 'publication authority transition');
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

export function buildPostPromotionLedger({
  candidateLedger,
  lease,
  events,
  vector,
  latestRootReceipts,
}) {
  if (
    candidateLedger?.candidateLedgerSha256 !== lease.candidateLedgerSha256
    || !Array.isArray(candidateLedger.packages)
    || candidateLedger.packages.length !== PACKAGE_COUNT
    || !Array.isArray(events)
    || !Array.isArray(latestRootReceipts)
    || latestRootReceipts.length !== 2
  ) {
    throw new TypeError('post-promotion ledger inputs are not closed');
  }
  const ledger = {
    schemaVersion: 'snapback.package-post-promotion-ledger.v1',
    previousLedgerSha256: candidateLedger.candidateLedgerSha256,
    operationId: lease.operationId,
    publicationEpoch: lease.publicationEpoch,
    publisherInstanceId: lease.publisherInstanceId,
    candidateTag: lease.candidateTag,
    defaultTag: lease.defaultTag,
    packages: candidateLedger.packages.map((row) => ({
      sourceName: row.sourceName,
      name: row.name,
      version: row.version,
      candidateTarballSha256: row.sha256,
      registryIntegrity: row.registryIntegrity,
      registryTarballSha256: row.registrySha256,
      defaultTagVersion: vector[row.name],
    })),
    tagEvents: structuredClone(events),
    finalVector: structuredClone(vector),
    latestRootReceipts: structuredClone(latestRootReceipts),
  };
  ledger.postPromotionLedgerSha256 = sha256Hex(canonicalJcs(ledger));
  return validatePostPromotionLedger(ledger);
}

export function validatePostPromotionLedger(ledger) {
  requireExactKeys(ledger, POST_PROMOTION_LEDGER_KEYS, 'post-promotion ledger');
  assertHexSha256(ledger.previousLedgerSha256, 'previousLedgerSha256');
  assertHexSha256(ledger.postPromotionLedgerSha256, 'postPromotionLedgerSha256');
  const { postPromotionLedgerSha256, ...withoutDigest } = ledger;
  if (postPromotionLedgerSha256 !== sha256Hex(canonicalJcs(withoutDigest))) {
    throw new Error('post-promotion ledger self-digest mismatch');
  }
  if (
    !Array.isArray(ledger.packages)
    || ledger.packages.length !== PACKAGE_COUNT
    || !Array.isArray(ledger.latestRootReceipts)
    || ledger.latestRootReceipts.length !== 2
    || !Array.isArray(ledger.tagEvents)
    || ledger.tagEvents.length !== PACKAGE_COUNT
  ) {
    throw new Error('post-promotion ledger closure is incomplete');
  }
  const packageNames = new Set();
  for (const [index, row] of ledger.packages.entries()) {
    requireExactKeys(row, POST_PROMOTION_PACKAGE_KEYS, `post-promotion package ${index}`);
    if (!PROMOTION_PACKAGE_NAMES.includes(row.name) || packageNames.has(row.name)) {
      throw new Error(`post-promotion package ${index} is invalid`);
    }
    packageNames.add(row.name);
    if (row.sourceName !== `@snapback/${row.name.slice('@ccheever/snapback-'.length)}`) {
      throw new Error(`post-promotion package ${index} source alias drifted`);
    }
    for (const field of ['candidateTarballSha256', 'registryTarballSha256']) {
      assertHexSha256(row[field], `post-promotion package ${index}.${field}`);
    }
    if (
      row.defaultTagVersion !== row.version
      || ledger.finalVector[row.name] !== row.version
      || typeof row.registryIntegrity !== 'string'
      || row.registryIntegrity.length < 16
    ) {
      throw new Error(`post-promotion package ${index} default tag drifted`);
    }
  }
  for (const [index, event] of ledger.tagEvents.entries()) {
    if (
      event?.phase !== 'promote'
      || event.package !== PROMOTION_PACKAGE_NAMES[index]
    ) {
      throw new Error(`post-promotion tag event ${index} drifted`);
    }
  }
  for (const [index, platform] of ['darwin-arm64', 'linux-x64'].entries()) {
    const receipt = ledger.latestRootReceipts[index];
    if (receipt?.platform !== platform) {
      throw new Error(`post-promotion latest receipt ${index} drifted`);
    }
    assertHexSha256(receipt.sha256, `post-promotion latest receipt ${index}.sha256`);
  }
  return ledger;
}

/**
 * Execute one complete dependency-first tag vector transition.
 *
 * The adapter methods are async so tests can model races precisely and the CLI
 * can re-read the official registry and external lease head around every
 * mutation.
 *
 * @ref LLP 0041#unreviewed-post-round-correction-publication-lease-and-rollback
 * — every mutation is full-vector expected-value guarded; rollback never
 * overwrites an independently advanced tag.
 */
export async function promoteDefaultVector({
  lease,
  readVector,
  readLeaseHead,
  setTag,
  removeTag,
  record = () => {},
  now = () => Date.now(),
  afterPromotion = async () => null,
}) {
  const names = lease.packages.map((row) => row.name);
  let expected = vectorFromLease(lease, 'prior');
  const changed = [];
  const events = [];
  const emit = (event) => {
    events.push(event);
    record(event);
  };

  try {
    for (const row of lease.packages) {
      const beforeLeaseHead = await readLeaseHead();
      requireLeaseHead(beforeLeaseHead, lease);
      requireCurrentLease(lease, now());
      const before = await readVector(names);
      if (!vectorsEqual(before, expected, names)) {
        throw new Error(`default-tag vector drift before ${row.name}`);
      }
      requireCurrentLease(lease, now());
      let mutationError = null;
      try {
        await setTag(row.name, row.newVersion);
      } catch (cause) {
        mutationError = cause;
      }
      const after = await readVector(names);
      const next = { ...expected, [row.name]: row.newVersion };
      const changedNow = changedNames(before, after, names);
      if (changedNow.length !== 1 || changedNow[0] !== row.name
          || !vectorsEqual(after, next, names)) {
        throw new Error(
          mutationError?.message ?? `default-tag vector drift after ${row.name}`,
          { cause: mutationError ?? undefined },
        );
      }
      // The official registry proves this operation's intended mutation even
      // if the command transport returned an ambiguous error. Journal both
      // the changed row and its proven next vector before either fallible
      // post-mutation authority check so rollback starts from registry truth.
      changed.push(row);
      expected = next;
      let afterLeaseHead = null;
      try {
        afterLeaseHead = await readLeaseHead();
        requireLeaseHead(afterLeaseHead, lease);
        requireCurrentLease(lease, now());
      } catch (postMutationAuthorityCause) {
        emit({
          phase: 'promote',
          package: row.name,
          beforeLeaseHead,
          before,
          after,
          afterLeaseHead,
          commandReportedError: mutationError?.message ?? null,
          postMutationAuthorityError: {
            code: 'SNAPBACK_PUBLICATION_POST_MUTATION_AUTHORITY_REFUSED',
            message: postMutationAuthorityCause.message,
          },
        });
        throw postMutationAuthorityCause;
      }
      emit({
        phase: 'promote',
        package: row.name,
        beforeLeaseHead,
        before,
        after,
        afterLeaseHead,
        commandReportedError: mutationError?.message ?? null,
      });
      if (mutationError) throw mutationError;
    }
    const finalization = await afterPromotion({
      vector: structuredClone(expected),
      events: structuredClone(events),
    });
    return {
      ok: true,
      events,
      vector: expected,
      rollback: [],
      finalization,
    };
  } catch (cause) {
    const rollback = [];
    // The last journaled expected vector, not a newly observed drifted vector,
    // is the only legal first rollback checkpoint.
    let rollbackExpected = structuredClone(expected);
    for (const row of [...changed].reverse()) {
      try {
        const beforeLeaseHead = await readLeaseHead();
        requireLeaseHead(beforeLeaseHead, lease);
        requireCurrentLease(lease, now());
        const before = await readVector(names);
        if (!vectorsEqual(before, rollbackExpected, names)
            || (before[row.name] ?? null) !== row.newVersion) {
          throw new Error(`rollback expected-value drift for ${row.name}`);
        }
        requireCurrentLease(lease, now());
        if (row.expectedPriorVersion === null) await removeTag(row.name);
        else await setTag(row.name, row.expectedPriorVersion);
        const after = await readVector(names);
        const next = { ...rollbackExpected, [row.name]: row.expectedPriorVersion };
        const changedNow = changedNames(before, after, names);
        if (changedNow.length !== 1 || changedNow[0] !== row.name
            || !vectorsEqual(after, next, names)) {
          throw new Error(`rollback vector drift after ${row.name}`);
        }
        const afterLeaseHead = await readLeaseHead();
        requireLeaseHead(afterLeaseHead, lease);
        requireCurrentLease(lease, now());
        rollbackExpected = next;
        const event = {
          phase: 'rollback',
          package: row.name,
          ok: true,
          beforeLeaseHead,
          before,
          after,
          afterLeaseHead,
        };
        rollback.push(event);
        emit(event);
      } catch (rollbackCause) {
        const event = {
          phase: 'rollback',
          package: row.name,
          ok: false,
          error: rollbackCause.message,
          observed: await readVector(names),
        };
        rollback.push(event);
        emit(event);
        // Keep the preceding checkpoint. Every earlier reverse step will now
        // refuse unless the complete vector independently returns to it.
      }
    }
    const error = new Error(cause.message, { cause });
    error.result = {
      ok: false,
      events,
      vector: await readVector(names),
      rollback,
    };
    throw error;
  }
}
