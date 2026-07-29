#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendOnlyPrefixMatches, appendOnlyRecord, liveOutputDirectories } from "./freeze-boundary.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bakeoffRoot = path.resolve(here, "..");
const repoRoot = path.resolve(bakeoffRoot, "../..");
const protocolRoot = path.join(bakeoffRoot, "protocol");
// @ref LLP 0102#stage-0-freeze — timed work is gated on exact frozen,
// machine-verifiable prompts, profiles, acceptance counts, and environment.
const writeFreeze = process.argv.includes("--write-freeze");
const errors = [];

const expectedProviders = ["snapback", "convex", "supabase", "firebase", "instantdb", "spacetimedb", "appwrite"];
const expectedApps = ["todo", "chat", "linear", "partiful", "research-room"];
const diaryPaths = [
  "diaries/0027-todo-backend-bakeoff.diary.md",
  "diaries/0028-chat-backend-bakeoff.diary.md",
  "diaries/0029-linear-backend-bakeoff.diary.md",
  "diaries/0030-partiful-backend-bakeoff.diary.md",
  "diaries/0031-research-room-backend-bakeoff.diary.md",
];

async function json(relative) {
  try {
    return JSON.parse(await readFile(path.join(bakeoffRoot, relative), "utf8"));
  } catch (error) {
    errors.push(`${relative}: ${error.message}`);
    return {};
  }
}

function sameSet(actual, expected) {
  return Array.isArray(actual) &&
    actual.length === expected.length &&
    [...actual].sort().join("\n") === [...expected].sort().join("\n");
}

function check(condition, message) {
  if (!condition) errors.push(message);
}

const protocol = await json("protocol/protocol.v1.json");
const providers = await json("protocol/provider-inventory.v1.json");
const environment = await json("protocol/environment.v1.json");
const assistance = await json("protocol/assistance-policy.v1.json");
const order = await json("protocol/order.v1.json");
const scoring = await json("protocol/scoring.v1.json");
const workloads = await json("protocol/workloads.v1.json");
const health = await json("protocol/credentials-health.v1.json");
const targetLifecycle = await json("protocol/target-lifecycle.v1.json");

check(protocol.schemaVersion === 1, "protocol schemaVersion must be 1");
check(sameSet(protocol.providers, expectedProviders), "protocol provider set must contain all seven providers exactly once");
check(sameSet(protocol.apps, expectedApps), "protocol app set must contain all five apps exactly once");
check(protocol.timedBudgets?.calibration?.activeMinutes === 240, "calibration time budget drift");
check(protocol.timedBudgets?.calibration?.toolCalls === 200, "calibration tool-call budget drift");
check(protocol.timedBudgets?.deep?.activeMinutes === 480, "deep time budget drift");
check(protocol.timedBudgets?.deep?.toolCalls === 400, "deep tool-call budget drift");
check(Object.keys(providers.providers ?? {}).length === 7, "provider inventory must contain seven providers");
check(sameSet(Object.keys(providers.providers ?? {}), expectedProviders), "provider inventory keys drifted");

for (const provider of expectedProviders) {
  const item = providers.providers?.[provider];
  check(item && item.local && item.hosted, `${provider}: local and hosted profiles required`);
  check(Array.isArray(item?.officialDocs) && item.officialDocs.length >= 3, `${provider}: at least three official documentation references required`);
  check(typeof item?.hosted?.plan === "string" && item.hosted.plan.length > 0, `${provider}: hosted plan must be explicit`);
  check(typeof item?.hosted?.region === "string" && item.hosted.region.length > 0, `${provider}: hosted region must be explicit`);
}

for (const app of expectedApps) {
  const manifest = await json(`protocol/acceptance/${app}.v1.json`);
  const scenarios = manifest.scenarios ?? [];
  check(manifest.app === app, `${app}: acceptance app id drift`);
  check(manifest.expectedCheckCount === scenarios.length, `${app}: expectedCheckCount does not match scenario count`);
  check(scenarios.length >= 10, `${app}: too few frozen acceptance scenarios`);
  const ids = scenarios.map((scenario) => scenario.id);
  check(new Set(ids).size === ids.length, `${app}: duplicate acceptance id`);
  check(scenarios.every((scenario) => Array.isArray(scenario.evidence) && scenario.evidence.length > 0), `${app}: every scenario requires evidence`);
  try {
    const prompt = await readFile(path.join(protocolRoot, "prompts", `${app}.md`), "utf8");
    check(prompt.includes(`acceptance/${app}.v1.json`), `${app}: prompt must bind its acceptance manifest`);
    check(/idiomatic|native/i.test(prompt), `${app}: prompt must require provider-native implementation`);
  } catch (error) {
    errors.push(`${app}: missing prompt (${error.message})`);
  }

  const actualOrder = order.orders?.[app];
  check(sameSet(actualOrder, expectedProviders), `${app}: randomized order must be a provider permutation`);
  if (Array.isArray(actualOrder)) {
    const expectedOrder = expectedProviders.slice().sort((left, right) => {
      const leftHash = createHash("sha256").update(`${order.seed}:${app}:${left}`).digest("hex");
      const rightHash = createHash("sha256").update(`${order.seed}:${app}:${right}`).digest("hex");
      return leftHash.localeCompare(rightHash);
    });
    check(actualOrder.join("\n") === expectedOrder.join("\n"), `${app}: order does not match frozen algorithm and seed`);
  }
}

const scoreTotal = Object.values(scoring.categories ?? {}).reduce((total, value) => total + value, 0);
check(scoreTotal === 100, `scoring weights sum to ${scoreTotal}, expected 100`);
check(scoring.evidenceConfidenceDimensions?.length === 8, "evidence confidence must retain eight dimensions");
check(scoring.evidenceConfidenceScale?.maximum === 16, "evidence confidence maximum must be 16");
check(workloads.performance?.warmups === 2, "performance warmup count drift");
check(workloads.performance?.recordedSamples === 7, "performance recorded sample count drift");
check(targetLifecycle.isolation?.freshLocalTargetPerArm === true, "target lifecycle must isolate local targets per arm");
check(targetLifecycle.isolation?.sharedHostedTargetAllowed === true, "target lifecycle must explicitly permit shared hosted targets");
check(targetLifecycle.isolation?.uniqueNamespacePerArm === true, "shared targets must use a unique namespace per arm");
check(targetLifecycle.isolation?.baselinePreservationRequiredForSharedTargets === true,
  "shared targets must require baseline preservation");
check(targetLifecycle.isolation?.reuseAcrossProviders === false, "target lifecycle must forbid cross-provider reuse");
check(targetLifecycle.forbidden?.includes("unresolved target variables"), "target lifecycle must refuse unresolved cleanup targets");
check(environment.repository?.startingCommit?.length === 40, "starting Snapback commit must be a full digest");
check(assistance.independentReview?.minimumExternalModelFamilyReviews === 1, "independent review minimum drift");
check(health.containsSecretValues === false, "credential health artifact must declare that it contains no values");
const computedReadiness =
  Object.values(health.executionCapabilities ?? {}).length === expectedProviders.length &&
  Object.values(health.executionCapabilities ?? {}).every((value) => value.status === "ready") &&
  Object.values(health.localTools ?? {}).every((item) => item.status === "ready");
check(health.readyForTimedArms === computedReadiness, "readyForTimedArms does not match preflight statuses");

const credentialText = JSON.stringify(health);
for (const forbidden of [/"apiKey"\s*:/i, /"token"\s*:/i, /"password"\s*:/i, /"secretValue"\s*:/i, /-----BEGIN [A-Z ]+PRIVATE KEY-----/]) {
  check(!forbidden.test(credentialText), `credential health contains forbidden secret-shaped material: ${forbidden}`);
}

for (const relative of diaryPaths) {
  try {
    const body = await readFile(path.join(repoRoot, relative), "utf8");
    check(body.includes("Stage 0"), `${relative}: missing Stage 0 entry`);
  } catch (error) {
    errors.push(`${relative}: ${error.message}`);
  }
}

for (const relative of [
  "neutral-ui/package.json",
  "neutral-ui/package-lock.json",
  "neutral-ui/src/App.tsx",
  "neutral-ui/src/styles.css",
  "scripts/inventory-arm.mjs",
]) {
  try {
    await access(path.join(bakeoffRoot, relative));
  } catch {
    errors.push(`${relative}: required Stage 0 artifact missing`);
  }
}

const shellSource = await readFile(path.join(bakeoffRoot, "neutral-ui/src/App.tsx"), "utf8").catch(() => "");
for (const app of expectedApps) {
  const testIdPrefix = app === "research-room" ? "research" : app;
  check(shellSource.includes(`data-testid="${testIdPrefix}`), `${app}: neutral shell lacks a stable test id`);
}
check(!/ProviderAdapter|BackendAdapter|setInterval\s*\(/.test(shellSource), "neutral shell contains a provider abstraction or poller");

async function freezeFiles() {
  const relative = [];
  async function walk(root, prefix) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || /^freeze\.v\d+\.json$/.test(entry.name)) continue;
      if (prefix === "demos/backend-bakeoff" && liveOutputDirectories.has(entry.name)) continue;
      const absolute = path.join(root, entry.name);
      const next = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) await walk(absolute, next);
      else if (entry.isFile()) relative.push(next);
    }
  }
  await walk(bakeoffRoot, "demos/backend-bakeoff");
  relative.push("llp/0102-seven-backend-five-app-bakeoff.plan.md");
  return relative.sort();
}

async function digestRecords() {
  const records = [];
  for (const relative of await freezeFiles()) {
    const body = await readFile(path.join(repoRoot, relative));
    records.push({
      path: relative,
      bytes: body.byteLength,
      sha256: createHash("sha256").update(body).digest("hex"),
    });
  }
  return records;
}

async function appendOnlyRecords() {
  const records = [];
  for (const relative of diaryPaths) {
    records.push(appendOnlyRecord(relative, await readFile(path.join(repoRoot, relative))));
  }
  return records;
}

const freezePath = path.join(protocolRoot, "freeze.v2.json");
if (writeFreeze && errors.length === 0) {
  const artifacts = await digestRecords();
  const appendOnlyArtifacts = await appendOnlyRecords();
  const aggregateSha256 = createHash("sha256")
    .update(artifacts.map((item) => `${item.sha256}  ${item.path}\n`).join(""))
    .digest("hex");
  await writeFile(freezePath, `${JSON.stringify({
    schemaVersion: 2,
    protocolId: protocol.protocolId,
    frozenAt: new Date().toISOString(),
    readinessAtFreeze: health.readyForTimedArms ? "ready" : "not-ready",
    aggregateSha256,
    artifacts,
    appendOnlyArtifacts,
    liveOutputDirectories: [...liveOutputDirectories].sort(),
  }, null, 2)}\n`);
} else {
  try {
    const frozen = JSON.parse(await readFile(freezePath, "utf8"));
    check(frozen.schemaVersion === 2, "freeze schemaVersion must be 2");
    const actual = await digestRecords();
    const actualAggregate = createHash("sha256")
      .update(actual.map((item) => `${item.sha256}  ${item.path}\n`).join(""))
      .digest("hex");
    check(frozen.aggregateSha256 === actualAggregate, "freeze digest mismatch; record a prospective amendment and rewrite before a timed arm");
    check(JSON.stringify(frozen.artifacts) === JSON.stringify(actual), "freeze artifact inventory mismatch");
    check(JSON.stringify(frozen.liveOutputDirectories) === JSON.stringify([...liveOutputDirectories].sort()),
      "freeze living-output boundary mismatch");
    for (const record of frozen.appendOnlyArtifacts ?? []) {
      const current = await readFile(path.join(repoRoot, record.path));
      check(appendOnlyPrefixMatches(record, current), `${record.path}: frozen diary prefix was edited or truncated`);
    }
    check(sameSet((frozen.appendOnlyArtifacts ?? []).map((record) => record.path), diaryPaths),
      "freeze append-only diary set mismatch");
  } catch (error) {
    errors.push(`protocol/freeze.v2.json: ${error.message}; run npm run freeze`);
  }
}

if (errors.length > 0) {
  console.error(JSON.stringify({ ok: false, protocolValid: false, errors }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  protocolValid: true,
  readyForTimedArms: health.readyForTimedArms,
  readinessNote: health.readyForTimedArms ? "preflight is ready" : "protocol is frozen, but timed arms remain gated by credentials/tools",
  providers: expectedProviders.length,
  apps: expectedApps.length,
  acceptanceChecks: 73,
}, null, 2));
