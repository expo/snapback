import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  canonicalJson,
  sha256,
  validateMaturityRecordTree,
  validateTransitionRange,
} from '../scripts/capability-maturity.mjs';

const PAIR = ['bounded_children_v1', 'write_activity_v1'];
const INTRODUCED_ID = 'new_capability_v1';
const RECORD_ROOT = 'tests/acceptance/maturity';
const CLAIM_SCOPE = Object.freeze({
  files: Object.freeze([
    'guide/capabilities.md',
    'llp/0110-pair.spec.md',
    'packages/snapback-codegen/index.mjs',
    'packages/snapback-codegen/target-profiles.mjs',
    'schemas/capability.manifest.local-dev-sqlite-ibex.json',
    'schemas/capability.manifest.remote-service-sqlite-ibex.json',
    'tests/acceptance/capability-maturity.experimental.json',
    'tests/maturity-admission.txt',
  ]),
  roots: Object.freeze(['src']),
  schemaVersion: 'snapback.maturity-claim-scope.v1',
});

function runGit(root, args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: options.binary ? null : 'utf8',
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function write(root, path, bytes) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
}

function writeCanonical(root, path, value) {
  write(root, path, `${canonicalJson(value)}\n`);
}

function commit(root, dateUtc, message) {
  runGit(root, ['add', '-A']);
  runGit(root, ['commit', '-m', message], {
    env: {
      GIT_AUTHOR_DATE: `${dateUtc}T12:00:00Z`,
      GIT_COMMITTER_DATE: `${dateUtc}T12:00:00Z`,
    },
  });
  return runGit(root, ['rev-parse', 'HEAD']).trim();
}

function bytesAt(root, sourceSha, path) {
  return runGit(root, ['show', `${sourceSha}:${path}`], { binary: true });
}

function locator(root, path, sourceSha, schemaVersion = 'fixture.v1', producer = 'maturity-test') {
  return {
    path,
    producer,
    schemaVersion,
    sha256: sha256(bytesAt(root, sourceSha, path)),
    sourceSha,
  };
}

function indexTreeManifest(root, excludedPath) {
  const paths = runGit(root, ['ls-files', '-z']).split('\0').filter(Boolean);
  const entries = paths
    .filter((path) => path !== excludedPath)
    .map((path) => [path, sha256(runGit(root, ['show', `:${path}`], { binary: true }))])
    .sort((left, right) => Buffer.compare(Buffer.from(left[0]), Buffer.from(right[0])));
  return sha256(Buffer.from(canonicalJson(entries)));
}

function scaffoldRepository({ includeRegistryProjection = true, registeredStableIds = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'snapback-maturity-'));
  const experimentalIds = [...PAIR];
  runGit(root, ['init', '-q']);
  runGit(root, ['config', 'user.name', 'Maturity Test']);
  runGit(root, ['config', 'user.email', 'maturity-test@example.invalid']);
  write(root, 'src/manifest.rs', `experimental ${experimentalIds.join(' ')}\n`);
  write(root, 'packages/snapback-codegen/index.mjs', `experimental ${experimentalIds.join(' ')}\n`);
  if (includeRegistryProjection) {
    writeCanonical(
      root,
      'tests/acceptance/capability-registry.ids.json',
      [...experimentalIds, ...registeredStableIds].sort(),
    );
  }
  writeCanonical(root, 'tests/acceptance/capability-maturity.experimental.json', experimentalIds);
  writeCanonical(root, 'schemas/capability.manifest.local-dev-sqlite-ibex.json', {
    artifactKind: 'capabilityManifest',
    capabilityGaps: [],
    targetProfileId: 'local-dev-sqlite-ibex',
  });
  writeCanonical(root, 'schemas/capability.manifest.remote-service-sqlite-ibex.json', {
    artifactKind: 'capabilityManifest',
    capabilityGaps: experimentalIds,
    targetProfileId: 'remote-service-sqlite-ibex',
  });
  write(root, 'tests/maturity-admission.txt', 'experimental refusal\n');
  write(root, 'guide/capabilities.md', 'bounded pair experimental\n');
  write(root, 'llp/0110-pair.spec.md', 'Status: Implemented\n');
  write(root, 'llp/0115-board.plan.md', 'CV-8 experimental\n');
  write(root, 'packages/snapback-codegen/target-profiles.mjs', 'closed target profiles\n');
  write(root, 'src/local-relation-activity-publication.v1.json', '{"carrier":"verified"}\n');
  write(root, 'evidence/pre-cutoff.json', '{"status":"shipped"}\n');
  const initial = commit(root, '2025-12-31', 'initial experimental pair');
  return { root, initial };
}

function buildIntroductionFixture(
  root,
  candidate,
  { addToRegistry = true, addToExperimental = true, writeIntroductionRecord = true } = {},
) {
  const recordPath = `${RECORD_ROOT}/new-capability.introduction.json`;
  const registeredBefore = JSON.parse(readFileSync(
    join(root, 'tests/acceptance/capability-registry.ids.json'),
  ));
  const experimentalBefore = JSON.parse(readFileSync(
    join(root, 'tests/acceptance/capability-maturity.experimental.json'),
  ));
  write(root, 'src/manifest.rs', `experimental ${PAIR.join(' ')} ${INTRODUCED_ID}\n`);
  write(root, 'packages/snapback-codegen/index.mjs', `experimental ${PAIR.join(' ')} ${INTRODUCED_ID}\n`);
  writeCanonical(
    root,
    'tests/acceptance/capability-registry.ids.json',
    addToRegistry ? [...registeredBefore, INTRODUCED_ID].sort() : registeredBefore,
  );
  writeCanonical(
    root,
    'tests/acceptance/capability-maturity.experimental.json',
    addToExperimental ? [...experimentalBefore, INTRODUCED_ID].sort() : experimentalBefore,
  );
  write(root, 'tests/maturity-admission.txt', 'experimental introduction refusal\n');
  write(root, 'guide/capabilities.md', 'bounded pair and new capability experimental\n');
  write(root, 'llp/0140-new-capability.spec.md', 'Status: Implemented\n');
  write(root, 'llp/0115-board.plan.md', 'CV-8 new capability experimental\n');
  mkdirSync(join(root, RECORD_ROOT), { recursive: true });
  if (writeIntroductionRecord) {
    writeCanonical(root, recordPath, {
      candidateParentSha: candidate,
      candidateSourceSha: candidate,
      capabilityIds: [INTRODUCED_ID],
      fromMaturity: 'unregistered',
      governingLlp: 'llp/0140-new-capability.spec.md',
      introductionDate: '2026-01-01T12:00:00.000Z',
      recordingMode: 'same-commit.v1',
      route: 'default.v1',
      schemaVersion: 1,
      toMaturity: 'experimental',
    });
  }
  return {
    commit: commit(root, '2026-01-01', 'introduce new experimental capability'),
    recordPath,
  };
}

function buildPromotionAndDemotionFixture(root, initial, {
  fixtureSlug = 'pair',
  soakStart = '2026-01-01',
  registryCitation = true,
  promotedCapabilityIds = PAIR,
  corpusCapabilityIds = promotedCapabilityIds,
  corpusTargetProfileId = 'local-dev-sqlite-ibex',
  claimScope = CLAIM_SCOPE,
  candidateAuditScope = claimScope,
  advanceAfterCandidate = false,
  includeDemotion = true,
} = {}) {
  if (canonicalJson(promotedCapabilityIds) !== canonicalJson(PAIR)) {
    writeCanonical(root, 'schemas/capability.manifest.remote-service-sqlite-ibex.json', {
      artifactKind: 'capabilityManifest',
      capabilityGaps: [...PAIR, ...promotedCapabilityIds].sort(),
      targetProfileId: 'remote-service-sqlite-ibex',
    });
  }
  const soakStartMs = Date.parse(`${soakStart}T00:00:00Z`);
  const promotionDay = new Date(soakStartMs + 14 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const demotionDay = new Date(soakStartMs + 15 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const observationRefs = [];
  for (let offset = 0; offset < 14; offset += 1) {
    const date = new Date(soakStartMs + offset * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    const headSha = runGit(root, ['rev-parse', 'HEAD']).trim();
    const path = `${RECORD_ROOT}/${fixtureSlug}-${date}.soak-observation.json`;
    writeCanonical(root, path, {
      capabilityIds: promotedCapabilityIds,
      carrierDigests: [{
        path: 'src/local-relation-activity-publication.v1.json',
        sha256: sha256(bytesAt(root, headSha, 'src/local-relation-activity-publication.v1.json')),
      }],
      dateUtc: date,
      headSha,
      outcome: 'green',
      schemaVersion: 1,
      suiteProducer: 'relation-activity-publication-v1',
      targetProfileId: 'local-dev-sqlite-ibex',
    });
    const observationCommit = commit(root, date, `soak observation ${date}`);
    observationRefs.push(locator(root, path, observationCommit, 'soak-observation.v1'));
  }

  const evidencePaths = [
    `evidence/${fixtureSlug}-review.json`,
    `evidence/${fixtureSlug}-consumer.json`,
    `evidence/${fixtureSlug}-support.json`,
    `evidence/${fixtureSlug}-adjudication.json`,
  ];
  for (const path of evidencePaths) writeCanonical(root, path, { schemaVersion: 1, status: 'green' });
  const claimScopeSha256 = sha256(Buffer.from(canonicalJson(claimScope)));
  const corpusPath = `evidence/${fixtureSlug}-corpus.json`;
  writeCanonical(root, corpusPath, {
    capabilityIds: corpusCapabilityIds,
    claimScopeSha256,
    schemaVersion: 'snapback.maturity-own-corpus-run.v1',
    status: 'green',
    targetProfileId: corpusTargetProfileId,
  });
  const candidateAuditPath = `evidence/${fixtureSlug}-candidate-audit.json`;
  writeCanonical(root, candidateAuditPath, {
    capabilityIds: promotedCapabilityIds,
    claimScope: candidateAuditScope,
    refCheck: {
      command: './ref-check --verbose',
      scope: candidateAuditScope,
      status: 'green',
    },
    schemaVersion: 'snapback.maturity-claim-audit.v1',
    status: 'green',
  });
  const defectPath = `${RECORD_ROOT}/${fixtureSlug}.defect-search.json`;
  writeCanonical(root, defectPath, {
    capabilityIds: promotedCapabilityIds,
    findings: [],
    governingLlp: 'llp/0110-pair.spec.md',
    schemaVersion: 1,
    scopes: ['issues.v1', 'linear-exact-snapback.v1'],
    searchDateUtc: `${promotionDay}T00:00:00Z`,
  });
  const grandfatherPath = `${RECORD_ROOT}/inline-handler.grandfather.json`;
  const preCutoff = locator(root, 'evidence/pre-cutoff.json', initial);
  writeCanonical(root, grandfatherPath, {
    acceptanceSuiteRefs: [preCutoff],
    capabilityIds: ['inline_handler_v1'],
    cutoffDate: '2026-07-30',
    demoUseRefs: [preCutoff],
    governingContractBaseline: locator(root, 'llp/0110-pair.spec.md', initial, 'llp-blob.v1', 'git'),
    positivePredicateRefs: [preCutoff],
    preCutoffCommitRefs: [preCutoff],
    schemaVersion: 1,
  });
  const candidate = commit(root, promotionDay, `${fixtureSlug} candidate evidence complete`);
  const evidence = Object.fromEntries(evidencePaths.map((path) => [path, locator(root, path, candidate)]));
  const corpusRef = locator(root, corpusPath, candidate, 'capability-corpus-run.v1');
  const candidateAuditRef = locator(root, candidateAuditPath, candidate, 'claim-audit.v1');
  const defectRef = locator(root, defectPath, candidate, 'defect-search.v1');
  let candidateParent = candidate;
  if (advanceAfterCandidate) {
    write(root, 'README.md', `${fixtureSlug} unrelated advancement before promotion\n`);
    candidateParent = commit(root, promotionDay, `${fixtureSlug} advance beyond exact candidate pin`);
  }

  const promotionPath = `${RECORD_ROOT}/${fixtureSlug}.promotion.json`;
  const citation = registryCitation
    ? `// @ref LLP 0134#4-the-promotion-act — promoted ${promotionDay} via ${promotionPath}\n`
    : '';
  const experimentalBefore = JSON.parse(readFileSync(
    join(root, 'tests/acceptance/capability-maturity.experimental.json'),
  ));
  const experimentalAfter = experimentalBefore
    .filter((id) => !promotedCapabilityIds.includes(id));
  write(root, 'src/manifest.rs', `stable ${promotedCapabilityIds.join(' ')}\n${citation}`);
  write(root, 'packages/snapback-codegen/index.mjs', `stable ${promotedCapabilityIds.join(' ')}\n`);
  writeCanonical(root, 'tests/acceptance/capability-maturity.experimental.json', experimentalAfter);
  write(root, 'tests/maturity-admission.txt', 'stable acknowledgment no-op\n');
  write(root, 'guide/capabilities.md', 'bounded pair stable\n');
  write(root, 'llp/0110-pair.spec.md', 'Status: Implemented\nPromotion addendum\n');
  write(root, 'llp/0115-board.plan.md', 'CV-8 promoted\n');
  const stagedAuditPath = `evidence/${fixtureSlug}-promotion-tree-audit.json`;
  writeCanonical(root, stagedAuditPath, { schemaVersion: 1, status: 'green' });
  runGit(root, ['add', '-A']);
  const stagedAuditRef = {
    path: stagedAuditPath,
    producer: 'maturity-test',
    schemaVersion: 'claim-audit.v1',
    sha256: sha256(readFileSync(join(root, stagedAuditPath))),
    sourceSha: candidate,
  };
  const promotion = {
    authorAdjudication: {
      adjudicator: 'Charlie Cheever',
      date: `${promotionDay}T00:00:00Z`,
      provenanceRef: evidence[`evidence/${fixtureSlug}-adjudication.json`],
      record: 'fixture author act',
    },
    candidateParentSha: candidate,
    candidateSourceSha: candidate,
    capabilityIds: promotedCapabilityIds,
    claimAuditRefs: [candidateAuditRef, stagedAuditRef],
    claimScope,
    consumerArmRefs: [evidence[`evidence/${fixtureSlug}-consumer.json`]],
    corpusRunRefs: [corpusRef],
    fromMaturity: 'experimental',
    governingLlp: 'llp/0110-pair.spec.md',
    governingStatusAtPromotion: 'Implemented',
    promotionDate: `${promotionDay}T00:00:00Z`,
    reviewJournalRefs: [evidence[`evidence/${fixtureSlug}-review.json`]],
    route: 'default.v1',
    schemaVersion: 1,
    soakEvidence: {
      defectSearchRef: defectRef,
      observationRefs,
      window: {
        end: `${promotionDay}T00:00:00Z`,
        start: `${soakStart}T00:00:00Z`,
        targetPopulation: {
          hostedDeployments: [],
          localProfileIds: ['local-dev-sqlite-ibex'],
        },
      },
    },
    stagedTreeManifestSha256: indexTreeManifest(root, promotionPath),
    supportEvidenceRefs: [evidence[`evidence/${fixtureSlug}-support.json`]],
    toMaturity: 'stable',
  };
  writeCanonical(root, promotionPath, promotion);
  const promotionCommit = commit(root, promotionDay, `${fixtureSlug} promotion record`);

  if (!includeDemotion) {
    return {
      candidate,
      candidateParent,
      promotionCommit,
      promotionPath,
    };
  }

  const gateRegressionPath = `evidence/${fixtureSlug}-gate-regression.json`;
  writeCanonical(root, gateRegressionPath, { schemaVersion: 1, status: 'red' });
  const demotionCandidate = commit(root, demotionDay, `${fixtureSlug} witness gate regression`);
  const triggerRef = locator(root, gateRegressionPath, demotionCandidate);
  write(root, 'src/manifest.rs', 'experimental bounded_children_v1 write_activity_v1\n');
  write(root, 'packages/snapback-codegen/index.mjs', 'experimental bounded_children_v1 write_activity_v1\n');
  writeCanonical(
    root,
    'tests/acceptance/capability-maturity.experimental.json',
    [...experimentalAfter, ...promotedCapabilityIds].sort(),
  );
  write(root, 'tests/maturity-admission.txt', 'experimental refusal restored\n');
  write(root, 'guide/capabilities.md', 'bounded pair experimental after demotion\n');
  write(root, 'llp/0110-pair.spec.md', 'Status: Implemented\nPromotion addendum\nDemotion addendum\n');
  write(root, 'llp/0115-board.plan.md', 'CV-8 demoted\n');
  const demotionPath = `${RECORD_ROOT}/${fixtureSlug}.demotion.json`;
  writeCanonical(root, demotionPath, {
    authority: 'fast-path.v1',
    candidateParentSha: demotionCandidate,
    candidateSourceSha: demotionCandidate,
    capabilityIds: promotedCapabilityIds,
    demotionDate: `${demotionDay}T12:00:00Z`,
    fromMaturity: 'stable',
    notifiedAuthorDate: `${demotionDay}T12:00:00Z`,
    schemaVersion: 1,
    toMaturity: 'experimental',
    triggerEvidenceRefs: [triggerRef],
    triggerKind: 'gate-regression.v1',
    voidedReceiptRef: locator(root, promotionPath, promotionCommit, 'maturity-promotion.v1'),
  });
  const demotionCommit = commit(root, demotionDay, `${fixtureSlug} demotion`);
  return {
    candidate,
    candidateParent,
    demotionCandidate,
    demotionCommit,
    promotionCommit,
    promotionPath,
  };
}

// @ref LLP 0134#9-acceptance — one real registry capability family exercises
// daily soak evidence, promotion, staged-tree binding, and fast-path demotion.
test('real capability pair validates through soak, promotion, and demotion', () => {
  const { root, initial } = scaffoldRepository();
  try {
    const fixture = buildPromotionAndDemotionFixture(root, initial);
    const validation = validateMaturityRecordTree({
      repoRoot: root,
      recordRoot: join(root, RECORD_ROOT),
    });
    assert.equal(validation.records.filter((entry) => entry.suffix === '.soak-observation.json').length, 14);
    assert.deepEqual(
      validateTransitionRange({ repoRoot: root, range: `${fixture.candidate}..${fixture.promotionCommit}`, validation })
        .map((entry) => entry.direction),
      ['promotion'],
    );
    assert.deepEqual(
      validateTransitionRange({ repoRoot: root, range: `${fixture.demotionCandidate}..${fixture.demotionCommit}`, validation })
        .map((entry) => entry.direction),
      ['demotion'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// @ref LLP 0134#1-maturity-semantics-and-the-two-routes — registration at
// experimental is an introduction act, not a demotion from stable.
test('new experimental capability validates through a same-commit introduction record', () => {
  const { root, initial } = scaffoldRepository();
  try {
    const fixture = buildIntroductionFixture(root, initial);
    const validation = validateMaturityRecordTree({
      repoRoot: root,
      recordRoot: join(root, RECORD_ROOT),
    });
    assert.deepEqual(
      validateTransitionRange({ repoRoot: root, range: `${initial}..${fixture.commit}`, validation }),
      [{
        capabilityIds: [INTRODUCED_ID],
        commit: fixture.commit,
        direction: 'introduction',
        parent: initial,
        recordPath: fixture.recordPath,
      }],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the full registry history projection can establish its baseline without a transition', () => {
  const { root, initial } = scaffoldRepository({ includeRegistryProjection: false });
  try {
    writeCanonical(root, 'tests/acceptance/capability-registry.ids.json', PAIR);
    mkdirSync(join(root, RECORD_ROOT), { recursive: true });
    const baseline = commit(root, '2026-01-01', 'establish full registry projection');
    const validation = validateMaturityRecordTree({
      repoRoot: root,
      recordRoot: join(root, RECORD_ROOT),
    });
    assert.deepEqual(
      validateTransitionRange({ repoRoot: root, range: `${initial}..${baseline}`, validation }),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('historical introduction backfills are a closed set', () => {
  const { root } = scaffoldRepository();
  try {
    writeCanonical(root, `${RECORD_ROOT}/unapproved.introduction.json`, {
      backfillIssue: 'issues/closed/20260803-maturity-transition-records-missing.md',
      candidateParentSha: 'a'.repeat(40),
      candidateSourceSha: 'a'.repeat(40),
      capabilityIds: [INTRODUCED_ID],
      fromMaturity: 'unregistered',
      governingLlp: 'llp/0140-new-capability.spec.md',
      historicalTransitionCommit: 'b'.repeat(40),
      introductionDate: '2026-01-01T12:00:00.000Z',
      recordingMode: 'historical-backfill.v1',
      route: 'default.v1',
      schemaVersion: 1,
      toMaturity: 'experimental',
    });
    assert.throws(
      () => validateMaturityRecordTree({ repoRoot: root, recordRoot: join(root, RECORD_ROOT) }),
      /MATURITY_INTRODUCTION_BACKFILL_REFUSED/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a registered id cannot relabel demotion as introduction', () => {
  const { root, initial } = scaffoldRepository({ registeredStableIds: [INTRODUCED_ID] });
  try {
    const fixture = buildIntroductionFixture(root, initial, { addToRegistry: false });
    const validation = validateMaturityRecordTree({
      repoRoot: root,
      recordRoot: join(root, RECORD_ROOT),
    });
    assert.throws(
      () => validateTransitionRange({
        repoRoot: root,
        range: `${initial}..${fixture.commit}`,
        validation,
      }),
      /MATURITY_TRANSITION_RECORD_MISSING: .*\.demotion\.json/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a newly registered id cannot bypass the experimental default route', () => {
  const { root, initial } = scaffoldRepository();
  try {
    const fixture = buildIntroductionFixture(root, initial, {
      addToExperimental: false,
      writeIntroductionRecord: false,
    });
    const validation = validateMaturityRecordTree({
      repoRoot: root,
      recordRoot: join(root, RECORD_ROOT),
    });
    assert.throws(
      () => validateTransitionRange({
        repoRoot: root,
        range: `${initial}..${fixture.commit}`,
        validation,
      }),
      /MATURITY_REGISTRATION_NOT_EXPERIMENTAL/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('promotion source/parent equality and staged-tree pins fail closed independently', () => {
  const { root, initial } = scaffoldRepository();
  try {
    const fixture = buildPromotionAndDemotionFixture(root, initial);
    const path = join(root, fixture.promotionPath);
    const receipt = JSON.parse(readFileSync(path));
    const original = structuredClone(receipt);
    receipt.candidateParentSha = initial;
    writeCanonical(root, fixture.promotionPath, receipt);
    assert.throws(
      () => validateMaturityRecordTree({ repoRoot: root, recordRoot: join(root, RECORD_ROOT) }),
      /MATURITY_CANDIDATE_PIN_MISMATCH/,
    );

    original.stagedTreeManifestSha256 = '0'.repeat(64);
    writeCanonical(root, fixture.promotionPath, original);
    assert.throws(
      () => validateTransitionRange({
        repoRoot: root,
        range: `${fixture.candidate}..${fixture.promotionCommit}`,
        validation: validateMaturityRecordTree({ repoRoot: root, recordRoot: join(root, RECORD_ROOT) }),
      }),
      /MATURITY_STAGED_TREE_MISMATCH/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('A5 independently rejects a promotion whose equal pins are not the actual parent', () => {
  const { root, initial } = scaffoldRepository();
  try {
    const fixture = buildPromotionAndDemotionFixture(root, initial, {
      advanceAfterCandidate: true,
      includeDemotion: false,
    });
    const validation = validateMaturityRecordTree({
      repoRoot: root,
      recordRoot: join(root, RECORD_ROOT),
    });
    assert.throws(
      () => validateTransitionRange({
        repoRoot: root,
        range: `${fixture.candidate}..${fixture.promotionCommit}`,
        validation,
      }),
      /MATURITY_TRANSITION_PARENT_MISMATCH/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('E2 rejects a corpus receipt that is not scoped to the promoted capability set', () => {
  const { root, initial } = scaffoldRepository();
  try {
    buildPromotionAndDemotionFixture(root, initial, {
      corpusCapabilityIds: ['bounded_children_v1'],
    });
    assert.throws(
      () => validateMaturityRecordTree({ repoRoot: root, recordRoot: join(root, RECORD_ROOT) }),
      /MATURITY_CORPUS_SCOPE_INVALID/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('E2 rejects a target profile outside the closed codegen population', () => {
  const { root, initial } = scaffoldRepository();
  try {
    buildPromotionAndDemotionFixture(root, initial, {
      corpusTargetProfileId: 'bogus-profile',
    });
    assert.throws(
      () => validateMaturityRecordTree({ repoRoot: root, recordRoot: join(root, RECORD_ROOT) }),
      /MATURITY_TARGET_PROFILE_INVALID.*bogus-profile/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('E2 requires one own-corpus receipt for every supporting target profile', () => {
  const { root, initial } = scaffoldRepository();
  try {
    writeCanonical(root, 'schemas/capability.manifest.remote-service-sqlite-ibex.json', {
      artifactKind: 'capabilityManifest',
      capabilityGaps: [],
      targetProfileId: 'remote-service-sqlite-ibex',
    });
    buildPromotionAndDemotionFixture(root, initial);
    assert.throws(
      () => validateMaturityRecordTree({ repoRoot: root, recordRoot: join(root, RECORD_ROOT) }),
      /MATURITY_CORPUS_PROFILE_POPULATION_INVALID.*remote-service-sqlite-ibex/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('E4(a) rejects whole-repo or otherwise mismatched ref-check scope', () => {
  const { root, initial } = scaffoldRepository();
  try {
    buildPromotionAndDemotionFixture(root, initial, {
      candidateAuditScope: {
        files: [...CLAIM_SCOPE.files, 'unrelated/global.md'].sort(),
        roots: [...CLAIM_SCOPE.roots],
        schemaVersion: CLAIM_SCOPE.schemaVersion,
      },
    });
    assert.throws(
      () => validateMaturityRecordTree({ repoRoot: root, recordRoot: join(root, RECORD_ROOT) }),
      /MATURITY_CLAIM_AUDIT_SCOPE_INVALID/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('promotion registry citation binds the record path without a receipt digest cycle', () => {
  const { root, initial } = scaffoldRepository();
  try {
    const fixture = buildPromotionAndDemotionFixture(root, initial, { registryCitation: false });
    const validation = validateMaturityRecordTree({
      repoRoot: root,
      recordRoot: join(root, RECORD_ROOT),
    });
    assert.throws(
      () => validateTransitionRange({
        repoRoot: root,
        range: `${fixture.candidate}..${fixture.promotionCommit}`,
        validation,
      }),
      /MATURITY_PROMOTION_COMMENT_MISSING/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
