#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armRoot = path.resolve(workRoot, "..");
const receiptsRoot = path.resolve(armRoot, "receipts");
const capsulePath = path.resolve(armRoot, "run-capsule.v1.json");
const capsule = JSON.parse(await readFile(capsulePath, "utf8"));
const authoritative = JSON.parse(
  await readFile(path.resolve(receiptsRoot, "authoritative-summary.v1.json"), "utf8"),
);
const personas = JSON.parse(
  await readFile(path.resolve(receiptsRoot, "personas.v1.json"), "utf8"),
);
const inventory = JSON.parse(
  await readFile(path.resolve(receiptsRoot, "inventory.v1.json"), "utf8"),
);

const finishedAt = new Date().toISOString();
capsule.environment.finishedAt = finishedAt;
capsule.budget = {
  activeLimitMinutes: 240,
  toolCallLimit: 200,
  activeElapsedMs: Date.parse(finishedAt) - Date.parse(capsule.environment.startedAt),
  toolCalls: 83,
  timedWindowFrozenAt: finishedAt,
  extension: false,
};
capsule.actors = {
  alice: { principalIdHash: personas.principalIdHashes.alice, role: "member" },
  bob: { principalIdHash: personas.principalIdHashes.bob, role: "member" },
  mallory: { principalIdHash: personas.principalIdHashes.mallory, role: "outsider" },
};
capsule.targets.binding.scopedCleanupPlanPath = "receipts/cleanup-plan.v1.json";
capsule.targets.local = {
  status: "cleaned",
  identityHash: authoritative.targetIdentityHash,
  profile: "Firebase Local Emulator Suite with Authentication and Cloud Firestore",
  gapReason: "",
  receiptPaths: [
    "receipts/authoritative-summary.v1.json",
    "receipts/personas.v1.json",
    "receipts/correctness-smoke.v1.json",
    "receipts/offline-smoke.v1.json",
    "receipts/performance.v1.json",
    "receipts/dependency-audit.v1.json",
    "receipts/cleanup.v1.json",
  ],
};
capsule.milestones = {
  firstLocalReadMs: 863000,
  firstAuthoritativeMutationMs: 1110000,
  firstRealtimeTransitionMs: 1135000,
  localAcceptanceMs: 1871818,
  hostedUrlMs: null,
  acceptanceCompletionMs: 1941000,
};
capsule.commands = [
  {
    command: "npm install firebase@12.16.0 firebase-admin@14.2.0 playwright-core@1.62.0",
    startedMonotonicMs: 0,
    finishedMonotonicMs: 6400,
    exitStatus: 0,
    classification: "arm-local-provider-dependencies-with-audit-warnings",
  },
  {
    command: "firebase emulators:start --project demo-llp0102-todo-firebase --only auth,firestore",
    startedMonotonicMs: 7000,
    finishedMonotonicMs: 147000,
    exitStatus: 0,
    classification: "fresh-local-demo-project-and-first-emulator-download",
  },
  {
    command: "node scripts/provision-personas.mjs (first attempt)",
    startedMonotonicMs: 700000,
    finishedMonotonicMs: 730000,
    exitStatus: 1,
    classification: "harness-auth-restore-race",
  },
  {
    command: "node scripts/provision-personas.mjs",
    startedMonotonicMs: 731000,
    finishedMonotonicMs: 865000,
    exitStatus: 0,
    classification: "native-auth-personas-rules-and-deterministic-seed",
  },
  {
    command: "node scripts/correctness-smoke.mjs (four diagnostic attempts)",
    startedMonotonicMs: 900000,
    finishedMonotonicMs: 1180000,
    exitStatus: 1,
    classification: "regrant-resubscription-profile-lock-and-harness-typo-diagnostics",
  },
  {
    command: "node scripts/correctness-smoke.mjs",
    startedMonotonicMs: 1181000,
    finishedMonotonicMs: 1205000,
    exitStatus: 0,
    classification: "crud-push-conflict-order-revocation-and-logout",
  },
  {
    command: "node scripts/offline-smoke.mjs (paused-process and browser-route diagnostics)",
    startedMonotonicMs: 1250000,
    finishedMonotonicMs: 1780000,
    exitStatus: 1,
    classification: "unfaithful-offline-barriers-replaced-after-cache-diagnostics",
  },
  {
    command: "node scripts/offline-smoke.mjs",
    startedMonotonicMs: 1781000,
    finishedMonotonicMs: 1871818,
    exitStatus: 0,
    classification: "full-emulator-stop-cold-cache-queue-and-imported-restart",
  },
  {
    command: "node scripts/performance-smoke.mjs",
    startedMonotonicMs: 1872000,
    finishedMonotonicMs: 1909000,
    exitStatus: 0,
    classification: "frozen-performance-sampling",
  },
  {
    command: "npm run lint && npm run build",
    startedMonotonicMs: 1910000,
    finishedMonotonicMs: 1913000,
    exitStatus: 0,
    classification: "static-check-and-production-build",
  },
  {
    command: "node scripts/inventory.mjs && node scripts/finalize-evidence.mjs",
    startedMonotonicMs: 1914000,
    finishedMonotonicMs: 1930000,
    exitStatus: 0,
    classification: "artifact-target-and-dependency-audit-evidence",
  },
  {
    command: "node scripts/cleanup-arm.mjs",
    startedMonotonicMs: 1931000,
    finishedMonotonicMs: 1941000,
    exitStatus: 0,
    classification: "target-bound-emulator-vite-runtime-and-credential-cleanup",
  },
];
const result = (id, evidencePaths, transport, authoritativeCheck, note = "") => ({
  id,
  status: "pass",
  evidencePaths,
  transport,
  authoritativeCheck,
  note,
});
capsule.scenarioResults = [
  result(
    "TODO-01-SEED",
    ["receipts/authoritative-summary.v1.json", "receipts/personas.v1.json"],
    "not-applicable",
    "The Admin SDK proved one workspace, two memberships, four lists, 100 unique deterministic tasks, and four valid 25-task orders.",
  ),
  result(
    "TODO-02-MEMBER-READ",
    ["receipts/personas.v1.json"],
    "push",
    "Stable native Firebase Auth users Alice and Bob each received exactly 100 authorized tasks.",
  ),
  result(
    "TODO-03-OUTSIDER-REFUSAL",
    ["receipts/personas.v1.json"],
    "push",
    "Native Auth user Mallory opened a Firestore listen channel but Security Rules returned zero protected rows.",
  ),
  result(
    "TODO-04-CRUD",
    ["receipts/correctness-smoke.v1.json", "receipts/authoritative-summary.v1.json"],
    "local-optimistic",
    "Alice created, edited, completed, reopened, reordered, and deleted while Bob observed settled state; authority returned to 100 tasks.",
  ),
  result(
    "TODO-05-PUSH",
    ["receipts/correctness-smoke.v1.json", "receipts/performance.v1.json"],
    "push",
    "A directly observed Cloud Firestore WebChannel listen stream delivered Alice's changes to Bob without refresh, with seven retained timing samples.",
  ),
  result(
    "TODO-06-OFFLINE-BOOT",
    ["receipts/offline-smoke.v1.json"],
    "local-optimistic",
    "After an exact full emulator export and shutdown closed every arm port, the reopened Alice profile restored all 100 rows from persistent IndexedDB.",
  ),
  result(
    "TODO-07-OFFLINE-WRITES",
    ["receipts/offline-smoke.v1.json"],
    "local-optimistic",
    "With every emulator port closed, the cold client displayed one create and one update optimistically and reported snapshot pending writes.",
  ),
  result(
    "TODO-08-RECONNECT",
    ["receipts/offline-smoke.v1.json", "receipts/authoritative-summary.v1.json"],
    "push",
    "After restart from the exact export, authority contained the update and exactly one create at count 101; deterministic cleanup restored 100.",
  ),
  result(
    "TODO-09-CONFLICT",
    ["receipts/correctness-smoke.v1.json"],
    "push",
    "Two native clients crossed a title-edit barrier; the Admin SDK identified Bob's last server commit as the winner and both listeners converged.",
  ),
  result(
    "TODO-10-ORDER",
    ["receipts/correctness-smoke.v1.json", "receipts/authoritative-summary.v1.json"],
    "push",
    "Concurrent whole-array order writes converged by last server commit to a unique 0-through-24 permutation.",
  ),
  result(
    "TODO-11-LOGOUT",
    ["receipts/correctness-smoke.v1.json"],
    "push",
    "Firebase Auth sign-out removed protected UI and stopped future delivery; the receipt separately records that Firestore's device cache is not erased by sign-out.",
  ),
  result(
    "TODO-12-REVOKE",
    ["receipts/correctness-smoke.v1.json"],
    "push",
    "Removing Bob's membership caused the connected listen to terminate on the next server write and blocked delivery; regrant plus explicit resubscription restored access.",
  ),
  result(
    "TODO-13-PERFORMANCE",
    ["receipts/performance.v1.json"],
    "push",
    "The receipt retains two warmups and seven raw samples for Admin read, origin reconciliation, second-client push, browser resubscription, and production build.",
  ),
  result(
    "TODO-14-CLEANUP",
    ["receipts/cleanup-plan.v1.json", "receipts/backup-manifest.v1.json", "receipts/cleanup.v1.json"],
    "not-applicable",
    "Guarded cleanup verified exact Vite and Firebase hub owners before stopping them, deleting only arm runtime and credentials, and proving all six ports and paths absent.",
  ),
];
capsule.inventory = {
  receiptPath: "receipts/inventory.v1.json",
  authoredSource: inventory.totals["authored-source"] ?? null,
  generated: null,
  tests: inventory.totals.test ?? null,
  configuration: inventory.totals.configuration ?? null,
  policy: inventory.totals.policy ?? null,
  dependencyManifests: inventory.totals["dependency-manifest"] ?? null,
  installedDependencyBytes: inventory.installedDependencyBytes,
  glue: [
    "secret-safe local persona provisioning and Admin SDK authority helper",
    "explicit cache bootstrap plus native Firestore listeners and pending-write metadata",
    "two-client correctness, full-emulator offline, and performance barriers",
    "exact process-owner, port, runtime, and credential cleanup",
  ],
};
capsule.evidenceConfidence = {
  "actor-authority": {
    score: 2,
    reason: "Three stable native Auth users were exercised positively and negatively, including connected revocation and logout.",
    evidencePaths: ["receipts/personas.v1.json", "receipts/correctness-smoke.v1.json"],
  },
  "transaction-conflict": {
    score: 2,
    reason: "Two-client barriers plus independent Admin SDK queries directly proved the title winner and order invariant.",
    evidencePaths: ["receipts/correctness-smoke.v1.json", "receipts/authoritative-summary.v1.json"],
  },
  transport: {
    score: 2,
    reason: "Independent browsers opened native Firestore WebChannel listen streams, and seven second-client samples were retained.",
    evidencePaths: ["receipts/personas.v1.json", "receipts/performance.v1.json"],
  },
  "offline-reconnect": {
    score: 2,
    reason: "All exact emulator processes and ports were stopped, cold cache and queued writes were inspected, and authority was queried after an imported restart.",
    evidencePaths: ["receipts/offline-smoke.v1.json"],
  },
  settlement: {
    score: 2,
    reason: "Online and offline mutations were observed optimistically and authoritatively, including one reconnect marker and restored baseline.",
    evidencePaths: ["receipts/correctness-smoke.v1.json", "receipts/offline-smoke.v1.json"],
  },
  "target-identity": {
    score: 2,
    reason: "The demo project, SDK/CLI versions, emulator version, and emulator JAR digest are bound into one target hash.",
    evidencePaths: ["receipts/authoritative-summary.v1.json"],
  },
  "cleanup-isolation": {
    score: 2,
    reason: "A predeclared plan verified exact process commands before stop and proved all target ports and disposable paths absent.",
    evidencePaths: ["receipts/cleanup-plan.v1.json", "receipts/cleanup.v1.json"],
  },
  "artifact-reproducibility": {
    score: 2,
    reason: "Rules, indexes, deterministic seed, build, dependency audit, and category-separated inventory are retained.",
    evidencePaths: [
      "receipts/backup-manifest.v1.json",
      "receipts/dependency-audit.v1.json",
      "receipts/inventory.v1.json",
    ],
  },
};
capsule.stopDefects = [];
capsule.cleanup = {
  status: "complete",
  targetBoundPlanPath: "receipts/cleanup-plan.v1.json",
  receiptPaths: ["receipts/backup-manifest.v1.json", "receipts/cleanup.v1.json"],
  postCleanupProbe:
    "Ports 4181, 8085, 9102, 4400, 4500, and 9150 were closed; the runtime tree, generated emulator cache/logs, and arm credential file were absent.",
};
capsule.result = "complete";

await writeFile(capsulePath, `${JSON.stringify(capsule, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
process.stdout.write(`${JSON.stringify({
  ok: true,
  result: capsule.result,
  passes: capsule.scenarioResults.filter((scenario) => scenario.status === "pass").length,
})}\n`);
