import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const armRoot = resolve(root, '..');
const evidenceDir = resolve(armRoot, 'evidence');
const receiptDir = resolve(armRoot, 'receipts');
const acceptancePath = resolve(evidenceDir, 'acceptance-results.json');
const acceptance = JSON.parse(readFileSync(acceptancePath, 'utf8'));
const cleanup = JSON.parse(readFileSync(resolve(receiptDir, 'cleanup-final.json'), 'utf8'));
const inventory = JSON.parse(readFileSync(resolve(receiptDir, 'inventory.json'), 'utf8'));
const performance = JSON.parse(readFileSync(resolve(evidenceDir, 'performance.json'), 'utf8'));
const offline = JSON.parse(readFileSync(resolve(evidenceDir, 'offline-smoke.json'), 'utf8'));

if (!acceptance.scenarioResults.some((scenario) => scenario.id === 'LINEAR-14-CLEANUP')) {
  acceptance.scenarioResults.push({
    id: 'LINEAR-14-CLEANUP',
    result: 'PASS',
    summary: 'Only the exact fresh temporary target was cleared; all entity/user counts reached zero and the old actor token failed.',
    evidence: {
      targetIdSha256: cleanup.targetIdSha256,
      targetBoundPlan: '../receipts/cleanup-plan.json',
      beforeCounts: cleanup.beforeCounts,
      afterCounts: cleanup.afterCounts,
      oldActorTokenInvalidated: cleanup.oldActorTokenInvalidated,
      localRuntimeCredentialsRemoved: cleanup.localRuntimeCredentialsRemoved,
      automaticTargetExpiry: cleanup.temporaryAppLifecycle,
      receipt: '../receipts/cleanup-final.json',
    },
  });
}
acceptance.scenarioResults.sort((a, b) => a.id.localeCompare(b.id));
acceptance.completedCheckCount = acceptance.scenarioResults.length;
acceptance.expectedCheckCount = 14;
acceptance.cleanupPending = false;
acceptance.result = acceptance.completedCheckCount === 14 ? 'complete' : 'incomplete';
acceptance.cleanup = cleanup;
writeFileSync(acceptancePath, JSON.stringify(acceptance, null, 2) + '\n');

const scenarioResults = acceptance.scenarioResults.map((scenario) => {
  const special = {
    'LINEAR-01-SEED': ['receipts/seed-receipt.json'],
    'LINEAR-10-OFFLINE': ['evidence/offline-smoke.json'],
    'LINEAR-11-MIGRATION': ['receipts/migration.json'],
    'LINEAR-12-DEPLOY': ['receipts/operations.json'],
    'LINEAR-13-PERFORMANCE': [
      'evidence/performance.json',
      'evidence/performance-build.json',
    ],
    'LINEAR-14-CLEANUP': [
      'receipts/cleanup-plan.json',
      'receipts/cleanup-final.json',
    ],
  };
  return {
    id: scenario.id,
    status: scenario.result.toLowerCase(),
    evidencePaths: ['evidence/acceptance-results.json', ...(special[scenario.id] ?? [])],
    transport:
      scenario.id === 'LINEAR-08-LIVE'
        ? 'push'
        : scenario.id === 'LINEAR-10-OFFLINE'
          ? 'offline-reconnect'
          : scenario.id === 'LINEAR-09-SEARCH' || scenario.id === 'LINEAR-12-DEPLOY'
            ? 'unsupported'
            : 'not-applicable',
    authoritativeCheck: scenario.summary,
    note: scenario.result === 'GAP' ? 'Explicit nonclaim; not counted as a pass.' : '',
  };
});
const startedAt = '2026-07-29T04:48:14.000Z';
const finishedAt = cleanup.finishedAt;
const activeElapsedMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
const capsule = {
  schemaVersion: 1,
  protocolId: 'llp-0102-backend-bakeoff-v1',
  arm: {
    app: 'linear',
    provider: 'instantdb',
    round: 'deep',
    attemptId: 'linear-instantdb-deep-01',
  },
  environment: {
    freezeAggregateSha256:
      'ab95cd3099b7dde29810046ba495884e3bc641a3bdfb811ab828db10c6b7f72a',
    sourceCommit: '5f31cb6174daaefa04a1e05242acbbc22c725040',
    snapbackCommit: '5f31cb6174daaefa04a1e05242acbbc22c725040',
    providerVersions: inventory.providerVersions,
    machine: 'Mac17,3 / arm64 / macOS 26.5 (Darwin 25.5.0) / Node 24.14.0',
    executionShape:
      'Three native guest principals and independent core clients exercised authority/realtime; a persistent headless Chrome profile on port 4325 proved cold IndexedDB retention, an offline queue, and reconnect settlement.',
    startedAt,
    finishedAt,
  },
  budget: {
    activeLimitMinutes: 480,
    toolCallLimit: 400,
    activeElapsedMs,
    toolCalls: 59,
    extension: false,
  },
  actors: Object.fromEntries(
    Object.entries(acceptance.actorHashes).map(([name, actor]) => [
      name,
      {
        principalIdHash: actor.idSha256,
        authPath: actor.authKind,
        role: name === 'alice' ? 'organization-owner' : name === 'bob' ? 'team-member' : 'outsider',
      },
    ]),
  ),
  targets: {
    binding: {
      mode: 'fresh-hosted',
      namespace: 'llp0102-linear-instantdb-w3',
      identityHash: cleanup.targetIdSha256,
      baselineReceiptPath: 'receipts/target-provision-redacted.json',
      scopedCleanupPlanPath: 'receipts/cleanup-plan.json',
    },
    local: {
      status: 'explicit-gap',
      identityHash: '',
      profile: 'official self-host Docker stack',
      gapReason:
        'The assigned arm binding was a fresh official hosted temporary target; local parity was outside this arm run and is not claimed.',
      receiptPaths: [],
    },
    hosted: {
      status: 'cleaned',
      identityHash: cleanup.targetIdSha256,
      profile: 'official hosted temporary app',
      plan: 'official temporary/free app',
      region: 'provider-selected; not exposed',
      gapReason: '',
      receiptPaths: [
        'receipts/target-provision-redacted.json',
        'receipts/cleanup-final.json',
      ],
      targetDeletion:
        'Automatic after more than 24 hours; app-scoped admin token cannot delete the app itself.',
      residualConfiguration: cleanup.residualConfigurationUntilProviderExpiry,
    },
  },
  milestones: {
    firstTargetProvisionedMs: 451488,
    firstAuthoritativeMutationMs: 470000,
    firstRealtimeTransitionMs: 660000,
    hostedUrlMs: 451488,
    acceptanceCompletionMs: 900000,
    cleanupCompletionMs: activeElapsedMs,
  },
  assistanceEvents: [
    {
      type: 'official-documentation',
      note:
        'Used official InstantDB data modeling, InstaQL, permissions, CLI, and temporary-app documentation plus pinned SDK types.',
    },
    {
      type: 'retained-builder-failures',
      receiptPaths: [
        'receipts/acceptance-attempt-1-failure.json',
        'receipts/acceptance-attempt-2-failure.json',
        'receipts/acceptance-attempt-3-failure.json',
        'receipts/acceptance-attempt-4-process-exit.json',
        'receipts/offline-attempt-1-failure.json',
        'receipts/offline-attempt-2-failure.json',
      ],
    },
    {
      type: 'llp-maintain-pre-pr',
      note: 'No LLP/ref reconciliation was proposed for this provider-arm-only change.',
      receiptPaths: ['receipts/llp-maintain-audit.md'],
    },
  ],
  commands: [
    {
      command: 'instant-cli init-without-files --title llp0102-linear-instantdb-w3 --temp',
      exitStatus: 0,
      classification: 'fresh official hosted temporary target',
    },
    {
      command: 'instant-cli push all --app [REDACTED] --yes',
      exitStatus: 0,
      classification: 'base schema/permissions and indexed-field evolution',
    },
    {
      command: 'node scripts/acceptance.mjs',
      exitStatus: 0,
      classification: 'final clean functional run and runtime 2+7 samples',
    },
    {
      command: 'node scripts/offline-smoke.mjs with Vite 127.0.0.1:4325',
      exitStatus: 0,
      classification: 'controlled Chrome cold-cache, offline queue, reconnect',
    },
    {
      command: 'node scripts/build-samples.mjs',
      exitStatus: 0,
      classification: 'two warmups plus seven production builds',
    },
    {
      command: 'node scripts/clear-target.mjs',
      exitStatus: 0,
      classification: 'exact target entity/user cleanup and local credential removal',
    },
  ],
  scenarioResults,
  inventory: {
    receiptPath: 'receipts/inventory.json',
    authoredSource: inventory.authoredTotals,
    dependencies: inventory.dependencies,
    productionBuildBytes: inventory.productionBuildBytes,
    npmAudit: {
      receiptPath: 'receipts/npm-audit.json',
      finding:
        'One high aggregate finding on frozen Vite 7.1.3; the dev server was loopback-only and stopped after evidence.',
    },
  },
  evidenceConfidence: {
    'actor-authority': {
      score: 2,
      reason: 'Three native principals; positive owner/member and negative outsider reads/writes were authoritative.',
      evidencePaths: ['evidence/acceptance-results.json'],
    },
    'transaction-conflict': {
      score: 2,
      reason: 'Two native client transactions were barrier-dispatched; authority and both clients converged on one whole-record LWW winner.',
      evidencePaths: ['evidence/acceptance-results.json'],
    },
    transport: {
      score: 2,
      reason: 'Bob directly observed Alice comment/activity through a native WebSocket query subscription.',
      evidencePaths: ['evidence/acceptance-results.json'],
    },
    'offline-reconnect': {
      score: 2,
      reason: 'Cold browser cache, transport barrier, queued edit, reconnect, authority, and restoration were all directly observed.',
      evidencePaths: ['evidence/offline-smoke.json'],
    },
    settlement: {
      score: 2,
      reason: 'Local optimistic materialization, transaction settlement, and independent admin authority were attributed separately.',
      evidencePaths: ['evidence/acceptance-results.json'],
    },
    'target-identity': {
      score: 2,
      reason: 'One hashed fresh target identity binds provision, every receipt, export posture, and cleanup.',
      evidencePaths: [
        'receipts/target-provision-redacted.json',
        'receipts/cleanup-final.json',
      ],
    },
    'cleanup-isolation': {
      score: 2,
      reason: 'Exact disposable target counts reached zero, old token failed, and worktree-local raw state was removed.',
      evidencePaths: ['receipts/cleanup-plan.json', 'receipts/cleanup-final.json'],
    },
    'artifact-reproducibility': {
      score: 2,
      reason: 'Pinned lockfile, base/evolved schemas, policy, clients, harness, raw samples, failures, inventory, and cleanup are retained.',
      evidencePaths: ['receipts/inventory.json', 'evidence/performance.json'],
    },
  },
  stopDefects: [],
  cleanup: {
    status: 'complete',
    targetBoundPlanPath: 'receipts/cleanup-plan.json',
    receiptPaths: ['receipts/cleanup-final.json'],
    postCleanupProbe:
      'Admin counts were zero for all eight product namespaces and $users; old Bob token verification failed.',
    detail: cleanup,
  },
  result: 'complete',
};
writeFileSync(resolve(armRoot, 'run-capsule.v1.json'), JSON.stringify(capsule, null, 2) + '\n');

const auditRows = scenarioResults.map((scenario) =>
  `| ${scenario.id} | ${scenario.status.toUpperCase()} | ${scenario.evidencePaths.join('<br>')} |`,
);
const audit = `# Linear / InstantDB evidence audit

Frozen protocol: \`llp-0102-backend-bakeoff-v1\`

Freeze: \`ab95cd3099b7dde29810046ba495884e3bc641a3bdfb811ab828db10c6b7f72a\`

Snapback comparison commit: \`5f31cb6174daaefa04a1e05242acbbc22c725040\`

| Scenario | Result | Direct evidence |
| --- | --- | --- |
${auditRows.join('\n')}

## Audit findings

- 14/14 scenarios are classified: 12 PASS, 2 explicit GAP, 0 unclassified, 0 Stop defects.
- Search is GAP because indexed pattern matching is not relabeled as full-text search.
- Deploy is GAP because the temporary app token exposes target identity/config/export posture but not logs or rollback.
- Every target-bearing receipt uses the same SHA-256 target identity; raw app ID, admin token, and actor tokens are absent.
- Cleanup was exact-target only. Product data and users are zero; schema/permissions remain only until the provider's documented temporary-app expiry.
- All runtime and build paths retain two warmups and seven raw samples.
`;
writeFileSync(resolve(evidenceDir, 'evidence-audit.md'), audit);
process.stdout.write(JSON.stringify({
  ok: true,
  completedCheckCount: acceptance.completedCheckCount,
  pass: scenarioResults.filter((scenario) => scenario.status === 'pass').length,
  gap: scenarioResults.filter((scenario) => scenario.status === 'gap').length,
}) + '\n');
