#!/usr/bin/env node

// @ref LLP 0295#r2-load-isolated-calibration-rerun — R2 is a preregistered,
// strictly serial twelve-cell calibration wave whose per-cell production
// controller command is resolved and accepted before any authoring clock.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveInstrumentArtifacts } from '../../tools/lane-setup.mjs';
import { loadLaneControllerConfig } from '../../tools/social-messenger/metering/lane-controller.mjs';

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

const config = readJson('harness-config.json');
const preflight = readJson('preflight.json');
const provenance = readJson('prompt-provenance.json');

if (config.status !== 'prepared-blocked' || !config.noBenchmarkCellStarted) {
  fail('configuration must remain prepared-blocked with no cell started');
}
if (preflight.waveStartAllowed !== false || !preflight.noBenchmarkCellStarted) {
  fail('preflight must refuse wave start and attest that no cell started');
}
if (!config.execution.serial || config.execution.maxConcurrentCells !== 1) {
  fail('execution must be strictly serial');
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
};
for (const [field, path] of Object.entries(overlayHashes)) {
  if (config.pins.instrument.d06MeteringOverlay[field] !== repositorySha256(path)) {
    fail(`D0.6 overlay digest drifted: ${field} (${path})`);
  }
}

for (const field of ['entrypoint', 'driver', 'signal']) {
  const path = resolve(repositoryRoot, config.controller?.[field] ?? '');
  if (!existsSync(path)) fail(`controller ${field} does not exist: ${path}`);
}
if (!existsSync(config.controller.commandTemplate?.[0] ?? '')) {
  fail('controller command does not name an executable Node binary');
}
const driverModule = await import(pathToFileURL(resolve(repositoryRoot, config.controller.driver)));
for (const hook of ['prepare', 'claimOptions', 'runMilestone', 'finalize', 'observationSources']) {
  if (typeof driverModule[hook] !== 'function') fail(`production driver lacks ${hook}()`);
}

for (const prompt of provenance.files) {
  if (sha256(prompt.path) !== prompt.r2Sha256) {
    fail(`prompt hash drifted: ${prompt.path}`);
  }
}

for (const cell of config.cells) {
  if (cell.loadCeilingId !== config.execution.loadIsolation.policyId) {
    fail(`cell ${cell.id} does not carry the registered load ceiling`);
  }
  const slot = readJson(`cells/${cell.id}/cell.json`);
  if (slot.cellId !== cell.id || slot.status !== 'not-started') {
    fail(`cell slot is not pristine: ${cell.id}`);
  }
  if (existsSync(join(root, 'cells', cell.id, 'record.json'))) {
    fail(`cell ${cell.id} unexpectedly has a completed record`);
  }
  const expectedCommand = config.controller.commandTemplate.map((value) => (
    value === '{cellId}' ? cell.id : value
  ));
  if (JSON.stringify(cell.controllerCommand) !== JSON.stringify(expectedCommand)) {
    fail(`cell ${cell.id} does not carry its exact production controller command`);
  }
  const harness = config.harnesses[cell.harness];
  if (!harness || !existsSync(harness.binary)) {
    fail(`cell ${cell.id} has no existing ${cell.harness} CLI binary`);
  }
  if (!['stdin', 'file', 'argument'].includes(harness.promptDelivery)) {
    fail(`cell ${cell.id} has no supported prompt delivery mode`);
  }
  const loaded = await loadLaneControllerConfig({
    harnessConfigPath,
    cellId: cell.id,
  });
  if (loaded.config.cell.id !== cell.id || loaded.config.instrumentPin !== 'social-messenger@0.3.3-m8') {
    fail(`lane controller rejected or misresolved cell ${cell.id}`);
  }
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  status: config.status,
  cells: config.cells.length,
  promptHashes: provenance.files.length,
  packagePins: Object.keys(config.pins.snapback0125.packages).length,
  productionDriver: config.controller.driver,
  controllerCommands: config.cells.length,
  waveStartAllowed: preflight.waveStartAllowed,
  noBenchmarkCellStarted: true,
})}\n`);
