#!/usr/bin/env node

// @ref LLP 0295#r2-load-isolated-calibration-rerun — R2 is a preregistered,
// strictly serial twelve-cell calibration wave whose per-cell production
// controller command is resolved and accepted before any authoring clock.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveInstrumentArtifacts } from '../../tools/lane-setup.mjs';
import { loadLaneControllerConfig } from '../../tools/social-messenger/metering/lane-controller.mjs';
import {
  configuredExecutionBinding,
  inspectCommittedDispositions,
  loadPolicyForCell,
  liveSourceClosure,
  registeredCellExpectations,
} from '../../tools/social-messenger/metering/r2-cell-admission.mjs';
import { validateDryRunEvidence } from './validate-dry-run-evidence.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(root, '../../..');
const harnessConfigPath = join(root, 'harness-config.json');

function fail(message) {
  throw new Error(`R2_PLAN_INVALID: ${message}`);
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8'));
}

function sha256(relativePath) {
  return createHash('sha256')
    .update(readFileSync(join(root, relativePath)))
    .digest('hex');
}

function repositorySha256(relativePath) {
  return createHash('sha256')
    .update(readFileSync(join(repositoryRoot, relativePath)))
    .digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function canonicalSha256(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function optionValue(argv, option) {
  const index = argv.indexOf(option);
  return index === -1 ? null : argv[index + 1];
}

function containsSensitiveIdentityKey(value) {
  if (Array.isArray(value)) return value.some(containsSensitiveIdentityKey);
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => (
    /serial|uuid/i.test(key) || containsSensitiveIdentityKey(child)
  ));
}

function resolvedEffort(harnessKey, harness) {
  if (typeof harness.effort === 'string') return harness.effort;
  if (
    harness.effort
    && typeof harness.effort === 'object'
    && !Array.isArray(harness.effort)
    && Object.hasOwn(harness.effort, 'value')
    && (harness.effort.value === null || typeof harness.effort.value === 'string')
    && typeof harness.effort.ruled === 'string'
    && harness.effort.ruled.startsWith('ORCHESTRATOR RULING:')
  ) {
    return harness.effort.value;
  }
  fail(`harness ${harnessKey} has no resolved effort configuration`);
}

function verifyHarness(harnessKey, harness) {
  if (!existsSync(harness.binary)) fail(`harness ${harnessKey} CLI binary does not exist`);
  const version = spawnSync(harness.binary, ['--version'], { encoding: 'utf8' });
  if (version.status !== 0) {
    fail(`harness ${harnessKey} --version failed with status ${version.status}`);
  }
  const versionText = `${version.stdout ?? ''}\n${version.stderr ?? ''}`;
  if (!versionText.includes(harness.observedVersion)) {
    fail(`harness ${harnessKey} version does not match recorded ${harness.observedVersion}`);
  }

  const effort = resolvedEffort(harnessKey, harness);
  const argv = harness.argvTemplate;
  if (!Array.isArray(argv) || argv.length === 0) {
    fail(`harness ${harnessKey} has no resolved argvTemplate`);
  }
  if (optionValue(argv, '--model') !== harness.model) {
    fail(`harness ${harnessKey} argv does not invoke its recorded model`);
  }
  if (harnessKey === 'codex-sol') {
    if (optionValue(argv, '-c') !== `model_reasoning_effort="${effort}"`) {
      fail('Codex argv does not invoke the recorded effort');
    }
  } else if (harnessKey === 'grok-46') {
    if (optionValue(argv, '--reasoning-effort') !== effort) {
      fail('Grok argv does not invoke the recorded effort');
    }
  } else if (harnessKey === 'claude-opus5') {
    if (effort !== null) fail('Claude R2 effort must resolve to harness-default/null');
    if (argv.some((arg) => /^--(?:reasoning-)?effort(?:=|$)/u.test(arg))) {
      fail('Claude R2 argv must omit --effort by orchestrator ruling');
    }
  } else {
    fail(`unknown R2 harness ${harnessKey}`);
  }
}

const config = readJson('harness-config.json');
const preflight = readJson('preflight.json');
const provenance = readJson('prompt-provenance.json');

if (config.status !== 'serial-per-cell-admission' || config.noBenchmarkCellStarted !== false) {
  fail('configuration must identify the explicit recovered-to-per-cell-admission transition');
}
if (preflight.waveStartAllowed !== false || preflight.noBenchmarkCellStarted !== false) {
  fail('preflight must refuse continuation while acknowledging recovered cell 1');
}
if (
  preflight.campaignState?.continuationBlocked !== true
  || preflight.campaignState?.blockedUntilFreshAdmission !== true
  || preflight.campaignState?.continuationMode !== 'fresh-hash-bound-per-cell-admission'
) {
  fail('historical blocked state must transition only through fresh per-cell admission');
}
const recoveryDescriptor = config.recoveryResume;
if (
  recoveryDescriptor?.version !== 'snapback.r2-recovery-resume.v4'
  || recoveryDescriptor.nextCell !== config.cellOrder?.[2]
  || sha256(recoveryDescriptor.path) !== recoveryDescriptor.sha256
) {
  fail('configuration lacks the exact versioned recovery/resume transition');
}
const recovery = readJson(recoveryDescriptor.path);
const recoveryWithoutIntegrity = structuredClone(recovery);
delete recoveryWithoutIntegrity.integrity;
const instrumentMigrations = config.pins.instrument.instrumentMigrations;
const retainedFinalizerMigration = instrumentMigrations?.[0];
const dispositionMigration = instrumentMigrations?.[1];
const suiteStatusMigration = instrumentMigrations?.[2];
const boundaryTelemetryMigration = instrumentMigrations?.[3];
const dualReviewHardeningMigration = instrumentMigrations?.[4];
const recoveryInstrumentMigrated = dispositionMigration?.instrumentManifestSha256From
    === recovery.resumeInstrument.sha256?.replace(/^sha256:/u, '')
  && dispositionMigration.instrumentManifestSha256To
    === suiteStatusMigration?.instrumentManifestSha256From
  && suiteStatusMigration.instrumentManifestSha256To
    === boundaryTelemetryMigration?.instrumentManifestSha256From
  && boundaryTelemetryMigration.instrumentManifestSha256To
    === dualReviewHardeningMigration?.instrumentManifestSha256From
  && dualReviewHardeningMigration.instrumentManifestSha256To
    === config.pins.instrument.manifestSha256
  && dispositionMigration.materializedRootFrom === recovery.resumeInstrument.materializedRoot
  && dispositionMigration.materializedRootTo === suiteStatusMigration.materializedRootFrom
  && suiteStatusMigration.materializedRootTo === boundaryTelemetryMigration.materializedRootFrom
  && boundaryTelemetryMigration.materializedRootTo
    === dualReviewHardeningMigration?.materializedRootFrom
  && dualReviewHardeningMigration.materializedRootTo === config.paths.instrumentRoot;
if (
  recovery.version !== recoveryDescriptor.version
  || recovery.completedCell !== config.cellOrder[0]
  || JSON.stringify(recovery.completedCells) !== JSON.stringify(config.cellOrder.slice(0, 2))
  || recovery.nextCell !== config.cellOrder[2]
  || recovery.completedCellRecoveryVersion !== 'snapback.r2-retained-corrupt-finalization.v1'
  || recovery.campaignCellRerun !== false
  || !recoveryInstrumentMigrated
  || sha256(recovery.resumeInstrument.path) !== config.pins.instrument.manifestSha256
  || recovery.integrity?.algorithm !== 'sha256-canonical-json-without-integrity'
  || recovery.integrity?.sha256 !== `sha256:${canonicalSha256(recoveryWithoutIntegrity)}`
  || recovery.cell1RecoveryValidation?.metadata?.path !== 'cells/sol-clique-explicit/validation.json'
  || recovery.cell1RecoveryValidation?.metadata?.sha256 !== `sha256:${sha256(recovery.cell1RecoveryValidation.metadata.path)}`
  || recovery.cell1RecoveryValidation?.protectedEvidenceHashesVerified !== true
  || recovery.cell1RecoveryValidation?.campaignCellRerun !== false
  || JSON.stringify(recovery.initiallyPristineCells) !== JSON.stringify(config.cellOrder.slice(1))
  || JSON.stringify(recovery.remainingPristineCells) !== JSON.stringify(config.cellOrder.slice(2))
) {
  fail('recovery transition does not bind the recovered two-cell prefix to pristine cell 3');
}
const unresolvedRulings = preflight.checks.filter((check) => check.status === 'needs-ruling');
if (unresolvedRulings.length > 0) {
  fail(`preflight retains unresolved rulings: ${unresolvedRulings.map((check) => check.id).join(', ')}`);
}
if (!config.execution.serial || config.execution.maxConcurrentCells !== 1) {
  fail('execution must be strictly serial');
}
try {
  liveSourceClosure({ harnessConfig: config, repositoryRoot });
} catch (error) {
  fail(`executing source closure is not exact: ${error.message}`);
}
const loadIsolation = config.execution.loadIsolation;
const loadPolicies = Object.values(loadIsolation.policies ?? {});
if (loadPolicies.length !== 2 || loadPolicies.some((policy) => (
  policy.status !== 'approved'
  || !policy.ruling?.startsWith('ORCHESTRATOR RULING:')
  || policy.sampleEverySeconds !== 60
  || policy.preStartConsecutivePassingSamples !== 3
  || Object.values(policy.ceilingInclusive ?? {}).some((value) => value !== 10)
  || config.machines?.[policy.allowedHostId]?.id !== policy.allowedHostId
))) {
  fail('load isolation must carry exact host-scoped <=10.00 three-minute admission rulings');
}
const currentHost = config.machines?.['mac-mini-durand'];
if (
  currentHost?.hostname !== 'Mac.lan'
  || currentHost.machineName !== 'Mac mini'
  || currentHost.hardwareModel !== 'Mac16,11'
  || currentHost.chip !== 'Apple M4 Pro'
  || currentHost.physicalCpuCount !== 12
  || currentHost.logicalCpuCount !== 12
  || currentHost.memoryBytes !== 25769803776
) {
  fail('Codex/Grok host identity must be the exact non-sensitive Mac.lan Mac16,11 M4 Pro 12-core/24-GB identity');
}
for (const machine of Object.values(config.machines ?? {})) {
  if (containsSensitiveIdentityKey(machine)) {
    fail(`host identity ${machine.id} contains a forbidden sensitive identifier`);
  }
}
if (config.cells.length !== 12 || config.cellOrder.length !== 12) {
  fail('exactly twelve cells are required');
}
if (new Set(config.cellOrder).size !== 12) fail('cell order contains duplicates');
if (config.cells.map((cell) => cell.id).join('\0') !== config.cellOrder.join('\0')) {
  fail('cell definitions must be in the preregistered order');
}
if (Object.keys(config.pins.snapback0125.packages).length !== 14) {
  fail('the published Snapback closure must carry fourteen identities');
}
if (Object.values(config.pins.snapback0125.packages).some((version) => version !== '0.1.25')) {
  fail('every published package pin must be exactly 0.1.25');
}
if (config.pins.instrument.instrumentPin !== 'social-messenger@0.3.3-m8'
    || config.pins.instrument.choreographyVersion !== '0.3.3-m8') {
  fail('R2 must pin the built 0.3.3-m8 instrument and choreography');
}
if (config.execution.suiteStatus.currentImplementationStatus
    !== 'implemented-required') {
  fail('suite-status linkage must be required by the runnable controller');
}
if (config.pins.instrument.observabilityBump.included !== true
    || config.pins.instrument.observabilityBump.status !== 'landed') {
  fail('the controller requires the landed observability bump');
}

const codexHarness = config.harnesses['codex-sol'];
if (
  codexHarness.observedVersion !== '0.149.0'
  || codexHarness.baselineVersion !== '0.147.0'
  || codexHarness.versionFlag !== 'same-harness-version-change-accepted:0.147.0->0.149.0'
  || !codexHarness.versionRuling?.startsWith('ORCHESTRATOR RULING:')
) {
  fail('Codex 0.149.0 must carry the accepted same-harness version flag');
}
const claudeHarness = config.harnesses['claude-opus5'];
if (
  resolvedEffort('claude-opus5', claudeHarness) !== null
  || !claudeHarness.effort.ruled.includes('harness-default per 0.1.24 executed behavior')
) {
  fail('Claude effort ruling must preserve the harness-default 0.1.24 execution');
}

for (const [harnessKey, harness] of Object.entries(config.harnesses)) {
  verifyHarness(harnessKey, harness);
}

const instrumentSnapshot = resolveInstrumentArtifacts({
  instrumentRoot: join(repositoryRoot, 'benchmarks'),
  instrumentPin: config.pins.instrument.instrumentPin,
});
if (instrumentSnapshot.manifest.sha256 !== config.pins.instrument.manifestSha256) {
  fail('the R2 manifest digest does not bind the current 0.3.3-m8 snapshot');
}
const overlayHashes = {
  recordSchemaSha256: 'benchmarks/schema/social-messenger/run-record.schema.json',
  extensionSchemaSha256: 'benchmarks/schema/social-messenger/run-record-extension.schema.json',
  recordValidatorSha256: 'benchmarks/tools/social-messenger/record-validator.mjs',
  meterSha256: 'benchmarks/tools/social-messenger/metering/meter.mjs',
  laneSetupSha256: 'benchmarks/tools/lane-setup.mjs',
  laneControllerSha256: 'benchmarks/tools/social-messenger/metering/lane-controller.mjs',
  productionDriverSha256: 'benchmarks/tools/social-messenger/metering/r2-cell-driver.mjs',
  signalSha256: 'benchmarks/tools/social-messenger/metering/r2-cell-signal.mjs',
  manifestLoaderSha256: 'benchmarks/tools/social-messenger/metering/manifest.mjs',
  joinerSha256: 'benchmarks/tools/social-messenger/metering/joiner.mjs',
  observationsSha256: 'benchmarks/tools/social-messenger/metering/observations.mjs',
  codexAdapterSha256: 'benchmarks/tools/social-messenger/metering/adapters/codex-session.mjs',
  codexNativeEvidenceSha256: 'benchmarks/tools/social-messenger/metering/codex-native-evidence.mjs',
  recordComposerSha256: 'benchmarks/tools/social-messenger/metering/record-composer.mjs',
  admissionToolSha256: 'benchmarks/tools/social-messenger/metering/r2-cell-admission.mjs',
  finalizedCellValidatorSha256: 'benchmarks/tools/social-messenger/metering/r2-finalized-cell.mjs',
  hostLockSha256: 'benchmarks/tools/social-messenger/metering/r2-host-lock.mjs',
  finalizeExistingSha256: 'benchmarks/tools/social-messenger/metering/r2-finalize-existing.mjs',
  instrumentMaterializerSha256: 'benchmarks/tools/materialize-instrument.mjs',
};
for (const [field, path] of Object.entries(overlayHashes)) {
  if (config.pins.instrument.d06MeteringOverlay[field] !== repositorySha256(path)) {
    fail(`D0.6 overlay digest drifted: ${field} (${path})`);
  }
}
if (
  !Array.isArray(instrumentMigrations)
  || instrumentMigrations.length !== 5
  || retainedFinalizerMigration?.date !== '2026-08-24'
  || retainedFinalizerMigration.reason !== 'finalizer repairs after cell-1 corrupt token_count and sidecar-identity defects'
  || JSON.stringify(retainedFinalizerMigration.commits) !== JSON.stringify([
    'a4ad07029',
    '7b828efca',
    'b5a141698',
    'e25831ec4',
    '9a782983d',
  ])
  || retainedFinalizerMigration.recordValidatorSha256From !== 'fa1b179a617db743ec15d9d87017458e594cab070b798ccd72b5349ccf373238'
  || retainedFinalizerMigration.recordValidatorSha256To !== '6083bf88cf29feac9e625093b5bc026377c644c7a963195f920cc6b17edcd727'
  || retainedFinalizerMigration.semantics !== 'fail-closed additions only: aggregate-total checksum, pre-validation identity canonicalization'
  || dispositionMigration?.date !== '2026-08-24'
  || dispositionMigration.reason !== 'two-host R2 execution requires disposition-complete admission independent of plan order'
  || JSON.stringify(dispositionMigration.commits) !== JSON.stringify(['1cb5a2307'])
  || dispositionMigration.admissionToolSha256From !== '1531082d27a08e699515b08fd1ae5ea863efe20dff6bb48ad3b7fc85e37ce861'
  || dispositionMigration.admissionToolSha256To !== repositorySha256(
    overlayHashes.admissionToolSha256,
  )
  || dispositionMigration.validatePlanSha256From !== '4acd162d5f99c9648ba0fa7709615c74fbce3c8f32bbb6d2369b2941ae68214d'
  || dispositionMigration.validatePlanSha256To !== '908544533fcda8d5488129c077c518e9e1270cac7e59580a758090fbf3373308'
  || !recoveryInstrumentMigrated
) {
  fail('instrument migration does not bind the disposition-complete admission implementation');
}
if (
  suiteStatusMigration.date !== '2026-08-24'
  || suiteStatusMigration.reason !== 'suite-status finalization must preserve hash-bound green verdicts across later milestone suite rollover'
  || JSON.stringify(suiteStatusMigration.commits) !== JSON.stringify(['f489b8e28', '4890eb485'])
  || suiteStatusMigration.productionDriverSha256From !== 'de0163b2a5621e70cec038089ed2b3abeca3ec82e85904c9faa286c124e81135'
  || suiteStatusMigration.productionDriverSha256To !== repositorySha256(
    overlayHashes.productionDriverSha256,
  )
  || suiteStatusMigration.manifestLoaderSha256From !== 'd21925146a888cda3f24d19bdf9c3e0994ed87d7ac88c5fc485a92a46f5ee530'
  || suiteStatusMigration.manifestLoaderSha256To !== repositorySha256(
    overlayHashes.manifestLoaderSha256,
  )
  || suiteStatusMigration.meteringRootSha256From !== 'b8b56bc3f29cf689b7401f58eec4c77583a52c66bb2ec638b055bad552363c9e'
  || suiteStatusMigration.meteringRootSha256To
    !== boundaryTelemetryMigration.meteringRootSha256From
  || suiteStatusMigration.instrumentManifestSha256From
    !== dispositionMigration.instrumentManifestSha256To
  || suiteStatusMigration.instrumentManifestSha256To
    !== boundaryTelemetryMigration.instrumentManifestSha256From
  || suiteStatusMigration.materializedRootFrom !== dispositionMigration.materializedRootTo
  || suiteStatusMigration.materializedRootTo !== boundaryTelemetryMigration.materializedRootFrom
  || suiteStatusMigration.semantics !== 'unchanged receipt verdict plus identical refusal-time SHA-256 may restore an unbound aggregate rollover; verdict flips and receipt identity changes still fail closed'
) {
  fail('instrument migration does not bind the suite-status receipt-identity implementation');
}
if (
  boundaryTelemetryMigration.date !== '2026-08-25'
  || boundaryTelemetryMigration.reason !== 'post-terminal pure harness telemetry must not invalidate a semantic authoring boundary'
  || JSON.stringify(boundaryTelemetryMigration.commits) !== JSON.stringify([
    'b86cd6e2d',
    '057ce5898',
    '92f21bec4',
  ])
  || boundaryTelemetryMigration.sourceRevisionFrom !== '4890eb48555042dd6eee5ffa116039d3fe9107c4'
  || boundaryTelemetryMigration.harnessConfigSha256From !== 'd3f2959a03e1c63c914039a5f9f29ad69455918a1bb32e2de994f29786c464d3'
  || boundaryTelemetryMigration.joinerSha256From !== '6cdb9a603b4d436c12a61cef7f882a9b0dc99948b043f18e7fe22b9bf5137fcd'
  || boundaryTelemetryMigration.joinerSha256To !== repositorySha256(
    overlayHashes.joinerSha256,
  )
  || boundaryTelemetryMigration.observationsSha256From !== '1de845b90a135a138bc7d9aed40a80a0d2d5c64d2928a27caf31874408d76c8a'
  || boundaryTelemetryMigration.observationsSha256To !== repositorySha256(
    overlayHashes.observationsSha256,
  )
  || boundaryTelemetryMigration.finalizeExistingSha256From !== 'cf9848906ed653a8ebd667f7c17cf79b4e2651c3a995c98872a6bb3d93d1a4d7'
  || boundaryTelemetryMigration.finalizeExistingSha256To !== repositorySha256(
    overlayHashes.finalizeExistingSha256,
  )
  || boundaryTelemetryMigration.meteringRootSha256From !== 'c1e875f6c992da33a79c26ec686de78b8daa58aab1f63f96e7ab72d142a6d5b4'
  || boundaryTelemetryMigration.meteringRootSha256To
    !== dualReviewHardeningMigration.meteringRootSha256From
  || boundaryTelemetryMigration.instrumentManifestSha256From
    !== suiteStatusMigration.instrumentManifestSha256To
  || boundaryTelemetryMigration.instrumentManifestSha256To
    !== dualReviewHardeningMigration.instrumentManifestSha256From
  || boundaryTelemetryMigration.materializedRootFrom !== suiteStatusMigration.materializedRootTo
  || boundaryTelemetryMigration.materializedRootTo
    !== dualReviewHardeningMigration.materializedRootFrom
  || boundaryTelemetryMigration.semantics !== 'only block-claim and host-load-sample may drain after the authoring terminal; every semantic or unregistered observation type still fails closed'
) {
  fail('instrument migration does not bind the post-terminal harness-telemetry finalization implementation');
}
if (
  dualReviewHardeningMigration.date !== '2026-08-25'
  || dualReviewHardeningMigration.reason !== 'dual-review hardening for next-campaign milestone attribution, disposition identity, and terminal telemetry custody'
  || !Array.isArray(dualReviewHardeningMigration.commits)
  || JSON.stringify(dualReviewHardeningMigration.commits) !== JSON.stringify([
    'c57b3cdf4',
    '1f9566aa9',
  ])
  || dualReviewHardeningMigration.sourceRevisionFrom !== '09c46df751ab02e797a21c84bafb96e35591c55c'
  || dualReviewHardeningMigration.productionDriverSha256From !== '61931aeca07f67b569127d75ae256b5cce372ce335dbde4530f8934303f10559'
  || dualReviewHardeningMigration.productionDriverSha256To !== repositorySha256(
    overlayHashes.productionDriverSha256,
  )
  || dualReviewHardeningMigration.admissionToolSha256From !== 'b7b56f1b571bd05240002e5c68926a02507e09d4cfa67b0f5032842c9daa489d'
  || dualReviewHardeningMigration.admissionToolSha256To !== repositorySha256(
    overlayHashes.admissionToolSha256,
  )
  || dualReviewHardeningMigration.joinerSha256From !== '03c61e6aceaf54ad7fb993666ca94aea5c493290f7a4e5a9744306b44ad5c3fb'
  || dualReviewHardeningMigration.joinerSha256To !== repositorySha256(
    overlayHashes.joinerSha256,
  )
  || dualReviewHardeningMigration.observationsSha256From !== '27b37159ae35a24ba458bca3cf2b29a8eead6e231031750a3f6360aa98d7cdd0'
  || dualReviewHardeningMigration.observationsSha256To !== repositorySha256(
    overlayHashes.observationsSha256,
  )
  || dualReviewHardeningMigration.validatePlanSha256From !== 'e598cd89cd3f88dbe1336318e82112cb95c02e9d780a10ab267735366e812a57'
  || dualReviewHardeningMigration.validatePlanSha256To !== repositorySha256(
    'benchmarks/runs/2026-08-23-r2-published-0125/validate-plan.mjs',
  )
  || dualReviewHardeningMigration.meteringRootSha256From !== '789dfcf036ff9dadb73d82591870a2a61945488410caed7e5fa76ab62061dc59'
  || dualReviewHardeningMigration.meteringRootSha256To
    !== config.execution.sourceClosure.meteringRoot.sha256.replace(/^sha256:/u, '')
  || dualReviewHardeningMigration.instrumentManifestSha256From !== '1ae3e6fc5fe853e328053b01bfc339eb0231906c9a0b6cd511ec117d92eaa4fe'
  || dualReviewHardeningMigration.instrumentManifestSha256To
    !== config.pins.instrument.manifestSha256
  || dualReviewHardeningMigration.materializedRootFrom !== '/Users/ccheever/bench-matrix-20260823-r2/instrument-corpus-hardening-20260825-v9'
  || dualReviewHardeningMigration.materializedRootTo !== config.paths.instrumentRoot
  || dualReviewHardeningMigration.semantics !== 'future milestones fail immediately on queued observation refusal; failure dispositions bind committed cell and attempt identity; terminal telemetry requires controller source and pre-finalization time'
) {
  fail('instrument migration does not bind the dual-review hardening implementation');
}
try {
  execFileSync('git', [
    'cat-file',
    '-e',
    `${dualReviewHardeningMigration.commits.at(-1)}^{commit}`,
  ], { cwd: repositoryRoot });
} catch {
  fail('dual-review hardening migration does not name a real landed implementation commit');
}

for (const field of ['entrypoint', 'driver', 'signal', 'admission', 'finalizeExisting', 'materializeInstrument']) {
  const path = resolve(repositoryRoot, config.controller?.[field] ?? '');
  if (!existsSync(path)) fail(`controller ${field} does not exist: ${path}`);
}
if (!existsSync(config.controller.commandTemplate?.[0] ?? '')) {
  fail('controller command does not name an executable Node binary');
}
const driverModule = await import(pathToFileURL(resolve(repositoryRoot, config.controller.driver)));
for (const hook of ['preflight', 'prepare', 'claimOptions', 'runMilestone', 'finalize', 'observationSources']) {
  if (typeof driverModule[hook] !== 'function') fail(`production driver lacks ${hook}()`);
}

for (const prompt of provenance.files) {
  if (sha256(prompt.path) !== prompt.r2Sha256) {
    fail(`prompt hash drifted: ${prompt.path}`);
  }
  const sourceBytes = execFileSync('git', [
    'show',
    `${provenance.sourceCommit}:${prompt.sourcePath}`,
  ], { cwd: repositoryRoot });
  if (createHash('sha256').update(sourceBytes).digest('hex') !== prompt.sourceSha256) {
    fail(`prompt source hash drifted: ${prompt.sourcePath}`);
  }
  const transformed = provenance.allowedTransforms.reduce(
    (text, transform) => text.replaceAll(transform.from, transform.to),
    sourceBytes.toString('utf8'),
  );
  if (readFileSync(join(root, prompt.path), 'utf8') !== transformed) {
    fail(`prompt ${prompt.path} is not exactly the registered source transforms`);
  }
}

const dryRunEvidence = await Promise.all(['success', 'failure'].map((kind) => (
  validateDryRunEvidence(join(root, 'dry-run-evidence', kind), {
    historicalValidatorBinding: recovery.historicalDryRunValidator,
  })
)));
if (
  dryRunEvidence[0].status !== 'green'
  || dryRunEvidence[0].failureProbe
  || dryRunEvidence[1].status !== 'aborted'
  || !dryRunEvidence[1].failureProbe
) {
  fail('retained success/failure dry-run evidence has the wrong dispositions');
}

let campaignDispositions;
try {
  campaignDispositions = await inspectCommittedDispositions({
    harnessConfig: config,
    repositoryRoot,
    gitRead: (args, cwd) => execFileSync('git', args, {
      cwd,
      maxBuffer: 256 * 1024 * 1024,
    }),
  });
} catch (error) {
  fail(`campaign slots lack landed dispositions: ${error.message}`);
}
const dispositionedCells = new Set(
  campaignDispositions.landedDispositions.map((disposition) => disposition.cellId),
);
const dispositionPrefixLength = config.cellOrder.findIndex((cellId) => !dispositionedCells.has(cellId));
const recordedPrefixLength = dispositionPrefixLength === -1
  ? config.cellOrder.length
  : dispositionPrefixLength;
for (const [cellIndex, cell] of config.cells.entries()) {
  try {
    registeredCellExpectations(config, cell);
  } catch (error) {
    fail(`cell ${cell.id} has no exact adapter/native-count policy: ${error.message}`);
  }
  const policy = loadPolicyForCell(config, cell);
  if (cell.allowedHostId !== policy.allowedHostId || !config.machines[cell.allowedHostId]) {
    fail(`cell ${cell.id} does not bind one registered host-specific load ceiling`);
  }
  const slot = readJson(`cells/${cell.id}/cell.json`);
  if (slot.cellId !== cell.id) fail(`cell slot identity drifted: ${cell.id}`);
  if (
    cellIndex === 0 && (
      slot.status !== 'recovered-finalized'
      || slot.campaignCellRerun !== false
      || slot.recoveryVersion !== recovery.completedCellRecoveryVersion
    )
  ) {
    fail(`recovered cell 1 does not retain its exact versioned non-rerun declaration: ${cell.id}`);
  }
  const expectedCommand = config.controller.commandTemplate.map((value) => (
    value.replaceAll('{cellId}', cell.id)
  ));
  if (JSON.stringify(cell.controllerCommand) !== JSON.stringify(expectedCommand)) {
    fail(`cell ${cell.id} does not carry its exact production controller command`);
  }
  try {
    const binding = configuredExecutionBinding({ harnessConfig: config, cell, repositoryRoot });
    const allowedMachine = config.machines[cell.allowedHostId];
    const boundNodeVersion = execFileSync(binding.node.path, ['--version'], { encoding: 'utf8' }).trim();
    if (
      allowedMachine.node.path !== binding.node.path
      || allowedMachine.node.sha256 !== binding.node.sha256
      || allowedMachine.node.version !== boundNodeVersion
    ) {
      fail(`cell ${cell.id} Node binding disagrees with its allowed host toolchain`);
    }
  } catch (error) {
    fail(`cell ${cell.id} execution binding is invalid: ${error.message}`);
  }
  const expectedAdmission = `admissions/${cell.id}.json`;
  if (
    cell.admissionArtifact !== expectedAdmission
    || optionValue(cell.controllerCommand, '--admission') !== `${config.paths.committedRunRoot}/${expectedAdmission}`
  ) {
    fail(`cell ${cell.id} does not bind its deterministic per-cell admission artifact`);
  }
  const harness = config.harnesses[cell.harness];
  if (!harness || !existsSync(harness.binary)) {
    fail(`cell ${cell.id} has no existing ${cell.harness} CLI binary`);
  }
  if (!['stdin', 'file', 'argument'].includes(harness.promptDelivery)) {
    fail(`cell ${cell.id} has no supported prompt delivery mode`);
  }
  if (cell.model !== harness.model) {
    fail(`cell ${cell.id} model disagrees with harness ${cell.harness}`);
  }
  if (cell.effort !== resolvedEffort(cell.harness, harness)) {
    fail(`cell ${cell.id} effort disagrees with harness ${cell.harness}`);
  }
  const loaded = await loadLaneControllerConfig({
    harnessConfigPath,
    cellId: cell.id,
  });
  if (loaded.config.cell.id !== cell.id || loaded.config.instrumentPin !== 'social-messenger@0.3.3-m8') {
    fail(`lane controller rejected or misresolved cell ${cell.id}`);
  }
}

const nextCell = config.cells[recordedPrefixLength] ?? null;
if (
  recordedPrefixLength === recovery.completedCells.length
  && (JSON.stringify(recovery.nextControllerCommand) !== JSON.stringify(nextCell.controllerCommand)
  || recovery.loadAdmissionPolicyId !== nextCell.loadCeilingId
  || recovery.nextCellRule !== loadPolicyForCell(config, nextCell).nextCellRule
  || recovery.resumeAllowedHostId !== nextCell.allowedHostId)
) {
  fail('recovery transition changed the registered next-cell command or admission rules');
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  status: config.status,
  cells: config.cells.length,
  promptHashes: provenance.files.length,
  packagePins: Object.keys(config.pins.snapback0125.packages).length,
  productionDriver: config.controller.driver,
  controllerCommands: config.cells.length,
  harnesses: Object.keys(config.harnesses).length,
  resolvedRulings: 3,
  dryRunEvidence: dryRunEvidence.length,
  waveStartAllowed: preflight.waveStartAllowed,
  noBenchmarkCellStarted: false,
  recordedPrefixLength,
  nextCell: nextCell?.id ?? null,
  nextControllerCommand: nextCell?.controllerCommand ?? null,
})}\n`);
