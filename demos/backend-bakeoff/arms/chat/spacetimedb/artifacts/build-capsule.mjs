import { readFile, writeFile } from "node:fs/promises";

const armRoot = new URL("../", import.meta.url);
const acceptance = JSON.parse(
  await readFile(new URL("evidence/acceptance-results.json", armRoot), "utf8")
);
const identities = JSON.parse(
  await readFile(new URL("evidence/actor-identity-receipt.json", armRoot), "utf8")
);
const inventory = JSON.parse(
  await readFile(new URL("evidence/inventory.json", armRoot), "utf8")
);

const checks = {
  "CHAT-01-SEED": ["not-applicable", "Per-actor subscribed views returned the exact four channels and 125 messages per channel."],
  "CHAT-02-AUTHORITY": ["push", "Mallory received zero private rows and the server rejected a direct private-table subscription."],
  "CHAT-03-SEND": ["push", "The committed row carried server-derived author identity, timestamp, and increasing message ID."],
  "CHAT-04-PUSH": ["push", "Bob's second SDK client observed the row through a WebSocket onInsert callback."],
  "CHAT-05-PAGINATION": ["push", "Two server-materialized 25-row snapshots had a 50-row unique union across an intervening insert."],
  "CHAT-06-TYPING": ["unsupported", "Durable typing rows and explicit clear were exercised but remain application glue, not native ephemeral state."],
  "CHAT-07-PRESENCE": ["push", "Server connection lifecycle reducers removed and restored Bob's subscribed presence row."],
  "CHAT-08-RECONNECT": ["push", "Token reconnect rebuilt the authoritative protected view without duplicate primary keys."],
  "CHAT-09-OFFLINE-HISTORY": ["unsupported", "No provider-backed persistent cold-start cache exists; warm in-memory retention is not claimed as offline support."],
  "CHAT-10-UNREAD": ["push", "The identity-scoped read marker converged across two clients and reconnect."],
  "CHAT-11-CONCURRENT-SEND": ["push", "A two-actor Promise.all barrier preserved both rows with unique deterministic auto-increment order."],
  "CHAT-12-LOGOUT": ["push", "Disconnect completed before the private send and the logged-out callback received no later row."],
  "CHAT-13-REVOKE": ["push", "Membership removal evicted protected subscribed rows and blocked later private delivery."],
  "CHAT-14-PERFORMANCE": ["not-applicable", "All five frozen paths retain two warmups, seven raw samples, median, and nearest-rank p95."],
  "CHAT-15-CLEANUP": ["not-applicable", "The arm-only data directory was cleared explicitly, the exact database lookup failed, and both ports were closed."],
};

const evidencePaths = {
  "CHAT-01-SEED": ["evidence/acceptance-results.json", "evidence/target-identity.json"],
  "CHAT-02-AUTHORITY": ["evidence/acceptance-results.json", "evidence/actor-identity-receipt.json"],
  "CHAT-03-SEND": ["evidence/acceptance-results.json"],
  "CHAT-04-PUSH": ["evidence/acceptance-results.json"],
  "CHAT-05-PAGINATION": ["evidence/acceptance-results.json"],
  "CHAT-06-TYPING": ["evidence/acceptance-results.json", "implementation-notes.md"],
  "CHAT-07-PRESENCE": ["evidence/acceptance-results.json"],
  "CHAT-08-RECONNECT": ["evidence/acceptance-results.json"],
  "CHAT-09-OFFLINE-HISTORY": ["evidence/acceptance-results.json", "implementation-notes.md"],
  "CHAT-10-UNREAD": ["evidence/acceptance-results.json"],
  "CHAT-11-CONCURRENT-SEND": ["evidence/acceptance-results.json"],
  "CHAT-12-LOGOUT": ["evidence/acceptance-results.json"],
  "CHAT-13-REVOKE": ["evidence/acceptance-results.json"],
  "CHAT-14-PERFORMANCE": ["evidence/performance-samples.json", "evidence/performance-build-samples.json"],
  "CHAT-15-CLEANUP": ["evidence/cleanup-receipt.json", "evidence/cleanup-receipt.failed.json", "evidence/environment-cleanup.json"],
};

const capsule = {
  schemaVersion: 1,
  protocolId: "llp-0102-backend-bakeoff-v1",
  arm: {
    app: "chat",
    provider: "spacetimedb",
    round: "calibration",
    attemptId: "w1",
  },
  environment: {
    freezeAggregateSha256: "ab95cd3099b7dde29810046ba495884e3bc641a3bdfb811ab828db10c6b7f72a",
    sourceCommit: "ed31c1dd428298dc7ab4734ee2e3c2354112ba1a",
    snapbackFrozen: true,
    providerVersions: {
      product: "SpacetimeDB 2.7.0",
      client: "2.7.0",
      cli: "2.7.0",
      cliCommit: "d220349adb7af7eefa810eb08a185609356b83f6",
    },
    machine: "Apartment Air/arm64/macOS/Darwin 25.5.0",
    startedAt: "2026-07-29T02:39:13Z",
    finishedAt: "2026-07-29T02:50:59Z",
  },
  budget: {
    activeLimitMinutes: 240,
    toolCallLimit: 200,
    activeElapsedMs: 706000,
    toolCalls: 58,
    timedWindowFrozenAt: "2026-07-29T02:50:59Z",
    extension: false,
  },
  actors: {
    alice: { principalIdHash: identities.actors.Alice, role: "owner/member" },
    bob: { principalIdHash: identities.actors.Bob, role: "member" },
    mallory: { principalIdHash: identities.actors.Mallory, role: "outsider" },
  },
  targets: {
    binding: {
      mode: "fresh-local",
      namespace: "llp0102-chat-spacetimedb-w1",
      baselineReceiptPath: "evidence/target-identity.json",
      scopedCleanupPlanPath: "evidence/cleanup-remediation-plan.json",
    },
    local: {
      status: "cleaned",
      identityHash: "c6d8ee49d12958f8ce9a1e16b839dbe47ac0cab5c1be27254e442fdd5f102024",
      profile: "official standalone local server",
      gapReason: "",
      receiptPaths: [
        "evidence/target-identity.json",
        "evidence/cleanup-receipt.json",
        "evidence/environment-cleanup.json",
      ],
    },
    hosted: {
      status: "explicit-gap",
      identityHash: "",
      profile: "Maincloud managed database/module",
      plan: "Maincloud Pro",
      region: "provider-selected",
      gapReason: "Hosted evidence unavailable for this arm: frozen credential health says credential-unavailable. This is an environment GAP, not a product failure.",
      receiptPaths: ["evidence/hosted-gap.json"],
    },
  },
  milestones: {
    firstLocalReadMs: 354000,
    firstAuthoritativeMutationMs: 354000,
    firstRealtimeTransitionMs: 355000,
    localAcceptanceMs: 357000,
    hostedUrlMs: null,
    acceptanceCompletionMs: 357000,
  },
  assistanceEvents: [],
  commands: [
    { label: "isolated init rejected by root-dir binary coupling", exitStatus: 1, startedMonotonicMs: 0, finishedMonotonicMs: 1 },
    { label: "isolated init and standalone server start", exitStatus: 0, startedMonotonicMs: 23000, finishedMonotonicMs: 24000 },
    { label: "module build and fresh local publish", exitStatus: 0, startedMonotonicMs: 144000, finishedMonotonicMs: 146000 },
    { label: "generated-bindings acceptance harness", exitStatus: 0, startedMonotonicMs: 354000, finishedMonotonicMs: 357000 },
    { label: "React production build", exitStatus: 0, startedMonotonicMs: 430000, finishedMonotonicMs: 433000 },
    { label: "two-warmup seven-sample module build series", exitStatus: 0, startedMonotonicMs: 470000, finishedMonotonicMs: 485000 },
    { label: "exact database delete refused: different anonymous owner identity", exitStatus: 1, startedMonotonicMs: 620000, finishedMonotonicMs: 621000 },
    { label: "explicit arm-only data-directory cleanup and negative probes", exitStatus: 0, startedMonotonicMs: 704000, finishedMonotonicMs: 706000 },
  ],
  scenarioResults: acceptance.scenarios.map(scenario => ({
    id: scenario.id,
    status: scenario.status.toLowerCase(),
    evidencePaths: evidencePaths[scenario.id],
    transport: checks[scenario.id][0],
    authoritativeCheck: checks[scenario.id][1],
    note: scenario.summary,
  })),
  inventory: {
    receiptPath: "evidence/inventory.json",
    authoredSource: inventory.totals["authored-source"],
    generated: inventory.totals.generated,
    tests: { files: 1, bytes: 22366, lines: 447 },
    configuration: inventory.totals.configuration,
    policy: inventory.totals.policy,
    dependencyManifests: inventory.totals["dependency-manifest"],
    installedDependencyBytes: 208994304,
    glue: [
      "identity-scoped durable page_result table for parameterized cursor snapshots",
      "durable typing_state table with explicit clear because no native ephemeral TTL path exists",
      "application persona-claim reducer over server-issued development identities",
      "arm-only data-directory cleanup fallback after anonymous owner token was not retained",
    ],
  },
  evidenceConfidence: {
    "actor-authority": {
      score: 2,
      reason: "Three hashed principals, negative private read, negative direct subscription, and live revocation eviction are retained.",
      evidencePaths: ["evidence/actor-identity-receipt.json", "evidence/acceptance-results.json"],
    },
    "transaction-conflict": {
      score: 2,
      reason: "Two actor clients crossed a barrier; both committed rows and deterministic server order are retained.",
      evidencePaths: ["evidence/acceptance-results.json"],
    },
    transport: {
      score: 2,
      reason: "Second-client row callbacks are attributed to native SpacetimeDB WebSocket subscriptions; no product polling is used.",
      evidencePaths: ["evidence/acceptance-results.json"],
    },
    "offline-reconnect": {
      score: 1,
      reason: "Reconnect is directly proven, while persistent cold-start offline history is honestly recorded as GAP.",
      evidencePaths: ["evidence/acceptance-results.json", "implementation-notes.md"],
    },
    settlement: {
      score: 2,
      reason: "Confirmed reads, reducer promises, server fields, and authoritative subscribed rows bound each assertion.",
      evidencePaths: ["evidence/acceptance-results.json"],
    },
    "target-identity": {
      score: 2,
      reason: "Fresh database name, server URL, immutable database identity, versions, ports, and isolated paths are retained.",
      evidencePaths: ["evidence/target-identity.json"],
    },
    "cleanup-isolation": {
      score: 2,
      reason: "Both the safe 403 and scoped remediation are retained, followed by database and port negative probes.",
      evidencePaths: ["evidence/cleanup-receipt.failed.json", "evidence/cleanup-receipt.json", "evidence/environment-cleanup.json"],
    },
    "artifact-reproducibility": {
      score: 2,
      reason: "Authored module/client/harness source, generated bindings, lockfiles, raw samples, and inventory are retained.",
      evidencePaths: ["evidence/inventory.json", "evidence/performance-samples.json", "work/server/spacetimedb/package-lock.json", "work/client/package-lock.json"],
    },
  },
  stopDefects: [],
  cleanup: {
    status: "complete",
    targetBoundPlanPath: "evidence/cleanup-remediation-plan.json",
    receiptPaths: [
      "evidence/cleanup-receipt.failed.json",
      "evidence/cleanup-receipt.json",
      "evidence/environment-cleanup.json",
    ],
    postCleanupProbe: "describe returned failed to find database; lsof returned no listeners on 3312 or 4291",
  },
  result: "complete",
};

await writeFile(
  new URL("run-capsule.v1.json", armRoot),
  `${JSON.stringify(capsule, null, 2)}\n`
);
