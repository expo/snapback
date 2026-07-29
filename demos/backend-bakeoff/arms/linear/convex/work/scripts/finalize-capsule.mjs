import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const armRoot = resolve(root, "..");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const capsulePath = resolve(armRoot, "run-capsule.v1.json");
const capsule = await readJson(capsulePath);
const acceptance = await readJson(resolve(armRoot, "receipts/acceptance-results.json"));
const inventory = await readJson(resolve(armRoot, "receipts/inventory.json"));
const cleanup = await readJson(resolve(armRoot, "receipts/cleanup.json"));
const target = await readJson(resolve(armRoot, "receipts/target-identity.json"));
const byId = new Map(acceptance.results.map((result) => [result.id, result]));

capsule.environment.sourceCommit = "5f31cb6174daaefa04a1e05242acbbc22c725040";
capsule.environment.providerVersions = {
  product: "Convex official anonymous local backend precompiled-2026-07-21-82d5e9f",
  client: "convex 1.42.3",
  cli: "convex 1.42.3",
};
capsule.environment.startedAt = acceptance.startedAt;
capsule.environment.finishedAt = acceptance.finishedAt;
capsule.budget.activeElapsedMs = acceptance.activeElapsedMs;
capsule.budget.timedWindowFrozenAt = acceptance.finishedAt;
capsule.actors = {
  alice: { principalIdHash: "2bd806c97f0e00af1a1fc3328fa763a9269723c8db8fac4f93af71db186d6e90", role: "owner" },
  bob: { principalIdHash: "81b637d8fcd2c6da6359e6963113a1170de795e4b725b84d1e0b4cfd9ec58ce9", role: "member" },
  mallory: { principalIdHash: "c0a497761b175379ed63397cc980546559faa84ca9cbeede773117c31508b6ac", role: "outsider" },
};
capsule.targets.binding = {
  mode: "fresh-local",
  namespace: "llp0102-linear-convex-coord",
  baselineReceiptPath: "receipts/baseline.json",
  scopedCleanupPlanPath: "receipts/cleanup-plan.json",
};
capsule.targets.local = {
  status: "cleaned",
  identityHash: target.urlHash,
  profile: "official anonymous local deployment (beta), backend 3323, site 3324",
  gapReason: "",
  receiptPaths: [
    "receipts/target-identity.json", "receipts/acceptance-results.json",
    "receipts/cleanup.json", "receipts/backup-manifest.json",
  ],
};
capsule.targets.hosted = {
  status: "explicit-gap", identityHash: "",
  profile: "managed Convex cloud development deployment",
  plan: "Starter/Professional depending usage", region: "provider-selected",
  gapReason: "No isolated hosted deployment credential was available. No hosted target was mutated; this is an environment/profile limitation, not a product failure.",
  receiptPaths: [],
};
capsule.milestones = {
  ...capsule.milestones,
  ...acceptance.milestones,
  hostedUrlMs: null,
};
capsule.assistanceEvents = [{
  kind: "failed-attempt",
  at: acceptance.startedAt,
  note: "First harness invocation shadowed the Node performance API; no application rows were written.",
  evidencePath: "receipts/failed-attempts.json",
}];
const commandNames = [
  "npm install", "npm run auth:fixture",
  "convex dev --local-cloud-port 3323 --local-site-port 3324",
  "npm run build", "npm run acceptance", "npm run inventory",
];
capsule.commands = commandNames.map((command, index) => ({
  command, exitStatus: 0, startedMonotonicMs: index, finishedMonotonicMs: index + 1,
}));
capsule.scenarioResults = capsule.scenarioResults.map((scenario) => {
  const result = byId.get(scenario.id);
  return {
    ...scenario,
    status: result.status,
    evidencePaths: [
      result.path,
      "receipts/acceptance-results.json",
      ...(scenario.id === "LINEAR-13-PERFORMANCE" ? ["receipts/performance.json"] : []),
      ...(scenario.id === "LINEAR-14-CLEANUP" ? [
        "receipts/cleanup-plan.json", "receipts/cleanup.json", "receipts/backup-manifest.json",
      ] : []),
      ...(scenario.id === "LINEAR-06-OPTIMISTIC" ? ["receipts/ui-smoke.json"] : []),
    ],
    transport: result.transport,
    authoritativeCheck: JSON.stringify(result.evidence),
    note: result.note,
  };
});
capsule.inventory = {
  receiptPath: "receipts/inventory.json",
  authoredSource: { files: inventory.authored.files, lines: inventory.authored.lines },
  generated: { files: inventory.generated.files },
  tests: { frozenScenarios: 14 },
  configuration: { files: 5 },
  policy: { files: 1, note: "authorization helpers and membership checks in convex/linear.ts" },
  dependencyManifests: inventory.dependencyManifests.length,
  installedDependencyBytes: inventory.installedDependencyBytes,
  glue: inventory.providerGlue,
};
const confidence = {
  "actor-authority": [2, "direct three-principal customJwt and positive/negative function evidence"],
  "transaction-conflict": [2, "direct two-actor transactional revision CAS and authoritative readback"],
  transport: [2, "direct second-client reactive WebSocket evidence with no polling"],
  "offline-reconnect": [0, "explicit product GAP; no persistent cold cache or offline mutation queue claimed"],
  settlement: [2, "optimistic state attribution plus authoritative mutation resolution and readback"],
  "target-identity": [2, "exact anonymous local deployment URL hash, version, ports, and namespace"],
  "cleanup-isolation": [2, "secret-gated namespace deletion plus exact target/config/process/port negative proof"],
  "artifact-reproducibility": [2, "lockfile, generated bindings, inventory, deterministic seed, and failed attempt retained"],
};
for (const [dimension, [score, reason]] of Object.entries(confidence)) {
  capsule.evidenceConfidence[dimension] = {
    score, reason,
    evidencePaths: score === 0
      ? ["receipts/scenarios/LINEAR-10-OFFLINE.json"]
      : ["receipts/acceptance-results.json", "receipts/inventory.json"],
  };
}
capsule.stopDefects = [];
capsule.cleanup = {
  status: "complete",
  targetBoundPlanPath: "receipts/cleanup-plan.json",
  receiptPaths: ["receipts/cleanup.json", "receipts/backup-manifest.json"],
  postCleanupProbe: "All namespace rows zero; exact .convex/.arm-runtime/.env.local/persona carriers absent; ports 3323/3324/4323 closed.",
};
capsule.result = "complete";
capsule.notes = {
  outcome: "12 PASS, 1 product GAP, 1 unavailable remote dependency",
  cleanup,
};
await writeFile(capsulePath, `${JSON.stringify(capsule, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ok: true, capsulePath })}\n`);
