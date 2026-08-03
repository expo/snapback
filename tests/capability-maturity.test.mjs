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
  runGit(root, ['init', '-q']);
  runGit(root, ['config', 'user.name', 'Maturity Test']);
  runGit(root, ['config', 'user.email', 'maturity-test@example.invalid']);
  write(root, 'src/manifest.rs', 'experimental bounded_children_v1 write_activity_v1\n');
  write(root, 'packages/snapback-codegen/index.mjs', 'experimental bounded_children_v1 write_activity_v1\n');
  if (includeRegistryProjection) {
    writeCanonical(
      root,
      'tests/acceptance/capability-registry.ids.json',
      [...PAIR, ...registeredStableIds].sort(),
    );
  }
  writeCanonical(root, 'tests/acceptance/capability-maturity.experimental.json', PAIR);
  write(root, 'tests/maturity-admission.txt', 'experimental refusal\n');
  write(root, 'guide/capabilities.md', 'bounded pair experimental\n');
  write(root, 'llp/0110-pair.spec.md', 'Status: Implemented\n');
  write(root, 'llp/0115-board.plan.md', 'CV-8 experimental\n');
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

function buildPromotionAndDemotionFixture(root, initial, { registryCitation = true } = {}) {
  const observationRefs = [];
  for (let offset = 0; offset < 14; offset += 1) {
    const date = new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10);
    const headSha = runGit(root, ['rev-parse', 'HEAD']).trim();
    const path = `${RECORD_ROOT}/pair-${date}.soak-observation.json`;
    writeCanonical(root, path, {
      capabilityIds: PAIR,
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
    'evidence/review.json',
    'evidence/corpus.json',
    'evidence/candidate-audit.json',
    'evidence/consumer.json',
    'evidence/support.json',
    'evidence/adjudication.json',
  ];
  for (const path of evidencePaths) writeCanonical(root, path, { schemaVersion: 1, status: 'green' });
  const defectPath = `${RECORD_ROOT}/pair.defect-search.json`;
  writeCanonical(root, defectPath, {
    capabilityIds: PAIR,
    findings: [],
    governingLlp: 'llp/0110-pair.spec.md',
    schemaVersion: 1,
    scopes: ['issues.v1', 'linear-exact-snapback.v1'],
    searchDateUtc: '2026-01-15T00:00:00Z',
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
  const candidate = commit(root, '2026-01-15', 'candidate evidence complete');
  const evidence = Object.fromEntries(evidencePaths.map((path) => [path, locator(root, path, candidate)]));
  const defectRef = locator(root, defectPath, candidate, 'defect-search.v1');

  const promotionPath = `${RECORD_ROOT}/pair.promotion.json`;
  const citation = registryCitation
    ? `// @ref LLP 0134#4-the-promotion-act — promoted 2026-01-15 via ${promotionPath}\n`
    : '';
  write(root, 'src/manifest.rs', `stable bounded_children_v1 write_activity_v1\n${citation}`);
  write(root, 'packages/snapback-codegen/index.mjs', 'stable bounded_children_v1 write_activity_v1\n');
  writeCanonical(root, 'tests/acceptance/capability-maturity.experimental.json', []);
  write(root, 'tests/maturity-admission.txt', 'stable acknowledgment no-op\n');
  write(root, 'guide/capabilities.md', 'bounded pair stable\n');
  write(root, 'llp/0110-pair.spec.md', 'Status: Implemented\nPromotion addendum\n');
  write(root, 'llp/0115-board.plan.md', 'CV-8 promoted\n');
  const stagedAuditPath = 'evidence/promotion-tree-audit.json';
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
      date: '2026-01-15T00:00:00Z',
      provenanceRef: evidence['evidence/adjudication.json'],
      record: 'fixture author act',
    },
    candidateParentSha: candidate,
    candidateSourceSha: candidate,
    capabilityIds: PAIR,
    claimAuditRefs: [evidence['evidence/candidate-audit.json'], stagedAuditRef],
    consumerArmRefs: [evidence['evidence/consumer.json']],
    corpusRunRefs: [evidence['evidence/corpus.json']],
    fromMaturity: 'experimental',
    governingLlp: 'llp/0110-pair.spec.md',
    governingStatusAtPromotion: 'Implemented',
    promotionDate: '2026-01-15T00:00:00Z',
    reviewJournalRefs: [evidence['evidence/review.json']],
    route: 'default.v1',
    schemaVersion: 1,
    soakEvidence: {
      defectSearchRef: defectRef,
      observationRefs,
      window: {
        end: '2026-01-15T00:00:00Z',
        start: '2026-01-01T00:00:00Z',
        targetPopulation: {
          hostedDeployments: [],
          localProfileIds: ['local-dev-sqlite-ibex'],
        },
      },
    },
    stagedTreeManifestSha256: indexTreeManifest(root, promotionPath),
    supportEvidenceRefs: [evidence['evidence/support.json']],
    toMaturity: 'stable',
  };
  writeCanonical(root, promotionPath, promotion);
  const promotionCommit = commit(root, '2026-01-15', 'promote bounded pair');

  writeCanonical(root, 'evidence/gate-regression.json', { schemaVersion: 1, status: 'red' });
  const demotionCandidate = commit(root, '2026-01-16', 'witness gate regression');
  const triggerRef = locator(root, 'evidence/gate-regression.json', demotionCandidate);
  write(root, 'src/manifest.rs', 'experimental bounded_children_v1 write_activity_v1\n');
  write(root, 'packages/snapback-codegen/index.mjs', 'experimental bounded_children_v1 write_activity_v1\n');
  writeCanonical(root, 'tests/acceptance/capability-maturity.experimental.json', PAIR);
  write(root, 'tests/maturity-admission.txt', 'experimental refusal restored\n');
  write(root, 'guide/capabilities.md', 'bounded pair experimental after demotion\n');
  write(root, 'llp/0110-pair.spec.md', 'Status: Implemented\nPromotion addendum\nDemotion addendum\n');
  write(root, 'llp/0115-board.plan.md', 'CV-8 demoted\n');
  const demotionPath = `${RECORD_ROOT}/pair.demotion.json`;
  writeCanonical(root, demotionPath, {
    authority: 'fast-path.v1',
    candidateParentSha: demotionCandidate,
    candidateSourceSha: demotionCandidate,
    capabilityIds: PAIR,
    demotionDate: '2026-01-16T12:00:00Z',
    fromMaturity: 'stable',
    notifiedAuthorDate: '2026-01-16T12:00:00Z',
    schemaVersion: 1,
    toMaturity: 'experimental',
    triggerEvidenceRefs: [triggerRef],
    triggerKind: 'gate-regression.v1',
    voidedReceiptRef: locator(root, promotionPath, promotionCommit, 'maturity-promotion.v1'),
  });
  const demotionCommit = commit(root, '2026-01-16', 'demote bounded pair');
  return {
    candidate,
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

test('candidate and staged-tree pins fail closed', () => {
  const { root, initial } = scaffoldRepository();
  try {
    const fixture = buildPromotionAndDemotionFixture(root, initial);
    const path = join(root, fixture.promotionPath);
    const receipt = JSON.parse(readFileSync(path));
    receipt.candidateParentSha = initial;
    writeCanonical(root, fixture.promotionPath, receipt);
    assert.throws(
      () => validateMaturityRecordTree({ repoRoot: root, recordRoot: join(root, RECORD_ROOT) }),
      /MATURITY_CANDIDATE_PIN_MISMATCH/,
    );
    receipt.candidateParentSha = receipt.candidateSourceSha;
    receipt.stagedTreeManifestSha256 = '0'.repeat(64);
    writeCanonical(root, fixture.promotionPath, receipt);
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
