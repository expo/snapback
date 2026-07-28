import {
  PACKAGE_COUNT,
  PROMOTION_PACKAGE_NAMES,
  assertHexSha256,
  canonicalJcs,
  leaseSha256,
  parseTimestamp,
  publicationAuthorityTransition,
  requireExactKeys,
  sha256Hex,
  unsignedLease,
  validatePublicationAuthorityHead,
  validatePublicationAuthorityReceipt,
  validatePublicationLease,
  vectorFromLease,
} from '../packages/snapback-publication-authority/protocol.mjs';

export {
  canonicalJcs,
  leaseSha256,
  publicationAuthorityTransition,
  sha256Hex,
  unsignedLease,
  validatePublicationAuthorityHead,
  validatePublicationAuthorityReceipt,
  validatePublicationLease,
  vectorFromLease,
};

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

function vectorsEqual(left, right, names) {
  return names.every((name) => (left[name] ?? null) === (right[name] ?? null));
}

function changedNames(before, after, names) {
  return names.filter((name) => (before[name] ?? null) !== (after[name] ?? null));
}

function requireLeaseHead(head, lease, authorityPublicKey) {
  try {
    validatePublicationAuthorityHead({
      head,
      publicKey: authorityPublicKey,
      authorityInstallationId: lease.authorityInstallationId,
      authorityOrigin: lease.authorityOrigin,
    });
  } catch (cause) {
    throw new Error('external publication lease head drifted', { cause });
  }
  if (head.status !== 'acquired'
      || head.outcome !== null
      || head.operationId !== lease.operationId
      || head?.publicationEpoch !== lease.publicationEpoch
      || head.publisherInstanceId !== lease.publisherInstanceId
      || head.signingKeyId !== lease.signingKeyId
      || head.expiresAt !== lease.expiresAt
      || head.leaseSha256 !== leaseSha256(lease)) {
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
  authorityPublicKey,
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
      const beforeAuthorityTime = now();
      requireLeaseHead(beforeLeaseHead, lease, authorityPublicKey, beforeAuthorityTime);
      requireCurrentLease(lease, beforeAuthorityTime);
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
        const afterAuthorityTime = now();
        requireLeaseHead(afterLeaseHead, lease, authorityPublicKey, afterAuthorityTime);
        requireCurrentLease(lease, afterAuthorityTime);
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
        const beforeAuthorityTime = now();
        requireLeaseHead(beforeLeaseHead, lease, authorityPublicKey, beforeAuthorityTime);
        requireCurrentLease(lease, beforeAuthorityTime);
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
        const afterAuthorityTime = now();
        requireLeaseHead(afterLeaseHead, lease, authorityPublicKey, afterAuthorityTime);
        requireCurrentLease(lease, afterAuthorityTime);
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
