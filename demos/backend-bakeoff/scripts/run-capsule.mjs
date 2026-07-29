#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const bakeoffRoot = path.resolve(here, "..");
const providers = ["snapback", "convex", "supabase", "firebase", "instantdb", "spacetimedb", "appwrite"];
const apps = ["todo", "chat", "linear", "partiful", "research-room"];
const finalScenarioStatuses = new Set(["pass", "fail", "gap", "expected-refusal", "unavailable-remote-dependency"]);
const draftScenarioStatuses = new Set([...finalScenarioStatuses, "pending"]);
const results = new Set(["pending", "complete", "timeboxed", "stopped"]);
const transports = new Set(["push", "poll", "local-optimistic", "unsupported", "not-applicable"]);
const confidenceDimensions = [
  "actor-authority",
  "transaction-conflict",
  "transport",
  "offline-reconnect",
  "settlement",
  "target-identity",
  "cleanup-isolation",
  "artifact-reproducibility",
];

// @ref LLP 0102#cross-application-acceptance-kernel — a rendered update or
// empty suite cannot stand in for actors, authority, transport, settlement,
// target identity, expected checks, and cleanup evidence.
async function acceptanceManifest(app) {
  return JSON.parse(await readFile(path.join(bakeoffRoot, "protocol", "acceptance", `${app}.v1.json`), "utf8"));
}

export async function newCapsule({ app, provider, round = app === "todo" || app === "chat" ? "calibration" : "deep", attemptId }) {
  if (!apps.includes(app)) throw new Error(`unknown app: ${app}`);
  if (!providers.includes(provider)) throw new Error(`unknown provider: ${provider}`);
  const [manifest, freeze, environment, inventory, health] = await Promise.all([
    acceptanceManifest(app),
    readFile(path.join(bakeoffRoot, "protocol", "freeze.v2.json"), "utf8").then(JSON.parse),
    readFile(path.join(bakeoffRoot, "protocol", "environment.v1.json"), "utf8").then(JSON.parse),
    readFile(path.join(bakeoffRoot, "protocol", "provider-inventory.v1.json"), "utf8").then(JSON.parse),
    readFile(path.join(bakeoffRoot, "protocol", "credentials-health.v1.json"), "utf8").then(JSON.parse),
  ]);
  const providerInventory = inventory.providers[provider];
  const execution = health.executionCapabilities[provider];
  const hostedGap =
    providerInventory.hosted.status === "explicit-gap" ||
    execution.hostedEvidence === "credential-unavailable" ||
    execution.hostedEvidence === "shared credential probe failed";
  const namespace = `llp0102-${app}-${provider}-${round}-${attemptId}`;
  return {
    schemaVersion: 1,
    protocolId: "llp-0102-backend-bakeoff-v1",
    arm: { app, provider, round, attemptId },
    environment: {
      freezeAggregateSha256: freeze.aggregateSha256,
      sourceCommit: environment.repository.startingCommit,
      providerVersions: {
        product: providerInventory.version ?? providerInventory.product,
        client: providerInventory.client?.version ?? null,
        cli: providerInventory.cli?.version ?? null,
      },
      machine: `${environment.machine.hardwareModel}/${environment.machine.architecture}/${environment.machine.os}/${environment.machine.osBuild}`,
      startedAt: "",
      finishedAt: ""
    },
    budget: {
      activeLimitMinutes: app === "todo" || app === "chat" ? 240 : 480,
      toolCallLimit: app === "todo" || app === "chat" ? 200 : 400,
      activeElapsedMs: 0,
      toolCalls: 0,
      timedWindowFrozenAt: "",
      extension: false
    },
    actors: {
      alice: { principalIdHash: "", role: "" },
      bob: { principalIdHash: "", role: "" },
      mallory: { principalIdHash: "", role: "outsider" }
    },
    targets: {
      binding: {
        mode: execution.targetMode,
        namespace,
        baselineReceiptPath: "",
        scopedCleanupPlanPath: "",
      },
      local: {
        status: "pending",
        identityHash: "",
        profile: providerInventory.local.profile,
        gapReason: "",
        receiptPaths: [],
      },
      hosted: {
        status: hostedGap ? "explicit-gap" : "pending",
        identityHash: "",
        profile: providerInventory.hosted.profile,
        plan: providerInventory.hosted.plan,
        region: providerInventory.hosted.region,
        gapReason: hostedGap
          ? `Hosted evidence unavailable for this arm: ${execution.hostedEvidence}. This is not scored as a product failure.`
          : "",
        receiptPaths: [],
      }
    },
    milestones: {
      firstLocalReadMs: null,
      firstAuthoritativeMutationMs: null,
      firstRealtimeTransitionMs: null,
      localAcceptanceMs: null,
      hostedUrlMs: null,
      acceptanceCompletionMs: null
    },
    assistanceEvents: [],
    commands: [],
    scenarioResults: manifest.scenarios.map((scenario) => ({
      id: scenario.id,
      status: "pending",
      evidencePaths: [],
      transport: "not-applicable",
      authoritativeCheck: "",
      note: ""
    })),
    inventory: {
      receiptPath: "",
      authoredSource: null,
      generated: null,
      tests: null,
      configuration: null,
      policy: null,
      dependencyManifests: null,
      installedDependencyBytes: null,
      glue: []
    },
    evidenceConfidence: Object.fromEntries(confidenceDimensions.map((dimension) => [
      dimension,
      { score: null, reason: "", evidencePaths: [] },
    ])),
    stopDefects: [],
    cleanup: {
      status: "pending",
      targetBoundPlanPath: "",
      receiptPaths: [],
      postCleanupProbe: ""
    },
    result: "pending"
  };
}

function problem(problems, condition, message) {
  if (!condition) problems.push(message);
}

function hasSecretShapedKey(value, at = "$") {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => hasSecretShapedKey(item, `${at}[${index}]`));
  }
  if (!value || typeof value !== "object") return [];
  const findings = [];
  for (const [key, child] of Object.entries(value)) {
    if (/^(apiKey|token|password|secret|privateKey|credentialValue)$/i.test(key)) findings.push(`${at}.${key}`);
    findings.push(...hasSecretShapedKey(child, `${at}.${key}`));
  }
  return findings;
}

export async function verifyCapsule(capsule, { allowDraft = false } = {}) {
  const problems = [];
  problem(problems, capsule?.schemaVersion === 1, "schemaVersion must be 1");
  problem(problems, capsule?.protocolId === "llp-0102-backend-bakeoff-v1", "protocolId mismatch");
  problem(problems, apps.includes(capsule?.arm?.app), "unknown app");
  problem(problems, providers.includes(capsule?.arm?.provider), "unknown provider");
  problem(problems, typeof capsule?.arm?.attemptId === "string" && capsule.arm.attemptId.length > 0, "attemptId required");
  problem(problems, results.has(capsule?.result), "invalid result");
  problem(problems, allowDraft || capsule?.result !== "pending", "final capsule cannot be pending");

  if (apps.includes(capsule?.arm?.app)) {
    const manifest = await acceptanceManifest(capsule.arm.app);
    const scenarioResults = capsule.scenarioResults ?? [];
    problem(problems, scenarioResults.length === manifest.expectedCheckCount,
      `scenario count ${scenarioResults.length} does not match expected ${manifest.expectedCheckCount}`);
    const expectedIds = manifest.scenarios.map((scenario) => scenario.id).sort();
    const actualIds = scenarioResults.map((scenario) => scenario.id).sort();
    problem(problems, JSON.stringify(actualIds) === JSON.stringify(expectedIds), "scenario IDs do not exactly match frozen manifest");
    problem(problems, new Set(actualIds).size === actualIds.length, "duplicate scenario result IDs");
    for (const scenario of scenarioResults) {
      problem(problems, (allowDraft ? draftScenarioStatuses : finalScenarioStatuses).has(scenario.status),
        `${scenario.id}: invalid or pending final status`);
      problem(problems, transports.has(scenario.transport), `${scenario.id}: invalid transport attribution`);
      if (scenario.status === "pass" || scenario.status === "expected-refusal") {
        problem(problems, Array.isArray(scenario.evidencePaths) && scenario.evidencePaths.length > 0,
          `${scenario.id}: pass/refusal requires evidence`);
        problem(problems, typeof scenario.authoritativeCheck === "string" && scenario.authoritativeCheck.length > 0,
          `${scenario.id}: pass/refusal requires authoritative check`);
      }
      if (scenario.status === "gap" || scenario.status === "unavailable-remote-dependency") {
        problem(problems, typeof scenario.note === "string" && scenario.note.length > 0,
          `${scenario.id}: nonclaim requires a note`);
      }
    }
  }

  for (const actor of ["alice", "bob", "mallory"]) {
    problem(problems, typeof capsule?.actors?.[actor]?.principalIdHash === "string", `${actor}: principal hash field required`);
  }
  const binding = capsule?.targets?.binding;
  problem(problems, new Set(["fresh-local", "fresh-hosted", "namespace-isolated-shared-hosted"]).has(binding?.mode),
    "target binding mode is invalid");
  problem(problems, typeof binding?.namespace === "string" && /^llp0102-[a-z0-9-]+$/.test(binding.namespace),
    "target binding requires a safe arm namespace");
  if (binding?.mode === "namespace-isolated-shared-hosted" && !allowDraft) {
    problem(problems, typeof binding.baselineReceiptPath === "string" && binding.baselineReceiptPath.length > 0,
      "shared target requires a redacted baseline receipt");
    problem(problems, typeof binding.scopedCleanupPlanPath === "string" && binding.scopedCleanupPlanPath.length > 0,
      "shared target requires a namespace-scoped cleanup plan");
  }
  for (const targetName of ["local", "hosted"]) {
    const target = capsule?.targets?.[targetName];
    const allowedTargetStatuses = allowDraft
      ? new Set(["pending", "provisioned", "cleaned", "explicit-gap"])
      : new Set(["cleaned", "explicit-gap"]);
    problem(problems, allowedTargetStatuses.has(target?.status), `${targetName}: invalid or unfinished target status`);
    if (target?.status === "explicit-gap") {
      problem(problems, typeof target.gapReason === "string" && target.gapReason.length > 0,
        `${targetName}: explicit target GAP requires a reason`);
    }
    if (target?.status === "provisioned" || target?.status === "cleaned") {
      problem(problems, typeof target.identityHash === "string" && target.identityHash.length > 0,
        `${targetName}: provisioned/cleaned target requires identity hash`);
      problem(problems, Array.isArray(target.receiptPaths) && target.receiptPaths.length > 0,
        `${targetName}: provisioned/cleaned target requires receipts`);
    }
  }
  problem(problems, Array.isArray(capsule?.commands), "commands must be an array");
  for (const command of capsule?.commands ?? []) {
    problem(problems, Number.isInteger(command.exitStatus), "every command requires integer exitStatus");
    problem(problems, Number.isFinite(command.startedMonotonicMs) && Number.isFinite(command.finishedMonotonicMs) &&
      command.finishedMonotonicMs >= command.startedMonotonicMs, "command monotonic interval invalid");
  }
  problem(problems, Number.isFinite(capsule?.budget?.activeElapsedMs) && capsule.budget.activeElapsedMs >= 0, "active elapsed time invalid");
  problem(problems, Number.isInteger(capsule?.budget?.toolCalls) && capsule.budget.toolCalls >= 0, "tool call count invalid");
  const actualDimensions = Object.keys(capsule?.evidenceConfidence ?? {}).sort();
  problem(problems, JSON.stringify(actualDimensions) === JSON.stringify([...confidenceDimensions].sort()),
    "evidence-confidence dimensions do not match frozen set");
  for (const dimension of confidenceDimensions) {
    const confidence = capsule?.evidenceConfidence?.[dimension];
    const scoreAllowed = allowDraft
      ? confidence?.score === null || Number.isInteger(confidence?.score) && confidence.score >= 0 && confidence.score <= 2
      : Number.isInteger(confidence?.score) && confidence.score >= 0 && confidence.score <= 2;
    problem(problems, scoreAllowed, `${dimension}: evidence-confidence score must be 0, 1, or 2`);
    if (!allowDraft) {
      problem(problems, typeof confidence?.reason === "string" && confidence.reason.length > 0,
        `${dimension}: final evidence-confidence score requires a reason`);
      if (confidence?.score > 0) {
        problem(problems, Array.isArray(confidence?.evidencePaths) && confidence.evidencePaths.length > 0,
          `${dimension}: nonzero evidence-confidence score requires evidence`);
      }
    }
  }
  problem(problems, allowDraft || capsule?.cleanup?.status === "complete" || capsule?.cleanup?.status === "explicit-gap",
    "final capsule requires complete cleanup or explicit cleanup GAP");
  if (!allowDraft && capsule?.cleanup?.status === "complete") {
    problem(problems, typeof capsule.cleanup.targetBoundPlanPath === "string" && capsule.cleanup.targetBoundPlanPath.length > 0,
      "complete cleanup requires a target-bound plan");
    problem(problems, Array.isArray(capsule.cleanup.receiptPaths) && capsule.cleanup.receiptPaths.length > 0,
      "complete cleanup requires receipts");
    problem(problems, typeof capsule.cleanup.postCleanupProbe === "string" && capsule.cleanup.postCleanupProbe.length > 0,
      "complete cleanup requires a post-cleanup probe");
  }
  problem(problems, Array.isArray(capsule?.stopDefects), "stopDefects must be an array");
  if ((capsule?.stopDefects ?? []).length > 0) problem(problems, capsule.result === "stopped", "a Stop defect requires stopped result");

  const secretKeys = hasSecretShapedKey(capsule);
  problem(problems, secretKeys.length === 0, `secret-shaped keys are forbidden: ${secretKeys.join(", ")}`);
  return problems;
}

async function main() {
  const [command, first, second, third] = process.argv.slice(2);
  if (command === "new") {
    const [app, provider] = [first, second];
    const attemptId = third;
    if (!attemptId) throw new Error("usage: npm run capsule:new -- <app> <provider> <attempt-id>");
    const capsule = await newCapsule({ app, provider, attemptId });
    const output = path.join(bakeoffRoot, "arms", app, provider, "run-capsule.v1.json");
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(capsule, null, 2)}\n`, { flag: "wx" });
    console.log(output);
    return;
  }
  if (command === "verify") {
    if (!first) throw new Error("usage: npm run capsule:verify -- <capsule> [--draft]");
    const capsule = JSON.parse(await readFile(path.resolve(process.cwd(), first), "utf8"));
    const problems = await verifyCapsule(capsule, { allowDraft: second === "--draft" });
    if (problems.length > 0) {
      console.error(JSON.stringify({ ok: false, problems }, null, 2));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify({ ok: true, app: capsule.arm.app, provider: capsule.arm.provider }, null, 2));
    }
    return;
  }
  throw new Error("usage: node scripts/run-capsule.mjs <new|verify> ...");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
