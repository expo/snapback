#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const bakeoffRoot = path.resolve(here, "..");
const repoRoot = path.resolve(bakeoffRoot, "../..");
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

// @ref LLP 0102#stage-0-freeze — the capsule shape is frozen. The verifier
// hard-binds to protocol/run-capsule.v1.schema.json (integrity-checked against
// freeze.v2.json): this validator implements exactly the draft 2020-12
// keywords that frozen schema uses and refuses to run against any other
// vocabulary. Accepting a new capsule field therefore requires a dated
// protocol version amendment (new frozen schema plus verifier update), never
// an ad-hoc relaxation here.
const schemaAnnotationKeywords = new Set(["$schema", "$id", "title"]);
const schemaSupportedKeywords = new Set(["type", "required", "properties", "additionalProperties", "const", "enum", "minLength"]);

function assertSupportedSchema(schema, at = "#") {
  for (const [keyword, value] of Object.entries(schema)) {
    if (schemaAnnotationKeywords.has(keyword)) continue;
    if (!schemaSupportedKeywords.has(keyword)) {
      throw new Error(`frozen schema uses unsupported keyword "${keyword}" at ${at}; ` +
        "amend the protocol version and extend this validator together");
    }
    if (keyword === "additionalProperties" && value !== false) {
      throw new Error(`frozen schema uses non-boolean additionalProperties at ${at}; ` +
        "amend the protocol version and extend this validator together");
    }
    if (keyword === "properties") {
      for (const [name, child] of Object.entries(value)) assertSupportedSchema(child, `${at}/properties/${name}`);
    }
  }
}

let frozenSchemaPromise = null;

async function loadFrozenSchema() {
  frozenSchemaPromise ??= (async () => {
    const relative = "protocol/run-capsule.v1.schema.json";
    const body = await readFile(path.join(bakeoffRoot, relative), "utf8");
    const freeze = JSON.parse(await readFile(path.join(bakeoffRoot, "protocol", "freeze.v2.json"), "utf8"));
    const record = (freeze.artifacts ?? []).find((item) => item.path === `demos/backend-bakeoff/${relative}`);
    const actualSha256 = createHash("sha256").update(body).digest("hex");
    if (!record || record.sha256 !== actualSha256) {
      throw new Error(`${relative} does not match the freeze record; ` +
        "capsule fields change only through a dated protocol amendment plus re-freeze, not schema edits");
    }
    const schema = JSON.parse(body);
    assertSupportedSchema(schema);
    return schema;
  })();
  return frozenSchemaPromise;
}

function typeMatches(type, value) {
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "array") return Array.isArray(value);
  if (type === "string") return typeof value === "string";
  throw new Error(`frozen schema uses unsupported type "${type}"`);
}

export function schemaViolations(schema, value, at = "$") {
  const violations = [];
  if ("const" in schema && value !== schema.const) {
    violations.push(`${at}: must equal ${JSON.stringify(schema.const)}`);
  }
  if ("enum" in schema && !schema.enum.includes(value)) {
    violations.push(`${at}: must be one of ${JSON.stringify(schema.enum)}`);
  }
  if ("type" in schema && !typeMatches(schema.type, value)) {
    violations.push(`${at}: must be of type ${schema.type}`);
    return violations;
  }
  if ("minLength" in schema && typeof value === "string" && value.length < schema.minLength) {
    violations.push(`${at}: must be at least ${schema.minLength} characters`);
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const name of schema.required ?? []) {
      if (!Object.hasOwn(value, name)) violations.push(`${at}: missing required field "${name}"`);
    }
    for (const [name, child] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, name)) violations.push(...schemaViolations(child, value[name], `${at}.${name}`));
    }
    if (schema.additionalProperties === false) {
      const known = new Set(Object.keys(schema.properties ?? {}));
      for (const name of Object.keys(value)) {
        if (!known.has(name)) violations.push(`${at}: unknown field "${name}" is not in the frozen capsule schema`);
      }
    }
  }
  return violations;
}

// Path-bearing capsule fields must either be empty when inapplicable or
// resolve to retained artifact files under the arm directory or, for
// repository-rooted declarations, under the repository root. A prose sentinel
// standing in for a file is a verification failure.
export function declaredCapsulePaths(capsule) {
  const declared = [];
  const push = (at, value) => declared.push({ at, value });
  const pushList = (at, values) => {
    if (Array.isArray(values)) values.forEach((value, index) => push(`${at}[${index}]`, value));
  };
  push("targets.binding.baselineReceiptPath", capsule?.targets?.binding?.baselineReceiptPath);
  push("targets.binding.scopedCleanupPlanPath", capsule?.targets?.binding?.scopedCleanupPlanPath);
  for (const target of ["local", "hosted"]) pushList(`targets.${target}.receiptPaths`, capsule?.targets?.[target]?.receiptPaths);
  for (const scenario of capsule?.scenarioResults ?? []) pushList(`scenarioResults[${scenario?.id}].evidencePaths`, scenario?.evidencePaths);
  push("inventory.receiptPath", capsule?.inventory?.receiptPath);
  for (const [dimension, confidence] of Object.entries(capsule?.evidenceConfidence ?? {})) {
    pushList(`evidenceConfidence.${dimension}.evidencePaths`, confidence?.evidencePaths);
  }
  push("cleanup.targetBoundPlanPath", capsule?.cleanup?.targetBoundPlanPath);
  pushList("cleanup.receiptPaths", capsule?.cleanup?.receiptPaths);
  return declared.filter((item) => item.value !== undefined && item.value !== null && item.value !== "");
}

async function isFile(candidate) {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

async function pathResolutionProblems(capsule, capsuleDir) {
  const problems = [];
  for (const { at, value } of declaredCapsulePaths(capsule)) {
    if (typeof value !== "string") {
      problems.push(`${at}: declared path must be a string`);
      continue;
    }
    if (path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) {
      problems.push(`${at}: declared path "${value}" escapes the retained evidence roots`);
      continue;
    }
    if (!(await isFile(path.resolve(capsuleDir, value))) && !(await isFile(path.resolve(repoRoot, value)))) {
      problems.push(`${at}: declared path "${value}" does not resolve to a retained file under the arm or repository root`);
    }
  }
  return problems;
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

export async function verifyCapsule(capsule, { allowDraft = false, capsuleDir = null } = {}) {
  // Frozen-schema validation runs first: a capsule that is not an instance of
  // the frozen shape fails on that alone, before any semantic reading of it.
  const shapeProblems = schemaViolations(await loadFrozenSchema(), capsule).map((violation) => `schema: ${violation}`);
  if (shapeProblems.length > 0) return shapeProblems;

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

  if (capsuleDir) problems.push(...await pathResolutionProblems(capsule, capsuleDir));
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
    const capsulePath = path.resolve(process.cwd(), first);
    const capsule = JSON.parse(await readFile(capsulePath, "utf8"));
    const problems = await verifyCapsule(capsule, { allowDraft: second === "--draft", capsuleDir: path.dirname(capsulePath) });
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
