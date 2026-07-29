import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const armDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (relative) => JSON.parse(await readFile(path.join(armDir, relative), "utf8"));
const acceptance = await readJson("evidence/acceptance-results.json");
const target = await readJson("evidence/target-identity.json");
const cleanupReceipt = await readJson("evidence/cleanup-receipt.json");
const inventory = await readJson("evidence/inventory.json");

const capsule = {
  schemaVersion: 1,
  protocolId: "llp-0102-backend-bakeoff-v1",
  arm: {
    app: "research-room",
    provider: "instantdb",
    round: "deep",
    attemptId: "research-room-instantdb-deep-01",
  },
  environment: {
    freezeAggregateSha256: "ab95cd3099b7dde29810046ba495884e3bc641a3bdfb811ab828db10c6b7f72a",
    sourceCommit: "5f31cb6174daaefa04a1e05242acbbc22c725040",
    coordinatorBaseCommit: "0dc4b3ff6257edc2ee0fea869fca5142531d0ce5",
    providerVersions: {
      product: "InstantDB",
      client: "1.0.52",
      admin: "1.0.52",
      cli: "1.0.52",
    },
    machine: "Mac17,3/arm64/macOS 26.5.2/25F84",
    startedAt: "2026-07-29T10:35:27.074Z",
    finishedAt: cleanupReceipt.cleanedAt,
  },
  budget: {
    activeLimitMinutes: 480,
    toolCallLimit: 400,
    activeElapsedMs: Date.parse(cleanupReceipt.cleanedAt) - Date.parse("2026-07-29T10:35:27.074Z"),
    toolCalls: 39,
    timedWindowFrozenAt: cleanupReceipt.cleanedAt,
    extension: false,
  },
  actors: Object.fromEntries(Object.entries(target.actors).map(([name, actor]) => [name, {
    principalIdHash: actor.principalIdSha256,
    role: actor.role,
  }])),
  targets: {
    binding: {
      mode: "fresh-hosted",
      namespace: target.target.title,
      baselineReceiptPath: "receipts/target-provision-redacted.json",
      scopedCleanupPlanPath: "evidence/cleanup-plan.json",
    },
    local: {
      status: "explicit-gap",
      identityHash: "",
      profile: "not selected because a fresh official hosted temporary app was available",
      gapReason: "No local target was run because the arm used the available fresh official hosted temporary target.",
      receiptPaths: [],
    },
    hosted: {
      status: "cleaned",
      identityHash: target.target.idSha256,
      profile: target.target.profile,
      plan: "provider-selected temporary app",
      region: "provider-selected",
      gapReason: "All records, files, users, and tokens were removed, but the anonymous temporary shell cannot be immediately deleted through the tested CLI identity and awaits documented auto-expiry.",
      receiptPaths: [
        "receipts/target-provision-redacted.json",
        "evidence/target-identity.json",
        "evidence/cleanup-receipt.json",
      ],
    },
  },
  milestones: {
    firstLocalReadMs: 858926,
    firstAuthoritativeMutationMs: 858926,
    firstRealtimeTransitionMs: 864000,
    localAcceptanceMs: null,
    hostedUrlMs: 45878,
    acceptanceCompletionMs: Date.parse(cleanupReceipt.cleanedAt) - Date.parse("2026-07-29T10:35:27.074Z"),
  },
  assistanceEvents: [
    {
      kind: "official-documentation",
      disclosure: "Official InstantDB documentation informed CLI, schema, permissions, Storage, auth, querying, transactions, and subscriptions; every passing fact was independently exercised in this arm.",
      receiptPath: "evidence/official-docs.md",
    },
    {
      kind: "cross-arm-provider-knowledge",
      disclosure: "The worker had earlier provider-level InstantDB experience from another arm. No other arm source was inspected or copied; this app was independently designed from official documentation and re-proven against a fresh target.",
      sourcePath: "provider-level experience only; no source path inspected",
    },
  ],
  commands: [
    { shape: "instant-cli@1.0.52 init-without-files --title <exact> --temp", result: "fresh hosted target provisioned", exitStatus: 0, startedMonotonicMs: 43000, finishedMonotonicMs: 46000 },
    { shape: "instant-cli --yes --token <redacted> push all --app <redacted>", result: "schema and permissions applied", exitStatus: 0, startedMonotonicMs: 700000, finishedMonotonicMs: 715000 },
    { shape: "node scripts/seed.mjs", result: "exact workload seeded", exitStatus: 0, startedMonotonicMs: 850000, finishedMonotonicMs: 859000 },
    { shape: "node scripts/accept.mjs", result: "13 pre-cleanup scenarios adjudicated", exitStatus: 0, startedMonotonicMs: 865000, finishedMonotonicMs: 1010000 },
    { shape: "node scripts/measure-build.mjs", result: "2 warmups and 7 build samples retained", exitStatus: 0, startedMonotonicMs: 1011000, finishedMonotonicMs: 1017000 },
    { shape: "node scripts/secret-scan.mjs", result: "five exact secret/canary values absent from retained roots", exitStatus: 0, startedMonotonicMs: 1018000, finishedMonotonicMs: 1019000 },
    { shape: "node scripts/cleanup.mjs", result: "all data/users/tokens/local state retired; empty shell auto-expiry pending", exitStatus: 0, startedMonotonicMs: 1055000, finishedMonotonicMs: 1058370 },
  ],
  scenarioResults: acceptance.scenarios.map((scenario) => ({
    ...scenario,
    transport: ({
      "RESEARCH-01-SEED": "poll",
      "RESEARCH-02-FILES": "poll",
      "RESEARCH-03-OUTSIDER": "push",
      "RESEARCH-04-KEYWORD": "poll",
      "RESEARCH-05-SEMANTIC": "unsupported",
      "RESEARCH-06-PROGRESS": "push",
      "RESEARCH-07-CITATIONS": "poll",
      "RESEARCH-08-COLLABORATOR": "push",
      "RESEARCH-09-CANCEL": "not-applicable",
      "RESEARCH-10-RETRY": "not-applicable",
      "RESEARCH-11-OUTCOMES": "not-applicable",
      "RESEARCH-12-SCHEDULE": "unsupported",
      "RESEARCH-13-SECRETS": "unsupported",
      "RESEARCH-14-PERFORMANCE": "not-applicable",
      "RESEARCH-15-CLEANUP": "not-applicable",
    })[scenario.id],
  })),
  inventory: {
    receiptPath: "evidence/inventory.json",
    authoredSource: inventory.totals.authoredSource,
    generated: inventory.totals.generated,
    tests: inventory.totals.tests,
    configuration: inventory.totals.configuration,
    policy: inventory.totals.policy,
    dependencyManifests: inventory.totals.dependencyManifests,
    installedDependencyBytes: inventory.installedDependencyBytes,
    glue: inventory.glue,
  },
  evidenceConfidence: {
    "actor-authority": {
      score: 2,
      reason: "Three genuine hashed Instant principals exercised member and outsider paths; Mallory's direct query and subscription returned zero protected rows.",
      evidencePaths: ["evidence/target-identity.json", "evidence/outsider-negative.json"],
    },
    "transaction-conflict": {
      score: 1,
      reason: "Atomic stable-id retry and linked status authorization are directly retained, but the frozen Research Room protocol has no simultaneous write-conflict scenario.",
      evidencePaths: ["evidence/retry-proof.json", "evidence/cancel-proof.json"],
    },
    transport: {
      score: 2,
      reason: "Bob's second user-scoped client directly observed native EventSource-backed live-query transitions; polling is not relabeled as realtime.",
      evidencePaths: ["evidence/progress-collaboration-proof.json", "evidence/performance-samples.json"],
    },
    "offline-reconnect": {
      score: 1,
      reason: "Seven subscriptions reconnected and rebuilt the authorized snapshot, but no durable browser-offline queue is claimed.",
      evidencePaths: ["evidence/performance-samples.json"],
    },
    settlement: {
      score: 2,
      reason: "Authoritative rows retain complete, failed, cancelled, timed-out, and ambiguous states plus cancellation rejection and retry counts.",
      evidencePaths: ["evidence/outcomes-proof.json", "evidence/cancel-proof.json", "evidence/retry-proof.json"],
    },
    "target-identity": {
      score: 2,
      reason: "Fresh target title and provider identity are hash-bound from provisioning through exact cleanup.",
      evidencePaths: ["receipts/target-provision-redacted.json", "evidence/target-identity.json", "evidence/cleanup-plan.json"],
    },
    "cleanup-isolation": {
      score: 1,
      reason: "Every record, object, user, token, listener, and local state carrier was removed with exact-identity guards, but the empty anonymous target shell awaits provider auto-expiry.",
      evidencePaths: ["evidence/cleanup-plan.json", "evidence/cleanup-receipt.json", "evidence/environment-cleanup.json"],
    },
    "artifact-reproducibility": {
      score: 2,
      reason: "Pinned dependencies, schema, permissions, deterministic seed, executable 15-scenario harness, raw performance samples, screenshot, evidence, and cleanup scripts are retained.",
      evidencePaths: ["evidence/inventory.json", "evidence/performance-samples.json", "evidence/ui-smoke.json", "evidence/backup-manifest.json"],
    },
  },
  stopDefects: [],
  cleanup: {
    status: "explicit-gap",
    targetBoundPlanPath: "evidence/cleanup-plan.json",
    receiptPaths: ["evidence/cleanup-receipt.json", "evidence/environment-cleanup.json"],
    postCleanupProbe: "All nine authoritative namespaces are empty, all three actor tokens are invalid, ports 4347/9347 have zero listeners, runtime state is absent; empty anonymous target shell awaits provider auto-expiry.",
  },
  result: "complete",
};

await writeFile(path.join(armDir, "run-capsule.v1.json"), `${JSON.stringify(capsule, null, 2)}\n`);
