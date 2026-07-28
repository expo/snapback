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
  'preCloseAuthorityHead',
  'preCloseRegistryObservation',
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
const LATEST_ROOT_RECEIPT_KEYS = [
  'browserCaptureSha256',
  'browserDistributionSha256',
  'browserExecutableSha256',
  'browserPackageTreeSha256',
  'github',
  'latestRootResolution',
  'machine',
  'platform',
  'sha256',
];
const LATEST_ROOT_GITHUB_KEYS = [
  'artifactApiDigest',
  'artifactArchiveSha256',
  'artifactId',
  'artifactName',
  'collectedAt',
  'dispatchStartedAt',
  'operationId',
  'ref',
  'repository',
  'runAttempt',
  'runCreatedAt',
  'runHeadSha',
  'runId',
  'runStartedAt',
  'workflow',
  'workflowId',
  'workflowPath',
];
const LATEST_PROOF_PLAN_KEYS = [
  'collection',
  'darwinReceipt',
  'dispatchTimeoutMs',
  'expectedHeadSha',
  'helperSha256',
  'ledgerPath',
  'linuxReceipt',
  'operationId',
  'ref',
  'repository',
  'schemaVersion',
  'verifyTimeoutMs',
  'workflow',
];

function vectorsEqual(left, right, names) {
  return names.every((name) => (left[name] ?? null) === (right[name] ?? null));
}

function changedNames(before, after, names) {
  return names.filter((name) => (before[name] ?? null) !== (after[name] ?? null));
}

async function observeVector(readVector, names) {
  try {
    return { ok: true, value: await readVector(names), error: null };
  } catch (error) {
    return { ok: false, value: null, error: error.message };
  }
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

export function validatePreClosePublicationState({
  lease,
  authorityPublicKey,
  expectedVector,
  observedVector,
  head,
  now = Date.now(),
}) {
  const names = lease.packages.map((row) => row.name);
  if (!vectorsEqual(observedVector, expectedVector, names)) {
    throw new Error('default-tag vector drift after latest-root proof');
  }
  requireLeaseHead(head, lease, authorityPublicKey);
  requireCurrentLease(lease, now);
  return {
    head,
    vector: structuredClone(observedVector),
  };
}

export function validateClosedLatestProofPlan({
  plan,
  expectedOperationId,
  expectedHelperSha256,
  expectedLedgerPath,
  expectedHeadSha,
}) {
  requireExactKeys(plan, LATEST_PROOF_PLAN_KEYS, 'latest-root proof plan');
  if (
    plan.schemaVersion !== 'snapback.latest-root-proof-plan.v2'
    || plan.repository !== 'ccheever/snapback'
    || plan.workflow !== 'public-package-proof.yml'
    || plan.operationId !== expectedOperationId
    || plan.expectedHeadSha !== expectedHeadSha
    || plan.helperSha256 !== expectedHelperSha256
    || plan.ledgerPath !== expectedLedgerPath
    || !/^[A-Za-z0-9._/-]{1,200}$/u.test(plan.ref ?? '')
    || plan.ref.includes('..')
    || !/^[0-9a-f]{40}$/u.test(plan.expectedHeadSha ?? '')
    || !/^[0-9a-f]{64}$/u.test(plan.helperSha256 ?? '')
    || !Number.isSafeInteger(plan.dispatchTimeoutMs)
    || plan.dispatchTimeoutMs < 1_000
    || plan.dispatchTimeoutMs > 450_000
    || !Number.isSafeInteger(plan.verifyTimeoutMs)
    || plan.verifyTimeoutMs < 1_000
    || plan.verifyTimeoutMs > 30_000
    || plan.dispatchTimeoutMs + plan.verifyTimeoutMs > 8 * 60_000
  ) {
    throw new Error('latest-root proof plan is not the closed package-owned plan');
  }
  for (const field of ['ledgerPath', 'darwinReceipt', 'linuxReceipt', 'collection']) {
    const value = plan[field];
    if (
      typeof value !== 'string'
      || value.startsWith('/')
      || value.split('/').some((part) => part === '' || part === '..')
    ) {
      throw new Error(`latest-root proof plan ${field} must be normalized and relative`);
    }
  }
  return plan;
}

export function buildPostPromotionLedger({
  candidateLedger,
  lease,
  events,
  vector,
  latestRootReceipts,
  preCloseAuthorityHead,
  preCloseRegistryObservation,
}) {
  if (
    candidateLedger?.candidateLedgerSha256 !== lease.candidateLedgerSha256
    || !Array.isArray(candidateLedger.packages)
    || candidateLedger.packages.length !== PACKAGE_COUNT
    || !Array.isArray(events)
    || !Array.isArray(latestRootReceipts)
    || latestRootReceipts.length !== 2
    || preCloseAuthorityHead === null
    || typeof preCloseAuthorityHead !== 'object'
    || preCloseRegistryObservation === null
    || typeof preCloseRegistryObservation !== 'object'
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
    preCloseAuthorityHead: structuredClone(preCloseAuthorityHead),
    preCloseRegistryObservation: structuredClone(preCloseRegistryObservation),
  };
  ledger.postPromotionLedgerSha256 = sha256Hex(canonicalJcs(ledger));
  return validatePostPromotionLedger(ledger);
}

export function validatePostPromotionLatestRootReceipts(receipts, operationId) {
  if (!Array.isArray(receipts) || receipts.length !== 2) {
    throw new Error('post-promotion latest receipts are incomplete');
  }
  for (const [index, platform] of ['darwin-arm64', 'linux-x64'].entries()) {
    const receipt = receipts[index];
    requireExactKeys(receipt, LATEST_ROOT_RECEIPT_KEYS, `latest receipt ${index}`);
    requireExactKeys(receipt.github, LATEST_ROOT_GITHUB_KEYS, `latest receipt ${index} GitHub`);
    if (receipt?.platform !== platform) {
      throw new Error(`post-promotion latest receipt ${index} drifted`);
    }
    for (const field of [
      'sha256',
      'browserCaptureSha256',
      'browserDistributionSha256',
      'browserExecutableSha256',
      'browserPackageTreeSha256',
    ]) {
      assertHexSha256(receipt[field], `post-promotion latest receipt ${index}.${field}`);
    }
    assertHexSha256(
      receipt.github.artifactArchiveSha256,
      `post-promotion latest receipt ${index}.github.artifactArchiveSha256`,
    );
    const githubTimes = {};
    for (const field of [
      'dispatchStartedAt',
      'runCreatedAt',
      'runStartedAt',
      'collectedAt',
    ]) {
      githubTimes[field] = parseTimestamp(
        receipt.github[field],
        `latest receipt ${index}.github.${field}`,
      );
    }
    if (
      receipt.github.repository !== 'ccheever/snapback'
      || receipt.github.workflow !== 'public-package-proof.yml'
      || receipt.github.operationId !== operationId
      || receipt.github.artifactApiDigest
        !== `sha256:${receipt.github.artifactArchiveSha256}`
      || !Number.isSafeInteger(receipt.github.runId)
      || receipt.github.runId < 1
      || !Number.isSafeInteger(receipt.github.runAttempt)
      || receipt.github.runAttempt < 1
      || !Number.isSafeInteger(receipt.github.artifactId)
      || receipt.github.artifactId < 1
      || githubTimes.runCreatedAt < githubTimes.dispatchStartedAt - 5_000
      || githubTimes.runCreatedAt > githubTimes.dispatchStartedAt + 90_000
      || githubTimes.runStartedAt < githubTimes.runCreatedAt - 5_000
      || githubTimes.collectedAt < githubTimes.runStartedAt
      || githubTimes.collectedAt - githubTimes.dispatchStartedAt > 15 * 60_000
    ) {
      throw new Error(`post-promotion latest receipt ${index} GitHub evidence drifted`);
    }
  }
  const [darwinGithub, linuxGithub] = receipts.map((receipt) => receipt.github);
  for (const field of [
    'repository',
    'workflow',
    'workflowId',
    'workflowPath',
    'ref',
    'runId',
    'runAttempt',
    'runHeadSha',
    'operationId',
    'dispatchStartedAt',
    'runCreatedAt',
    'runStartedAt',
    'collectedAt',
  ]) {
    if (darwinGithub[field] !== linuxGithub[field]) {
      throw new Error(`post-promotion latest receipt GitHub ${field} diverged`);
    }
  }
  if (darwinGithub.artifactId === linuxGithub.artifactId) {
    throw new Error('post-promotion latest receipts reuse one GitHub artifact');
  }
  return receipts;
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
  requireExactKeys(
    ledger.preCloseRegistryObservation,
    ['observedAt', 'vector'],
    'pre-close registry observation',
  );
  parseTimestamp(
    ledger.preCloseRegistryObservation.observedAt,
    'pre-close registry observedAt',
  );
  if (
    canonicalJcs(ledger.preCloseRegistryObservation.vector)
      !== canonicalJcs(ledger.finalVector)
  ) {
    throw new Error('pre-close registry observation drifted');
  }
  if (
    ledger.preCloseAuthorityHead?.status !== 'acquired'
    || ledger.preCloseAuthorityHead?.outcome !== null
    || ledger.preCloseAuthorityHead?.operationId !== ledger.operationId
    || ledger.preCloseAuthorityHead?.publicationEpoch !== ledger.publicationEpoch
  ) {
    throw new Error('pre-close authority head drifted');
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
  validatePostPromotionLatestRootReceipts(
    ledger.latestRootReceipts,
    ledger.operationId,
  );
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
      const rollbackCheckpoint = structuredClone(rollbackExpected);
      const intendedNext = {
        ...rollbackCheckpoint,
        [row.name]: row.expectedPriorVersion,
      };
      let beforeLeaseHead = null;
      let before = null;
      let after = null;
      let mutationError = null;
      try {
        beforeLeaseHead = await readLeaseHead();
        const beforeAuthorityTime = now();
        requireLeaseHead(beforeLeaseHead, lease, authorityPublicKey, beforeAuthorityTime);
        requireCurrentLease(lease, beforeAuthorityTime);
        before = await readVector(names);
        if (!vectorsEqual(before, rollbackCheckpoint, names)
            || (before[row.name] ?? null) !== row.newVersion) {
          throw new Error(`rollback expected-value drift for ${row.name}`);
        }
        requireCurrentLease(lease, now());
        try {
          if (row.expectedPriorVersion === null) await removeTag(row.name);
          else await setTag(row.name, row.expectedPriorVersion);
        } catch (error) {
          mutationError = error;
        }
        // A command can apply remotely and then lose its response. Registry
        // truth, not the transport status, decides whether the reverse
        // checkpoint advanced.
        after = await readVector(names);
        const changedNow = changedNames(before, after, names);
        if (changedNow.length !== 1 || changedNow[0] !== row.name
            || !vectorsEqual(after, intendedNext, names)) {
          throw new Error(
            mutationError?.message ?? `rollback vector drift after ${row.name}`,
            { cause: mutationError ?? undefined },
          );
        }
        // Journal the observed reverse mutation before any later fallible
        // authority read, just as the forward path does.
        rollbackExpected = intendedNext;
        const afterLeaseHead = await readLeaseHead();
        const afterAuthorityTime = now();
        requireLeaseHead(afterLeaseHead, lease, authorityPublicKey, afterAuthorityTime);
        requireCurrentLease(lease, afterAuthorityTime);
        const event = {
          phase: 'rollback',
          package: row.name,
          ok: true,
          beforeLeaseHead,
          before,
          after,
          afterLeaseHead,
          commandReportedError: mutationError?.message ?? null,
        };
        rollback.push(event);
        emit(event);
      } catch (rollbackCause) {
        const observation = after === null
          ? await observeVector(readVector, names)
          : { ok: true, value: after, error: null };
        const reconciledChanges = (
          before !== null
          && observation.ok
          && observation.value !== null
          && typeof observation.value === 'object'
        )
          ? changedNames(before, observation.value, names)
          : [];
        const reconciledIntendedWrite = (
          reconciledChanges.length === 1
          && reconciledChanges[0] === row.name
          && vectorsEqual(observation.value, intendedNext, names)
        );
        if (reconciledIntendedWrite) {
          // The first post-write observation can fail after the registry
          // accepted the reverse mutation. One bounded retry may advance the
          // checkpoint only when it proves the exact intended full vector.
          rollbackExpected = intendedNext;
        }
        const event = {
          phase: 'rollback',
          package: row.name,
          ok: false,
          error: rollbackCause.message,
          beforeLeaseHead,
          before,
          commandReportedError: mutationError?.message ?? null,
          observed: observation.value,
          observationError: observation.error,
          checkpointAdvanced: vectorsEqual(
            rollbackExpected,
            intendedNext,
            names,
          ),
        };
        rollback.push(event);
        emit(event);
        // Otherwise keep the preceding checkpoint. Every earlier reverse step
        // will refuse unless the complete vector independently returns to it.
      }
    }
    const finalObservation = await observeVector(readVector, names);
    const error = new Error(cause.message, { cause });
    error.result = {
      ok: false,
      events,
      vector: finalObservation.value,
      vectorObservationError: finalObservation.error,
      rollback,
    };
    throw error;
  }
}
