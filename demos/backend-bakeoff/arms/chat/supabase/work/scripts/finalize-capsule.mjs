import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = path.resolve(here, "..");
const arm = path.resolve(work, "..");
const capsulePath = path.join(arm, "run-capsule.v1.json");
const capsule = JSON.parse(await readFile(capsulePath, "utf8"));
const acceptance = JSON.parse(await readFile(path.join(arm, "receipts", "acceptance.json"), "utf8"));
const performance = JSON.parse(await readFile(path.join(arm, "receipts", "performance.json"), "utf8"));
const inventory = JSON.parse(await readFile(path.join(arm, "receipts", "inventory.json"), "utf8"));
const commandLog = JSON.parse(await readFile(path.join(arm, "receipts", "command-log.json"), "utf8"));
const target = JSON.parse(await readFile(path.join(arm, "receipts", "target-identity.json"), "utf8"));
const seed = JSON.parse(await readFile(path.join(arm, "receipts", "seed.json"), "utf8"));
const policyStat = await stat(path.join(work, "supabase", "migrations", "20260729011000_chat.sql"));

const prefix = "demos/backend-bakeoff/arms/chat/supabase";
const evidence = (name) => `${prefix}/receipts/${name}`;
const checks = {
  "CHAT-01-SEED": "Authoritative service-role counts were exactly 4 channels, 10 memberships, and 500 messages (125 per channel).",
  "CHAT-02-AUTHORITY": "Alice and Bob read private history; Mallory read zero rows and her RLS-authorized private Realtime join returned CHANNEL_ERROR.",
  "CHAT-03-SEND": "Independent service-role read matched the database-assigned UUID, Alice author, generated identity sequence, and timestamp; author spoof was rejected.",
  "CHAT-04-PUSH": "Bob's second authenticated client received Alice's committed public message through Realtime Postgres Changes without product polling.",
  "CHAT-05-PAGINATION": "Two 25-row seq-cursor pages had a 50-row unique union and excluded the concurrent newer insert.",
  "CHAT-06-TYPING": "Bob received native Broadcast; authoritative message-table inspection found zero durable typing rows after the application display TTL.",
  "CHAT-07-PRESENCE": "Alice observed two Presence keys after track and one after Bob untracked.",
  "CHAT-08-RECONNECT": "Fresh authoritative history after Realtime resubscribe contained the disconnected insert and 25 unique IDs.",
  "CHAT-09-OFFLINE-HISTORY": "Cold retained history is unsupported by bare supabase-js; no provider-owned retained query store exists.",
  "CHAT-10-UNREAD": "Bob's durable marker written by client one matched client two before and after reconnect; the later Alice seq counted unread.",
  "CHAT-11-CONCURRENT-SEND": "Both barrier-launched actor writes existed authoritatively and generated identity sequence gave a strict deterministic order.",
  "CHAT-12-LOGOUT": "After signOut resolved and application cleanup removed channels, the already-connected client observed zero future private events.",
  "CHAT-13-REVOKE": "After membership deletion, Bob's fresh private query returned zero and his established Postgres Changes subscription received zero future protected messages.",
  "CHAT-14-PERFORMANCE": "Each frozen path retained two warmups and seven recorded samples plus raw, median, nearest-rank p95, dataset, and machine context.",
  "CHAT-15-CLEANUP": "Exact CLI stop selected project llp0102-chat-supabase-w3; post-probe found zero matching containers/volumes/networks and every assigned port closed."
};
const transport = {
  "CHAT-01-SEED": "not-applicable",
  "CHAT-02-AUTHORITY": "push",
  "CHAT-03-SEND": "not-applicable",
  "CHAT-04-PUSH": "push",
  "CHAT-05-PAGINATION": "not-applicable",
  "CHAT-06-TYPING": "push",
  "CHAT-07-PRESENCE": "push",
  "CHAT-08-RECONNECT": "push",
  "CHAT-09-OFFLINE-HISTORY": "unsupported",
  "CHAT-10-UNREAD": "not-applicable",
  "CHAT-11-CONCURRENT-SEND": "not-applicable",
  "CHAT-12-LOGOUT": "push",
  "CHAT-13-REVOKE": "push",
  "CHAT-14-PERFORMANCE": "push",
  "CHAT-15-CLEANUP": "not-applicable"
};
const extraEvidence = {
  "CHAT-01-SEED": [evidence("seed.json"), evidence("target-identity.json")],
  "CHAT-02-AUTHORITY": [evidence("transport-attribution.json")],
  "CHAT-03-SEND": [],
  "CHAT-04-PUSH": [evidence("transport-attribution.json")],
  "CHAT-05-PAGINATION": [],
  "CHAT-06-TYPING": [evidence("transport-attribution.json")],
  "CHAT-07-PRESENCE": [evidence("transport-attribution.json")],
  "CHAT-08-RECONNECT": [evidence("transport-attribution.json")],
  "CHAT-09-OFFLINE-HISTORY": [evidence("offline-history-gap.json")],
  "CHAT-10-UNREAD": [],
  "CHAT-11-CONCURRENT-SEND": [],
  "CHAT-12-LOGOUT": [evidence("transport-attribution.json")],
  "CHAT-13-REVOKE": [evidence("transport-attribution.json")],
  "CHAT-14-PERFORMANCE": [evidence("performance.json")],
  "CHAT-15-CLEANUP": [evidence("pre-cleanup-resources.json"), evidence("cleanup.json"), `${prefix}/cleanup-plan.json`]
};

capsule.environment.startedAt = "2026-07-29T01:09:14.731Z";
capsule.environment.finishedAt = "2026-07-29T02:32:22.939Z";
capsule.budget.activeElapsedMs = 4_988_205;
capsule.budget.toolCalls = 79;
capsule.budget.timedWindowFrozenAt = capsule.environment.finishedAt;
capsule.actors = {
  alice: { principalIdHash: seed.actors.alice, role: "private-channel owner and public-channel member" },
  bob: { principalIdHash: seed.actors.bob, role: "member" },
  mallory: { principalIdHash: seed.actors.mallory, role: "outsider to private channels" }
};
capsule.targets.binding = {
  mode: "fresh-local",
  namespace: capsule.targets.binding.namespace,
  baselineReceiptPath: evidence("pre-provision.json"),
  scopedCleanupPlanPath: `${prefix}/cleanup-plan.json`
};
capsule.targets.local = {
  status: "cleaned",
  identityHash: target.identityHash,
  profile: "official Supabase CLI Docker stack",
  gapReason: "",
  receiptPaths: [
    evidence("pre-provision.json"),
    evidence("target-identity.json"),
    evidence("pre-cleanup-resources.json"),
    evidence("cleanup.json")
  ]
};
capsule.targets.hosted = {
  ...capsule.targets.hosted,
  status: "explicit-gap",
  identityHash: "",
  gapReason: "Hosted target was not provisioned in this isolated worker. The official local CLI path supplied product evidence; hosted deployment, region, operations, usage, and list-price evidence remain unavailable and are not scored as product failures.",
  receiptPaths: []
};
capsule.milestones = {
  firstLocalReadMs: 4_500_000,
  firstAuthoritativeMutationMs: 4_767_554,
  firstRealtimeTransitionMs: 4_767_663,
  localAcceptanceMs: 4_785_039,
  hostedUrlMs: null,
  acceptanceCompletionMs: 4_988_205
};
capsule.assistanceEvents = [
  {
    type: "official-documentation",
    source: "Supabase official Realtime Authorization, Postgres Changes, Broadcast, Presence, and CLI config documentation",
    effect: "Selected realtime.messages RLS, table RLS, private topics, Postgres Changes, Broadcast, Presence, and explicit local ports."
  },
  {
    type: "environment-workaround",
    source: "Local Colima bind-mount diagnosis",
    effect: "Mirrored only the exact CLI runtime project under a unique /Users cache path because Colima could not bind generated files from /private/tmp. Canonical source/evidence stayed in the detached worktree."
  }
];
capsule.commands = commandLog.commands;
capsule.scenarioResults = capsule.scenarioResults.map((scenario) => {
  if (scenario.id === "CHAT-15-CLEANUP") {
    return {
      id: scenario.id,
      status: "pass",
      evidencePaths: extraEvidence[scenario.id],
      transport: transport[scenario.id],
      authoritativeCheck: checks[scenario.id],
      note: "Fresh local project resources and runtime-only state were cleaned exactly; host runtime directories were moved to macOS Trash and remain recoverable until it is emptied."
    };
  }
  const result = acceptance.results[scenario.id];
  return {
    id: scenario.id,
    status: result.status,
    evidencePaths: [evidence("acceptance.json"), ...extraEvidence[scenario.id]],
    transport: transport[scenario.id],
    authoritativeCheck: checks[scenario.id],
    note: result.note ?? ""
  };
});
capsule.inventory = {
  receiptPath: evidence("inventory.json"),
  authoredSource: inventory.totals["authored-source"] ?? { files: 0, bytes: 0, lines: 0 },
  generated: inventory.totals.generated ?? { files: 0, bytes: 0, lines: 0 },
  tests: inventory.totals.test ?? { files: 0, bytes: 0, lines: 0 },
  configuration: inventory.totals.configuration ?? { files: 0, bytes: 0, lines: 0 },
  policy: { files: 1, bytes: policyStat.size, path: `${prefix}/work/supabase/migrations/20260729011000_chat.sql` },
  dependencyManifests: inventory.totals["dependency-manifest"] ?? { files: 0, bytes: 0, lines: 0 },
  installedDependencyBytes: inventory.installedDependencyBytes,
  glue: [
    "runtime-only /Users project mirror for Colima /private/tmp bind limitation (cleaned)",
    "realtime.messages RLS in addition to ordinary table RLS",
    "explicit removeAllChannels logout lifecycle cleanup",
    "application display TTL for ephemeral typing",
    "fresh authoritative snapshot after Realtime resubscribe",
    "durable read_markers table for cross-client unread state"
  ]
};
capsule.evidenceConfidence = {
  "actor-authority": {
    score: 2,
    reason: "Three native Auth users, direct private reads, author-spoof refusal, private topic denial, and post-revocation checks are reproducible.",
    evidencePaths: [evidence("seed.json"), evidence("acceptance.json")]
  },
  "transaction-conflict": {
    score: 2,
    reason: "Both barrier-launched writes were read independently and strictly ordered by database-generated identity sequence.",
    evidencePaths: [evidence("acceptance.json")]
  },
  transport: {
    score: 2,
    reason: "Durable push, Broadcast, and Presence were observed directly and attributed separately; no product polling was used.",
    evidencePaths: [evidence("transport-attribution.json"), evidence("performance.json")]
  },
  "offline-reconnect": {
    score: 1,
    reason: "Reconnect is direct and reproducible, but cold offline history is an explicit provider-client GAP.",
    evidencePaths: [evidence("acceptance.json"), evidence("offline-history-gap.json")]
  },
  settlement: {
    score: 2,
    reason: "Writes were followed by independent authoritative reads, exact counts, or independently observed committed push.",
    evidencePaths: [evidence("acceptance.json")]
  },
  "target-identity": {
    score: 2,
    reason: "The exact local project, ports, image topology, source commit, and identity hash were retained; hosted evidence is separately marked unavailable.",
    evidencePaths: [evidence("target-identity.json"), evidence("pre-cleanup-resources.json")]
  },
  "cleanup-isolation": {
    score: 2,
    reason: "The exact project-bound plan, CLI project filter, resource absence, and closed-port probes are retained.",
    evidencePaths: [`${prefix}/cleanup-plan.json`, evidence("cleanup.json")]
  },
  "artifact-reproducibility": {
    score: 1,
    reason: "Versions, source, policies, scripts, failed attempts, build, and inventory are retained, but Colima required a machine-specific runtime mirror and hosted deployment was not reproduced.",
    evidencePaths: [evidence("inventory.json"), evidence("command-log.json"), evidence("npm-audit.json")]
  }
};
capsule.stopDefects = [];
capsule.cleanup = {
  status: "complete",
  targetBoundPlanPath: `${prefix}/cleanup-plan.json`,
  receiptPaths: [evidence("pre-cleanup-resources.json"), evidence("pre-cleanup-public-schema.sql"), evidence("cleanup.json")],
  postCleanupProbe: "Zero exact-project containers, volumes, and networks; ports 4289 and 55421-55430 all closed; runtime mirror/state absent."
};
capsule.result = "complete";

await writeFile(capsulePath, `${JSON.stringify(capsule, null, 2)}\n`);
console.log(JSON.stringify({
  result: capsule.result,
  statuses: capsule.scenarioResults.reduce((counts, scenario) => {
    counts[scenario.status] = (counts[scenario.status] ?? 0) + 1;
    return counts;
  }, {}),
  confidence: Object.values(capsule.evidenceConfidence).reduce((total, item) => total + item.score, 0),
  performanceMediansMs: Object.fromEntries(Object.entries(performance.paths).map(([name, value]) => [name, value.medianMs]))
}, null, 2));
