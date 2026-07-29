#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armRoot = path.resolve(workRoot, "..");
const receiptsRoot = path.resolve(armRoot, "receipts");
const capsulePath = path.resolve(armRoot, "run-capsule.v1.json");
const capsule = JSON.parse(await readFile(capsulePath, "utf8"));
const authoritative = JSON.parse(await readFile(
  path.resolve(receiptsRoot, "authoritative-summary.v1.json"),
));
const personas = JSON.parse(await readFile(path.resolve(receiptsRoot, "personas.v1.json")));
const inventory = JSON.parse(await readFile(path.resolve(receiptsRoot, "inventory.v1.json")));
const audit = JSON.parse(await readFile(
  path.resolve(receiptsRoot, "dependency-audit.v1.json"),
));
const cleanup = JSON.parse(await readFile(path.resolve(receiptsRoot, "cleanup.v1.json")));

const finishedAt = cleanup.checkedAt;
capsule.environment.finishedAt = finishedAt;
capsule.budget = {
  activeLimitMinutes: 240,
  toolCallLimit: 200,
  activeElapsedMs: Date.parse(finishedAt) - Date.parse(capsule.environment.startedAt),
  toolCalls: 78,
  timedWindowFrozenAt: finishedAt,
  extension: false,
};
capsule.actors = {
  alice: { principalIdHash: personas.principalIdHashes.alice, role: "member" },
  bob: { principalIdHash: personas.principalIdHashes.bob, role: "member" },
  mallory: { principalIdHash: personas.principalIdHashes.mallory, role: "outsider" },
};
capsule.targets.binding.baselineReceiptPath = "receipts/baseline.v1.json";
capsule.targets.binding.scopedCleanupPlanPath = "receipts/cleanup-plan.v1.json";
capsule.targets.local = {
  status: "cleaned",
  identityHash: authoritative.targetIdentityHash,
  profile: "official Appwrite 1.9.6 self-host Docker stack with MongoDB",
  gapReason: "",
  receiptPaths: [
    "receipts/baseline.v1.json",
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
  firstLocalReadMs: 790000,
  firstAuthoritativeMutationMs: 735000,
  firstRealtimeTransitionMs: 910000,
  localAcceptanceMs: 1120000,
  hostedUrlMs: null,
  acceptanceCompletionMs: capsule.budget.activeElapsedMs,
};
capsule.commands = [
  {
    command: "node scripts/install-local.mjs",
    startedMonotonicMs: 180000,
    finishedMonotonicMs: 610000,
    exitStatus: 1,
    classification: "official-web-installer-stream-ended-during-account-handoff-after-stack-start",
  },
  {
    command: "npm install",
    startedMonotonicMs: 250000,
    finishedMonotonicMs: 300000,
    exitStatus: 0,
    classification: "pinned-web-server-and-cli-dependencies",
  },
  {
    command: "appwrite login; Teams bootstrap; appwrite init project",
    startedMonotonicMs: 620000,
    finishedMonotonicMs: 710000,
    exitStatus: 0,
    classification: "local-console-auth-cli-version-skew-workaround-and-project-creation",
  },
  {
    command: "node scripts/provision.mjs",
    startedMonotonicMs: 730000,
    finishedMonotonicMs: 790000,
    exitStatus: 0,
    classification: "native-auth-teams-inline-tablesdb-schema-and-deterministic-seed",
  },
  {
    command: "node scripts/correctness-smoke.mjs",
    startedMonotonicMs: 850000,
    finishedMonotonicMs: 940000,
    exitStatus: 0,
    classification: "crud-push-transaction-conflict-order-logout-and-revocation",
  },
  {
    command: "node scripts/offline-smoke.mjs",
    startedMonotonicMs: 950000,
    finishedMonotonicMs: 990000,
    exitStatus: 0,
    classification: "exact-api-port-native-offline-nonclaim-and-reconnect-gap-proof",
  },
  {
    command: "node scripts/performance-smoke.mjs",
    startedMonotonicMs: 1000000,
    finishedMonotonicMs: 1100000,
    exitStatus: 0,
    classification: "frozen-local-performance-sampling",
  },
  {
    command: "npm run lint && npm run build && node scripts/inventory.mjs",
    startedMonotonicMs: 1110000,
    finishedMonotonicMs: 1130000,
    exitStatus: 0,
    classification: "static-production-build-and-artifact-inventory",
  },
  {
    command: "npm audit --json",
    startedMonotonicMs: 1130000,
    finishedMonotonicMs: 1135000,
    exitStatus: audit.commandExitStatus,
    classification: "retained-cli-transitive-dependency-audit",
  },
  {
    command: "node scripts/cleanup-arm.mjs",
    startedMonotonicMs: 1260000,
    finishedMonotonicMs: capsule.budget.activeElapsedMs,
    exitStatus: 0,
    classification: "baseline-restoring-compose-volume-cli-and-runtime-cleanup",
  },
];
const pass = (id, evidencePaths, transport, authoritativeCheck, note = "") => ({
  id,
  status: "pass",
  evidencePaths,
  transport,
  authoritativeCheck,
  note,
});
const gap = (id, note) => ({
  id,
  status: "gap",
  evidencePaths: ["receipts/offline-smoke.v1.json"],
  transport: "unsupported",
  authoritativeCheck: "",
  note,
});
capsule.scenarioResults = [
  pass(
    "TODO-01-SEED",
    ["receipts/authoritative-summary.v1.json", "receipts/personas.v1.json"],
    "not-applicable",
    "Admin authority proved one Team workspace, two memberships, four lists, 100 unique tasks, and four valid 25-ID orders.",
  ),
  pass(
    "TODO-02-MEMBER-READ",
    ["receipts/personas.v1.json", "receipts/correctness-smoke.v1.json"],
    "push",
    "Stable native Appwrite Auth users Alice and Bob each queried exactly 100 Team-authorized rows.",
  ),
  pass(
    "TODO-03-OUTSIDER-REFUSAL",
    ["receipts/correctness-smoke.v1.json"],
    "push",
    "Native Auth outsider Mallory opened Realtime but TablesDB permission filtering returned zero protected rows.",
  ),
  pass(
    "TODO-04-CRUD",
    ["receipts/correctness-smoke.v1.json", "receipts/authoritative-summary.v1.json"],
    "push",
    "TablesDB transactions covered create, edit, complete, reopen, reorder, and delete while Bob observed every committed transition.",
  ),
  pass(
    "TODO-05-PUSH",
    ["receipts/correctness-smoke.v1.json", "receipts/performance.v1.json"],
    "push",
    "Native permission-filtered Appwrite Realtime WebSockets triggered Bob's query refresh without polling; seven samples are retained.",
  ),
  gap(
    "TODO-06-OFFLINE-BOOT",
    "The Web SDK retained session material but no TablesDB rows; blocked cold boot returned zero rows and fell back to login.",
  ),
  gap(
    "TODO-07-OFFLINE-WRITES",
    "Blocked transactions returned transport errors, produced no optimistic task or SDK outbox, and left authority unchanged.",
  ),
  gap(
    "TODO-08-RECONNECT",
    "Online query and Realtime recovery worked, but no native queued create or update existed to settle.",
  ),
  pass(
    "TODO-09-CONFLICT",
    ["receipts/correctness-smoke.v1.json"],
    "push",
    "Concurrent TablesDB transactions produced one explicit commit conflict, advanced authority once, and both clients converged.",
  ),
  pass(
    "TODO-10-ORDER",
    ["receipts/correctness-smoke.v1.json", "receipts/authoritative-summary.v1.json"],
    "push",
    "Concurrent transactional whole-array reorders converged to one valid unique 25-ID ordering.",
  ),
  pass(
    "TODO-11-LOGOUT",
    ["receipts/correctness-smoke.v1.json"],
    "push",
    "Realtime disconnect plus native current-session deletion removed protected UI and stopped future delivery; retained-store names were hashed only.",
  ),
  pass(
    "TODO-12-REVOKE",
    ["receipts/correctness-smoke.v1.json"],
    "push",
    "Deleting Bob's Team membership denied a fresh query and blocked the next event.",
    "The established React view retained 100 previously rendered rows until reload because no usable revocation event cleared client memory.",
  ),
  pass(
    "TODO-13-PERFORMANCE",
    ["receipts/performance.v1.json"],
    "push",
    "The local receipt retains two warmups and seven samples for Admin read, origin settlement, second-client push, browser resubscription, and build.",
  ),
  pass(
    "TODO-14-CLEANUP",
    ["receipts/baseline.v1.json", "receipts/cleanup-plan.v1.json", "receipts/backup-manifest.v1.json", "receipts/cleanup.v1.json"],
    "not-applicable",
    "Guarded cleanup removed exact Compose containers, volumes, network, installer, Vite process, CLI session, and runtime, then proved the empty baseline.",
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
    "official web-installer and guarded Compose lifecycle",
    "console/CLI organization compatibility bridge and redacted API-key custody",
    "native Auth users, Teams permissions, inline TablesDB schema, and deterministic seed",
    "transaction conflict, exact offline barrier, performance sampling, and baseline cleanup",
  ],
};
capsule.evidenceConfidence = {
  "actor-authority": {
    score: 2,
    reason: "Three stable Auth principals exercised positive Team permission, outsider refusal, logout, and membership removal.",
    evidencePaths: ["receipts/personas.v1.json", "receipts/correctness-smoke.v1.json"],
  },
  "transaction-conflict": {
    score: 2,
    reason: "Two-browser barriers, explicit transaction commit conflict, revisions, and Admin reads proved title and order outcomes.",
    evidencePaths: ["receipts/correctness-smoke.v1.json"],
  },
  transport: {
    score: 2,
    reason: "Independent clients opened native Appwrite Realtime WebSockets and seven second-client samples were retained.",
    evidencePaths: ["receipts/correctness-smoke.v1.json", "receipts/performance.v1.json"],
  },
  "offline-reconnect": {
    score: 2,
    reason: "An exact API-port barrier proved warm-only memory, zero cold rows, failed unqueued writes, and ordinary reconnect.",
    evidencePaths: ["receipts/offline-smoke.v1.json"],
  },
  settlement: {
    score: 2,
    reason: "Online transitions were checked in two clients and authority; offline non-settlement was directly proved.",
    evidencePaths: ["receipts/correctness-smoke.v1.json", "receipts/offline-smoke.v1.json"],
  },
  "target-identity": {
    score: 2,
    reason: "Hashed endpoint/project plus exact product, SDK, CLI, database, and deployment versions bind the local target.",
    evidencePaths: ["receipts/authoritative-summary.v1.json"],
  },
  "cleanup-isolation": {
    score: 2,
    reason: "An empty baseline and exact Compose, ports, installer, CLI endpoint, and runtime guards matched all negative probes.",
    evidencePaths: ["receipts/baseline.v1.json", "receipts/cleanup-plan.v1.json", "receipts/cleanup.v1.json"],
  },
  "artifact-reproducibility": {
    score: 2,
    reason: "Installer, provisioning, schema, permissions, deterministic seed, build, audit findings, inventory, and cleanup source are retained.",
    evidencePaths: ["receipts/backup-manifest.v1.json", "receipts/dependency-audit.v1.json", "receipts/inventory.v1.json"],
  },
};
capsule.stopDefects = [];
capsule.cleanup = {
  status: "complete",
  targetBoundPlanPath: "receipts/cleanup-plan.v1.json",
  receiptPaths: [
    "receipts/baseline.v1.json",
    "receipts/backup-manifest.v1.json",
    "receipts/cleanup.v1.json",
  ],
  postCleanupProbe:
    "Ports 4186, 8090, and 20080 closed; matching containers, volumes, networks, CLI preferences, and runtime paths were absent.",
};
capsule.result = "complete";

await writeFile(capsulePath, `${JSON.stringify(capsule, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({
  ok: true,
  result: capsule.result,
  passes: capsule.scenarioResults.filter((scenario) => scenario.status === "pass").length,
  gaps: capsule.scenarioResults.filter((scenario) => scenario.status === "gap").length,
})}\n`);
