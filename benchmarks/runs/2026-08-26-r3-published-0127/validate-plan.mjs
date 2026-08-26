#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveInstrumentArtifacts } from "../../tools/lane-setup.mjs";
import {
  allCampaignPorts,
  configuredExecutionBinding,
  currentHostIdentity,
  liveSourceClosure,
  registeredCellExpectations,
  registeredMilestonesForCell,
} from "../../tools/social-messenger/metering/r2-cell-admission.mjs";
import { resolveRegisteredJourney } from "../../tools/social-messenger/metering/journey-contract.mjs";
import { loadLaneControllerConfig } from "../../tools/social-messenger/metering/lane-controller.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(root, "../../..");
const configPath = join(root, "harness-config.json");
const configBytes = readFileSync(configPath);
const config = JSON.parse(configBytes);
const full = ["M1", "M2", "M3", "M4", "M5", "M6", "M8", "M7"];
const reduced = ["M1", "M2", "M3"];
const conditions = [
  ["Clique", "explicit"],
  ["Coterie", "explicit"],
  ["Clique", "familiar"],
  ["Coterie", "familiar"],
];
const cleanEnvironment = { ...process.env };
for (const name of config.execution.environment.forbiddenVariables) delete cleanEnvironment[name];

function fail(message) {
  throw new Error(`R3_PLAN_INVALID: ${message}`);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(resolve(repositoryRoot, path))).digest("hex");
}

function commandVersion(path, expected) {
  const result = spawnSync(path, ["--version"], { encoding: "utf8" });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0 || !output.includes(expected)) {
    fail(`${path} does not report registered version ${expected}`);
  }
}

function expectedCommand(cellId) {
  return config.controller.commandTemplate.map((value) => value.replaceAll("{cellId}", cellId));
}

function rotated(replicate) {
  const shift = replicate - 1;
  return [...conditions.slice(shift), ...conditions.slice(0, shift)];
}

function expectedOrder() {
  const result = [];
  for (let replicate = 1; replicate <= 3; replicate += 1) {
    for (const [app, profile] of rotated(replicate)) {
      const appId = app.toLowerCase();
      result.push(`sol-${appId}-${profile}-${replicate}`);
      result.push(`opus-${appId}-${profile}-${replicate}`);
      if (replicate === 1) result.push(`grok-${appId}-${profile}-1`);
    }
  }
  return result;
}

// @ref LLP 0295#r3-claim-eligible-wave — R3 is N>=3 for the scored legs;
// the Grok leg remains explicitly exploratory at N=1.
if (
  config.schemaVersion !== "snapback.r2-harness-config.v1"
  || config.runId !== "2026-08-26-r3-published-0127"
  || config.status !== "serial-per-cell-admission"
  || config.noBenchmarkCellStarted !== true
  || config.execution.serial !== true
  || config.execution.maxConcurrentCells !== 1
) fail("campaign identity, pristine flag, or seriality drifted");

if (!same(config.cellOrder, expectedOrder())) fail("global interleaved execution order drifted");
if (config.cells.length !== 28 || new Set(config.cells.map((cell) => cell.id)).size !== 28) {
  fail("wave must contain exactly 28 unique cells");
}
if (!same(config.cellOrder, config.cells.map((cell) => cell.id))) {
  fail("cells must be serialized in exact cellOrder");
}

const byLeg = Object.groupBy(config.cells, (cell) => cell.leg);
if (byLeg.A?.length !== 12 || byLeg.B?.length !== 12 || byLeg.C?.length !== 4) {
  fail("leg cardinalities must be A=12, B=12, C=4");
}

// @ref LLP 0197#the-standard — rule 2 requires a predeclared rotation with
// per-position counts differing by no more than one at N=3 over four lanes.
for (const leg of ["A", "B"]) {
  for (let replicate = 1; replicate <= 3; replicate += 1) {
    const observed = byLeg[leg]
      .filter((cell) => cell.replicate === replicate)
      .map((cell) => [cell.app, cell.profile]);
    if (!same(observed, rotated(replicate))) fail(`Leg ${leg} replicate ${replicate} rotation drifted`);
  }
  for (let position = 0; position < 4; position += 1) {
    const counts = new Map(conditions.map((condition) => [condition.join("/"), 0]));
    for (let replicate = 1; replicate <= 3; replicate += 1) {
      const key = rotated(replicate)[position].join("/");
      counts.set(key, counts.get(key) + 1);
    }
    const values = [...counts.values()];
    if (Math.max(...values) - Math.min(...values) > 1) fail(`Leg ${leg} position ${position + 1} is not near-balanced`);
  }
}
if (!same(byLeg.C.map((cell) => [cell.app, cell.profile]), conditions)) {
  fail("exploratory Leg C must use only the replicate-1 condition order");
}

const expectedHarness = {
  A: ["codex-sol", "gpt-5.6-sol", "xhigh", "full", "full-journey", "scored-family-and-profile-scoped"],
  B: ["claude-opus5", "claude-opus-5", null, "reduced", "reduced-run-m1-m3", "scored-family-and-profile-scoped-reduced-only"],
  C: ["grok-46", "grok-4.6", "xhigh", "reduced", "reduced-run-m1-m3", "exploratory-claim-ineligible-by-registration"],
};

for (const [index, cell] of config.cells.entries()) {
  if (!/^(sol|opus|grok)-(clique|coterie)-(explicit|familiar)-[123]$/u.test(cell.id)) {
    fail(`cell slot name violates modelfamily-app-profile-replicateN: ${cell.id}`);
  }
  const expected = expectedHarness[cell.leg];
  if (!same([cell.harness, cell.model, cell.effort, cell.runScope, cell.scoringProfile, cell.claimEligibility], expected)) {
    fail(`cell ${cell.id} leg registration drifted`);
  }
  const expectedMilestones = cell.leg === "A" ? full : reduced;
  if (!same(cell.milestones, expectedMilestones)) fail(`cell ${cell.id} milestones drifted`);
  if (!same(registeredMilestonesForCell(config, cell), expectedMilestones)) {
    fail(`cell ${cell.id} loader milestone binding drifted`);
  }
  const journey = resolveRegisteredJourney({
    milestones: cell.milestones,
    sessionShape: config.execution.sessionShape,
    cell,
  });
  if (journey.runScope !== cell.runScope || journey.driverId !== cell.driverId) {
    fail(`cell ${cell.id} journey/driver contract drifted`);
  }
  if (cell.leg === "A" ? cell.m7Ports?.length !== 2 : cell.m7Ports !== undefined) {
    fail(`cell ${cell.id} has the wrong M7 port posture`);
  }
  if (!same(cell.controllerCommand, expectedCommand(cell.id))) fail(`cell ${cell.id} command drifted`);
  if (cell.admissionArtifact !== `admissions/${cell.id}.json`) fail(`cell ${cell.id} admission path drifted`);
  if (cell.ports[0] !== 57000 + (index * 60) || cell.ports[1] !== 57059 + (index * 60)) {
    fail(`cell ${cell.id} main port block drifted`);
  }
  registeredCellExpectations(config, cell);

  const promptPath = join(root, cell.promptFile);
  const prompt = readFileSync(promptPath, "utf8");
  if (!prompt.includes("Snapback 0.1.27") || !prompt.includes("/Users/ccheever/bench-r3-20260826/instrument")) {
    fail(`cell ${cell.id} prompt lacks the frozen product/instrument pin`);
  }

  const slotRoot = join(root, "cells", cell.id);
  const entries = readdirSync(slotRoot);
  if (!same(entries, ["cell.json"])) fail(`cell ${cell.id} is not pristine`);
  const slot = JSON.parse(readFileSync(join(slotRoot, "cell.json"), "utf8"));
  if (slot.cellId !== cell.id || slot.status !== "not-started") fail(`cell ${cell.id} slot status drifted`);
}

let fullRefusal = null;
try {
  resolveRegisteredJourney({
    milestones: full,
    sessionShape: config.execution.sessionShape,
    cell: { ...byLeg.B[0], m7Ports: [53000, 53059] },
  });
} catch (error) {
  fullRefusal = error.message;
}
if (!fullRefusal?.startsWith("R2_DRIVER_FULL_JOURNEY_ACCOUNTING_UNSUPPORTED:")) {
  fail("Claude full-journey nonclaim is not enforced by the retained journey contract");
}

const aCells = byLeg.A;
for (const [index, cell] of aCells.entries()) {
  if (!same(cell.m7Ports, [59000 + (index * 60), 59059 + (index * 60)])) {
    fail(`cell ${cell.id} M7 port block drifted`);
  }
}
const campaignPorts = allCampaignPorts(config);
if (
  campaignPorts.length !== 2400
  || campaignPorts[0] !== 57000
  || campaignPorts[1679] !== 58679
  || campaignPorts[1680] !== 59000
  || campaignPorts.at(-1) !== 59719
) fail("allCampaignPorts is not the exact main-plus-M7 union");

if (
  config.execution.diskPolicy.admissionFloorGiB !== 20
  || config.execution.diskPolicy.refusalDiagnostic !== "R3_ADMISSION_DISK_FLOOR"
  || !config.execution.diskPolicy.cleanupAfterSeal.includes("workspace node_modules")
  || !config.execution.diskPolicy.neverDelete.includes("evidence capsules")
  || config.execution.finalizationPolicy !== "same-config-only"
) fail("disk or same-config finalization ruling drifted");

const machine = config.machines["charlies-macbook-air"];
const observedHost = currentHostIdentity();
const expectedHost = Object.fromEntries([
  "hostname", "platform", "release", "arch", "hardwareModel", "chip",
  "physicalCpuCount", "logicalCpuCount", "memoryBytes",
].map((key) => [key, machine[key]]));
if (!same(observedHost, expectedHost)) fail("registered host no longer matches the executing host");
commandVersion(machine.node.path, machine.node.version);
const nodeBytes = readFileSync(machine.node.path);
if (
  machine.node.sha256 !== `sha256:${createHash("sha256").update(nodeBytes).digest("hex")}`
  || machine.node.bytes !== nodeBytes.byteLength
) fail("registered Node executable bytes drifted");

commandVersion(config.harnesses["codex-sol"].binary, "0.149.1");
commandVersion(config.harnesses["claude-opus5"].binary, "2.1.241");
commandVersion(config.harnesses["grok-46"].binary, "1.0.5 (5115b46bc909)");

if (
  config.pins.snapback0127.version !== "0.1.27"
  || Object.keys(config.pins.snapback0127.packages).length !== 14
  || Object.values(config.pins.snapback0127.packages).some((version) => version !== "0.1.27")
  || config.pins.instrument.instrumentPin !== "social-messenger@0.3.4-m8"
) fail("published closure or instrument pin drifted");

const manifestDigest = sha256(config.pins.instrument.manifestPath);
if (manifestDigest !== config.pins.instrument.manifestSha256) fail("instrument manifest digest drifted");
const materialized = resolveInstrumentArtifacts({
  instrumentRoot: config.paths.instrumentRoot,
  instrumentPin: config.pins.instrument.instrumentPin,
});
if (materialized.manifest.sha256 !== config.pins.instrument.manifestSha256) {
  fail("materialized instrument digest differs from the source pin");
}
if ((lstatSync(config.paths.instrumentRoot).mode & 0o222) !== 0) fail("instrument root is not read-only");

const overlayFiles = {
  recordSchemaSha256: "benchmarks/schema/social-messenger/run-record.schema.json",
  extensionSchemaSha256: "benchmarks/schema/social-messenger/run-record-extension.schema.json",
  recordValidatorSha256: "benchmarks/tools/social-messenger/record-validator.mjs",
  meterSha256: "benchmarks/tools/social-messenger/metering/meter.mjs",
  laneSetupSha256: "benchmarks/tools/lane-setup.mjs",
  laneControllerSha256: "benchmarks/tools/social-messenger/metering/lane-controller.mjs",
  productionDriverSha256: "benchmarks/tools/social-messenger/metering/r2-cell-driver.mjs",
  signalSha256: "benchmarks/tools/social-messenger/metering/r2-cell-signal.mjs",
  manifestLoaderSha256: "benchmarks/tools/social-messenger/metering/manifest.mjs",
  joinerSha256: "benchmarks/tools/social-messenger/metering/joiner.mjs",
  observationsSha256: "benchmarks/tools/social-messenger/metering/observations.mjs",
  codexNativeEvidenceSha256: "benchmarks/tools/social-messenger/metering/codex-native-evidence.mjs",
  recordComposerSha256: "benchmarks/tools/social-messenger/metering/record-composer.mjs",
  admissionToolSha256: "benchmarks/tools/social-messenger/metering/r2-cell-admission.mjs",
  finalizedCellValidatorSha256: "benchmarks/tools/social-messenger/metering/r2-finalized-cell.mjs",
  hostLockSha256: "benchmarks/tools/social-messenger/metering/r2-host-lock.mjs",
  finalizeExistingSha256: "benchmarks/tools/social-messenger/metering/r2-finalize-existing.mjs",
  instrumentMaterializerSha256: "benchmarks/tools/materialize-instrument.mjs",
};
for (const [field, path] of Object.entries(overlayFiles)) {
  if (config.pins.instrument.d06MeteringOverlay[field] !== sha256(path)) fail(`overlay digest drifted: ${field}`);
}

liveSourceClosure({ harnessConfig: config, repositoryRoot });
for (const cell of config.cells) {
  configuredExecutionBinding({
    harnessConfig: config,
    cell,
    repositoryRoot,
    environment: cleanEnvironment,
  });
  const loaded = await loadLaneControllerConfig({ harnessConfigPath: configPath, cellId: cell.id });
  if (!same(loaded.config.milestones, cell.milestones)) fail(`controller loader lost ${cell.id} per-cell scope`);
}

if (execFileSync("git", ["-C", config.paths.exactPinnedCheckout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  !== config.pins.exactPinnedCheckout.revision) fail("Exact checkout revision drifted");
if (execFileSync("git", ["-C", config.paths.exactPinnedCheckout, "status", "--short"], { encoding: "utf8" }).trim() !== "") {
  fail("Exact checkout is not clean");
}

const logicalConfig = relative(repositoryRoot, configPath).split("\\").join("/");
const committed = execFileSync("git", ["show", `HEAD:${logicalConfig}`], { cwd: repositoryRoot });
if (!Buffer.from(committed).equals(configBytes)) fail("harness config differs from committed HEAD");

process.stdout.write(`${JSON.stringify({
  ok: true,
  status: "pristine",
  cells: config.cells.length,
  legs: { A: byLeg.A.length, B: byLeg.B.length, C: byLeg.C.length },
  fullJourneyCells: byLeg.A.length,
  reducedCells: byLeg.B.length + byLeg.C.length,
  campaignPorts: campaignPorts.length,
  firstCell: config.cellOrder[0],
  noBenchmarkCellStarted: true,
  instrumentManifestSha256: config.pins.instrument.manifestSha256,
})}\n`);
