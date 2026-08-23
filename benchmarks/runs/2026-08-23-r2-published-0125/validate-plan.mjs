#!/usr/bin/env node

// @ref LLP 0295#r2-load-isolated-calibration-rerun — R2 is a preregistered,
// strictly serial twelve-cell calibration wave; this validator cannot launch it.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

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
if (config.pins.instrument.observabilityBump.included !== false
    || config.pins.instrument.observabilityBump.status !== 'not-landed') {
  fail('the open observability bump must not be represented as landed');
}
if (config.execution.suiteStatus.currentImplementationStatus
    !== 'blocked-current-choreography-still-optional') {
  fail('suite-status linkage must remain a start blocker until refusal lands');
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
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  status: config.status,
  cells: config.cells.length,
  promptHashes: provenance.files.length,
  packagePins: Object.keys(config.pins.snapback0125.packages).length,
  waveStartAllowed: preflight.waveStartAllowed,
  noBenchmarkCellStarted: true,
})}\n`);
