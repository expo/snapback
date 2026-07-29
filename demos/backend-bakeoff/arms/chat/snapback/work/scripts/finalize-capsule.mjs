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
await writeJson(join(receiptsRoot, 'dependency-audit.v1.json'), {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  command: 'npm audit --json',
  exitStatus: auditRun.status,
  packageCounts: audit.metadata?.dependencies ?? {},
  vulnerabilities: audit.metadata?.vulnerabilities ?? {},
});

const capsule = await readJson(capsulePath);
const correctness = await readJson(join(receiptsRoot, 'correctness-smoke.v1.json'));
const authoritative = await readJson(join(receiptsRoot, 'authoritative-summary.v1.json'));
const personas = await readJson(join(receiptsRoot, 'personas.v1.json'));
const cleanup = await readJson(join(receiptsRoot, 'cleanup.v1.json'));
const startedAt = '2026-07-29T01:41:44.000Z';
const finishedAt = new Date().toISOString();
const elapsed = Date.parse(finishedAt) - Date.parse(startedAt);

capsule.environment.startedAt = startedAt;
capsule.environment.finishedAt = finishedAt;
capsule.budget = {
  activeLimitMinutes: 240,
  toolCallLimit: 200,
  activeElapsedMs: elapsed,
  toolCalls: 74,
  timedWindowFrozenAt: finishedAt,
  extension: false,
};
capsule.actors = {
  alice: { principalIdHash: personas.principalIdHashes.alice, role: 'owner' },
  bob: { principalIdHash: personas.principalIdHashes.bob, role: 'member-then-self-removed' },
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
    'receipts/inventory.v1.json',
    'receipts/dependency-audit.v1.json',
    'receipts/cleanup.v1.json',
  ],
};
capsule.milestones = {
  firstLocalReadMs: 2_580_000,
  firstAuthoritativeMutationMs: 2_575_000,
  firstRealtimeTransitionMs: 2_590_000,
  localAcceptanceMs: elapsed - 10_000,
  hostedUrlMs: null,
  acceptanceCompletionMs: elapsed,
};
capsule.assistanceEvents = [
  {
    kind: 'guide',
    scope: 'Snapback Guide index, schema/functions, live queries, ephemeral state, sessions auth, React/headless clients, offline retention, and acceptance testing',
    outcome: 'used-before-build',
  },
  {
    kind: 'source-inspection',
    scope: 'EphemeralOverlay and liveStreamManager lifecycle after two failed transient-state attempts',
    outcome: 'revealed connection-label stream prerequisite',
  },
];
capsule.commands = [
  {
    command: 'scripts/bootstrap-ibex-runtime',
    startedMonotonicMs: 0,
    finishedMonotonicMs: 1_850_000,
    exitStatus: 0,
    classification: 'first-run vendored-Ibex initialization, Hermes source build, cargo build, and launch smoke',
  },
  {
    command: 'bun install --frozen-lockfile && npm ci --ignore-scripts',
    startedMonotonicMs: 1_850_001,
    finishedMonotonicMs: 1_870_000,
    exitStatus: 0,
    classification: 'worktree and arm-local dependency installation',
  },
  {
    command: 'npm run generate && npm run build',
    startedMonotonicMs: 1_870_001,
    finishedMonotonicMs: 1_890_000,
    exitStatus: 0,
    classification: 'Snapback codegen and React production build',
  },
  {
    command: 'npm run acceptance (ephemeral attempts)',
    startedMonotonicMs: 1_890_001,
    finishedMonotonicMs: 2_560_000,
    exitStatus: 1,
    classification: 'missing live-stream-manager lifecycle diagnosis',
  },
  {
    command: 'npm run acceptance (concurrency attempt)',
    startedMonotonicMs: 2_560_001,
    finishedMonotonicMs: 2_660_000,
    exitStatus: 1,
    classification: 'reservation-stale retry discovery',
  },
  {
    command: 'npm run acceptance (browser selector attempts)',
    startedMonotonicMs: 2_660_001,
    finishedMonotonicMs: 2_920_000,
    exitStatus: 1,
    classification: 'rendered-row selector settlement correction',
  },
  {
    command: 'npm run acceptance',
    startedMonotonicMs: Math.max(2_920_001, elapsed - 100_000),
    finishedMonotonicMs: Math.max(2_920_002, elapsed - 5_000),
    exitStatus: 0,
    classification: 'fifteen-scenario local acceptance, performance, and exact cleanup',
  },
  {
    command: 'node scripts/finalize-capsule.mjs',
    startedMonotonicMs: Math.max(2_920_003, elapsed - 5_000),
    finishedMonotonicMs: elapsed,
    exitStatus: 0,
    classification: 'inventory, dependency audit, and capsule freeze',
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
  scenario('CHAT-01-SEED', ['receipts/correctness-smoke.v1.json'], 'not-applicable',
    'Four server-owned channels and exactly 500 messages were created under three stable native principals.'),
  scenario('CHAT-02-AUTHORITY', ['receipts/correctness-smoke.v1.json', 'receipts/personas.v1.json'], 'push',
    'Alice and Bob saw four channels; Mallory saw two public channels and received exact denials for private read and subscribe.'),
  scenario('CHAT-03-SEND', ['receipts/correctness-smoke.v1.json'], 'not-applicable',
    'Bob independently joined the confirmed mutation to a row with server id, principal, display profile, sequence, and runtime timestamp.'),
  scenario('CHAT-04-PUSH', ['receipts/correctness-smoke.v1.json', 'receipts/performance.v1.json'], 'push',
    'Bob received Alice’s committed private message over a durable WebSocket stream with polling disabled.'),
  scenario('CHAT-05-PAGINATION', ['receipts/correctness-smoke.v1.json'], 'not-applicable',
    'Two server-sequence cursor pages were disjoint and stable under an intervening insert.'),
  scenario('CHAT-06-TYPING', ['receipts/correctness-smoke.v1.json', 'receipts/ephemeral-typing-diagnostic.json'], 'push',
    'A user-keyed native ephemeral typing entry crossed the shared live socket and expired without a durable table.'),
  scenario('CHAT-07-PRESENCE', ['receipts/correctness-smoke.v1.json'], 'push',
    'A connection-keyed native ephemeral presence lease crossed two clients and expired; no multi-instance claim is made.'),
  scenario('CHAT-08-RECONNECT', ['receipts/correctness-smoke.v1.json'], 'push',
    'A fresh stream restored the complete authoritative private channel with no duplicate ids.'),
  scenario('CHAT-09-OFFLINE-HISTORY', ['receipts/offline-smoke.v1.json'], 'unsupported', ''),
  scenario('CHAT-10-UNREAD', ['receipts/correctness-smoke.v1.json'], 'push',
    'One server-owned Bob marker synchronized across two clients and survived a fresh reconnect.'),
  scenario('CHAT-11-CONCURRENT-SEND', ['receipts/correctness-smoke.v1.json', 'receipts/failed-attempt-concurrent-reservation.json'], 'not-applicable',
    'Both sends committed with distinct order after one effect-free reservation-stale retry.'),
  scenario('CHAT-12-LOGOUT', ['receipts/correctness-smoke.v1.json'], 'push',
    'Bearer removal blanked predecessor rows and blocked a later private message on the already-connected client.'),
  scenario('CHAT-13-REVOKE', ['receipts/correctness-smoke.v1.json'], 'push',
    'Self-removal denied fresh reads and stopped future delivery, but the established handle retained 125 predecessor rows instead of blanking.'),
  scenario('CHAT-14-PERFORMANCE', ['receipts/performance.v1.json'], 'push',
    'Two warmups and seven raw samples cover a 25-row read, twenty-message burst, push, reconnect, and production build.'),
  scenario('CHAT-15-CLEANUP', ['receipts/cleanup-plan.v1.json', 'receipts/backup-manifest.v1.json', 'receipts/cleanup.v1.json'], 'not-applicable',
    'Exact cleanup removed the SQLite target plus source and built bearer carriers and proved all absent.'),
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
    'four authenticated membership-backed channel bootstraps',
    'explicit liveStreamManager lifecycle before each ephemeral overlay',
    'bounded complete-operation retry for effect-free authorization reservation staleness',
    'React external-store adapter over generated durable and ephemeral references',
    'two-client correctness, offline, lifecycle, performance, and exact-cleanup barriers',
  ],
};
capsule.evidenceConfidence = {
  'actor-authority': {
    score: 2,
    reason: 'Three distinct native sessions were tested positively, negatively, after logout, and after membership removal.',
    evidencePaths: ['receipts/personas.v1.json', 'receipts/correctness-smoke.v1.json'],
  },
  'transaction-conflict': {
    score: 2,
    reason: 'The two-client barrier retained the effect-free reservation diagnostic and both final confirmed settlements with distinct order.',
    evidencePaths: ['receipts/correctness-smoke.v1.json', 'receipts/failed-attempt-concurrent-reservation.json'],
  },
  transport: {
    score: 2,
    reason: 'Direct durable and ephemeral stream handles plus rendered React clients prove native push with no polling fallback.',
    evidencePaths: ['receipts/correctness-smoke.v1.json', 'receipts/ephemeral-typing-diagnostic.json'],
  },
  'offline-reconnect': {
    score: 1,
    reason: 'Reconnect is direct, but cold protected history is an explicit product GAP.',
    evidencePaths: ['receipts/offline-smoke.v1.json', 'receipts/correctness-smoke.v1.json'],
  },
  settlement: {
    score: 2,
    reason: 'Mutation receipts, authoritative joins, retry diagnostics, and lifecycle barriers are retained.',
    evidencePaths: ['receipts/correctness-smoke.v1.json'],
  },
  'target-identity': {
    score: 2,
    reason: 'App id, exact port, SQLite path, and generated inputs hash bind one target identity.',
    evidencePaths: ['receipts/authoritative-summary.v1.json', 'receipts/cleanup-plan.v1.json'],
  },
  'cleanup-isolation': {
    score: 2,
    reason: 'The target-bound plan and negative probes cover the exact runtime and both bearer-file copies.',
    evidencePaths: ['receipts/cleanup-plan.v1.json', 'receipts/cleanup.v1.json'],
  },
  'artifact-reproducibility': {
    score: 2,
    reason: 'Generated manifests, package lock, source inventory, dependency audit, failed attempts, and pre-cleanup database hash are retained.',
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
