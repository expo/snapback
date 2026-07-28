import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from 'node:crypto';

const LEASE_DOMAIN = Buffer.from('snapback-authorized-publication-lease-v1\0');
const PACKAGE_COUNT = 9;
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
      const before = await readVector(names);
      if (!vectorsEqual(before, expected, names)) {
        throw new Error(`default-tag vector drift before ${row.name}`);
      }
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
      // if the command transport returned an ambiguous error. Record it before
      // the post-mutation lease read so rollback includes it.
      changed.push(row);
      const afterLeaseHead = await readLeaseHead();
      requireLeaseHead(afterLeaseHead, lease);
      expected = next;
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
    return { ok: true, events, vector: expected, rollback: [] };
  } catch (cause) {
    const rollback = [];
    let rollbackExpected = await readVector(names);
    for (const row of [...changed].reverse()) {
      try {
        const beforeLeaseHead = await readLeaseHead();
        requireLeaseHead(beforeLeaseHead, lease);
        const before = await readVector(names);
        if (!vectorsEqual(before, rollbackExpected, names)
            || (before[row.name] ?? null) !== row.newVersion) {
          throw new Error(`rollback expected-value drift for ${row.name}`);
        }
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
        // A later reverse step is legal only if its complete expected vector
        // still matches; retain the observation as the next expected vector.
        rollbackExpected = event.observed;
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
