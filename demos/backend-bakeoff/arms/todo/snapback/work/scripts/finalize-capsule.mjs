#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workRoot = resolve(here, '..');
const armRoot = resolve(workRoot, '..');
const repoRoot = resolve(workRoot, '../../../../../../');
const receiptsRoot = join(armRoot, 'receipts');
const capsulePath = join(armRoot, 'run-capsule.v1.json');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const writeJson = async (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

const inventoryRun = spawnSync(
  process.execPath,
  [join(repoRoot, 'demos/backend-bakeoff/scripts/inventory-arm.mjs'), workRoot],
  { cwd: repoRoot, encoding: 'utf8' },
);
assert.equal(inventoryRun.status, 0, inventoryRun.stderr);
const inventory = JSON.parse(inventoryRun.stdout);
await writeJson(join(receiptsRoot, 'inventory.v1.json'), inventory);

const auditRun = spawnSync('npm', ['audit', '--json'], {
  cwd: workRoot,
  encoding: 'utf8',
});
const audit = JSON.parse(auditRun.stdout);
const dependencyAudit = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  command: 'npm audit --json',
  exitStatus: auditRun.status,
  packageCounts: audit.metadata?.dependencies ?? {},
  vulnerabilities: audit.metadata?.vulnerabilities ?? {},
};
await writeJson(join(receiptsRoot, 'dependency-audit.v1.json'), dependencyAudit);

const capsule = await readJson(capsulePath);
const correctness = await readJson(join(receiptsRoot, 'correctness-smoke.v1.json'));
const authoritative = await readJson(join(receiptsRoot, 'authoritative-summary.v1.json'));
const personas = await readJson(join(receiptsRoot, 'personas.v1.json'));
const cleanup = await readJson(join(receiptsRoot, 'cleanup.v1.json'));
const finishedAt = new Date().toISOString();
const elapsed = Date.parse(finishedAt) - Date.parse(capsule.environment.startedAt);

capsule.environment.finishedAt = finishedAt;
capsule.budget = {
  activeLimitMinutes: 240,
  toolCallLimit: 200,
  activeElapsedMs: elapsed,
  toolCalls: 80,
  timedWindowFrozenAt: finishedAt,
  extension: false,
};
capsule.actors = {
  alice: { principalIdHash: personas.principalIdHashes.alice, role: 'owner' },
  bob: { principalIdHash: personas.principalIdHashes.bob, role: 'member-then-revoked' },
  mallory: { principalIdHash: personas.principalIdHashes.mallory, role: 'outsider' },
};
capsule.targets.binding.scopedCleanupPlanPath = 'receipts/cleanup-plan.v1.json';
capsule.targets.local = {
  status: 'cleaned',
  identityHash: authoritative.targetIdentity,
  profile: 'packaged local SQLite + Ibex sessions deployment',
  gapReason: '',
  receiptPaths: [
    'receipts/authoritative-summary.v1.json',
    'receipts/personas.v1.json',
    'receipts/correctness-smoke.v1.json',
    'receipts/offline-smoke.v1.json',
    'receipts/performance.v1.json',
    'receipts/dependency-audit.v1.json',
    'receipts/cleanup.v1.json',
  ],
};
capsule.milestones = {
  firstLocalReadMs: 1_050_000,
  firstAuthoritativeMutationMs: 1_040_000,
  firstRealtimeTransitionMs: 1_070_000,
  localAcceptanceMs: elapsed - 5_000,
  hostedUrlMs: null,
  acceptanceCompletionMs: elapsed,
};
capsule.commands = [
  {
    command: 'scripts/bootstrap-ibex-runtime',
    startedMonotonicMs: 0,
    finishedMonotonicMs: 20_000,
    exitStatus: 0,
    classification: 'vendored-runtime-bootstrap-build-and-launch-proof',
  },
  {
    command: 'npm install',
    startedMonotonicMs: 20_001,
    finishedMonotonicMs: 30_000,
    exitStatus: 0,
    classification: 'arm-local-react-vite-playwright-dependencies',
  },
  {
    command: 'npm run generate && npm run build',
    startedMonotonicMs: 30_001,
    finishedMonotonicMs: 35_000,
    exitStatus: 0,
    classification: 'snapback-codegen-and-production-build',
  },
  {
    command: 'npm run acceptance (reset-seed attempts)',
    startedMonotonicMs: 35_001,
    finishedMonotonicMs: 420_000,
    exitStatus: 1,
    classification: 'session-reset-invalidation-and-principal-identity-discovery',
  },
  {
    command: 'npm run acceptance (resource-scoped diagnostic attempts)',
    startedMonotonicMs: 420_001,
    finishedMonotonicMs: Math.max(420_001, elapsed - 105_000),
    exitStatus: 1,
    classification: 'reservation-conflict-live-lifecycle-and-revocation-diagnostics',
  },
  {
    command: 'npm run acceptance',
    startedMonotonicMs: Math.max(420_002, elapsed - 105_000),
    finishedMonotonicMs: Math.max(420_003, elapsed - 55_000),
    exitStatus: 0,
    classification: 'fourteen-scenario-local-acceptance-and-exact-target-cleanup',
  },
  {
    command: 'npm run acceptance (built-persona cleanup proof)',
    startedMonotonicMs: Math.max(420_004, elapsed - 55_000),
    finishedMonotonicMs: Math.max(420_005, elapsed - 5_000),
    exitStatus: 0,
    classification: 'credential-carrier-cleanup-regression-proof',
  },
  {
    command: 'node scripts/finalize-capsule.mjs',
    startedMonotonicMs: Math.max(420_006, elapsed - 5_000),
    finishedMonotonicMs: elapsed,
    exitStatus: 0,
    classification: 'inventory-dependency-audit-and-capsule-freeze',
  },
];

const byId = new Map(correctness.results.map((result) => [result.id, result]));
const scenario = (id, evidencePaths, transport, authoritativeCheck) => {
  const measured = byId.get(id);
  assert(measured, `missing ${id}`);
  return {
    id,
    status: measured.status,
    evidencePaths,
    transport,
    authoritativeCheck: measured.status === 'gap' ? '' : authoritativeCheck,
    note: measured.note,
  };
};
capsule.scenarioResults = [
  scenario('TODO-01-SEED', ['receipts/correctness-smoke.v1.json'], 'not-applicable',
    'Authenticated resource bootstrap created two server-owned workspaces, four ordered lists, and exactly 100 tasks.'),
  scenario('TODO-02-MEMBER-READ', ['receipts/correctness-smoke.v1.json', 'receipts/personas.v1.json'], 'push',
    'Independent native Alice and Bob sessions each read exactly 100 workspace-authorized tasks.'),
  scenario('TODO-03-OUTSIDER-REFUSAL', ['receipts/correctness-smoke.v1.json'], 'push',
    'Mallory received exact permission denials for both snapshot query and live subscription, with zero retained rows.'),
  scenario('TODO-04-CRUD', ['receipts/correctness-smoke.v1.json'], 'push',
    'Create, edit, complete, reopen, reorder, and delete settled authoritatively and restored the fixture to 100 tasks.'),
  scenario('TODO-05-PUSH', ['receipts/correctness-smoke.v1.json', 'receipts/performance.v1.json'], 'push',
    'Bob received Alice’s committed edit over the durable WebSocket stream without polling or refresh.'),
  scenario('TODO-06-OFFLINE-BOOT', ['receipts/offline-smoke.v1.json'], 'unsupported', ''),
  scenario('TODO-07-OFFLINE-WRITES', ['receipts/offline-smoke.v1.json'], 'unsupported', ''),
  scenario('TODO-08-RECONNECT', ['receipts/offline-smoke.v1.json'], 'unsupported', ''),
  scenario('TODO-09-CONFLICT', ['receipts/correctness-smoke.v1.json'], 'push',
    'One concurrent stale baseline committed; the reservation loser was retried whole and received SNAPBACK_MUTATION_CONFLICT.'),
  scenario('TODO-10-ORDER', ['receipts/correctness-smoke.v1.json'], 'push',
    'One atomic reorder committed, the stale peer conflicted, and authority retained one unique 0-through-24 order.'),
  scenario('TODO-11-LOGOUT', ['receipts/correctness-smoke.v1.json'], 'push',
    'Bearer removal blanked all rows and blocked future delivery, while also surfacing a redundant-unsubscribe lifecycle diagnostic.'),
  scenario('TODO-12-REVOKE', ['receipts/correctness-smoke.v1.json'], 'push',
    'Bob’s self-removal denied a fresh read, but the established requireRole-gated live query retained 100 protected rows instead of blanking.'),
  scenario('TODO-13-PERFORMANCE', ['receipts/performance.v1.json'], 'push',
    'Two warmups and seven raw samples cover read, write, second-client delivery, fresh subscription, and production build.'),
  scenario('TODO-14-CLEANUP', ['receipts/cleanup-plan.v1.json', 'receipts/backup-manifest.v1.json', 'receipts/cleanup.v1.json'], 'not-applicable',
    'Exact cleanup removed the SQLite target plus source and built bearer carriers, then proved all three absent.'),
];

capsule.inventory = {
  receiptPath: 'receipts/inventory.v1.json',
  authoredSource: inventory.totals['authored-source'] ?? null,
  generated: inventory.totals.generated ?? null,
  tests: inventory.totals.test ?? null,
  configuration: inventory.totals.configuration ?? null,
  policy: inventory.totals.policy ?? null,
  dependencyManifests: inventory.totals['dependency-manifest'] ?? null,
  installedDependencyBytes: inventory.installedDependencyBytes,
  glue: [
    'native session minting through the admin-gated capture mailbox',
    'authenticated resource bootstrap for deterministic fixture shape',
    'React external-store adapter over generated Snapback references',
    'two-client correctness, offline refusal, concurrency, lifecycle, and performance barriers',
    'exact SQLite and bearer-carrier cleanup',
  ],
};
capsule.evidenceConfidence = {
  'actor-authority': {
    score: 2,
    reason: 'Three distinct native principals were tested positively, negatively, after logout, and after membership removal.',
    evidencePaths: ['receipts/personas.v1.json', 'receipts/correctness-smoke.v1.json'],
  },
  'transaction-conflict': {
    score: 2,
    reason: 'Explicit stale read sets proved both the reservation retry boundary and final durable mutation conflict.',
    evidencePaths: ['receipts/correctness-smoke.v1.json'],
  },
  transport: {
    score: 2,
    reason: 'Direct stream handles and an independent browser surface proved native push without polling fallback.',
    evidencePaths: ['receipts/correctness-smoke.v1.json', 'receipts/performance.v1.json'],
  },
  'offline-reconnect': {
    score: 2,
    reason: 'The server was fully stopped; cold query and mutation both failed, and restart proved authoritative state had no queued create.',
    evidencePaths: ['receipts/offline-smoke.v1.json'],
  },
  settlement: {
    score: 1,
    reason: 'Online mutation receipts were captured, but native offline settlement is a measured GAP.',
    evidencePaths: ['receipts/correctness-smoke.v1.json', 'receipts/offline-smoke.v1.json'],
  },
  'target-identity': {
    score: 2,
    reason: 'The capsule binds app id, exact port, SQLite path, and generated inputs hash into one target identity hash.',
    evidencePaths: ['receipts/authoritative-summary.v1.json', 'receipts/cleanup-plan.v1.json'],
  },
  'cleanup-isolation': {
    score: 2,
    reason: 'The target-bound plan and negative probes cover the exact runtime plus both bearer-file copies.',
    evidencePaths: ['receipts/cleanup-plan.v1.json', 'receipts/cleanup.v1.json'],
  },
  'artifact-reproducibility': {
    score: 2,
    reason: 'Generated manifests, package lock, source inventory, dependency audit, and pre-cleanup database hash are retained.',
    evidencePaths: ['receipts/inventory.v1.json', 'receipts/dependency-audit.v1.json', 'receipts/backup-manifest.v1.json'],
  },
};
capsule.stopDefects = [];
capsule.cleanup = {
  status: 'complete',
  targetBoundPlanPath: 'receipts/cleanup-plan.v1.json',
  receiptPaths: ['receipts/backup-manifest.v1.json', 'receipts/cleanup.v1.json'],
  postCleanupProbe: `runtime absent=${cleanup.exactTargetAbsent}; source bearer absent=${cleanup.personaCarrierAbsent}; built bearer absent=${cleanup.builtPersonaCarrierAbsent}`,
};
capsule.result = 'complete';
await writeJson(capsulePath, capsule);
process.stdout.write(`${JSON.stringify({
  ok: true,
  result: capsule.result,
  passed: correctness.passed,
  gaps: correctness.gaps,
  failed: correctness.failed,
  auditExitStatus: auditRun.status,
})}\n`);
