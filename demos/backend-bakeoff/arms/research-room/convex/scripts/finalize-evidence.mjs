import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const arm = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = path.join(arm, "evidence");
const baseCommit = "0dc4b3ff6257edc2ee0fea869fca5142531d0ce5";
const frozenSnapbackSourceCommit = "5f31cb6174daaefa04a1e05242acbbc22c725040";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const readJson = async (name) => JSON.parse(await readFile(path.join(evidenceDir, name), "utf8"));

const acceptance = await readJson("acceptance.untimed.json");
const cleanup = await readJson("cleanup-receipt.v1.json");
const runtimePerformance = await readJson("performance.runtime.json");
const buildPerformance = await readJson("performance.build.json");
const assistance = await readJson("assistance-and-failures.json");
const security = await readJson("security-scan.precleanup.json");
const stop = await readJson("stop-defect.v1.json");
const isolation = await readJson("isolation-and-command-receipts.json");

const performanceScenario = acceptance.scenarios.find((item) => item.id === "RESEARCH-14-PERFORMANCE");
performanceScenario.details = {
  ...performanceScenario.details,
  buildSamplesPending: false,
  runtimePaths: runtimePerformance.paths.map((item) => ({
    name: item.name,
    warmupCount: item.warmupsMs.length,
    recordedCount: item.recorded.rawMs.length,
  })),
  buildPath: {
    name: buildPerformance.name,
    warmupCount: buildPerformance.warmupsMs.length,
    recordedCount: buildPerformance.recorded.rawMs.length,
  },
  costWindow: runtimePerformance.costWindow,
};

acceptance.scenarios.push({
  id: "RESEARCH-15-CLEANUP",
  status: "pass",
  transport: "not-applicable",
  authoritativeCheck:
    "Provider mutation/probe reached zero rows before exact target process, listener, config, secret, and path removal.",
  details: cleanup,
});
acceptance.finishedAt = cleanup.cleanedAt;
acceptance.summary = {
  expectedCheckCount: 15,
  actualCheckCount: acceptance.scenarios.length,
  passCount: acceptance.scenarios.filter((item) => item.status === "pass").length,
  failCount: acceptance.scenarios.filter((item) => item.status === "fail").length,
  gapCount: acceptance.scenarios.filter((item) => item.status === "gap").length,
  result: "stopped",
};
await writeFile(
  path.join(evidenceDir, "acceptance.final.json"),
  JSON.stringify(acceptance, null, 2) + "\n",
);

async function listFiles(root, prefix = "") {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (["node_modules", ".convex", "dist"].includes(entry.name)) continue;
    const relative = path.join(prefix, entry.name);
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await listFiles(absolute, relative)));
    else result.push(relative);
  }
  return result;
}

async function volume(paths) {
  let bytes = 0;
  let lines = 0;
  for (const relative of paths) {
    const data = await readFile(path.join(arm, relative));
    bytes += data.length;
    lines += data.toString("utf8").split("\n").length - 1;
  }
  return { files: paths.length, lines, bytes, paths: paths.sort() };
}

const allFiles = await listFiles(arm);
const generatedApi = allFiles.filter((name) => name.startsWith("convex/_generated/"));
const evidenceFiles = allFiles.filter((name) => name.startsWith("evidence/"));
const tests = ["harness.ts"];
const configuration = [
  ".gitignore",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
].filter((name) => allFiles.includes(name));
const authoredSource = allFiles.filter(
  (name) =>
    (name.startsWith("convex/") ||
      name.startsWith("src/") ||
      name.startsWith("scripts/") ||
      name === "index.html") &&
    !generatedApi.includes(name),
);
const documentation = ["README.md", "diary-entry-draft.md"].filter((name) => allFiles.includes(name));
const installedDependencyBytes = Number(
  execFileSync("du", ["-sb", path.join(arm, "node_modules")], { encoding: "utf8" })
    .trim()
    .split(/\s+/)[0],
);
const inventory = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  authoredSource: await volume(authoredSource),
  generated: await volume(generatedApi),
  tests: await volume(tests),
  configuration: await volume(configuration),
  documentation: await volume(documentation),
  evidence: await volume(evidenceFiles),
  policy: { files: 0, lines: 0, bytes: 0, paths: [] },
  dependencyManifests: await volume(["package.json", "package-lock.json"]),
  installedDependencyBytes,
  glue: [
    "harness.ts: local-only native acting-identity acceptance driver; never bundled",
    "convex/http.ts: deterministic HTTP fixture for scheduled external fetch",
    "scripts/run-build-samples.mjs: frozen Vite build sampler",
    "scripts/precleanup-security.sh: exact-value security scan without value output",
    "scripts/cleanup-arm.sh: exact target-bound cleanup"
  ],
};
await writeFile(path.join(evidenceDir, "inventory.v1.json"), JSON.stringify(inventory, null, 2) + "\n");

const scenarioResults = acceptance.scenarios.map((scenario) => ({
  id: scenario.id,
  status: scenario.status,
  evidencePaths: [
    "evidence/acceptance.final.json",
    ...(scenario.id === "RESEARCH-13-SECRETS"
      ? ["evidence/security-scan.precleanup.json", "evidence/stop-defect.v1.json"]
      : []),
    ...(scenario.id === "RESEARCH-14-PERFORMANCE"
      ? ["evidence/performance.runtime.json", "evidence/performance.build.json"]
      : []),
    ...(scenario.id === "RESEARCH-15-CLEANUP"
      ? ["evidence/cleanup-plan.v1.json", "evidence/cleanup-receipt.v1.json"]
      : []),
  ],
  transport:
    scenario.id === "RESEARCH-03-OUTSIDER" ||
    scenario.id === "RESEARCH-06-PROGRESS" ||
    scenario.id === "RESEARCH-08-COLLABORATOR" ||
    scenario.id === "RESEARCH-14-PERFORMANCE"
      ? "push"
      : "not-applicable",
  authoritativeCheck: scenario.authoritativeCheck,
  note:
    scenario.id === "RESEARCH-13-SECRETS"
      ? "Application canary passed; provider-local control-secret argv behavior causes FAIL/Stop."
      : "",
}));

const capsule = {
  schemaVersion: 1,
  protocolId: "llp-0102-backend-bakeoff-v1",
  arm: {
    app: "research-room",
    provider: "convex",
    round: "untimed-extension",
    attemptId: "research-room-convex-deep-01-r2",
  },
  environment: {
    freezeAggregateSha256: "ab95cd3099b7dde29810046ba495884e3bc641a3bdfb811ab828db10c6b7f72a",
    sourceCommit: baseCommit,
    frozenSnapbackSourceCommit,
    providerVersions: { product: "Convex", client: "1.42.3", cli: "1.42.3" },
    machine: `${isolation.machine.hostname}/${isolation.machine.architecture}/${isolation.machine.os}/${isolation.machine.kernel}`,
    startedAt: isolation.timestamps.timedStart,
    finishedAt: cleanup.cleanedAt,
    providerDocumentationSnapshot: [
      "https://docs.convex.dev/cli/local-deployments",
      "https://docs.convex.dev/cli/agent-mode",
      "https://docs.convex.dev/search/text-search",
      "https://docs.convex.dev/search/vector-search",
      "https://docs.convex.dev/file-storage/upload-files",
      "https://docs.convex.dev/scheduling/scheduled-functions"
    ],
  },
  budget: {
    activeLimitMinutes: 480,
    toolCallLimit: 400,
    activeElapsedMs: 836000,
    toolCalls: 0,
    toolCallCountAvailable: false,
    timedWindowFrozenAt: "2026-07-29T10:39:02Z",
    extension: true,
    note: "Timed window froze at the Stop defect before scenario work; all scenarios are untimed.",
  },
  actors: {
    alice: { principalIdHash: acceptance.actors.alice, role: "owner" },
    bob: { principalIdHash: acceptance.actors.bob, role: "member" },
    mallory: { principalIdHash: acceptance.actors.mallory, role: "outsider" },
  },
  targets: {
    binding: {
      mode: "fresh-local",
      namespace: "llp0102-research-convex-w2",
      baselineReceiptPath: "not-applicable-fresh-local",
      scopedCleanupPlanPath: "evidence/cleanup-plan.v1.json",
    },
    local: {
      status: "cleaned",
      identityHash: acceptance.target.deploymentUrlHash,
      profile: "official anonymous local deployment (beta)",
      gapReason: "",
      receiptPaths: [
        "evidence/isolation-and-command-receipts.json",
        "evidence/cleanup-receipt.v1.json"
      ],
    },
    hosted: {
      status: "explicit-gap",
      identityHash: "",
      profile: "managed production deployment",
      plan: "Starter",
      region: "provider-selected US region",
      gapReason: "No isolated hosted credential was available; no hosted deployment/auth/operations/cost claim.",
      receiptPaths: [],
    },
  },
  milestones: {
    firstLocalReadMs: acceptance.milestones.firstLocalReadMs,
    firstAuthoritativeMutationMs: acceptance.milestones.firstAuthoritativeMutationMs,
    firstRealtimeTransitionMs: acceptance.milestones.firstRealtimeTransitionMs,
    localAcceptanceMs: null,
    hostedUrlMs: null,
    acceptanceCompletionMs: null,
    timingWindow: "untimed-extension",
  },
  assistanceEvents: assistance.assistanceEvents,
  commands: [],
  scenarioResults,
  inventory: {
    receiptPath: "evidence/inventory.v1.json",
    authoredSource: inventory.authoredSource,
    generated: inventory.generated,
    tests: inventory.tests,
    configuration: inventory.configuration,
    policy: inventory.policy,
    dependencyManifests: inventory.dependencyManifests,
    installedDependencyBytes,
    glue: inventory.glue,
  },
  evidenceConfidence: {
    "actor-authority": {
      score: 2,
      reason: "Three distinct native local acting identities exercised positive and negative backend paths.",
      evidencePaths: ["evidence/acceptance.final.json"],
    },
    "transaction-conflict": {
      score: 2,
      reason: "Cancellation and dedupe settlement were directly queried from indexed durable records.",
      evidencePaths: ["evidence/acceptance.final.json"],
    },
    transport: {
      score: 2,
      reason: "A separate Bob ConvexClient observed native WebSocket updates.",
      evidencePaths: ["evidence/acceptance.final.json", "evidence/performance.runtime.json"],
    },
    "offline-reconnect": {
      score: 1,
      reason: "Fresh-client reconnect was direct; no offline-retained-data claim was required or made.",
      evidencePaths: ["evidence/performance.runtime.json"],
    },
    settlement: {
      score: 2,
      reason: "Retry, cancellation, late rejection, schedule dedupe, and outcome states are direct.",
      evidencePaths: ["evidence/acceptance.final.json"],
    },
    "target-identity": {
      score: 1,
      reason: "Fresh local identity and paths are direct; hosted identity is unavailable.",
      evidencePaths: ["evidence/isolation-and-command-receipts.json"],
    },
    "cleanup-isolation": {
      score: 2,
      reason: "Provider zero-row probe preceded exact process/listener/path/secret absence proofs.",
      evidencePaths: ["evidence/cleanup-receipt.v1.json"],
    },
    "artifact-reproducibility": {
      score: 2,
      reason: "Pinned dependency lock, source, scripts, raw samples, digests, and deterministic fixtures are retained.",
      evidencePaths: ["evidence/inventory.v1.json", "evidence/isolation-and-command-receipts.json"],
    },
  },
  stopDefects: [
    {
      id: stop.providerDefect.id,
      classification: "provider",
      scenario: "RESEARCH-13-SECRETS",
      evidencePaths: ["evidence/stop-defect.v1.json", "evidence/security-scan.precleanup.json"],
    },
    {
      id: stop.builderPropagation.id,
      classification: "builder",
      scenario: "pre-scenario-isolation-proof",
      evidencePaths: ["evidence/stop-defect.v1.json", "evidence/cleanup-receipt.v1.json"],
    },
  ],
  cleanup: {
    status: "complete",
    targetBoundPlanPath: "evidence/cleanup-plan.v1.json",
    receiptPaths: ["evidence/cleanup-receipt.v1.json"],
    postCleanupProbe: "Zero application rows, listeners, recorded processes, target paths, and exact secret matches.",
  },
  result: "stopped",
};
await writeFile(path.join(arm, "run-capsule.v1.json"), JSON.stringify(capsule, null, 2) + "\n");

const failed = acceptance.scenarios.filter((scenario) => scenario.status === "fail");
const report = `# Convex Research Room acceptance report

- Result: **stopped** — ${acceptance.summary.passCount}/15 pass, ${acceptance.summary.failCount}/15 fail.
- Timed result: frozen before scenario work at the Stop defect.
- Product evidence: untimed extension on a rotated fresh anonymous local target.
- Hosted evidence: unavailable and unclaimed.
- Cleanup: pass.

## Stop defect

Convex local 1.42.3 supplies its generated control secret through the
\`--instance-secret\` process-argv flag and binds backend/site ports to wildcard
addresses. The initial proof collector propagated that value by printing full
argv. The exact r1 target was contained and destroyed before scenario work; r2
rotated the credential and reproduced the provider behavior. Only fingerprints
and redacted flag names remain. This makes \`RESEARCH-13-SECRETS\` fail even
though the application canary stayed server-side.

## Scenario result

${acceptance.scenarios.map((scenario) => `- ${scenario.status.toUpperCase()} — ${scenario.id}: ${scenario.authoritativeCheck}`).join("\n")}

## Provider facts

- Full-text search used a room-filtered Convex search index.
- Semantic retrieval used a 32-dimension Convex vector index from an action.
- Files used native upload URLs, storage IDs, authenticated delivery, and deletion.
- Four durable scheduler-authored progress commits reached Bob via native WebSocket push.
- Retry used a room/dedupe index; cancellation suppressed every scheduled and injected late patch.
- Scheduled refresh used the native scheduler, an action HTTP fetch, and an idempotent internal mutation.
- Local development identities directly proved Alice/Bob/Mallory authority. They do not prove production Convex Auth.
- Two warmups plus seven recorded samples are retained for read, write, realtime, reconnect, and Vite build paths.

## Confidence

Dimension total: 14/16. Target identity is local-only (1/2), and reconnect is
direct while offline retention is unclaimed (1/2). The Stop defect is not
averaged into this confidence number and independently disqualifies the tested
version for this app.

## Evidence

See \`run-capsule.v1.json\`, \`evidence/acceptance.final.json\`,
\`evidence/stop-defect.v1.json\`, \`evidence/security-scan.precleanup.json\`,
\`evidence/performance.runtime.json\`, \`evidence/performance.build.json\`, and
\`evidence/cleanup-receipt.v1.json\`.
`;
await writeFile(path.join(evidenceDir, "acceptance-report.md"), report);

const capsuleBytes = await readFile(path.join(arm, "run-capsule.v1.json"));
await writeFile(
  path.join(evidenceDir, "artifact-digests.v1.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      acceptanceFinalSha256: sha256(await readFile(path.join(evidenceDir, "acceptance.final.json"))),
      cleanupReceiptSha256: sha256(await readFile(path.join(evidenceDir, "cleanup-receipt.v1.json"))),
      inventorySha256: sha256(await readFile(path.join(evidenceDir, "inventory.v1.json"))),
      runCapsuleSha256: sha256(capsuleBytes),
    },
    null,
    2,
  ) + "\n",
);

if (
  acceptance.scenarios.length !== 15 ||
  acceptance.summary.passCount !== 14 ||
  failed.length !== 1 ||
  failed[0].id !== "RESEARCH-13-SECRETS" ||
  cleanup.status !== "pass" ||
  security.r2ControlSecret.prohibitedArtifactMatches !== 0 ||
  security.applicationCanary.prohibitedArtifactMatches !== 0
) {
  throw new Error("FINAL_EVIDENCE_INVARIANT_FAILED");
}
