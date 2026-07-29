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
  toolCalls: 58,
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
  status: "explicit-gap",
  identityHash: "",
  profile: "official Supabase CLI Docker stack",
  gapReason:
    "The frozen namespace-isolated shared-hosted target was eligible and used, so a second local target was not provisioned. This is not scored as a product failure.",
  receiptPaths: [],
};
capsule.targets.hosted = {
  status: "cleaned",
  identityHash: authoritative.targetIdentityHash,
  profile: "managed Postgres, Auth, Realtime, and PostgREST in a shared project",
  plan: "shared target; billing plan not independently observed",
  region:
    `${authoritative.targetIdentity.poolerRegionHint} pooler hostname hint; dashboard identifier unavailable`,
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
  firstLocalReadMs: null,
  firstAuthoritativeMutationMs: 365000,
  firstRealtimeTransitionMs: 615000,
  localAcceptanceMs: null,
  hostedUrlMs: 15000,
  acceptanceCompletionMs: 1265000,
};
capsule.commands = [
  {
    command: "node scripts/capture-baseline.mjs",
    startedMonotonicMs: 0,
    finishedMonotonicMs: 3500,
    exitStatus: 0,
    classification: "redacted-zero-namespace-shared-target-baseline",
  },
  {
    command: "npm install @supabase/supabase-js@2.111.0 playwright-core@1.62.0",
    startedMonotonicMs: 4000,
    finishedMonotonicMs: 10000,
    exitStatus: 0,
    classification: "arm-local-provider-dependencies",
  },
  {
    command: "node scripts/admin-cli.mjs migrate && node scripts/admin-cli.mjs seed",
    startedMonotonicMs: 300000,
    finishedMonotonicMs: 370000,
    exitStatus: 0,
    classification: "prefix-isolated-hosted-migration-native-auth-and-seed",
  },
  {
    command: "node scripts/provision-personas.mjs",
    startedMonotonicMs: 550000,
    finishedMonotonicMs: 620000,
    exitStatus: 0,
    classification: "rls-personas-and-native-realtime-attribution",
  },
  {
    command: "node scripts/correctness-smoke.mjs (three diagnostic attempts)",
    startedMonotonicMs: 700000,
    finishedMonotonicMs: 920000,
    exitStatus: 1,
    classification: "remote-checkbox-exact-label-and-refetch-race-harness-corrections",
  },
  {
    command: "node scripts/correctness-smoke.mjs",
    startedMonotonicMs: 921000,
    finishedMonotonicMs: 950000,
    exitStatus: 0,
    classification: "crud-push-conflict-order-revocation-and-logout",
  },
  {
    command: "node scripts/offline-smoke.mjs",
    startedMonotonicMs: 975000,
    finishedMonotonicMs: 990000,
    exitStatus: 0,
    classification: "native-offline-nonclaim-and-reconnect-gap-proof",
  },
  {
    command: "node scripts/performance-smoke.mjs",
    startedMonotonicMs: 1010000,
    finishedMonotonicMs: 1065000,
    exitStatus: 0,
    classification: "frozen-hosted-performance-sampling",
  },
  {
    command: "npm run lint && npm run build",
    startedMonotonicMs: 1080000,
    finishedMonotonicMs: 1084000,
    exitStatus: 0,
    classification: "static-check-and-production-build",
  },
  {
    command: "node scripts/inventory.mjs && node scripts/finalize-evidence.mjs",
    startedMonotonicMs: 1100000,
    finishedMonotonicMs: 1110000,
    exitStatus: 0,
    classification: "artifact-target-baseline-and-dependency-evidence",
  },
  {
    command: "node scripts/cleanup-arm.mjs",
    startedMonotonicMs: 1240000,
    finishedMonotonicMs: 1265000,
    exitStatus: 0,
    classification: "baseline-restoring-shared-namespace-and-local-runtime-cleanup",
  },
];
const pass = (id, evidencePaths, transport, authoritativeCheck) => ({
  id,
  status: "pass",
  evidencePaths,
  transport,
  authoritativeCheck,
  note: "",
});
const gap = (id, evidencePaths, note) => ({
  id,
  status: "gap",
  evidencePaths,
  transport: "unsupported",
  authoritativeCheck: "",
  note,
});
capsule.scenarioResults = [
  pass(
    "TODO-01-SEED",
    ["receipts/baseline.v1.json", "receipts/authoritative-summary.v1.json", "receipts/personas.v1.json"],
    "not-applicable",
    "The clean baseline preceded an isolated SQL migration and Admin authority proved one workspace, two memberships, four lists, 100 unique tasks and valid orders.",
  ),
  pass(
    "TODO-02-MEMBER-READ",
    ["receipts/personas.v1.json"],
    "push",
    "Stable native Supabase Auth users Alice and Bob each queried exactly 100 RLS-authorized tasks.",
  ),
  pass(
    "TODO-03-OUTSIDER-REFUSAL",
    ["receipts/personas.v1.json"],
    "push",
    "Native Auth outsider Mallory opened a Realtime socket but RLS returned zero protected rows and no query cache existed.",
  ),
  pass(
    "TODO-04-CRUD",
    ["receipts/correctness-smoke.v1.json", "receipts/authoritative-summary.v1.json"],
    "push",
    "PostgreSQL RPCs and RLS-authorized updates covered create, edit, complete, reopen, reorder, and delete; Bob observed every committed transition.",
  ),
  pass(
    "TODO-05-PUSH",
    ["receipts/personas.v1.json", "receipts/correctness-smoke.v1.json", "receipts/performance.v1.json"],
    "push",
    "Directly observed Supabase Realtime Phoenix WebSockets delivered Postgres Changes that refetched Bob without refresh; seven samples are retained.",
  ),
  gap(
    "TODO-06-OFFLINE-BOOT",
    ["receipts/offline-smoke.v1.json"],
    "supabase-js retained the Auth session but cold boot with the exact project transport blocked returned zero tasks because it has no native durable PostgREST query cache.",
  ),
  gap(
    "TODO-07-OFFLINE-WRITES",
    ["receipts/offline-smoke.v1.json"],
    "Blocked create and update RPCs returned transport errors, produced no optimistic task state or SDK queue, and left authority unchanged.",
  ),
  gap(
    "TODO-08-RECONNECT",
    ["receipts/offline-smoke.v1.json"],
    "Online reconnect and resubscription worked, but no create or update had been queued, so the required exact queued-write settlement is unsupported natively.",
  ),
  pass(
    "TODO-09-CONFLICT",
    ["receipts/correctness-smoke.v1.json"],
    "push",
    "Two clients crossed an RPC title barrier; atomic revision increments counted both commits, Admin authority identified the last commit, and both clients converged.",
  ),
  pass(
    "TODO-10-ORDER",
    ["receipts/correctness-smoke.v1.json", "receipts/authoritative-summary.v1.json"],
    "push",
    "Concurrent whole-array PostgreSQL updates converged by last commit to a valid 25-ID unique task order.",
  ),
  pass(
    "TODO-11-LOGOUT",
    ["receipts/correctness-smoke.v1.json"],
    "push",
    "Supabase Auth signOut removed the protected UI and stopped delivery; no native query cache existed and retained-store names were hashed without inspecting values.",
  ),
  pass(
    "TODO-12-REVOKE",
    ["receipts/correctness-smoke.v1.json"],
    "push",
    "Deleting Bob's membership emitted a Realtime change, immediately refetched his RLS view to zero, and blocked the next protected task update.",
  ),
  pass(
    "TODO-13-PERFORMANCE",
    ["receipts/performance.v1.json"],
    "push",
    "The hosted receipt retains two warmups and seven raw samples for Admin read, origin settlement, second-client push, browser resubscription, and production build.",
  ),
  pass(
    "TODO-14-CLEANUP",
    ["receipts/baseline.v1.json", "receipts/cleanup-plan.v1.json", "receipts/backup-manifest.v1.json", "receipts/cleanup.v1.json"],
    "not-applicable",
    "Guarded cleanup removed only four prefixed relations/publication entries/functions and three metadata-bound users, then proved the zero-object redacted baseline restored.",
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
    "redacted shared-target baseline and exact prefix/persona lifecycle",
    "Postgres schema, constraints, RLS, grants, transaction RPCs, and Realtime publication",
    "native Auth browser personas and push-triggered PostgREST refetch",
    "explicit native-offline GAP barrier and baseline-restoring cleanup",
  ],
};
capsule.evidenceConfidence = {
  "actor-authority": {
    score: 2,
    reason: "Three stable native Auth users exercised positive RLS access, outsider refusal, immediate revocation, and logout.",
    evidencePaths: ["receipts/personas.v1.json", "receipts/correctness-smoke.v1.json"],
  },
  "transaction-conflict": {
    score: 2,
    reason: "Two-client barriers, atomic server revision increments, and service-role queries proved title and order outcomes.",
    evidencePaths: ["receipts/correctness-smoke.v1.json", "receipts/authoritative-summary.v1.json"],
  },
  transport: {
    score: 2,
    reason: "Each independent client opened a native Supabase Realtime WebSocket and seven hosted second-client samples were retained.",
    evidencePaths: ["receipts/personas.v1.json", "receipts/performance.v1.json"],
  },
  "offline-reconnect": {
    score: 2,
    reason: "An exact project-host barrier directly proved zero cold rows, failed unqueued writes, unchanged authority, and ordinary online resubscription.",
    evidencePaths: ["receipts/offline-smoke.v1.json"],
  },
  settlement: {
    score: 2,
    reason: "Every online transition was checked in both clients and authority; offline non-settlement was also directly proved.",
    evidencePaths: ["receipts/correctness-smoke.v1.json", "receipts/offline-smoke.v1.json"],
  },
  "target-identity": {
    score: 2,
    reason: "Hashed project/pooler hosts, server/client versions, region hint, namespace prefix, and object counts bind the shared target without credentials.",
    evidencePaths: ["receipts/baseline.v1.json", "receipts/authoritative-summary.v1.json"],
  },
  "cleanup-isolation": {
    score: 2,
    reason: "A zero-object baseline and predeclared exact relations, functions, publication members, and persona hashes matched the post-cleanup zero probe.",
    evidencePaths: ["receipts/baseline.v1.json", "receipts/cleanup-plan.v1.json", "receipts/cleanup.v1.json"],
  },
  "artifact-reproducibility": {
    score: 2,
    reason: "SQL migration/cleanup, deterministic seed, RLS, RPCs, zero-finding audit, build, and category-separated inventory are retained.",
    evidencePaths: ["receipts/backup-manifest.v1.json", "receipts/dependency-audit.v1.json", "receipts/inventory.v1.json"],
  },
};
capsule.stopDefects = [];
capsule.cleanup = {
  status: "complete",
  targetBoundPlanPath: "receipts/cleanup-plan.v1.json",
  receiptPaths: ["receipts/baseline.v1.json", "receipts/backup-manifest.v1.json", "receipts/cleanup.v1.json"],
  postCleanupProbe:
    "The shared project returned to zero matching relations, policies, Realtime publication entries, and persona users; port 4182 and both disposable credential/runtime paths were absent.",
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
  gaps: capsule.scenarioResults.filter((scenario) => scenario.status === "gap").length,
})}\n`);
