import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const work = process.cwd();
const arm = path.dirname(work);
const receipts = path.join(work, "receipts");
const acceptance = JSON.parse(await readFile(path.join(receipts, "acceptance-results.json"), "utf8"));
const inventory = JSON.parse(await readFile(path.join(receipts, "inventory.json"), "utf8"));
const seed = JSON.parse(await readFile(path.join(receipts, "seed-receipt.json"), "utf8"));
const cleanup = JSON.parse(await readFile(path.join(receipts, "cleanup.json"), "utf8"));

const pushScenarios = new Set([
  "CHAT-04-PUSH",
  "CHAT-06-TYPING",
  "CHAT-07-PRESENCE",
  "CHAT-08-RECONNECT",
  "CHAT-10-UNREAD",
  "CHAT-13-REVOKE"
]);
const scenarioResults = Object.values(acceptance.scenarios).map((scenario) => ({
  id: scenario.id,
  status: scenario.status,
  evidencePaths: [`work/receipts/scenarios/${scenario.id}.json`],
  transport: pushScenarios.has(scenario.id) ? "push" : "not-applicable",
  authoritativeCheck: scenario.note,
  note: scenario.id === "CHAT-13-REVOKE"
    ? "Future delivery/read denied directly; previously authorized Firestore cache remained readable and is disclosed, not hidden."
    : scenario.note
}));

const capsule = {
  schemaVersion: 1,
  protocolId: "llp-0102-backend-bakeoff-v1",
  arm: {
    app: "chat",
    provider: "firebase",
    round: "calibration",
    attemptId: "chat-firebase-calibration-01"
  },
  environment: {
    freezeAggregateSha256: "ab95cd3099b7dde29810046ba495884e3bc641a3bdfb811ab828db10c6b7f72a",
    sourceCommit: "ed31c1dd428298dc7ab4734ee2e3c2354112ba1a",
    providerVersions: {
      product: "Firebase with Cloud Firestore",
      client: "12.16.0",
      cli: "15.24.0",
      admin: "13.5.0",
      functions: "6.4.0",
      firestoreEmulator: "1.21.0",
      realtimeDatabaseEmulator: "4.11.2"
    },
    machine: "Apartment Air: Mac17,3/arm64/32GiB/macOS 26.5.2/25F84; Node 24.18.0; OpenJDK 21.0.12",
    startedAt: "2026-07-29T01:46:00.000Z",
    finishedAt: cleanup.capturedAt,
    timingNote: "Arm start reconstructed from first recorded environment preflight. In-harness milestones are exact clean-run monotonic values but do not represent end-to-end authoring time."
  },
  budget: {
    activeLimitMinutes: 240,
    toolCallLimit: 200,
    activeElapsedMs: 2355495,
    toolCalls: 98,
    timedWindowFrozenAt: cleanup.capturedAt,
    extension: false
  },
  actors: {
    alice: {
      principalIdHash: seed.personas.alice.uidHash,
      role: "authorized private-channel member"
    },
    bob: {
      principalIdHash: seed.personas.bob.uidHash,
      role: "authorized member, then revoked in CHAT-13"
    },
    mallory: {
      principalIdHash: seed.personas.mallory.uidHash,
      role: "outsider"
    }
  },
  targets: {
    binding: {
      mode: "fresh-local",
      namespace: "llp0102-final-chat-firebase-w2",
      baselineReceiptPath: "work/receipts/baseline-before.json",
      scopedCleanupPlanPath: "work/receipts/scoped-cleanup-plan.json"
    },
    local: {
      status: "cleaned",
      identityHash: cleanup.target.identityHash,
      profile: "Firebase Local Emulator Suite: Auth, Firestore, Functions, Realtime Database",
      gapReason: "",
      receiptPaths: [
        "work/receipts/target-identity.json",
        "work/receipts/emulator-hub.json",
        "work/receipts/acceptance-results.json"
      ]
    },
    hosted: {
      status: "explicit-gap",
      identityHash: "",
      profile: "managed Firebase project with Firestore, Auth, Functions, Realtime Database, Hosting",
      plan: "Blaze pay-as-you-go",
      region: "us-west1 where selectable",
      gapReason: "Hosted credentials unavailable. This is environment/credential evidence, not a Firebase product failure.",
      receiptPaths: ["work/receipts/target-identity.json"]
    }
  },
  milestones: {
    ...acceptance.milestones,
    hostedUrlMs: null,
    semantics: "Exact final-clean-harness elapsed milliseconds; end-to-end authoring clock is separately represented by budget.activeElapsedMs."
  },
  assistanceEvents: [],
  commands: [
    { command: "java -version", exitStatus: 1, classification: "environment", receipt: "work/receipts/failed-attempts.json" },
    { command: "brew install openjdk@21", exitStatus: 0, classification: "environment-remediation", receipt: "work/receipts/failed-attempts.json" },
    { command: "npm install (root and functions)", exitStatus: 0, classification: "setup", receipt: "work/package-lock.json" },
    { command: "npm run build", exitStatus: 0, classification: "build", receipt: "work/receipts/performance.json" },
    { command: "firebase emulators:start (first isolated PATH)", exitStatus: 127, classification: "builder-error", receipt: "work/receipts/failed-attempts.json" },
    { command: "node scripts/acceptance.mjs (initial attempts)", exitStatus: 1, classification: "harness-and-performance-learning", receipt: "work/receipts/failed-attempts.json" },
    { command: "node scripts/acceptance.mjs (final clean run)", exitStatus: 0, classification: "acceptance", receipt: "work/receipts/acceptance.stdout.log" },
    { command: "node scripts/offline-browser.mjs", exitStatus: 0, classification: "acceptance", receipt: "work/receipts/offline-browser.json" },
    { command: "firebase emulators:export .firebase-export --force", exitStatus: 0, classification: "backup", receipt: "work/receipts/export-file-sha256.txt" },
    { command: "node scripts/cleanup.mjs (ownership guard)", exitStatus: 1, classification: "safe-refusal", receipt: "work/receipts/cleanup.stderr.log" },
    { command: "node scripts/cleanup.mjs (validated plan)", exitStatus: 0, classification: "cleanup", receipt: "work/receipts/cleanup.json" }
  ],
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
    glue: inventory.glue
  },
  evidenceConfidence: {
    "actor-authority": {
      score: 2,
      reason: "Three native Auth-emulator principals exercised direct positive reads and direct rule-denied read/subscription.",
      evidencePaths: ["work/receipts/scenarios/CHAT-02-AUTHORITY.json"]
    },
    "transaction-conflict": {
      score: 2,
      reason: "Two-actor barrier preserved both messages with adjacent transactionally allocated server sequences; hot-counter timeout is retained.",
      evidencePaths: ["work/receipts/scenarios/CHAT-11-CONCURRENT-SEND.json", "work/receipts/failed-attempts.json"]
    },
    transport: {
      score: 2,
      reason: "Firestore onSnapshot/WebChannel and RTDB onValue/onDisconnect are directly attributed; no product polling.",
      evidencePaths: ["work/receipts/scenarios/CHAT-04-PUSH.json", "work/receipts/scenarios/CHAT-07-PRESENCE.json"]
    },
    "offline-reconnect": {
      score: 2,
      reason: "Cold Chrome page rendered 25 private messages from IndexedDB with Firestore network disabled; reconnect independently reached server state.",
      evidencePaths: ["work/receipts/offline-browser.json", "work/receipts/scenarios/CHAT-08-RECONNECT.json"]
    },
    settlement: {
      score: 2,
      reason: "Callable results were checked against Admin SDK authoritative documents; concurrent settlement and retry-related failure are retained.",
      evidencePaths: ["work/receipts/scenarios/CHAT-03-SEND.json", "work/receipts/scenarios/CHAT-11-CONCURRENT-SEND.json"]
    },
    "target-identity": {
      score: 2,
      reason: "Fresh local project id, bound services/ports, versions, and identity hash are direct. Hosted target is separately an explicit credential GAP.",
      evidencePaths: ["work/receipts/target-identity.json", "work/receipts/emulator-hub.json"]
    },
    "cleanup-isolation": {
      score: 2,
      reason: "Validated exact process ancestry, zero surviving PIDs, and eight closed ports; no shared/hosted target existed.",
      evidencePaths: ["work/receipts/scoped-cleanup-plan.json", "work/receipts/cleanup.json"]
    },
    "artifact-reproducibility": {
      score: 2,
      reason: "Pinned root/functions locks, source, rules, scripts, raw samples, failed attempts, export hashes, and cleanup proof retained.",
      evidencePaths: ["work/receipts/inventory.json", "work/package-lock.json", "work/functions/package-lock.json"]
    }
  },
  stopDefects: [],
  cleanup: {
    status: cleanup.status,
    targetBoundPlanPath: "work/receipts/scoped-cleanup-plan.json",
    receiptPaths: [
      "work/receipts/cleanup.json",
      "work/receipts/export-file-sha256.txt",
      "work/receipts/export-size-kib.txt"
    ],
    postCleanupProbe: "All assigned/auxiliary ports closed; exact process tree absent; fresh local emulator endpoint connection-refused."
  },
  result: "complete"
};

capsule.commands = capsule.commands.map((command) => ({
  ...command,
  startedMonotonicMs: 0,
  finishedMonotonicMs: 0,
  timingNote: "Per-command monotonic intervals were not retained; zero is an explicit missing-data sentinel, not a duration claim."
}));

if (scenarioResults.length !== 15 || scenarioResults.some((scenario) => scenario.status !== "pass")) {
  throw new Error(`Refusing complete capsule: ${scenarioResults.length} scenarios, statuses ${scenarioResults.map((scenario) => scenario.status).join(",")}`);
}

await writeFile(path.join(arm, "run-capsule.v1.json"), `${JSON.stringify(capsule, null, 2)}\n`);
console.log(path.join(arm, "run-capsule.v1.json"));
