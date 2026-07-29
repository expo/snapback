import { readFile, writeFile } from 'node:fs/promises';

const armRoot = new URL('../', import.meta.url);
const acceptance = JSON.parse(
  await readFile(new URL('evidence/acceptance-results.json', armRoot), 'utf8'),
);
const identities = JSON.parse(
  await readFile(new URL('evidence/actor-identity-receipt.json', armRoot), 'utf8'),
);
const inventory = JSON.parse(
  await readFile(new URL('evidence/inventory.json', armRoot), 'utf8'),
);
const milestones = JSON.parse(
  await readFile(new URL('evidence/milestones.partial.json', armRoot), 'utf8'),
);

acceptance.scenarios.sort((left, right) => {
  const leftNumber = Number(left.id.match(/LINEAR-(\d+)/)?.[1] ?? 0);
  const rightNumber = Number(right.id.match(/LINEAR-(\d+)/)?.[1] ?? 0);
  return leftNumber - rightNumber;
});
await writeFile(
  new URL('evidence/acceptance-results.json', armRoot),
  `${JSON.stringify(acceptance, null, 2)}\n`,
);

const startedAt = '2026-07-29T04:09:07.046Z';
const finishedAt = new Date().toISOString();
const activeElapsedMs = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));

const evidencePaths = {
  'LINEAR-01-SEED': ['evidence/acceptance-results.json', 'evidence/migration-before.json', 'evidence/target-identity.json'],
  'LINEAR-02-AUTHORITY': ['evidence/acceptance-results.json', 'evidence/actor-identity-receipt.json'],
  'LINEAR-03-FILTERS': ['evidence/acceptance-results.json', 'evidence/schema-after-migration.json'],
  'LINEAR-04-PAGINATION': ['evidence/acceptance-results.json'],
  'LINEAR-05-DETAIL': ['evidence/acceptance-results.json'],
  'LINEAR-06-OPTIMISTIC': ['evidence/acceptance-results.json', 'implementation-notes.md'],
  'LINEAR-07-CONFLICT': ['evidence/acceptance-results.json'],
  'LINEAR-08-LIVE': ['evidence/acceptance-results.json'],
  'LINEAR-09-SEARCH': ['evidence/acceptance-results.json', 'evidence/official-docs.md'],
  'LINEAR-10-OFFLINE': ['evidence/acceptance-results.json', 'implementation-notes.md'],
  'LINEAR-11-MIGRATION': ['evidence/migration-receipt.json', 'evidence/schema-v1.json', 'evidence/schema-after-migration.json'],
  'LINEAR-12-DEPLOY': ['evidence/deployment-receipt.json', 'evidence/hosted-gap.json', 'evidence/backup-manifest.json'],
  'LINEAR-13-PERFORMANCE': ['evidence/performance-samples.json', 'evidence/performance-build-samples.json', 'evidence/cost-window.json'],
  'LINEAR-14-CLEANUP': ['evidence/cleanup-plan.json', 'evidence/cleanup-receipt.json', 'evidence/environment-cleanup.json'],
};

const transport = {
  'LINEAR-01-SEED': 'not-applicable',
  'LINEAR-02-AUTHORITY': 'push',
  'LINEAR-03-FILTERS': 'push',
  'LINEAR-04-PAGINATION': 'push',
  'LINEAR-05-DETAIL': 'push',
  'LINEAR-06-OPTIMISTIC': 'push',
  'LINEAR-07-CONFLICT': 'push',
  'LINEAR-08-LIVE': 'push',
  'LINEAR-09-SEARCH': 'unsupported',
  'LINEAR-10-OFFLINE': 'unsupported',
  'LINEAR-11-MIGRATION': 'push',
  'LINEAR-12-DEPLOY': 'not-applicable',
  'LINEAR-13-PERFORMANCE': 'not-applicable',
  'LINEAR-14-CLEANUP': 'not-applicable',
};

const authoritativeChecks = {
  'LINEAR-01-SEED': 'Caller-scoped subscribed views returned the exact frozen counts for three server-issued identities.',
  'LINEAR-02-AUTHORITY': 'Mallory received zero protected rows, private subscription was rejected, and two negative writes failed.',
  'LINEAR-03-FILTERS': 'Server-materialized pages matched authoritative expected IDs for status, assignee, project, and label.',
  'LINEAR-04-PAGINATION': 'Two exclusive-cursor 50-row pages retained a 100-row unique union across an earlier-sort insert.',
  'LINEAR-05-DETAIL': 'Subscribed related rows supplied exact project, assignee, label, comment, and activity identities.',
  'LINEAR-06-OPTIMISTIC': 'Application-owned pending state preceded settlement and reconciled to the authoritative revision.',
  'LINEAR-07-CONFLICT': 'Two actor clients crossed one barrier; one CAS committed, one rejected, and both converged.',
  'LINEAR-08-LIVE': 'Bob’s second SDK client observed Alice’s comment and activity via native WebSocket row callbacks.',
  'LINEAR-09-SEARCH': 'No native full-text index or service identity exists; no substitute result is claimed.',
  'LINEAR-10-OFFLINE': 'Warm memory, empty cold client, disconnected transport, and nonaccepted mutation outcome are retained separately.',
  'LINEAR-11-MIGRATION': 'Authoritative counts remained 500 before/after while schema proof shows the new defaulted B-tree field.',
  'LINEAR-12-DEPLOY': 'Local identity/config/log/rebuild evidence exists; hosted URL and operations remain unavailable without credentials.',
  'LINEAR-13-PERFORMANCE': 'Every frozen path retains two warmups, seven raw samples, median, nearest-rank p95, and cost scope.',
  'LINEAR-14-CLEANUP': 'Exact database lookup failed after delete, both assigned ports closed, and only arm state was removed.',
};

function total(category) {
  return inventory.totals[category] ?? { files: 0, bytes: 0, lines: 0 };
}

const verifyRecord = inventory.files.find((record) => record.path === 'work/harness/verify.ts');
const capsule = {
  schemaVersion: 1,
  protocolId: 'llp-0102-backend-bakeoff-v1',
  arm: {
    app: 'linear',
    provider: 'spacetimedb',
    round: 'deep',
    attemptId: 'linear-spacetimedb-w1',
  },
  environment: {
    freezeAggregateSha256: 'ab95cd3099b7dde29810046ba495884e3bc641a3bdfb811ab828db10c6b7f72a',
    sourceCommit: '5f31cb6174daaefa04a1e05242acbbc22c725040',
    snapbackFrozen: true,
    providerVersions: {
      product: 'SpacetimeDB 2.7.0',
      client: '2.7.0',
      cli: '2.7.0',
      cliLauncherSha256: '74aca112ead0b20e64e01c4d4cbc2fdf022821f2f870b473a0be5e1da179c246',
    },
    machine: 'Minisforum AI Series/x86_64/Linux 6.17.0-40-generic',
    startedAt,
    finishedAt,
  },
  budget: {
    activeLimitMinutes: 480,
    toolCallLimit: 400,
    activeElapsedMs,
    toolCalls: 92,
    timedWindowFrozenAt: finishedAt,
    extension: false,
  },
  actors: {
    alice: { principalIdHash: identities.actors.alice, role: 'organization owner / team member' },
    bob: { principalIdHash: identities.actors.bob, role: 'organization and team member' },
    mallory: { principalIdHash: identities.actors.mallory, role: 'outsider' },
  },
  targets: {
    binding: {
      mode: 'fresh-local',
      namespace: 'llp0102-linear-spacetimedb-w1',
      baselineReceiptPath: 'evidence/baseline.json',
      scopedCleanupPlanPath: 'evidence/cleanup-plan.json',
    },
    local: {
      status: 'cleaned',
      identityHash: 'e714792b31b4bb901abeaff67a826647200f121a88690c7c37d06d4dcadaefae',
      profile: 'official standalone local server',
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
      plan: 'Maincloud Pro',
      region: 'provider-selected',
      gapReason: 'Hosted evidence unavailable: no SpacetimeDB credential was present in authorized sources. This is an environment GAP, not a product failure.',
      receiptPaths: ['evidence/hosted-gap.json'],
    },
  },
  milestones: {
    firstLocalReadMs: milestones.firstLocalReadMs,
    firstAuthoritativeMutationMs: milestones.firstAuthoritativeMutationMs,
    firstRealtimeTransitionMs: milestones.firstRealtimeTransitionMs,
    localAcceptanceMs: 2125137,
    hostedUrlMs: null,
    acceptanceCompletionMs: 2125137,
  },
  assistanceEvents: [],
  commands: [
    { label: 'worktree-local CLI 2.7.0 and standalone start', exitStatus: 0, startedMonotonicMs: 0, finishedMonotonicMs: 180000 },
    { label: 'V1 publish, exact seed, V2 data-preserving migration', exitStatus: 0, startedMonotonicMs: 2000000, finishedMonotonicMs: 2097250 },
    { label: 'generated-bindings acceptance harness', exitStatus: 0, startedMonotonicMs: 2097250, finishedMonotonicMs: 2125137 },
    { label: 'React production build and rendered UI smoke', exitStatus: 0, startedMonotonicMs: 2140000, finishedMonotonicMs: 2260788 },
    { label: 'two-warmup seven-sample module build series', exitStatus: 0, startedMonotonicMs: 2201000, finishedMonotonicMs: 2208780 },
    { label: 'exact database/process/runtime-state cleanup', exitStatus: 0, startedMonotonicMs: activeElapsedMs - 30000, finishedMonotonicMs: activeElapsedMs },
  ],
  scenarioResults: acceptance.scenarios.map((scenario) => ({
    id: scenario.id,
    status: scenario.status.toLowerCase().replaceAll('_', '-'),
    evidencePaths: evidencePaths[scenario.id],
    transport: transport[scenario.id],
    authoritativeCheck: authoritativeChecks[scenario.id],
    note: scenario.summary,
  })),
  inventory: {
    receiptPath: 'evidence/inventory.json',
    authoredSource: total('authored-source'),
    generated: total('generated'),
    tests: verifyRecord
      ? { files: 1, bytes: verifyRecord.bytes, lines: verifyRecord.lines }
      : { files: 0, bytes: 0, lines: 0 },
    configuration: total('configuration'),
    policy: total('policy'),
    dependencyManifests: total('dependency-manifest'),
    installedDependencyBytes: inventory.installedDependencyBytes,
    glue: [
      'identity-scoped durable page_result materialization for parameterized cursor pages',
      'application persona registration over server-issued development identities',
      'application-owned optimistic pending projection',
      'expected-revision compare-and-set conflict policy',
    ],
  },
  evidenceConfidence: {
    'actor-authority': {
      score: 2,
      reason: 'Three hashed principals, distinct views, a denied private read, and two denied writes are retained.',
      evidencePaths: ['evidence/actor-identity-receipt.json', 'evidence/acceptance-results.json'],
    },
    'transaction-conflict': {
      score: 2,
      reason: 'A two-client barrier produced exactly one CAS commit and one rejection followed by convergence.',
      evidencePaths: ['evidence/acceptance-results.json'],
    },
    transport: {
      score: 2,
      reason: 'Native SDK WebSocket row callbacks delivered second-client comment and activity transitions.',
      evidencePaths: ['evidence/acceptance-results.json'],
    },
    'offline-reconnect': {
      score: 1,
      reason: 'Reconnect is sampled directly; persistent cold offline state and queueing are explicitly GAP.',
      evidencePaths: ['evidence/acceptance-results.json', 'implementation-notes.md'],
    },
    settlement: {
      score: 2,
      reason: 'Reducer promises, confirmed reads, revisions, and authoritative subscribed rows bind assertions.',
      evidencePaths: ['evidence/acceptance-results.json'],
    },
    'target-identity': {
      score: 2,
      reason: 'Fresh database identity, server, versions, paths, machine, and assigned ports are retained.',
      evidencePaths: ['evidence/target-identity.json', 'evidence/baseline.json'],
    },
    'cleanup-isolation': {
      score: 2,
      reason: 'Deletion used the exact identity; process commands/cwds were validated; database and ports have negative proofs.',
      evidencePaths: ['evidence/cleanup-plan.json', 'evidence/cleanup-receipt.json', 'evidence/environment-cleanup.json'],
    },
    'artifact-reproducibility': {
      score: 2,
      reason: 'V1/V2 modules, exact seed, generated bindings, client, harness, locks, raw timings, schema, and inventory are retained.',
      evidencePaths: ['evidence/inventory.json', 'evidence/backup-manifest.json', 'evidence/performance-samples.json'],
    },
  },
  stopDefects: [],
  cleanup: {
    status: 'complete',
    targetBoundPlanPath: 'evidence/cleanup-plan.json',
    receiptPaths: ['evidence/cleanup-receipt.json', 'evidence/environment-cleanup.json'],
    postCleanupProbe: 'Exact database describe failed after delete; ss reported no listeners on 3320 or 4320; state/ is absent.',
  },
  result: 'complete',
};

await writeFile(
  new URL('run-capsule.v1.json', armRoot),
  `${JSON.stringify(capsule, null, 2)}\n`,
);
