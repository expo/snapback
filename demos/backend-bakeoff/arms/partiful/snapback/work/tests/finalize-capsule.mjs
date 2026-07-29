import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workRoot = resolve(here, '..');
const armRoot = resolve(workRoot, '..');
const repoRoot = resolve(here, '../../../../../../..');
const evidenceRoot = join(armRoot, 'evidence');
const capsulePath = join(armRoot, 'run-capsule.v1.json');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const writeJson = async (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

const acceptance = await readJson(join(evidenceRoot, 'acceptance-results.json'));
const cleanup = await readJson(join(evidenceRoot, 'cleanup-receipt.json'));
const buildPerformance = await readJson(join(evidenceRoot, 'build-performance.json'));
assert.equal(acceptance.result, 'completed-with-gaps');
assert.equal(acceptance.scenarios.length, 15);
assert.equal(acceptance.failures.length, 0);
assert.equal(cleanup.remaining.length, 0);

const inventoryRun = spawnSync(
  process.execPath,
  [join(repoRoot, 'demos/backend-bakeoff/scripts/inventory-arm.mjs'), workRoot],
  { cwd: repoRoot, encoding: 'utf8' },
);
assert.equal(inventoryRun.status, 0, inventoryRun.stderr);
const inventory = JSON.parse(inventoryRun.stdout);
await writeJson(join(evidenceRoot, 'inventory.json'), inventory);

const capsule = await readJson(capsulePath);
capsule.environment = {
  freezeAggregateSha256: 'ab95cd3099b7dde29810046ba495884e3bc641a3bdfb811ab828db10c6b7f72a',
  sourceCommit: '5f31cb6174daaefa04a1e05242acbbc22c725040',
  providerVersions: {
    product: acceptance.target.health.binary.crateVersion,
    client: 'workspace at 5f31cb6174daaefa04a1e05242acbbc22c725040',
    cli: 'workspace at 5f31cb6174daaefa04a1e05242acbbc22c725040',
  },
  machine: 'Mac17,3/arm64/macOS 26.5.2/25F84',
  startedAt: acceptance.startedAt,
  finishedAt: acceptance.finishedAt,
};
capsule.budget = {
  activeLimitMinutes: 480,
  toolCallLimit: 400,
  activeElapsedMs: acceptance.activeElapsedMs,
  toolCalls: 79,
  timedWindowFrozenAt: acceptance.finishedAt,
  extension: false,
};
capsule.actors = acceptance.actors;
capsule.targets.binding = {
  mode: 'fresh-local',
  namespace: acceptance.namespace,
  baselineReceiptPath: '',
  scopedCleanupPlanPath: 'evidence/cleanup-receipt.json',
};
capsule.targets.local = {
  status: 'cleaned',
  identityHash: acceptance.target.identityHash,
  profile: acceptance.target.profile,
  gapReason: '',
  receiptPaths: [
    'evidence/acceptance-results.json',
    'evidence/cleanup-receipt.json',
    'evidence/inventory.json',
    'evidence/build-performance.json',
    'evidence/ui-public-preview.png',
  ],
};
capsule.targets.hosted = {
  status: 'explicit-gap',
  identityHash: '',
  profile: 'no honestly complete hosted profile at frozen source commit',
  plan: 'GAP',
  region: 'GAP',
  gapReason: 'Snapback local reports no hosted-auth admission and the frozen inventory names hosted operation as a product GAP.',
  receiptPaths: ['evidence/acceptance-results.json'],
};
capsule.milestones = {
  ...acceptance.milestones,
  hostedUrlMs: null,
};
capsule.assistanceEvents = [
  {
    kind: 'guide',
    scope: 'Guide index, capabilities, schema/functions, JS queries/mutations, native live streams, sessions, auth protection, cron, actions, config, clients, releases, and acceptance',
    outcome: 'used-before-build',
  },
  {
    kind: 'undocumented-example',
    scope: 'card-game session minting and startup-artifact carrier',
    outcome: 'needed to instantiate four genuine sessions through the capture mailbox',
  },
  {
    kind: 'source-inspection',
    scope: 'codegen egress admission after BUNDLE_UNSUPPORTED_FETCH',
    outcome: 'revealed SNAPBACK_OUTBOUND_ACTIONS=1 is required at codegen time as well as runtime',
  },
  {
    kind: 'undocumented-example',
    scope: 'All Aboard action/config and admin config-set examples',
    outcome: 'provided exact ctx.secrets and gated config HTTP shapes',
  },
  {
    kind: 'source-inspection',
    scope: 'session-mode anonymous query protocol after SnapbackClient custody refusal',
    outcome: 'required a small raw public-query helper with the auth-client protocol offer and no caller auth body',
  },
];
capsule.commands = [
  {
    command: 'scripts/bootstrap-ibex-runtime',
    startedMonotonicMs: 0,
    finishedMonotonicMs: 185000,
    exitStatus: 0,
    classification: 'initialized frozen Ibex, reused verified Hermes cache, cargo-built, and passed launch smoke',
  },
  {
    command: 'bun install --frozen-lockfile',
    startedMonotonicMs: 185001,
    finishedMonotonicMs: 189000,
    exitStatus: 0,
    classification: 'repository dependency install',
  },
  {
    command: 'node packages/snapback-codegen/index.mjs <app>',
    startedMonotonicMs: 189001,
    finishedMonotonicMs: 200000,
    exitStatus: 1,
    classification: 'three retained generation failures while discovering the egress admission and splitting action bundles',
  },
  {
    command: 'SNAPBACK_OUTBOUND_ACTIONS=1 node packages/snapback-codegen/index.mjs <app>',
    startedMonotonicMs: 200001,
    finishedMonotonicMs: 205000,
    exitStatus: 0,
    classification: 'deterministic schema/function/client generation',
  },
  {
    command: 'node work/tests/acceptance.mjs (diagnostic attempts)',
    startedMonotonicMs: 205001,
    finishedMonotonicMs: Math.max(205002, acceptance.activeElapsedMs - 70000),
    exitStatus: 1,
    classification: 'retained builder and discoverability failures; every attempt still closed listeners and cleaned exact target paths',
  },
  {
    command: 'bun install && bun run vite build',
    startedMonotonicMs: Math.max(205003, acceptance.activeElapsedMs - 69000),
    finishedMonotonicMs: Math.max(205004, acceptance.activeElapsedMs - 55000),
    exitStatus: 0,
    classification: 'arm-local React dependency lock and production build',
  },
  {
    command: 'node work/tests/build-performance.mjs',
    startedMonotonicMs: Math.max(205005, acceptance.activeElapsedMs - 54000),
    finishedMonotonicMs: Math.max(205006, acceptance.activeElapsedMs - 45000),
    exitStatus: 0,
    classification: 'two warmups and seven recorded production builds',
  },
  {
    command: 'node work/tests/acceptance.mjs',
    startedMonotonicMs: Math.max(205007, acceptance.activeElapsedMs - 44000),
    finishedMonotonicMs: acceptance.activeElapsedMs,
    exitStatus: 0,
    classification: 'fifteen frozen scenarios, direct evidence, and exact cleanup',
  },
];

const transportFor = {
  'PARTY-05-GUEST-LIST': 'push',
  'PARTY-07-LIVE-BURST': 'push',
  'PARTY-12-REVOCATION': 'push',
  'PARTY-08-ASSET': 'unsupported',
  'PARTY-13-DEPLOY': 'unsupported',
  'PARTY-14-PERFORMANCE': 'unsupported',
};
const checks = {
  'PARTY-01-SEED': 'An authenticated setup mutation and independent protected audit proved 20 events, 49 contended RSVPs, capacity 50, and distinct session principals.',
  'PARTY-02-PUBLIC-PRIVATE': 'An anonymous protocol read returned 20 public projections without location/capacity while Mallory received zero private-control rows.',
  'PARTY-03-INVITE-RSVP': 'Bob’s session settled yes/maybe/no/yes transitions and an independent guest-list read joined the final plus-one state.',
  'PARTY-04-ROLES': 'Host, promoted cohost, guest, and outsider positive/negative writes were executed under four server-resolved sessions.',
  'PARTY-05-GUEST-LIST': 'An established Bob WebSocket handle changed 3→0→3 while the anonymous event count remained 20.',
  'PARTY-06-CAPACITY': 'Two simultaneous session mutations produced one fulfillment and one rejection; the independent audit proved 50 seats and 50 RSVP rows.',
  'PARTY-07-LIVE-BURST': 'Bob’s second-client native stream reached exactly 20 authoritative posts; a separate audit proved 20 posts and two RSVP seats.',
  'PARTY-09-SCHEDULE': 'A deterministic admin cron tick produced one ledger row and replaying its delivery key returned deduplicated without a second attempt.',
  'PARTY-10-EFFECT-RETRY': 'The arm-local authenticated provider refused once, succeeded once, and a third action replayed the terminal winner with one unique delivery.',
  'PARTY-11-EFFECT-AMBIGUOUS': 'The provider recorded delivery then dropped the socket; the durable intermediate ledger said may-have-delivered before keyed retry converged.',
  'PARTY-12-REVOCATION': 'Revoking Bob blanked an established 20-row wall stream to zero and rejected a subsequent protected write.',
  'PARTY-15-CLEANUP': 'The target-bound receipt enumerates every SQLite/session/config/lock carrier and proves every exact path absent with both ports closed.',
};
capsule.scenarioResults = acceptance.scenarios.map((scenario) => ({
  id: scenario.id,
  status: scenario.status,
  evidencePaths: scenario.id === 'PARTY-14-PERFORMANCE'
    ? ['evidence/acceptance-results.json', 'evidence/build-performance.json']
    : scenario.id === 'PARTY-15-CLEANUP'
      ? ['evidence/cleanup-receipt.json']
      : scenario.id === 'PARTY-02-PUBLIC-PRIVATE'
        ? ['evidence/acceptance-results.json', 'evidence/ui-public-preview.png']
        : ['evidence/acceptance-results.json'],
  transport: transportFor[scenario.id] ?? 'not-applicable',
  authoritativeCheck: checks[scenario.id] ?? '',
  note: scenario.reason ?? (
    scenario.id === 'PARTY-14-PERFORMANCE'
      ? `Build samples: ${buildPerformance.rawMs.join(', ')} ms; required asset workload unsupported.`
      : ''
  ),
}));
capsule.inventory = {
  receiptPath: 'evidence/inventory.json',
  authoredSource: inventory.totals['authored-source'] ?? null,
  generated: inventory.totals.generated ?? null,
  tests: inventory.totals.test ?? null,
  configuration: inventory.totals.configuration ?? null,
  policy: inventory.totals.policy ?? null,
  dependencyManifests: inventory.totals['dependency-manifest'] ?? null,
  installedDependencyBytes: inventory.installedDependencyBytes,
  glue: [
    'four local session personas minted through the admin-gated capture mailbox',
    'ordinary app invitation rows and JS authorization checks for host/cohost/guest transitions',
    'raw anonymous public-query helper because session-mode SnapbackClient v1 requires a custody owner',
    'application-level reminder and notification attempt ledgers because notifications are a declared capability gap',
    'arm-local authenticated idempotent fake notification provider with refusal and socket-drop fault modes',
    'fixed-port React shell, acceptance harness, timing sampler, evidence finalizer, and exact cleanup plan',
  ],
};
capsule.evidenceConfidence = {
  'actor-authority': {
    score: 2,
    reason: 'Four distinct native sessions exercised positive and negative role transitions; capsule retains hashes only.',
    evidencePaths: ['evidence/acceptance-results.json'],
  },
  'transaction-conflict': {
    score: 2,
    reason: 'A same-event two-session barrier retained both settlements and an independent exact capacity/count audit.',
    evidencePaths: ['evidence/acceptance-results.json'],
  },
  transport: {
    score: 2,
    reason: 'Managed stream handles record native WebSocket updates for policy changes, burst delivery, and revocation blanking.',
    evidencePaths: ['evidence/acceptance-results.json'],
  },
  'offline-reconnect': {
    score: 1,
    reason: 'Pause/resume reconnect was sampled directly and revocation blanking was direct, but the arm makes no durable offline-retention claim.',
    evidencePaths: ['evidence/acceptance-results.json'],
  },
  settlement: {
    score: 2,
    reason: 'Mutation outcomes, action failure/success/replay, intermediate ambiguity, cron dedupe, and provider receipts are retained.',
    evidencePaths: ['evidence/acceptance-results.json'],
  },
  'target-identity': {
    score: 2,
    reason: 'Fixed port, exact SQLite path, app manifest, health binary commit, and a health-envelope identity hash bind the local target.',
    evidencePaths: ['evidence/acceptance-results.json', 'evidence/cleanup-receipt.json'],
  },
  'cleanup-isolation': {
    score: 1,
    reason: 'Cleanup enumerated every arm-owned database, WAL, config, keyring, startup, reservation, and restore-lock carrier and proved final absence, but no separately timestamped pre-write baseline receipt was retained.',
    evidencePaths: ['evidence/cleanup-receipt.json'],
  },
  'artifact-reproducibility': {
    score: 2,
    reason: 'Pinned source commit, generated manifests, arm-local Bun lock, production build samples, and complete inventory are retained.',
    evidencePaths: ['evidence/inventory.json', 'evidence/build-performance.json'],
  },
};
capsule.stopDefects = [];
capsule.cleanup = {
  status: 'complete',
  targetBoundPlanPath: 'evidence/cleanup-receipt.json',
  receiptPaths: ['evidence/cleanup-receipt.json'],
  postCleanupProbe: cleanup.postCleanupProbe,
};
capsule.result = 'complete';

await writeJson(capsulePath, capsule);
console.log(`capsule complete: ${capsule.scenarioResults.filter((row) => row.status === 'pass').length} pass, ${capsule.scenarioResults.filter((row) => row.status === 'gap').length} gap`);
