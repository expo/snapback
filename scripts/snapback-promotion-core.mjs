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
  'latestRootPropagationSha256',
  'latestRootResolution',
  'machine',
  'platform',
  'sha256',
];
const LATEST_ROOT_GITHUB_KEYS = [
  'authorizedLeaseSha256',
  'artifactApiDigest',
  'artifactArchiveSha256',
  'artifactId',
  'artifactName',
  'collectedAt',
  'dispatchStartedAt',
  'expectedPriorRootVersion',
  'operationId',
  'publicationEpoch',
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
  'authorizedLeaseSha256',
  'collection',
  'darwinReceipt',
  'dispatchTimeoutMs',
  'expectedHeadSha',
  'expectedPriorRootVersion',
  'helperSha256',
  'ledgerPath',
  'linuxReceipt',
  'operationId',
  'publicationEpoch',
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

function requireLeaseBudget(lease, now, requiredRemainingMs) {
  const expiresAt = parseTimestamp(lease.expiresAt, 'expiresAt');
  if (expiresAt - now < requiredRemainingMs) {
    throw new Error('publication lease lacks the reserved proof and rollback budget');
  }
}

/**
 * Wait until a fresh public install resolves the promoted CLI root and its
 * complete package closure, not merely until dist-tag metadata converges.
 *
 * npm serves package metadata through more than one cache path. A successful
 * dist-tag read therefore cannot by itself authorize the cross-host proof.
 * Every bounded probe is fenced on both sides by the complete promoted vector
 * and the exact acquired authority head. The caller reserves enough lease time
 * for the hosted proof and a reverse transition before starting another probe.
 *
 * @ref LLP 0041#nine-package-candidate-promotion--2026-07-28 — a final
 * `latest` proof may start only after a fresh root install resolves the exact
 * candidate closure.
 */
export async function waitForPromotedInstallability({
  lease,
  authorityPublicKey,
  expectedVector,
  readVector,
  readLeaseHead,
  observeInstallability,
  record = () => {},
  now = () => Date.now(),
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  attempts = 6,
  delayMs = 10_000,
  probeBoundMs = 45_000,
  requiredRemainingMs = 0,
}) {
  if (
    !Number.isSafeInteger(attempts)
    || attempts < 1
    || attempts > 12
    || !Number.isSafeInteger(delayMs)
    || delayMs < 0
    || delayMs > 60_000
    || !Number.isSafeInteger(probeBoundMs)
    || probeBoundMs < 1
    || probeBoundMs > 120_000
    || !Number.isSafeInteger(requiredRemainingMs)
    || requiredRemainingMs < 0
    || requiredRemainingMs > 15 * 60_000
  ) {
    throw new TypeError('promoted installability barrier bounds are invalid');
  }
  const names = lease.packages.map((row) => row.name);
  const cliRow = lease.packages.find((row) => row.name === '@ccheever/snapback-cli');
  if (!cliRow || !vectorsEqual(expectedVector, vectorFromLease(lease, 'new'), names)) {
    throw new TypeError('promoted installability barrier expected vector is invalid');
  }
  const evidence = {
    schemaVersion: 'snapback.promoted-installability-barrier.v1',
    status: 'running',
    package: cliRow.name,
    expectedVersion: cliRow.newVersion,
    requiredRemainingMs,
    probeBoundMs,
    attempts: [],
  };
  const retain = () => record(structuredClone(evidence));
  const fail = (cause) => {
    evidence.status = 'failed';
    evidence.completedAt = new Date(now()).toISOString();
    evidence.error = cause.message;
    retain();
    cause.publicLatestRootBarrier = structuredClone(evidence);
    throw cause;
  };

  try {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const startedAtMs = now();
      requireCurrentLease(lease, startedAtMs);
      requireLeaseBudget(
        lease,
        startedAtMs,
        requiredRemainingMs + probeBoundMs,
      );
      const beforeHead = await readLeaseHead();
      const beforeVector = await readVector(names);
      validatePreClosePublicationState({
        lease,
        authorityPublicKey,
        expectedVector,
        observedVector: beforeVector,
        head: beforeHead,
        now: now(),
      });
      requireLeaseBudget(
        lease,
        now(),
        requiredRemainingMs + probeBoundMs,
      );

      let observation;
      try {
        observation = await observeInstallability({
          attempt,
          expectedVector: structuredClone(expectedVector),
        });
      } catch (error) {
        observation = {
          ok: false,
          rootVersion: null,
          closure: null,
          error: error.message,
          retryablePriorRoot: false,
        };
      }
      if (
        observation === null
        || typeof observation !== 'object'
        || Array.isArray(observation)
        || typeof observation.ok !== 'boolean'
        || !Object.hasOwn(observation, 'rootVersion')
        || !Object.hasOwn(observation, 'closure')
        || !Object.hasOwn(observation, 'error')
        || typeof observation.retryablePriorRoot !== 'boolean'
        || ![null, cliRow.expectedPriorVersion, cliRow.newVersion]
          .includes(observation.rootVersion)
        || (observation.error !== null
          && (typeof observation.error !== 'string'
            || observation.error.length > 1_000))
      ) {
        throw new Error('public latest-root probe returned an invalid observation');
      }

      const afterHead = await readLeaseHead();
      const afterVector = await readVector(names);
      const completedAtMs = now();
      validatePreClosePublicationState({
        lease,
        authorityPublicKey,
        expectedVector,
        observedVector: afterVector,
        head: afterHead,
        now: completedAtMs,
      });
      const attemptEvidence = {
        attempt,
        startedAt: new Date(startedAtMs).toISOString(),
        completedAt: new Date(completedAtMs).toISOString(),
        beforeVectorSha256: sha256Hex(canonicalJcs(beforeVector)),
        afterVectorSha256: sha256Hex(canonicalJcs(afterVector)),
        beforeHeadSha256: beforeHead.headSha256,
        afterHeadSha256: afterHead.headSha256,
        publicationEpoch: beforeHead.publicationEpoch,
        observation: structuredClone(observation),
      };
      evidence.attempts.push(attemptEvidence);

      if (observation.ok) {
        if (
          observation.rootVersion !== cliRow.newVersion
          || observation.closure === null
          || observation.error !== null
          || observation.retryablePriorRoot
        ) {
          throw new Error('public latest-root probe accepted an incomplete closure');
        }
        requireLeaseBudget(lease, completedAtMs, requiredRemainingMs);
        evidence.status = 'passed';
        evidence.completedAt = new Date(completedAtMs).toISOString();
        evidence.resolution = structuredClone(observation.closure);
        retain();
        return evidence;
      }

      if (
        !observation.retryablePriorRoot
        || cliRow.expectedPriorVersion === cliRow.newVersion
        || observation.rootVersion !== cliRow.expectedPriorVersion
      ) {
        throw new Error(
          'public latest-root probe failed outside the retryable prior-root state',
        );
      }
      retain();
      if (attempt === attempts) {
        throw new Error(
          `public latest-root installability did not converge after ${attempts} attempts`,
        );
      }
      const beforeWaitMs = now();
      requireCurrentLease(lease, beforeWaitMs);
      requireLeaseBudget(
        lease,
        beforeWaitMs,
        requiredRemainingMs + delayMs + probeBoundMs,
      );
      await wait(delayMs);
    }
  } catch (error) {
    fail(error);
  }
  throw new Error('unreachable promoted installability barrier state');
}

export function validateClosedLatestProofPlan({
  plan,
  expectedOperationId,
  expectedHelperSha256,
  expectedLedgerPath,
  expectedHeadSha,
  expectedPriorRootVersion,
  expectedAuthorizedLeaseSha256,
  expectedPublicationEpoch,
}) {
  requireExactKeys(plan, LATEST_PROOF_PLAN_KEYS, 'latest-root proof plan');
  if (
    plan.schemaVersion !== 'snapback.latest-root-proof-plan.v3'
    || plan.repository !== 'ccheever/snapback'
    || plan.workflow !== 'public-package-proof.yml'
    || plan.operationId !== expectedOperationId
    || plan.authorizedLeaseSha256 !== expectedAuthorizedLeaseSha256
    || plan.publicationEpoch !== expectedPublicationEpoch
    || plan.expectedHeadSha !== expectedHeadSha
    || plan.expectedPriorRootVersion !== expectedPriorRootVersion
    || plan.helperSha256 !== expectedHelperSha256
    || plan.ledgerPath !== expectedLedgerPath
    || !/^[A-Za-z0-9._/-]{1,200}$/u.test(plan.ref ?? '')
    || plan.ref.includes('..')
    || !/^[0-9a-f]{40}$/u.test(plan.expectedHeadSha ?? '')
    || !/^[0-9a-f]{64}$/u.test(plan.helperSha256 ?? '')
    || !/^[0-9a-f]{64}$/u.test(plan.authorizedLeaseSha256 ?? '')
    || !Number.isSafeInteger(plan.publicationEpoch)
    || plan.publicationEpoch < 1
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(
      plan.expectedPriorRootVersion ?? '',
    )
    || !Number.isSafeInteger(plan.dispatchTimeoutMs)
    || plan.dispatchTimeoutMs < 1_000
    || plan.dispatchTimeoutMs > 560_000
    || !Number.isSafeInteger(plan.verifyTimeoutMs)
    || plan.verifyTimeoutMs < 1_000
    || plan.verifyTimeoutMs > 30_000
    || plan.dispatchTimeoutMs + plan.verifyTimeoutMs > 9.5 * 60_000
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

/**
 * Resolve the only exact internal version that a prior default-tag artifact
 * may name. A package already selected at its candidate version can arise
 * when npm assigns `latest` to a first-ever publication despite a non-default
 * publish tag. That artifact is already promoted and therefore binds the new
 * vector; every ordinary prior artifact remains bound to the prior vector.
 */
export function validatePriorDependencyAlias({
  lease,
  ownerName,
  dependency,
  target,
  version,
}) {
  const rows = new Map(lease.packages.map((row) => [row.name, row]));
  const owner = rows.get(ownerName);
  const targetRow = rows.get(target);
  const expectedSourceKey = target.replace(
    '@ccheever/snapback-',
    '@snapback/',
  );
  const ownerAlreadyAtCandidate = (
    owner?.expectedPriorVersion === owner?.newVersion
  );
  const selectedVersion = ownerAlreadyAtCandidate
    ? targetRow?.newVersion
    : targetRow?.expectedPriorVersion;
  if (
    dependency !== expectedSourceKey
    || owner === undefined
    || targetRow === undefined
    || selectedVersion === null
    || selectedVersion !== version
  ) {
    throw new Error(
      `prior ${ownerName} alias ${target}@${version} escapes the authorized vector`,
    );
  }
  return {
    sectionVector: ownerAlreadyAtCandidate ? 'new' : 'prior',
    selectedVersion,
  };
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
    schemaVersion: 'snapback.package-post-promotion-ledger.v2',
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
      'latestRootPropagationSha256',
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
      || !/^[0-9a-f]{64}$/u.test(receipt.github.authorizedLeaseSha256 ?? '')
      || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(
        receipt.github.expectedPriorRootVersion ?? '',
      )
      || !Number.isSafeInteger(receipt.github.publicationEpoch)
      || receipt.github.publicationEpoch < 1
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
    'authorizedLeaseSha256',
    'publicationEpoch',
    'expectedPriorRootVersion',
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
  if (ledger.schemaVersion !== 'snapback.package-post-promotion-ledger.v2') {
    throw new Error('unsupported post-promotion ledger schema');
  }
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
  if (
    ledger.latestRootReceipts.some((receipt) => (
      receipt.github.authorizedLeaseSha256
        !== ledger.preCloseAuthorityHead.leaseSha256
      || receipt.github.publicationEpoch !== ledger.publicationEpoch
    ))
  ) {
    throw new Error('post-promotion latest receipt authority binding drifted');
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
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  registryConvergenceAttempts = 12,
  registryConvergenceDelayMs = 2_500,
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
  const readConvergedVector = async ({ before, intended, label }) => {
    let observed = null;
    for (let attempt = 1; attempt <= registryConvergenceAttempts; attempt += 1) {
      requireCurrentLease(lease, now());
      // A refused observation proves nothing about the complete vector. Only
      // an observed preceding checkpoint permits another convergence read.
      try {
        observed = await readVector(names);
      } catch (error) {
        error.registryConvergenceAttempts = attempt;
        throw error;
      }
      if (vectorsEqual(observed, intended, names)) {
        requireCurrentLease(lease, now());
        return { vector: observed, attempts: attempt };
      }
      if (!vectorsEqual(observed, before, names)) {
        const error = new Error(`${label} observed unrelated default-tag drift`);
        error.registryConvergenceAttempts = attempt;
        throw error;
      }
      if (attempt < registryConvergenceAttempts) {
        await wait(registryConvergenceDelayMs);
      }
    }
    return { vector: observed, attempts: registryConvergenceAttempts };
  };

  try {
    let precedingForwardCheckpoint = null;
    for (const row of lease.packages) {
      const beforeLeaseHead = await readLeaseHead();
      const beforeAuthorityTime = now();
      requireLeaseHead(beforeLeaseHead, lease, authorityPublicKey, beforeAuthorityTime);
      requireCurrentLease(lease, beforeAuthorityTime);
      const beforeConvergence = precedingForwardCheckpoint === null
        ? { vector: await readVector(names), attempts: 1 }
        : await readConvergedVector({
          before: precedingForwardCheckpoint,
          intended: expected,
          label: `pre-promotion checkpoint for ${row.name}`,
        });
      const before = beforeConvergence.vector;
      if (!vectorsEqual(before, expected, names)) {
        throw new Error(`default-tag vector drift before ${row.name}`);
      }
      if (row.expectedPriorVersion === row.newVersion) {
        const noOpConvergence = precedingForwardCheckpoint === null
          ? { vector: await readVector(names), attempts: 1 }
          : await readConvergedVector({
            before: precedingForwardCheckpoint,
            intended: expected,
            label: `pre-promoted checkpoint for ${row.name}`,
          });
        const after = noOpConvergence.vector;
        if (!vectorsEqual(after, expected, names)) {
          throw new Error(`default-tag vector drift at pre-promoted ${row.name}`);
        }
        const afterLeaseHead = await readLeaseHead();
        const afterAuthorityTime = now();
        requireLeaseHead(afterLeaseHead, lease, authorityPublicKey, afterAuthorityTime);
        requireCurrentLease(lease, afterAuthorityTime);
        emit({
          phase: 'promote',
          package: row.name,
          beforeLeaseHead,
          before,
          after,
          afterLeaseHead,
          commandReportedError: null,
          alreadyAtNewVersion: true,
          preMutationRegistryConvergenceAttempts: beforeConvergence.attempts,
          registryConvergenceAttempts: noOpConvergence.attempts,
        });
        continue;
      }
      requireCurrentLease(lease, now());
      let mutationError = null;
      try {
        await setTag(row.name, row.newVersion);
      } catch (cause) {
        mutationError = cause;
      }
      const next = { ...expected, [row.name]: row.newVersion };
      const convergence = await readConvergedVector({
        before,
        intended: next,
        label: `promotion of ${row.name}`,
      });
      const after = convergence.vector;
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
      precedingForwardCheckpoint = before;
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
          preMutationRegistryConvergenceAttempts: beforeConvergence.attempts,
          registryConvergenceAttempts: convergence.attempts,
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
        preMutationRegistryConvergenceAttempts: beforeConvergence.attempts,
        registryConvergenceAttempts: convergence.attempts,
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
    let precedingRollbackCheckpoint = null;
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
      let mutationAttempted = false;
      let preMutationRegistryAttempts = null;
      let registryAttempts = null;
      try {
        beforeLeaseHead = await readLeaseHead();
        const beforeAuthorityTime = now();
        requireLeaseHead(beforeLeaseHead, lease, authorityPublicKey, beforeAuthorityTime);
        requireCurrentLease(lease, beforeAuthorityTime);
        let beforeConvergence;
        try {
          if (precedingRollbackCheckpoint === null) {
            let initialVector;
            try {
              initialVector = await readVector(names);
            } catch (error) {
              error.registryConvergenceAttempts = 1;
              throw error;
            }
            beforeConvergence = { vector: initialVector, attempts: 1 };
          } else {
            beforeConvergence = await readConvergedVector({
              before: precedingRollbackCheckpoint,
              intended: rollbackCheckpoint,
              label: `pre-rollback checkpoint for ${row.name}`,
            });
          }
        } catch (error) {
          preMutationRegistryAttempts =
            error.registryConvergenceAttempts ?? null;
          throw error;
        }
        before = beforeConvergence.vector;
        preMutationRegistryAttempts = beforeConvergence.attempts;
        if (!vectorsEqual(before, rollbackCheckpoint, names)
            || (before[row.name] ?? null) !== row.newVersion) {
          throw new Error(`rollback expected-value drift for ${row.name}`);
        }
        requireCurrentLease(lease, now());
        mutationAttempted = true;
        try {
          if (row.expectedPriorVersion === null) await removeTag(row.name);
          else await setTag(row.name, row.expectedPriorVersion);
        } catch (error) {
          mutationError = error;
        }
        // A command can apply remotely and then lose its response. Registry
        // truth, not the transport status, decides whether the reverse
        // checkpoint advanced.
        let convergence;
        try {
          convergence = await readConvergedVector({
            before,
            intended: intendedNext,
            label: `rollback of ${row.name}`,
          });
        } catch (error) {
          registryAttempts = error.registryConvergenceAttempts ?? null;
          throw error;
        }
        after = convergence.vector;
        registryAttempts = convergence.attempts;
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
        precedingRollbackCheckpoint = before;
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
          preMutationRegistryConvergenceAttempts: preMutationRegistryAttempts,
          registryConvergenceAttempts: registryAttempts,
        };
        rollback.push(event);
        emit(event);
      } catch (rollbackCause) {
        const reconciliationRegistryObservations = after === null ? 1 : 0;
        const observation = after === null
          ? await observeVector(readVector, names)
          : { ok: true, value: after, error: null };
        if (mutationAttempted && reconciliationRegistryObservations === 1) {
          registryAttempts = (registryAttempts ?? 0) + 1;
        }
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
          precedingRollbackCheckpoint = before;
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
          preMutationRegistryConvergenceAttempts: preMutationRegistryAttempts,
          registryConvergenceAttempts: registryAttempts,
          reconciliationRegistryObservations,
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
