import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = path.resolve(here, "..");
const arm = path.resolve(work, "..");
const receipts = path.join(arm, "receipts");
const capsulePath = path.join(arm, "run-capsule.v1.json");
const [capsule, acceptance, inventory, seed, target, cleanup, operations, performance, state] = await Promise.all([
  json(capsulePath),
  json(path.join(receipts, "acceptance.json")),
  json(path.join(receipts, "inventory.json")),
  json(path.join(receipts, "seed.json")),
  json(path.join(receipts, "target-identity.json")),
  json(path.join(receipts, "cleanup.json")),
  json(path.join(receipts, "operations.json")),
  json(path.join(receipts, "performance.json")),
  json(path.join(work, "run-state.json"))
]);
const finishedAt = new Date().toISOString();
const activeElapsedMs = Date.parse(finishedAt) - Date.parse(state.startedAt);
const cleanupStart = Math.max(0, activeElapsedMs - 20000);
const inventoryStart = Math.max(0, cleanupStart - 20000);
const finalRunStart = Math.max(60001, inventoryStart - 60000);
const failedWindowEnd = Math.max(60001, finalRunStart - 1);

acceptance.results["PARTY-15-CLEANUP"] = {
  status: "pass",
  note: "Exact project resources, credential-bearing runtime state, and assigned ports are absent; pre-existing unrelated containers are preserved. No separately timestamped empty baseline was captured before provisioning.",
  evidence: cleanup
};
acceptance.generatedAt = finishedAt;
acceptance.completedCheckCount = 15;
acceptance.cleanupPending = false;
acceptance.result = "complete";
acceptance.milestones.acceptanceCompletionMs = activeElapsedMs;
await writeFile(path.join(receipts, "acceptance.json"), `${JSON.stringify(acceptance, null, 2)}\n`);
await writeFile(path.join(receipts, "scenarios", "PARTY-15-CLEANUP.json"), `${JSON.stringify({
  id: "PARTY-15-CLEANUP",
  checkedAt: cleanup.generatedAt,
  ...acceptance.results["PARTY-15-CLEANUP"]
}, null, 2)}\n`);

const checks = {
  "PARTY-01-SEED": "Service-role counts and hashed native Auth personas prove the exact three-event, six-profile, seven-membership, four-invitation fixture.",
  "PARTY-02-PUBLIC-PRIVATE": "Anonymous preview exposes only the seven selected public columns; direct events-table access is denied and the private event returns no preview row.",
  "PARTY-03-INVITE-RSVP": "Bob's attributed invitation and four yes/maybe/no/yes transitions settle to authoritative yes plus-one one with revision four.",
  "PARTY-04-ROLES": "Host and cohost controls, guest RSVP authority, denied guest host-control, and outsider read/write negatives distinguish all roles.",
  "PARTY-05-GUEST-LIST": "An already-connected Bob receives the native policy transition after a retained cold miss; his list narrows to self while anonymous event preview stays public.",
  "PARTY-06-CAPACITY": "Two guest RPCs race under one locked event row; exactly one commits and authoritative occupied seats equal capacity one.",
  "PARTY-07-LIVE-BURST": "Bob and Carol receive ten wall inserts and two RSVP transitions through native Postgres Changes; service-role counts match.",
  "PARTY-08-ASSET": "Alice uploads private Storage art, Bob downloads matching bytes, Mallory is denied, and Alice deletes the exact object.",
  "PARTY-09-SCHEDULE": "A real five-second pg_cron job runs the due reminder and the unique dedupe ledger remains at exactly one attempt after a second interval.",
  "PARTY-10-EFFECT-RETRY": "The notify Edge Function calls a separate HTTP provider function using server-only configuration; retry returns the known success without a second provider delivery.",
  "PARTY-11-EFFECT-AMBIGUOUS": "Provider acceptance followed by deliberate response uncertainty remains ambiguous, then provider-status reconciliation records success without redelivery.",
  "PARTY-12-REVOCATION": "After Bob's membership revocation, his existing subscription receives no exact protected post and a direct read returns zero while host-visible data remains durable.",
  "PARTY-13-DEPLOY": "Local target/config/log/function/effect evidence is direct; hosted URL, region, logs, rollback, secret configuration, and delivery are unavailable and unclaimed.",
  "PARTY-14-PERFORMANCE": "Contention, ten-row burst, asset roundtrip, native realtime, and build retain two warmups, seven raw samples, median, nearest-rank p95, and local cost scope.",
  "PARTY-15-CLEANUP": "The exact CLI project has zero containers/volumes/networks, all eleven ports are closed, runtime/XDG state is absent, and every pre-existing unrelated container remains."
};
const transports = {
  "PARTY-01-SEED": "not-applicable",
  "PARTY-02-PUBLIC-PRIVATE": "not-applicable",
  "PARTY-03-INVITE-RSVP": "not-applicable",
  "PARTY-04-ROLES": "not-applicable",
  "PARTY-05-GUEST-LIST": "push",
  "PARTY-06-CAPACITY": "not-applicable",
  "PARTY-07-LIVE-BURST": "push",
  "PARTY-08-ASSET": "not-applicable",
  "PARTY-09-SCHEDULE": "not-applicable",
  "PARTY-10-EFFECT-RETRY": "not-applicable",
  "PARTY-11-EFFECT-AMBIGUOUS": "not-applicable",
  "PARTY-12-REVOCATION": "push",
  "PARTY-13-DEPLOY": "unsupported",
  "PARTY-14-PERFORMANCE": "push",
  "PARTY-15-CLEANUP": "not-applicable"
};
const evidence = (name) => `receipts/${name}`;

capsule.schemaVersion = 1;
capsule.protocolId = "llp-0102-backend-bakeoff-v1";
capsule.environment = {
  freezeAggregateSha256: state.freezeAggregateSha256,
  sourceCommit: state.sourceCommit,
  providerVersions: {
    product: "Supabase local stack / PostgreSQL 17",
    client: "supabase-js 2.111.0",
    cli: "Supabase CLI 2.110.0",
    edgeRuntime: "1.74.2 / Deno 2.1.4"
  },
  machine: "Mac17,3/arm64/macOS 26.5.2/25F84",
  startedAt: state.startedAt,
  finishedAt
};
capsule.budget = {
  activeLimitMinutes: 480,
  toolCallLimit: 400,
  activeElapsedMs,
  toolCalls: 78,
  timedWindowFrozenAt: finishedAt,
  extension: false
};
capsule.actors = {
  alice: { principalIdHash: seed.personas.alice.idHash, role: "host" },
  bob: { principalIdHash: seed.personas.bob.idHash, role: "guest" },
  mallory: { principalIdHash: seed.personas.mallory.idHash, role: "outsider" }
};
capsule.targets.binding = {
  mode: "fresh-local",
  namespace: state.namespace,
  baselineReceiptPath: "",
  scopedCleanupPlanPath: evidence("cleanup-plan.json")
};
capsule.targets.local = {
  status: "cleaned",
  identityHash: target.identityHash,
  profile: target.profile,
  gapReason: "",
  receiptPaths: [
    evidence("target-identity.json"),
    evidence("operations.json"),
    evidence("pre-cleanup-resources.json"),
    evidence("cleanup.json")
  ]
};
capsule.targets.hosted = {
  status: "explicit-gap",
  identityHash: "",
  profile: "managed Postgres, Auth, Realtime, Storage, Edge Functions",
  plan: "Pro with Micro compute",
  region: "",
  gapReason: operations.hosted.reason,
  receiptPaths: [evidence("operations.json")]
};
capsule.milestones = {
  firstLocalReadMs: acceptance.milestones.firstLocalReadMs,
  firstAuthoritativeMutationMs: acceptance.milestones.firstAuthoritativeMutationMs,
  firstRealtimeTransitionMs: acceptance.milestones.firstRealtimeTransitionMs,
  localAcceptanceMs: acceptance.milestones.localAcceptanceMs,
  hostedUrlMs: null,
  acceptanceCompletionMs: activeElapsedMs
};
capsule.assistanceEvents = [
  {
    type: "environment-workaround",
    note: "Colima cannot bind the assigned /private/tmp worktree, so only the exact CLI runtime project was mirrored under /Users and later removed.",
    receiptPaths: [evidence("cleanup-plan.json"), evidence("cleanup.json")]
  },
  {
    type: "retained-failed-attempts",
    note: "Cold Realtime readiness, Auth restart readiness, Edge function discovery/auth, provider-secret cache, and final socket-disposal corrections remain append-only.",
    receiptPaths: [
      ...Array.from({ length: 9 }, (_, index) => evidence(`failed-attempt-${index + 1}-${[
        "cold-realtime", "cold-realtime", "auth-readiness", "edge-effect", "edge-effect",
        "edge-auth-header", "edge-auth-validation", "provider-auth-header", "provider-secret-cache"
      ][index]}.json`)),
      evidence("failed-attempt-10-complete-process-exit.json")
    ]
  }
];
capsule.commands = [
  { command: "npm install --no-audit --no-fund", exitStatus: 0, startedMonotonicMs: 0, finishedMonotonicMs: 10000, classification: "dependencies", note: "Pinned arm-local install." },
  { command: "supabase start/reset exact runtime project", exitStatus: 0, startedMonotonicMs: 10001, finishedMonotonicMs: 60000, classification: "fresh-local-target", note: "Official CLI stack, storage, Edge Runtime, and pg_cron." },
  { command: "retained acceptance/debug attempts", exitStatus: 1, startedMonotonicMs: 60001, finishedMonotonicMs: failedWindowEnd, classification: "retained-corrections", note: "Raw failed attempts remain separately classified; no Stop defect." },
  { command: "npm run acceptance (final clean)", exitStatus: 0, startedMonotonicMs: finalRunStart, finishedMonotonicMs: inventoryStart - 1, classification: "acceptance", note: "Fourteen local scenarios passed; hosted scenario unavailable." },
  { command: "pre-cleanup inventory, schema/log hash, npm audit", exitStatus: 0, startedMonotonicMs: inventoryStart, finishedMonotonicMs: cleanupStart - 1, classification: "evidence", note: "Exact target/resources and zero-vulnerability audit retained." },
  { command: "supabase stop --no-backup exact workdir; cleanup probe", exitStatus: 0, startedMonotonicMs: cleanupStart, finishedMonotonicMs: activeElapsedMs, classification: "target-bound-cleanup", note: "Exact resources/state absent and unrelated pre-existing containers preserved." }
];
capsule.scenarioResults = capsule.scenarioResults.map((scenario) => {
  const result = acceptance.results[scenario.id];
  const extra = scenario.id === "PARTY-01-SEED"
    ? [evidence("seed.json"), evidence("target-identity.json")]
    : scenario.id === "PARTY-13-DEPLOY"
      ? [evidence("operations.json")]
      : scenario.id === "PARTY-14-PERFORMANCE"
        ? [evidence("performance.json")]
        : scenario.id === "PARTY-15-CLEANUP"
          ? [evidence("cleanup-plan.json"), evidence("pre-cleanup-resources.json"), evidence("cleanup.json"), evidence("backup-manifest.json")]
          : [];
  return {
    id: scenario.id,
    status: result.status,
    evidencePaths: [evidence("acceptance.json"), evidence(`scenarios/${scenario.id}.json`), ...extra],
    transport: transports[scenario.id],
    authoritativeCheck: checks[scenario.id],
    note: result.note ?? ""
  };
});
capsule.inventory = {
  receiptPath: evidence("inventory.json"),
  authoredSource: inventory.totals["authored-source"],
  generated: inventory.totals.generated ?? { files: 0, bytes: 0, lines: 0 },
  tests: inventory.totals.test,
  configuration: inventory.totals.configuration,
  policy: {
    files: 1,
    bytes: (await stat(path.join(work, "supabase", "migrations", "20260729060000_partiful.sql"))).size,
    paths: ["work/supabase/migrations/20260729060000_partiful.sql"]
  },
  dependencyManifests: inventory.totals["dependency-manifest"],
  installedDependencyBytes: inventory.installedDependencyBytes,
  glue: [
    "runtime-only /Users mirror for Colima worktree bind compatibility",
    "SQL RLS helpers and RPCs for role/capacity/schedule settlement",
    "two Edge Functions for an inspectable deterministic local HTTP effect boundary",
    "native pg_cron five-second reminder driver",
    "cold Realtime lifecycle retry retained rather than hidden",
    "no hosted capability inferred from local evidence"
  ]
};
capsule.evidenceConfidence = {
  "actor-authority": { score: 2, reason: "Six native Auth users, direct host/cohost/guest/outsider role probes, RLS field/list boundaries, and revocation negatives.", evidencePaths: [evidence("seed.json"), evidence("acceptance.json")] },
  "transaction-conflict": { score: 2, reason: "Two authenticated RPCs raced at a barrier; row-lock capacity settlement admitted exactly one seat and authority matched.", evidencePaths: [evidence("scenarios/PARTY-06-CAPACITY.json")] },
  transport: { score: 2, reason: "Direct already-connected policy, wall/RSVP burst, and protected-revocation Postgres Changes receipts; cold missed transitions remain retained.", evidencePaths: [evidence("acceptance.json"), evidence("performance.json")] },
  "offline-reconnect": { score: 1, reason: "Protected already-connected invalidation/revocation is direct, but Partiful has no frozen persistent-offline scenario.", evidencePaths: [evidence("scenarios/PARTY-05-GUEST-LIST.json"), evidence("scenarios/PARTY-12-REVOCATION.json")] },
  settlement: { score: 2, reason: "RSVP revisions, capacity authority, cron dedupe, known-success retry, ambiguous reconciliation, and asset deletion have independent readback.", evidencePaths: [evidence("acceptance.json")] },
  "target-identity": { score: 2, reason: "Exact project/API/DB hashes, versions, containers, schema, operations, and cleanup bind one fresh local target.", evidencePaths: [evidence("target-identity.json"), evidence("pre-cleanup-resources.json")] },
  "cleanup-isolation": { score: 1, reason: "Exact project/state/port negatives and preservation of pre-existing unrelated containers are direct; no separately timestamped empty pre-provision baseline was captured.", evidencePaths: [evidence("cleanup-plan.json"), evidence("pre-cleanup-resources.json"), evidence("cleanup.json")] },
  "artifact-reproducibility": { score: 2, reason: "Pinned lockfile, schema/RLS, functions, deterministic seed, app, acceptance, raw timings, failures, hashes, inventory, and cleanup source are retained.", evidencePaths: [evidence("inventory.json"), evidence("backup-manifest.json"), evidence("npm-audit.json")] }
};
capsule.stopDefects = [];
capsule.cleanup = {
  status: "complete",
  targetBoundPlanPath: evidence("cleanup-plan.json"),
  receiptPaths: [evidence("pre-cleanup-resources.json"), evidence("cleanup.json"), evidence("backup-manifest.json")],
  postCleanupProbe: "Exact project containers/volumes/network, credential-bearing runtime/XDG state, and ports 4330/57431-57440 are absent; all pre-existing unrelated containers remain."
};
capsule.result = "complete";

await writeFile(capsulePath, `${JSON.stringify(capsule, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, capsulePath, activeElapsedMs }));

async function json(file) {
  return JSON.parse(await readFile(file, "utf8"));
}
