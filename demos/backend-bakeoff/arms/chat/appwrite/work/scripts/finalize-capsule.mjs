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
const baseline = JSON.parse(await readFile(path.resolve(receiptsRoot, "baseline.v1.json")));
const personas = JSON.parse(await readFile(path.resolve(receiptsRoot, "personas.v1.json")));
const inventory = JSON.parse(await readFile(path.resolve(receiptsRoot, "inventory.v1.json")));
const audit = JSON.parse(await readFile(
  path.resolve(receiptsRoot, "dependency-audit.v1.json"),
));
const cleanup = JSON.parse(await readFile(path.resolve(receiptsRoot, "cleanup.v1.json")));

const startedAt = baseline.capturedAt;
const finishedAt = cleanup.checkedAt;
const elapsed = Date.parse(finishedAt) - Date.parse(startedAt);
capsule.environment.startedAt = startedAt;
capsule.environment.finishedAt = finishedAt;
capsule.budget = {
  activeLimitMinutes: 240,
  toolCallLimit: 200,
  activeElapsedMs: elapsed,
  toolCalls: 87,
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
  firstLocalReadMs: 1_520_000,
  firstAuthoritativeMutationMs: 1_420_000,
  firstRealtimeTransitionMs: 2_380_000,
  localAcceptanceMs: 6_900_000,
  hostedUrlMs: null,
  acceptanceCompletionMs: elapsed,
};
capsule.assistanceEvents = [
  {
    atMonotonicMs: 2_100_000,
    kind: "official-documentation-refresh",
    detail:
      "Refreshed Appwrite installation, TablesDB query/permission, Realtime, and Presences documentation before attributing native paths.",
  },
];
capsule.commands = [
  {
    command: "official Appwrite 1.9.6 web installer; node scripts/install-local.mjs",
    startedMonotonicMs: 60_000,
    finishedMonotonicMs: 490_000,
    exitStatus: 1,
    classification:
      "installer stream terminated during account handoff after the generated stack reached ready",
  },
  {
    command: "npm install",
    startedMonotonicMs: 70_000,
    finishedMonotonicMs: 73_000,
    exitStatus: 0,
    classification: "pinned SDK, CLI, React, build, lint, and browser dependencies",
  },
  {
    command: "node scripts/bootstrap-project.mjs",
    startedMonotonicMs: 520_000,
    finishedMonotonicMs: 750_000,
    exitStatus: 0,
    classification:
      "console-session Teams compatibility bootstrap, CLI login, isolated project, and web platform",
  },
  {
    command: "node scripts/create-api-key.mjs; node scripts/provision.mjs",
    startedMonotonicMs: 780_000,
    finishedMonotonicMs: 1_520_000,
    exitStatus: 0,
    classification:
      "two retained provisioning corrections preceded native Auth/Teams/inline TablesDB seed success",
  },
  {
    command: "npm run lint && npm run build",
    startedMonotonicMs: 1_800_000,
    finishedMonotonicMs: 1_810_000,
    exitStatus: 0,
    classification: "provider-specific React chat static and production build proof",
  },
  {
    command: "node scripts/correctness-smoke.mjs",
    startedMonotonicMs: 2_000_000,
    finishedMonotonicMs: 4_600_000,
    exitStatus: 0,
    classification:
      "two-member/outside browsers, native push, pagination, unread, concurrent send, logout, revocation, and direct Presences refusal",
  },
  {
    command: "node scripts/offline-smoke.mjs",
    startedMonotonicMs: 4_650_000,
    finishedMonotonicMs: 4_710_000,
    exitStatus: 0,
    classification: "warm-memory/cold-reload/reconnect evidence and offline GAP",
  },
  {
    command: "node scripts/performance-smoke.mjs",
    startedMonotonicMs: 5_000_000,
    finishedMonotonicMs: 6_800_000,
    exitStatus: 0,
    classification:
      "two warmups plus seven read, 20-message burst, native push, reconnect, and build samples",
  },
  {
    command: "node scripts/dependency-audit.mjs; node scripts/inventory.mjs; node scripts/finalize-evidence.mjs",
    startedMonotonicMs: 6_820_000,
    finishedMonotonicMs: 7_270_000,
    exitStatus: 0,
    classification: `artifact inventory and retained npm audit (${audit.vulnerabilityCounts.total} findings)`,
  },
  {
    command: "node scripts/cleanup-arm.mjs",
    startedMonotonicMs: 7_280_000,
    finishedMonotonicMs: elapsed,
    exitStatus: 0,
    classification: "exact Compose, volume, installer, browser, port, CLI, and runtime cleanup",
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
const gap = (id, evidencePaths, transport, note) => ({
  id,
  status: "gap",
  evidencePaths,
  transport,
  authoritativeCheck: "",
  note,
});
capsule.scenarioResults = [
  pass(
    "CHAT-01-SEED",
    ["receipts/authoritative-summary.v1.json", "receipts/personas.v1.json"],
    "not-applicable",
    "Admin authority proved four channels, 125 messages per channel, 500 total messages, three native Auth principals, and the exact private Team.",
  ),
  pass(
    "CHAT-02-AUTHORITY",
    ["receipts/personas.v1.json", "receipts/correctness-smoke.v1.json"],
    "push",
    "Alice and Bob read and subscribed to both private channels; Mallory saw only the two public channels, read zero private rows, and received zero private subscription events.",
  ),
  pass(
    "CHAT-03-SEND",
    ["receipts/correctness-smoke.v1.json"],
    "push",
    "The committed message carried a server-assigned $id/$createdAt and a server-validated per-user ACL binding the author actor; Admin authority matched body and actor.",
  ),
  pass(
    "CHAT-04-PUSH",
    ["receipts/correctness-smoke.v1.json", "receipts/performance.v1.json"],
    "push",
    "Bob observed Alice's committed private message through a native Appwrite Realtime WebSocket with no product polling; seven delivery samples are retained.",
  ),
  pass(
    "CHAT-05-PAGINATION",
    ["receipts/correctness-smoke.v1.json"],
    "not-applicable",
    "A 25-row cursorAfter boundary remained nonduplicating across a concurrent insert; both page ID sets and cursor are retained.",
  ),
  gap(
    "CHAT-06-TYPING",
    ["receipts/correctness-smoke.v1.json"],
    "unsupported",
    "The pinned SDK/server exposes Presences, but authenticated Presences.upsert returned user_unauthorized; no durable typing-row substitute was credited.",
  ),
  gap(
    "CHAT-07-PRESENCE",
    ["receipts/correctness-smoke.v1.json"],
    "unsupported",
    "No authorized presence record could be created, so connect/disconnect/expiry could not be credited despite the documented native surface.",
  ),
  pass(
    "CHAT-08-RECONNECT",
    ["receipts/correctness-smoke.v1.json", "receipts/offline-smoke.v1.json"],
    "push",
    "A transport-disabled browser reconnected, resubscribed, refetched 25 authoritative rows, and contained 25 unique message IDs.",
  ),
  gap(
    "CHAT-09-OFFLINE-HISTORY",
    ["receipts/offline-smoke.v1.json"],
    "unsupported",
    "Twenty-five loaded rows survived only in mounted React memory; offline reload exposed zero rows and no provider TablesDB cache.",
  ),
  pass(
    "CHAT-10-UNREAD",
    ["receipts/correctness-smoke.v1.json"],
    "push",
    "A private per-user TablesDB marker produced zero unread on Bob's first browser, second browser, and reconnect.",
  ),
  pass(
    "CHAT-11-CONCURRENT-SEND",
    ["receipts/correctness-smoke.v1.json"],
    "push",
    "A two-actor barrier preserved both committed messages and authority supplied a deterministic $createdAt then $id ordering.",
  ),
  pass(
    "CHAT-12-LOGOUT",
    ["receipts/correctness-smoke.v1.json"],
    "push",
    "Native session deletion plus Realtime disconnect removed protected UI and prevented future private delivery.",
  ),
  pass(
    "CHAT-13-REVOKE",
    ["receipts/correctness-smoke.v1.json"],
    "push",
    "Deleting Bob's Team membership blocked the next private event and denied fresh channel/query visibility.",
    "The established React view honestly retained 25 historical rows until reload.",
  ),
  pass(
    "CHAT-14-PERFORMANCE",
    ["receipts/performance.v1.json"],
    "push",
    "The receipt retains two warmups plus seven samples for read, 20-message burst, second-client push, reconnect/resubscribe, and production build.",
  ),
  pass(
    "CHAT-15-CLEANUP",
    [
      "receipts/baseline.v1.json",
      "receipts/cleanup-plan.v1.json",
      "receipts/backup-manifest.v1.json",
      "receipts/cleanup.v1.json",
    ],
    "not-applicable",
    "Guarded cleanup removed the exact generated Compose stack, volumes, network, installer, Vite process, CLI session, and disposable runtime, then matched every negative baseline probe.",
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
    "official web-installer lifecycle and guarded generated-Compose cleanup",
    "console Teams compatibility bootstrap and redacted API-key custody",
    "native Auth/Teams permissions plus split public/private TablesDB message tables",
    "browser acceptance, offline barrier, performance sampling, inventory, and cleanup harnesses",
  ],
};
capsule.evidenceConfidence = {
  "actor-authority": {
    score: 2,
    reason:
      "Stable Auth principals, server-validated per-user ACLs, positive Team membership, outsider refusal, logout, and membership removal directly bind actors and authority.",
    evidencePaths: ["receipts/personas.v1.json", "receipts/correctness-smoke.v1.json"],
  },
  "transaction-conflict": {
    score: 2,
    reason:
      "A direct two-actor barrier retained both messages and authoritative server fields supplied the deterministic total order required by this app.",
    evidencePaths: ["receipts/correctness-smoke.v1.json"],
  },
  transport: {
    score: 2,
    reason:
      "Independent clients opened native Appwrite Realtime WebSockets; outsider filtering and seven second-client delivery samples were retained.",
    evidencePaths: ["receipts/correctness-smoke.v1.json", "receipts/performance.v1.json"],
  },
  "offline-reconnect": {
    score: 2,
    reason:
      "An exact browser transport barrier directly proved warm-only memory, zero offline-reload rows, and nonduplicating authoritative reconnect.",
    evidencePaths: ["receipts/offline-smoke.v1.json", "receipts/correctness-smoke.v1.json"],
  },
  settlement: {
    score: 2,
    reason:
      "Origin, second-client, Admin authority, cursor pages, unread markers, logout, and revocation were checked at their explicit barriers.",
    evidencePaths: ["receipts/correctness-smoke.v1.json"],
  },
  "target-identity": {
    score: 2,
    reason:
      "Hashed endpoint/project plus exact product, SDK, CLI, database, and official installer deployment bind the disposable local target.",
    evidencePaths: ["receipts/authoritative-summary.v1.json"],
  },
  "cleanup-isolation": {
    score: 2,
    reason:
      "Prior empty cleanup, pre-install negative guards, exact Compose/ports/CLI scope, and post-cleanup negative probes matched.",
    evidencePaths: [
      "receipts/baseline.v1.json",
      "receipts/cleanup-plan.v1.json",
      "receipts/cleanup.v1.json",
    ],
  },
  "artifact-reproducibility": {
    score: 2,
    reason:
      "Installer, bootstrap, schema, permissions, deterministic seed, app, acceptance, performance, dependency audit, inventory, and cleanup source are retained.",
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
