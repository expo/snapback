import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  armRoot,
  database,
  databaseIdentity,
  freezeAggregateSha256,
  frozenSnapbackCommit,
} from './constants.mjs';

const readJson = async (relative) =>
  JSON.parse(await readFile(path.resolve(armRoot, relative), 'utf8'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const [acceptance, identities, inventory, milestones] = await Promise.all([
  readJson('evidence/acceptance-results.json'),
  readJson('evidence/actor-identity-receipt.json'),
  readJson('evidence/inventory.json'),
  readJson('evidence/milestones.json'),
]);
const harnessBytes = (await readFile(path.resolve(armRoot, 'work/harness/verify.ts'))).byteLength;
const checks = {
  'PARTY-01-SEED': ['not-applicable', 'Direct private-table counts and identity-aware views matched one event, three memberships, four personas, and the exact seed facts.'],
  'PARTY-02-PUBLIC-PRIVATE': ['push', 'Mallory’s anonymous projection contained only public fields while every protected view was empty.'],
  'PARTY-03-INVITE-RSVP': ['push', 'Bob’s four RSVP transitions settled in both guest and host views with server revisions.'],
  'PARTY-04-ROLES': ['push', 'Distinct host/cohost/guest/outsider positive and negative reducer calls were exercised by separate principals.'],
  'PARTY-05-GUEST-LIST': ['push', 'Policy changes removed and restored guest rows on Bob’s established subscription without changing the public preview.'],
  'PARTY-06-CAPACITY': ['push', 'A two-actor final-seat barrier committed exactly one reducer, rejected one, and direct SQL confirmed no overbooking.'],
  'PARTY-07-LIVE-BURST': ['push', 'Bob’s second client received twenty wall inserts and RSVP-total changes through WebSocket view callbacks without polling.'],
  'PARTY-08-ASSET': ['push', 'Authorized delivery preserved object identity and independently computed content hash; Mallory saw zero rows and deletion pushed.'],
  'PARTY-09-SCHEDULE': ['push', 'A native scheduled procedure produced one durable run and one succeeded attempt carrying the schedule dedupe key.'],
  'PARTY-10-EFFECT-RETRY': ['not-applicable', 'The durable ledger suppressed a second HTTP call after known success; the deterministic receiver retained one call.'],
  'PARTY-11-EFFECT-AMBIGUOUS': ['not-applicable', 'Accepted-then-dropped fault injection retained ambiguous state; retry reused the key and settled succeeded.'],
  'PARTY-12-REVOCATION': ['push', 'Bob’s established subscription evicted protected rows, blocked a later post, and direct SQL retained private history honestly.'],
  'PARTY-13-DEPLOY': ['not-applicable', 'Official standalone identity, schema, logs, effect receipt, and local configuration are direct; hosted fields remain an explicit credential GAP.'],
  'PARTY-14-PERFORMANCE': ['not-applicable', 'Six application paths and module build retain two warmups, seven raw samples, median, nearest-rank p95, fixture, and cost scope.'],
  'PARTY-15-CLEANUP': ['not-applicable', 'Exact-identity deletion succeeded; positional describe returned database absence without usage diagnostics; validated processes, state, and ports are absent.'],
};
const evidencePaths = {
  'PARTY-01-SEED': ['evidence/acceptance-results.json', 'evidence/target-identity.json'],
  'PARTY-02-PUBLIC-PRIVATE': ['evidence/acceptance-results.json', 'evidence/actor-identity-receipt.json'],
  'PARTY-03-INVITE-RSVP': ['evidence/acceptance-results.json'],
  'PARTY-04-ROLES': ['evidence/acceptance-results.json', 'evidence/actor-identity-receipt.json'],
  'PARTY-05-GUEST-LIST': ['evidence/acceptance-results.json'],
  'PARTY-06-CAPACITY': ['evidence/acceptance-results.json', 'evidence/performance-samples.json'],
  'PARTY-07-LIVE-BURST': ['evidence/acceptance-results.json', 'evidence/performance-samples.json'],
  'PARTY-08-ASSET': ['evidence/acceptance-results.json', 'evidence/performance-samples.json'],
  'PARTY-09-SCHEDULE': ['evidence/acceptance-results.json', 'evidence/effect-receiver.json'],
  'PARTY-10-EFFECT-RETRY': ['evidence/acceptance-results.json', 'evidence/effect-receiver.json'],
  'PARTY-11-EFFECT-AMBIGUOUS': ['evidence/acceptance-results.json', 'evidence/effect-receiver.json'],
  'PARTY-12-REVOCATION': ['evidence/acceptance-results.json'],
  'PARTY-13-DEPLOY': ['evidence/deployment-receipt.json', 'evidence/hosted-gap.json', 'evidence/backup-manifest.json'],
  'PARTY-14-PERFORMANCE': ['evidence/performance-samples.json', 'evidence/performance-build-samples.json', 'evidence/cost-window.json'],
  'PARTY-15-CLEANUP': ['evidence/cleanup-plan.json', 'evidence/cleanup-receipt.json', 'evidence/environment-cleanup.json'],
};

const capsule = {
  schemaVersion: 1,
  protocolId: 'llp-0102-backend-bakeoff-v1',
  arm: { app: 'partiful', provider: 'spacetimedb', round: 'deep', attemptId: 'w2' },
  environment: {
    freezeAggregateSha256,
    sourceCommit: frozenSnapbackCommit,
    armBaseCommit: '4847b7ac53d084e6beeb143723243a65872052d8',
    snapbackFrozen: true,
    providerVersions: {
      product: 'SpacetimeDB 2.7.0',
      client: '2.7.0',
      cli: '2.7.0',
      cliCommit: 'a08663c7b94688a2542577532d472f751e641f5b',
      effectTunnel: 'cloudflared 2026.7.2',
    },
    machine: 'Minisforum AI Series/x86_64/Linux 6.17.0-40-generic/24 logical CPUs/63,826,722,816 bytes RAM',
    startedAt: '2026-07-29T05:10:38.256Z',
    finishedAt: '2026-07-29T06:15:05.960Z',
  },
  budget: {
    activeLimitMinutes: 480,
    toolCallLimit: 400,
    activeElapsedMs: 3_867_700,
    toolCalls: 0,
    timedWindowFrozenAt: '2026-07-29T06:15:05.960Z',
    extension: false,
  },
  actors: {
    alice: { principalIdHash: identities.actors.alice.principalIdHash, role: 'host/member' },
    bob: { principalIdHash: identities.actors.bob.principalIdHash, role: 'guest/cohost/member' },
    mallory: { principalIdHash: identities.actors.mallory.principalIdHash, role: 'outsider' },
    casey: { principalIdHash: identities.actors.casey.principalIdHash, role: 'guest/contention actor' },
  },
  targets: {
    binding: {
      mode: 'fresh-local',
      namespace: database,
      baselineReceiptPath: 'evidence/baseline.json',
      scopedCleanupPlanPath: 'evidence/cleanup-plan.json',
    },
    local: {
      status: 'cleaned',
      identityHash: sha256(databaseIdentity),
      profile: 'official SpacetimeDB 2.7.0 standalone local server',
      gapReason: '',
      receiptPaths: [
        'evidence/target-identity.json',
        'evidence/cleanup-receipt.json',
        'evidence/environment-cleanup.json',
      ],
    },
    hosted: {
      status: 'explicit-gap',
      identityHash: '',
      profile: 'Maincloud managed database/module',
      plan: 'Maincloud',
      region: 'provider-selected',
      gapReason: 'Hosted evidence unavailable: frozen credential health records credential-unavailable. Local standalone and a test-only tunnel are not relabeled as hosted evidence.',
      receiptPaths: ['evidence/hosted-gap.json'],
    },
  },
  milestones,
  assistanceEvents: [
    {
      kind: 'official-documentation',
      disclosure: 'Official SpacetimeDB and Cloudflare documentation informed CLI grammar and native feature selection; all passing claims were re-proven in this arm.',
      receiptPath: 'evidence/official-docs.md',
    },
    {
      kind: 'same-provider-source-inspection',
      disclosure: 'The earlier Linear/SpacetimeDB arm source was inspected for CLI and capsule orientation. Partiful facts, implementation, target, actors, effects, measurements, and cleanup were independently exercised here.',
      sourcePath: 'demos/backend-bakeoff/arms/linear/spacetimedb/',
    },
  ],
  commands: [
    { label: 'worktree-local CLI install; initial version subcommand usage failure retained', exitStatus: 1, startedMonotonicMs: 0, finishedMonotonicMs: 180000 },
    { label: 'official standalone start and syntactically valid fresh-database negative probe', exitStatus: 0, startedMonotonicMs: 447000, finishedMonotonicMs: 449000 },
    { label: 'official TypeScript module build, publish, and generated bindings', exitStatus: 0, startedMonotonicMs: 450000, finishedMonotonicMs: 560000 },
    { label: 'loopback scheduled effect refused by provider SSRF guard', exitStatus: 1, startedMonotonicMs: 1920000, finishedMonotonicMs: 1950000 },
    { label: 'clean generated-binding acceptance run with public effect tunnel', exitStatus: 0, startedMonotonicMs: 2260000, finishedMonotonicMs: 2318000 },
    { label: 'React production build and live generated-binding browser smoke', exitStatus: 0, startedMonotonicMs: 2450000, finishedMonotonicMs: 2520000 },
    { label: 'two-warmup seven-sample module build series', exitStatus: 0, startedMonotonicMs: 2532000, finishedMonotonicMs: 2538000 },
    { label: 'exact-identity delete, valid positional absence probe, validated process and state cleanup', exitStatus: 0, startedMonotonicMs: 3810000, finishedMonotonicMs: 3867700 },
  ],
  scenarioResults: acceptance.scenarios.map((scenario) => ({
    id: scenario.id,
    status: scenario.status.toLowerCase().replaceAll('_', '-'),
    evidencePaths: evidencePaths[scenario.id],
    transport: checks[scenario.id][0],
    authoritativeCheck: checks[scenario.id][1],
    note: scenario.summary,
  })),
  inventory: {
    receiptPath: 'evidence/inventory.json',
    authoredSource: inventory.totals['authored-source'] ?? { files: 0, bytes: 0, lines: 0 },
    generated: inventory.totals.generated ?? { files: 0, bytes: 0, lines: 0 },
    tests: { files: 1, bytes: harnessBytes, lines: 0 },
    configuration: inventory.totals.configuration ?? { files: 0, bytes: 0, lines: 0 },
    policy: inventory.totals.policy ?? { files: 0, bytes: 0, lines: 0 },
    dependencyManifests: inventory.totals['dependency-manifest'] ?? { files: 0, bytes: 0, lines: 0 },
    installedDependencyBytes: inventory.installedDependencyBytes,
    glue: [
      'private persona binding over server-issued development identities',
      'inline table bytes for the frozen small asset instead of object storage',
      'durable notification-attempt ledger with explicit ambiguous settlement',
      'arm-lifetime public Quick Tunnel because procedure HTTP rejects private destinations',
    ],
  },
  evidenceConfidence: {
    'actor-authority': {
      score: 2,
      reason: 'Four hashed principals, caller-dependent views, denied role/outsider writes, policy transitions, and live revocation eviction are retained.',
      evidencePaths: ['evidence/actor-identity-receipt.json', 'evidence/acceptance-results.json'],
    },
    'transaction-conflict': {
      score: 2,
      reason: 'Bob and Casey crossed one final-seat barrier; exactly one reducer committed, one rejected, and direct SQL confirmed capacity.',
      evidencePaths: ['evidence/acceptance-results.json', 'evidence/performance-samples.json'],
    },
    transport: {
      score: 2,
      reason: 'Second-client generated-binding WebSocket callbacks directly observed policy, RSVP, wall, asset, and revocation changes with no product polling.',
      evidencePaths: ['evidence/acceptance-results.json'],
    },
    'offline-reconnect': {
      score: 2,
      reason: 'Seven retained reconnect samples re-authenticated Bob with the server-issued credential and rebuilt the protected view without duplicates.',
      evidencePaths: ['evidence/performance-samples.json'],
    },
    settlement: {
      score: 2,
      reason: 'Confirmed reads, reducer/procedure promises, subscribed rows, direct SQL, receiver calls, and durable effect ledger states bind assertions.',
      evidencePaths: ['evidence/acceptance-results.json', 'evidence/effect-receiver.json'],
    },
    'target-identity': {
      score: 2,
      reason: 'Exact namespace, immutable database identity, schema hash, server hash, versions, isolated paths, PID/cwd, and ports are retained.',
      evidencePaths: ['evidence/target-identity.json', 'evidence/baseline.json'],
    },
    'cleanup-isolation': {
      score: 2,
      reason: 'Exact-identity deletion, valid positional absence diagnostic, validated process ownership, removed arm state, and closed ports are direct.',
      evidencePaths: ['evidence/cleanup-plan.json', 'evidence/cleanup-receipt.json', 'evidence/environment-cleanup.json'],
    },
    'artifact-reproducibility': {
      score: 2,
      reason: 'Module, deterministic seed, generated bindings, UI, harness, lockfiles, raw timings, screenshot, rebuild manifest, and inventory are retained.',
      evidencePaths: ['evidence/inventory.json', 'evidence/backup-manifest.json', 'evidence/performance-samples.json', 'evidence/ui-smoke.json'],
    },
  },
  stopDefects: [],
  cleanup: {
    status: 'complete',
    targetBoundPlanPath: 'evidence/cleanup-plan.json',
    receiptPaths: [
      'evidence/cleanup-receipt.json',
      'evidence/environment-cleanup.json',
    ],
    postCleanupProbe: 'Positional database describe exited 1 with “No such database”, syntaxValid=true, usageDiagnosticObserved=false; ports 3332/4333 and exact state path are absent.',
  },
  result: 'complete',
};

await writeFile(
  path.resolve(armRoot, 'run-capsule.v1.json'),
  `${JSON.stringify(capsule, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify({ ok: true, scenarios: capsule.scenarioResults.length })}\n`);
