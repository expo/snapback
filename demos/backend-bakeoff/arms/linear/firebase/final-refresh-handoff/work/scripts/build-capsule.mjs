import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const work = process.cwd();
const arm = path.dirname(work);
const receipts = path.join(work, "receipts");
const acceptance = JSON.parse(await readFile(path.join(receipts, "acceptance-results.json"), "utf8"));
const inventory = JSON.parse(await readFile(path.join(receipts, "inventory.json"), "utf8"));
const seed = JSON.parse(await readFile(path.join(receipts, "seed-receipt.json"), "utf8"));
const cleanup = JSON.parse(await readFile(path.join(receipts, "cleanup.json"), "utf8"));
const targetIdentity = JSON.parse(await readFile(path.join(receipts, "target-identity.json"), "utf8"));
const baseline = JSON.parse(await readFile(path.join(receipts, "baseline-before.json"), "utf8"));
const startedEpochMs = Date.parse(baseline.capturedAt);
const finishedEpochMs = Date.parse(cleanup.capturedAt);

const push = new Set(["LINEAR-06-OPTIMISTIC", "LINEAR-08-LIVE"]);
const scenarioResults = Object.values(acceptance.scenarios).map((scenario) => ({
  id: scenario.id,
  status: scenario.status,
  evidencePaths: [`work/receipts/scenarios/${scenario.id}.json`],
  transport: scenario.status === "gap"
    ? "unsupported"
    : push.has(scenario.id)
      ? "push"
      : scenario.id === "LINEAR-10-OFFLINE"
        ? "local-optimistic"
        : "not-applicable",
  authoritativeCheck: scenario.note ?? "",
  note: scenario.note ?? "",
}));

const capsule = {
  schemaVersion: 1,
  protocolId: "llp-0102-backend-bakeoff-v1",
  arm: {
    app: "linear",
    provider: "firebase",
    round: "final-confirmation",
    attemptId: "linear-firebase-final-refresh-w3",
  },
  environment: {
    freezeAggregateSha256: targetIdentity.freezeAggregateSha256,
    sourceCommit: targetIdentity.sourceRevision,
    armBaseCommit: targetIdentity.sourceBaseCommit,
    sourceDirty: targetIdentity.sourceDirty,
    providerVersions: {
      product: "Firebase with Cloud Firestore",
      client: "12.16.0",
      cli: "15.24.0",
      admin: "14.2.0",
      functions: "7.3.2",
    },
    machine: targetIdentity.machine,
    startedAt: baseline.capturedAt,
    finishedAt: cleanup.capturedAt,
    timingNote: "Active window begins at the retained provider preflight boundary and includes implementation, installation, debugging, acceptance, export, and cleanup.",
  },
  budget: {
    activeLimitMinutes: 480,
    toolCallLimit: 400,
    activeElapsedMs: Math.max(0, finishedEpochMs - startedEpochMs),
    toolCalls: 0,
    toolCallNote: "The worker surface did not expose an exact per-arm tool-call count; zero is a missing-data sentinel, not a usage claim.",
    timedWindowFrozenAt: cleanup.capturedAt,
    extension: false,
  },
  actors: {
    alice: { principalIdHash: seed.personas.alice.uidHash, role: "organization owner" },
    bob: { principalIdHash: seed.personas.bob.uidHash, role: "team member" },
    mallory: { principalIdHash: seed.personas.mallory.uidHash, role: "outsider to primary organization" },
  },
  targets: {
    binding: {
      mode: "fresh-local",
      namespace: "llp0102-final-linear-firebase-w3",
      baselineReceiptPath: "work/receipts/baseline-before.json",
      scopedCleanupPlanPath: "work/receipts/scoped-cleanup-plan.json",
    },
    local: {
      status: "cleaned",
      identityHash: targetIdentity.identityHash,
      profile: "Firebase Local Emulator Suite: Auth, Firestore, Functions, Storage",
      gapReason: "",
      receiptPaths: [
        "work/receipts/target-identity.json",
        "work/receipts/emulator-hub.json",
        "work/receipts/acceptance-results.json",
      ],
    },
    hosted: {
      status: "explicit-gap",
      identityHash: "",
      profile: "managed Firebase project with Firestore, Auth, Functions, Storage, Hosting",
      plan: "Blaze pay-as-you-go with budget alerts",
      region: "us-west1 where selectable; Firestore exact location captured with target",
      gapReason: "Hosted Firebase credentials were unavailable. No hosted target was mutated; this is environment evidence, not a product failure.",
      receiptPaths: ["work/receipts/target-identity.json"],
    },
  },
  milestones: { ...acceptance.milestones, hostedUrlMs: null },
  assistanceEvents: [
    {
      kind: "cross-arm-reference",
      source: "completed Todo and Chat Firebase arms",
      reason: "Parent explicitly required inspection of existing Firebase arms; reused emulator isolation, native offline cache, receipt, and cleanup patterns.",
      outcome: "Recorded as allowed cross-arm knowledge under LLP 0102 assistance policy.",
    },
    {
      kind: "isolation-remediation",
      source: "work/receipts-isolation-discovery",
      reason: "The first refresh run discovered Firebase Functions implicitly opened Eventarc and Tasks on default ports 9299 and 9499.",
      outcome: "The first run was retained as an isolation-discovery attempt; the final run preassigned and preflighted disjoint ports 61121 and 62121.",
    },
  ],
  commands: [
    ["npm run preflight", 1, "work/receipts/failed-attempts.json"],
    ["npm run preflight", 0, "work/receipts/baseline-before.json"],
    ["npm install", 0, "work/package-lock.json"],
    ["npm install --prefix functions", 0, "work/functions/package-lock.json"],
    ["npm run start:arm", 0, "work/receipts/target-identity.json"],
    ["npm run build", 1, "work/receipts/failed-attempts.json"],
    ["npm run build", 0, "work/receipts/performance.json"],
    ["npm run acceptance", 1, "work/receipts/failed-attempts.json"],
    ["npm run acceptance", 1, "work/receipts/failed-attempts.json"],
    ["npm run acceptance", 0, "work/receipts/acceptance-results.json"],
    ["npm run browser:offline", 0, "work/receipts/offline-browser.json"],
    ["npm run audit", 0, "work/receipts/npm-audit.json"],
    ["npm run inventory", 0, "work/receipts/inventory.json"],
    ["npm run export:arm", 0, "work/receipts/export-manifest.json"],
    ["npm run cleanup:arm", 1, "work/receipts/failed-attempts.json"],
    ["npm run cleanup:arm", 0, "work/receipts/cleanup.json"],
  ].map(([command, exitStatus, receipt]) => ({
    command,
    exitStatus,
    receipt,
    startedMonotonicMs: 0,
    finishedMonotonicMs: 0,
    timingNote: "Per-command monotonic boundaries unavailable; zero is a missing-data sentinel, not a duration claim.",
  })),
  scenarioResults,
  inventory: {
    receiptPath: "work/receipts/inventory.json",
    authoredSource: inventory.authoredSource,
    generated: inventory.generated,
    tests: inventory.tests,
    configuration: inventory.configuration,
    policy: inventory.policy,
    dependencyManifests: inventory.dependencyManifests,
    installedDependencyBytes: inventory.installedDependencyBytes,
    glue: inventory.glue,
  },
  evidenceConfidence: {
    "actor-authority": {
      score: 2,
      reason: "Three native Auth-emulator principals exercised direct owner/member success and direct outsider rule-denied read/write.",
      evidencePaths: ["work/receipts/scenarios/LINEAR-02-AUTHORITY.json"],
    },
    "transaction-conflict": {
      score: 2,
      reason: "Two authenticated clients raced one revision-CAS callable; exactly one transaction committed and the loser received a typed aborted conflict.",
      evidencePaths: ["work/receipts/scenarios/LINEAR-07-CONFLICT.json"],
    },
    transport: {
      score: 2,
      reason: "Second-client Firestore onSnapshot delivery retained server metadata, latency, IDs, and polling=false.",
      evidencePaths: ["work/receipts/scenarios/LINEAR-08-LIVE.json"],
    },
    "offline-reconnect": {
      score: 2,
      reason: "A cold page rendered 50 cached issues with transport disabled, queued an edit, proved remote state unchanged, then reconciled after reconnect.",
      evidencePaths: ["work/receipts/offline-browser.json"],
    },
    settlement: {
      score: 2,
      reason: "Client acknowledgements were independently checked through Admin SDK documents; optimistic metadata and conflict settlement are explicit.",
      evidencePaths: ["work/receipts/scenarios/LINEAR-06-OPTIMISTIC.json", "work/receipts/scenarios/LINEAR-07-CONFLICT.json"],
    },
    "target-identity": {
      score: 2,
      reason: "Fresh project id, exact service ports, emulator hub, source/freeze commits, and identity hash are direct; hosted target is separately a GAP.",
      evidencePaths: ["work/receipts/target-identity.json", "work/receipts/emulator-hub.json"],
    },
    "cleanup-isolation": {
      score: 2,
      reason: "Exact worktree/project/PID-group ownership was validated; all ten assigned ports, including explicitly isolated Eventarc and Tasks ports, closed and no shared target existed.",
      evidencePaths: [
        "work/receipts/scoped-cleanup-plan.json",
        "work/receipts/cleanup.json",
        "work/receipts-isolation-discovery/emulator-hub.json",
      ],
    },
    "artifact-reproducibility": {
      score: 2,
      reason: "Pinned locks, source, rules, indexes, raw scenarios/samples, export hashes, inventory, and cleanup proof are retained.",
      evidencePaths: ["work/receipts/inventory.json", "work/receipts/export-manifest.json", "work/package-lock.json", "work/functions/package-lock.json"],
    },
  },
  stopDefects: [],
  cleanup: {
    status: cleanup.status,
    targetBoundPlanPath: "work/receipts/scoped-cleanup-plan.json",
    receiptPaths: ["work/receipts/cleanup.json", "work/receipts/export-manifest.json"],
    postCleanupProbe: "All ten assigned ports closed, exact process groups absent, and fresh local project endpoints returned connection-refused.",
  },
  result: "complete",
};

if (scenarioResults.length !== 14 || scenarioResults.some((scenario) => scenario.status === "pending")) {
  throw new Error(`Refusing capsule: ${scenarioResults.length} scenarios; ${scenarioResults.map((item) => `${item.id}:${item.status}`).join(",")}`);
}
await writeFile(path.join(arm, "run-capsule.v1.json"), `${JSON.stringify(capsule, null, 2)}\n`);
console.log(path.join(arm, "run-capsule.v1.json"));
