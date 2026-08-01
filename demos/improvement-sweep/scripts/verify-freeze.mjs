#!/usr/bin/env node

// G0 sweep-freeze verifier for the LLP 0137 improvement sweep.
//
// Distinguishes protocol validity (the freeze is internally frozen and
// consistent) from execution readiness (G1 package qualification, probe
// credentials, Track B tooling), which is reported but never asserted here.
//
// @ref LLP 0137#g0--sweep-freeze — freeze contracts, shells, probe policy,
// evidence schemas, expected-check-count manifests, and assistance policy;
// Phase 1 deliberately does not freeze a Snapback revision.

import { access, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggregateDigest,
  digestRecord,
  liveOutputDirectories,
} from "./freeze-boundary.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const sweepRoot = path.resolve(here, "..");
const repoRoot = path.resolve(sweepRoot, "../..");
const protocolRoot = path.join(sweepRoot, "protocol");
const writeFreeze = process.argv.includes("--write-freeze");
const errors = [];

const expectedContracts = ["a1", "a2", "a3", "a4", "a5", "a6"];
const expectedOrder = ["a2", "a1", "a3", "a4", "a5", "a6"];
const contractFiles = {
  a1: "a1-field-notebook.v1.json",
  a2: "a2-chat-presence.v1.json",
  a3: "a3-issue-board.v1.json",
  a4: "a4-event-invitation.v1.json",
  a5: "a5-research-room.v1.json",
  a6: "a6-operations-ledger.v1.json",
};
const probeProviders = [
  "convex",
  "supabase",
  "firebase",
  "instantdb",
  "spacetimedb",
];
const expectedProbeGuidance = [
  "firebase:a1",
  "convex:a5",
  "convex:a6",
  "supabase:a5",
  "instantdb:a1",
  "instantdb:a2",
  "spacetimedb:a6",
];

async function json(relative) {
  try {
    return JSON.parse(await readFile(path.join(sweepRoot, relative), "utf8"));
  } catch (error) {
    errors.push(`${relative}: ${error.message}`);
    return {};
  }
}

async function text(relative) {
  try {
    return await readFile(path.join(sweepRoot, relative), "utf8");
  } catch (error) {
    errors.push(`${relative}: ${error.message}`);
    return "";
  }
}

function check(condition, message) {
  if (!condition) errors.push(message);
}

function sameSet(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    [...actual].sort().join("\n") === [...expected].sort().join("\n")
  );
}

const protocol = await json("protocol/protocol.v1.json");
const kernel = await json("protocol/kernel.v1.json");
const assistance = await json("protocol/assistance-policy.v1.json");
const targetLifecycle = await json("protocol/target-lifecycle.v1.json");
const armMatrix = await json("protocol/arm-matrix.v1.json");
const expoReceipt = await json("protocol/expo-receipt.v1.json");
const health = await json("protocol/credentials-health.v1.json");
const environment = await json("protocol/environment.v1.json");
const probePolicy = await text("protocol/probe-policy.md");

// --- protocol ---
check(protocol.schemaVersion === 1, "protocol schemaVersion must be 1");
check(
  protocol.protocolId === "llp-0137-improvement-sweep-v1",
  "protocol id drift",
);
check(
  sameSet(protocol.contracts, expectedContracts),
  "protocol contract set must be a1..a6 exactly once",
);
check(
  Array.isArray(protocol.webSweepOrder) &&
    protocol.webSweepOrder.join(",") === expectedOrder.join(","),
  "web sweep order must be the frozen ascending-ambition order a2,a1,a3,a4,a5,a6",
);
check(
  protocol.snapbackRevision?.frozen === false,
  "Phase 1 must record explicitly that no Snapback revision is frozen",
);
check(
  protocol.timedBudgets?.calibration?.activeMinutes === 240 &&
    protocol.timedBudgets?.calibration?.toolCalls === 200,
  "calibration budget drift (240 minutes / 200 calls)",
);
check(
  protocol.timedBudgets?.deep?.activeMinutes === 480 &&
    protocol.timedBudgets?.deep?.toolCalls === 400,
  "deep budget drift (480 minutes / 400 calls)",
);
check(
  protocol.timedBudgets?.role === "instruments-not-scores",
  "budgets must be recorded as instruments, not scores",
);
check(
  protocol.budgetClassByContract?.a2 === "calibration" &&
    expectedContracts
      .filter((contract) => contract !== "a2")
      .every(
        (contract) => protocol.budgetClassByContract?.[contract] === "deep",
      ),
  "budget classes drift: a2 is the calibration arm; all others are deep",
);
check(
  protocol.gapLedgerDimensions?.length === 10,
  "the gap ledger must retain ten dimensions",
);
check(
  sameSet(protocol.stopClasses, [
    "cross-user-disclosure",
    "secret-exposure",
    "destructive-cleanup",
    "false-capability-claim",
    "late-effect-after-confirmed-cancellation",
  ]),
  "stop classes drift",
);
check(
  protocol.hardRules?.phase1ProducesRanking === false &&
    protocol.hardRules?.phase1ArmsRelabeledAsChampionshipArms === false &&
    protocol.hardRules?.probesProduceRankingClaims === false,
  "phase-1 no-ranking rules must be frozen",
);
check(
  protocol.externalConsumerPosture?.required === true,
  "external consumer posture must be required",
);

// --- contracts ---
const loadedContracts = {};
let totalChecks = 0;
for (const contract of expectedContracts) {
  const relative = `protocol/contracts/${contractFiles[contract]}`;
  const manifest = await json(relative);
  loadedContracts[contract] = manifest;
  const scenarios = manifest.scenarios ?? [];
  check(manifest.contract === contract, `${contract}: contract id drift`);
  check(
    manifest.protocolId === "llp-0137-improvement-sweep-v1",
    `${contract}: protocol id drift`,
  );
  check(
    manifest.expectedCheckCount === scenarios.length,
    `${contract}: expectedCheckCount does not match scenario count`,
  );
  check(scenarios.length >= 10, `${contract}: too few frozen scenarios`);
  const ids = scenarios.map((scenario) => scenario.id);
  check(new Set(ids).size === ids.length, `${contract}: duplicate scenario id`);
  const prefix = `${contract.toUpperCase()}-`;
  check(
    ids.every((id) => id.startsWith(prefix)),
    `${contract}: scenario ids must carry the ${prefix} prefix`,
  );
  check(
    scenarios.every(
      (scenario) =>
        typeof scenario.fact === "string" &&
        scenario.fact.length > 0 &&
        typeof scenario.planBullet === "string" &&
        scenario.planBullet.length > 0 &&
        Array.isArray(scenario.evidence) &&
        scenario.evidence.length > 0,
    ),
    `${contract}: every scenario requires fact, planBullet, and evidence`,
  );
  check(
    scenarios[0]?.kernel === true && scenarios[0]?.id.endsWith("-SEED"),
    `${contract}: first scenario must be the kernel seed`,
  );
  check(
    scenarios.at(-1)?.kernel === true &&
      scenarios.at(-1)?.id.endsWith("-CLEANUP"),
    `${contract}: last scenario must be the kernel cleanup`,
  );
  check(
    manifest.budgetClass === protocol.budgetClassByContract?.[contract],
    `${contract}: budget class disagrees with protocol`,
  );
  check(
    typeof manifest.lineage === "string" && manifest.lineage.length > 0,
    `${contract}: lineage statement required`,
  );
  totalChecks += scenarios.length;

  if (manifest.lineageAcceptanceManifest) {
    try {
      const ancestor = JSON.parse(
        await readFile(
          path.join(repoRoot, manifest.lineageAcceptanceManifest),
          "utf8",
        ),
      );
      const ancestorIds = new Set(
        (ancestor.scenarios ?? []).map((scenario) => scenario.id),
      );
      for (const scenario of scenarios) {
        for (const ancestorId of scenario.lineageAncestors ?? []) {
          check(
            ancestorIds.has(ancestorId),
            `${contract}: ${scenario.id} cites unknown 0102 ancestor ${ancestorId}`,
          );
        }
      }
    } catch (error) {
      errors.push(
        `${contract}: lineage manifest unreadable (${error.message})`,
      );
    }
  } else {
    check(
      manifest.lineage.startsWith("new"),
      `${contract}: lineage contracts must bind their 0102 acceptance manifest`,
    );
  }
}

// --- kernel ---
check(
  Array.isArray(kernel.everyArmRetains) && kernel.everyArmRetains.length >= 14,
  "kernel must retain the full 0102-inherited evidence list",
);
check(
  kernel.everyArmRetains?.some((item) => item.includes("expected check count")),
  "kernel must require an expected check count",
);
check(
  Array.isArray(kernel.nonEvidence) && kernel.nonEvidence.length >= 7,
  "kernel non-evidence list drift",
);
check(
  typeof kernel.stopRule === "string" && kernel.stopRule.includes("Stop-class"),
  "kernel stop rule required",
);

// --- probe policy (frozen verbatim) ---
for (const phrase of [
  "verbatim",
  "fresh competitor probe",
  "justified only when",
  "timeboxed at the deep-arm ceiling",
  "never ranking claims, and never",
  "probes may interleave with Stage 2",
  "Firebase is the pre-declared mobile reference probe",
  "labeled with their source and",
]) {
  check(
    probePolicy.includes(phrase),
    `probe policy lost frozen phrase: "${phrase}"`,
  );
}
for (const provider of ["Firebase", "Convex", "Supabase", "InstantDB", "SpacetimeDB"]) {
  check(
    probePolicy.includes(provider),
    `probe policy must pre-declare ${provider}`,
  );
}

// --- assistance policy ---
check(
  assistance.policyId === "llp-0137-external-consumer-assistance-v1",
  "assistance policy id drift",
);
check(
  typeof assistance.posture === "string" &&
    assistance.posture.includes("external npm consumer"),
  "assistance policy must bind the external-consumer posture",
);
check(
  assistance.fixLoop?.fixesMayLandBetweenArms === true &&
    assistance.fixLoop?.armNotRestartedByFix === true &&
    assistance.fixLoop?.capsulePinsPackageVersions === true,
  "fix-loop rules drift",
);
check(
  assistance.budgets?.exceedingCeilingIsAFinding === true,
  "budget-as-instrument rule drift",
);
check(
  assistance.forbidden?.some((item) => item.includes("because the product under test is ours")),
  "assistance policy must forbid softening findings",
);

// --- target lifecycle ---
check(
  targetLifecycle.isolation?.sharedHostedTargetAllowed === true &&
    targetLifecycle.isolation?.uniqueNamespacePerArm === true &&
    targetLifecycle.isolation?.baselinePreservationRequiredForSharedTargets ===
      true &&
    targetLifecycle.isolation?.reuseAcrossProviders === false,
  "target lifecycle isolation drift",
);
check(
  targetLifecycle.forbidden?.includes("unresolved target variables"),
  "target lifecycle must refuse unresolved cleanup targets",
);

// --- arm matrix and expected check counts ---
for (const contract of expectedContracts) {
  check(
    armMatrix.expectedCheckCounts?.[contract] ===
      loadedContracts[contract]?.expectedCheckCount,
    `${contract}: arm-matrix expected check count disagrees with the contract`,
  );
}
check(
  Array.isArray(armMatrix.snapbackWebArms) &&
    armMatrix.snapbackWebArms.map((arm) => arm.contract).join(",") ===
      expectedOrder.join(","),
  "arm matrix web order drift",
);
const guidancePairs = (armMatrix.probeGuidance ?? []).map(
  (row) => `${row.provider}:${row.contract}`,
);
check(
  sameSet(guidancePairs, expectedProbeGuidance),
  "probe guidance must match the frozen probe policy's strongest-fit list",
);
check(
  armMatrix.probeRules?.status === "guidance-not-commitment",
  "probe guidance must stay guidance, not commitment",
);
check(
  sameSet(armMatrix.trackB?.contracts, ["a1", "a4"]) &&
    sameSet(armMatrix.trackB?.platforms, ["expo-ios", "expo-android"]),
  "Track B scope drift",
);
check(
  sameSet(armMatrix.trackC?.surfaces, [
    "contract-web",
    "exact-native-ios",
    "exact-native-android",
  ]),
  "Track C surfaces drift",
);

// --- expo receipt manifest ---
const expoChecks = expoReceipt.checks ?? [];
check(
  expoReceipt.expectedCheckCount === expoChecks.length &&
    expoChecks.length === 12,
  "expo receipt manifest must freeze twelve checks",
);
const expoIds = expoChecks.map((item) => item.id);
check(new Set(expoIds).size === expoIds.length, "duplicate expo check id");
for (const contract of ["a1", "a4"]) {
  const applicable = expoReceipt.contractApplicability?.[contract] ?? [];
  check(
    applicable.every((id) => expoIds.includes(id)),
    `expo receipt: ${contract} applicability cites unknown check ids`,
  );
  check(
    expoReceipt.expectedCheckCountByContract?.[contract] === applicable.length,
    `expo receipt: ${contract} expected check count disagrees with applicability`,
  );
}

// --- evidence schemas ---
const capsuleSchema = await json("protocol/schemas/run-capsule.v1.schema.json");
const findingSchema = await json("protocol/schemas/finding.v1.schema.json");
const expoSchema = await json("protocol/schemas/expo-receipt.v1.schema.json");
check(
  capsuleSchema.properties?.protocolId?.const ===
    "llp-0137-improvement-sweep-v1",
  "capsule schema protocol id drift",
);
for (const field of [
  "packageVersions",
  "postureBreaks",
  "differentiators",
  "expectedCheckCount",
  "attribution",
  "cleanup",
]) {
  check(
    capsuleSchema.required?.includes(field),
    `capsule schema must require ${field}`,
  );
}
for (const field of [
  "observation",
  "competitorOutcome",
  "classification",
  "mustNotRegress",
  "smallestCoherentFix",
  "acceptanceWitness",
  "owner",
]) {
  check(
    findingSchema.required?.includes(field),
    `finding schema must require ${field}`,
  );
}
check(
  findingSchema.properties?.dimension?.enum?.length === 10,
  "finding schema must enumerate the ten ledger dimensions",
);
check(
  sameSet(expoSchema.properties?.arm?.properties?.platform?.enum, [
    "expo-ios",
    "expo-android",
  ]),
  "expo receipt schema platform enum drift",
);

// --- credentials health (names only) ---
check(
  health.containsSecretValues === false,
  "credential health artifact must declare that it contains no values",
);
check(
  sameSet(Object.keys(health.probeProviders ?? {}), probeProviders),
  "credential health must cover exactly the named probe providers",
);
const credentialText = JSON.stringify(health);
for (const forbidden of [
  /"apiKey"\s*:/i,
  /"token"\s*:\s*"(?!.*only)/i,
  /"password"\s*:/i,
  /"secretValue"\s*:/i,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
]) {
  check(
    !forbidden.test(credentialText),
    `credential health contains forbidden secret-shaped material: ${forbidden}`,
  );
}

// --- environment ---
check(
  environment.snapbackRevision?.frozen === false,
  "environment must restate that Phase 1 freezes no Snapback revision",
);

// --- shells ---
for (const relative of [
  "neutral-web/package.json",
  "neutral-web/package-lock.json",
  "neutral-web/index.html",
  "neutral-web/tsconfig.json",
  "neutral-web/vite.config.ts",
  "neutral-web/src/App.tsx",
  "neutral-web/src/main.tsx",
  "neutral-web/src/styles.css",
  "neutral-web/src/vite-env.d.ts",
  "neutral-expo/package.json",
  "neutral-expo/package-lock.json",
  "neutral-expo/app.json",
  "neutral-expo/App.tsx",
  "neutral-expo/index.ts",
  "neutral-expo/tsconfig.json",
]) {
  try {
    await access(path.join(sweepRoot, relative));
  } catch {
    errors.push(`${relative}: required G0 shell artifact missing`);
  }
}

const webShell = await text("neutral-web/src/App.tsx");
for (const view of ["notebook", "chat", "board", "event", "research", "ops"]) {
  check(
    webShell.includes(`data-testid={\`${view}-shell\`}`) ||
      webShell.includes(`data-testid="${view}-`),
    `web shell: missing stable test ids for the ${view} view`,
  );
}
check(
  !/ProviderAdapter|BackendAdapter|setInterval\s*\(|fetch\s*\(|WebSocket/.test(
    webShell,
  ),
  "web shell contains a provider abstraction, poller, or transport",
);

const expoShell = await text("neutral-expo/App.tsx");
for (const marker of ["notebook-screen", "event-screen", "freshness-state"]) {
  check(
    expoShell.includes(`testID="${marker}"`),
    `expo shell: missing stable test id ${marker}`,
  );
}
check(
  !/ProviderAdapter|BackendAdapter|setInterval\s*\(|fetch\s*\(|WebSocket/.test(
    expoShell,
  ),
  "expo shell contains a provider abstraction, poller, or transport",
);
const expoImports = expoShell.match(/from\s+"([^"]+)"/g) ?? [];
check(
  expoImports.every((statement) =>
    ["react", "react-native", "expo-status-bar", "expo"].some((allowed) =>
      statement.includes(`"${allowed}"`),
    ),
  ),
  "expo shell imports outside the neutral dependency set",
);

for (const shell of ["neutral-web", "neutral-expo"]) {
  const manifest = await json(`${shell}/package.json`);
  const declared = {
    ...(manifest.dependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
  };
  check(
    Object.values(declared).every((version) => /^\d/.test(version)),
    `${shell}: dependency versions must be exact pins, not ranges`,
  );
}

// --- freeze digest ---
async function freezeFiles() {
  const relative = [];
  async function walk(root, prefix) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === ".expo" ||
        /^freeze\.v\d+\.json$/.test(entry.name)
      ) {
        continue;
      }
      if (
        prefix === "demos/improvement-sweep" &&
        liveOutputDirectories.has(entry.name)
      ) {
        continue;
      }
      const absolute = path.join(root, entry.name);
      const next = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) await walk(absolute, next);
      else if (entry.isFile()) relative.push(next);
    }
  }
  await walk(sweepRoot, "demos/improvement-sweep");
  relative.push("llp/0137-react-web-backend-championship.plan.md");
  return relative.sort();
}

async function digestRecords() {
  const records = [];
  for (const relative of await freezeFiles()) {
    const body = await readFile(path.join(repoRoot, relative));
    records.push(digestRecord(relative, body));
  }
  return records;
}

const freezePath = path.join(protocolRoot, "freeze.v1.json");
if (writeFreeze && errors.length === 0) {
  const artifacts = await digestRecords();
  await writeFile(
    freezePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        protocolId: protocol.protocolId,
        frozenAt: new Date().toISOString(),
        gate: "g0-sweep-freeze",
        snapbackRevisionFrozen: false,
        aggregateSha256: aggregateDigest(artifacts),
        artifacts,
        appendOnlyArtifacts: [],
        appendOnlyNote:
          "Diaries are created when each application's first arm begins (LLP 0137 diary protocol); the freeze adds their append-only prefixes prospectively at that point via a dated amendment.",
        liveOutputDirectories: [...liveOutputDirectories].sort(),
      },
      null,
      2,
    )}\n`,
  );
} else {
  try {
    const frozen = JSON.parse(await readFile(freezePath, "utf8"));
    check(frozen.schemaVersion === 1, "freeze schemaVersion must be 1");
    check(
      frozen.snapbackRevisionFrozen === false,
      "freeze must restate that no Snapback revision is frozen",
    );
    const actual = await digestRecords();
    check(
      frozen.aggregateSha256 === aggregateDigest(actual),
      "freeze digest mismatch; record a prospective amendment and rewrite before a diaried arm",
    );
    check(
      JSON.stringify(frozen.artifacts) === JSON.stringify(actual),
      "freeze artifact inventory mismatch",
    );
    check(
      JSON.stringify(frozen.liveOutputDirectories) ===
        JSON.stringify([...liveOutputDirectories].sort()),
      "freeze living-output boundary mismatch",
    );
  } catch (error) {
    errors.push(
      `protocol/freeze.v1.json: ${error.message}; run npm run freeze`,
    );
  }
}

if (errors.length > 0) {
  console.error(JSON.stringify({ ok: false, protocolValid: false, errors }, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      protocolValid: true,
      gate: "g0",
      snapbackRevisionFrozen: false,
      contracts: expectedContracts.length,
      totalWebAcceptanceChecks: totalChecks,
      expoReceiptChecks: expoReceipt.expectedCheckCount,
      readinessNote:
        "G0 freezes the protocol only; diaried arms remain gated on G1 (public package qualification) and, per track, G2/G3.",
    },
    null,
    2,
  ),
);
