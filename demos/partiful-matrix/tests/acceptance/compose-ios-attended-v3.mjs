#!/usr/bin/env node

// @ref LLP 0063#sequence — v3 composes facts, never whole-claim verdicts.
// A retained passing conjunct cannot offset a red or missing sibling.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const AMENDMENT_ID = 'partitime-step4-physical-ios-carrier-v3-2026-07-28';
const CLAIMS = {
  'STEP4.UI.KEYBOARD': {
    simulator: ['menu', 'guest'],
    physical: ['create', 'rsvp', 'wall'],
  },
  'STEP4.UI.REDUCED-MOTION': {
    simulator: ['overlay', 'rsvp'],
    physical: ['wall'],
  },
};

export function composeIosAttendedV3({
  amendment,
  simulatorReceipts,
  physicalReceipts,
}) {
  const errors = [];
  if (amendment?.amendmentId !== AMENDMENT_ID) errors.push('amendment identity mismatch');
  if (amendment?.status !== 'ratified') errors.push('amendment is not owner-ratified');
  if (amendment?.ratification?.owner !== 'Charlie Cheever') errors.push('ratifying owner mismatch');
  if (amendment?.ratification?.statement !== `I ratify ${AMENDMENT_ID}.`) {
    errors.push('ratification statement mismatch');
  }

  const arms = ['react', 'contract'];
  const cells = [];
  for (const arm of arms) {
    for (const [claimId, required] of Object.entries(CLAIMS)) {
      const simulator = simulatorReceipts?.[arm]?.[claimId] ?? null;
      const physical = physicalReceipts?.[arm] ?? null;
      const cellErrors = [];
      const identities = [simulatorIdentity(simulator), physical?.identity ?? null];
      const reference = identities.find(Boolean);

      if (!simulator) cellErrors.push('simulator receipt missing');
      if (!physical) cellErrors.push('physical receipt missing');
      if (simulator?.browser !== 'ios-safari') cellErrors.push('simulator browser identity mismatch');
      if (physical?.schemaVersion !== 'partitime.ios-attended-physical-receipt.v1') {
        cellErrors.push('physical receipt schema mismatch');
      }
      if (physical?.instrumentId !== AMENDMENT_ID) cellErrors.push('physical instrument identity mismatch');
      if (physical?.arm !== arm) cellErrors.push('physical arm mismatch');
      if (physical?.browser !== 'ordinary-mobile-safari-xcuitest') {
        cellErrors.push('physical browser identity mismatch');
      }
      if (physical?.safariDriverSessionAbsent !== true) {
        cellErrors.push('SafariDriver absence was not attested');
      }
      if (physical?.attended?.inputSource !== 'physical-iphone-soft-keyboard') {
        cellErrors.push('physical soft-keyboard identity mismatch');
      }
      if (physical?.attended?.operator !== 'Charlie Cheever') {
        cellErrors.push('attended operator mismatch');
      }
      if (physical?.device?.udid == null || physical?.device?.osVersion == null) {
        cellErrors.push('physical device identity incomplete');
      }
      for (const identity of identities) {
        if (!identity || !reference) continue;
        for (const field of ['snapbackRevision', 'exactRevision', 'fixtureId', 'packageIdentity']) {
          if (identity[field] !== reference[field]) cellErrors.push(`${field} mismatch`);
        }
      }

      const simulatorSubchecks = readSimulatorSubchecks(simulator, claimId, cellErrors);
      const physicalObservations = physical?.observations ?? {};
      const facts = [];
      for (const id of required.simulator) {
        facts.push(fact('simulator', id, simulatorSubchecks[id], cellErrors));
      }
      for (const id of required.physical) {
        const observationId = physicalObservationId(claimId, id);
        const observation = physicalObservations[observationId];
        facts.push(fact('physical', id, observation, cellErrors));
        if (observation?.attachments?.screenshot?.sha256 == null) {
          cellErrors.push(`${observationId} screenshot missing`);
        }
        if (observation?.attachments?.accessibilityTree?.sha256 == null) {
          cellErrors.push(`${observationId} accessibility tree missing`);
        }
      }

      cells.push({
        arm,
        claimId,
        status: cellErrors.length === 0 && facts.every(({ status }) => status === 'pass')
          ? 'pass'
          : 'red',
        identity: reference,
        facts,
        errors: [...new Set(cellErrors)],
      });
    }
  }

  return {
    schemaVersion: 'partitime.step4-ios-attended-composite.v3',
    generatedAt: new Date().toISOString(),
    instrumentId: AMENDMENT_ID,
    policy: {
      composition: 'fact-level-conjunctive',
      missingOrRed: 'red',
      physicalReplacementScope: {
        'STEP4.UI.KEYBOARD': ['create', 'rsvp', 'wall'],
        'STEP4.UI.REDUCED-MOTION': ['wall'],
      },
    },
    cells,
    errors,
    ok: errors.length === 0 && cells.length === 4 && cells.every(({ status }) => status === 'pass'),
  };
}

function simulatorIdentity(receipt) {
  if (!receipt) return null;
  return {
    snapbackRevision: receipt.revision?.snapback ?? null,
    exactRevision: receipt.revision?.exact ?? null,
    fixtureId: receipt.artifacts?.inputsHash ?? null,
    packageIdentity: receipt.testInventorySha256 ?? null,
  };
}

function readSimulatorSubchecks(receipt, claimId, errors) {
  const result = receipt?.results?.find(({ name }) => name?.startsWith(claimId));
  if (!result) {
    errors.push('simulator claim result missing');
    return {};
  }
  if (result.ok === true) {
    return Object.fromEntries(
      Object.entries(result.details ?? {})
        .filter(([id]) => Object.values(CLAIMS).some(({ simulator, physical }) => (
          simulator.includes(id) || physical.includes(id)
        )))
        .map(([id, details]) => [id, { status: 'pass', details }]),
    );
  }
  if (result.diagnostic?.code !== 'PARTITIME_PHASE4_CONJUNCT_FAILED') {
    errors.push('simulator failure lacks conjunctive diagnostics');
    return {};
  }
  if (result.diagnostic.claimId !== claimId) errors.push('simulator diagnostic claim mismatch');
  return Object.fromEntries(
    (result.diagnostic.subchecks ?? []).map((entry) => [entry.subcheckId, entry]),
  );
}

function physicalObservationId(claimId, subcheckId) {
  if (claimId === 'STEP4.UI.REDUCED-MOTION') return 'reduced-motion-wall';
  return `keyboard-${subcheckId}`;
}

function fact(source, subcheckId, observation, errors) {
  if (!observation) {
    errors.push(`${source} ${subcheckId} missing`);
    return { source, subcheckId, status: 'red', details: null };
  }
  if (observation.status !== 'pass') errors.push(`${source} ${subcheckId} is not passing`);
  return {
    source,
    subcheckId,
    status: observation.status === 'pass' ? 'pass' : 'red',
    details: observation.details ?? null,
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const amendmentPath = resolve(option('amendment') ?? '');
  const simulatorRoot = resolve(option('simulator-root') ?? '');
  const physicalRoot = resolve(option('physical-root') ?? '');
  const outputPath = resolve(option('out') ?? '');
  assert.ok(existsSync(amendmentPath), '--amendment must exist');
  assert.ok(existsSync(simulatorRoot), '--simulator-root must exist');
  assert.ok(existsSync(physicalRoot), '--physical-root must exist');
  assert.ok(outputPath !== repoRoot, '--out is required');

  const simulatorReceipts = {};
  const physicalReceipts = {};
  for (const arm of ['react', 'contract']) {
    simulatorReceipts[arm] = {};
    for (const claimId of Object.keys(CLAIMS)) {
      const slug = claimId.toLowerCase().replaceAll('.', '-');
      simulatorReceipts[arm][claimId] = readJson(resolve(simulatorRoot, arm, `${slug}.json`));
    }
    physicalReceipts[arm] = readJson(resolve(physicalRoot, arm, 'receipt.json'));
  }
  const report = composeIosAttendedV3({
    amendment: readJson(amendmentPath),
    simulatorReceipts,
    physicalReceipts,
  });
  report.inputs = {
    amendment: { path: relative(repoRoot, amendmentPath), sha256: digest(amendmentPath) },
    simulatorRoot: relative(repoRoot, simulatorRoot),
    physicalRoot: relative(repoRoot, physicalRoot),
  };
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${report.ok ? 'PASS' : 'RED'} iOS attended v3 composite — ${report.cells.filter(({ status }) => status === 'pass').length}/4 cells`);
  console.log(outputPath);
  if (!report.ok) process.exitCode = 1;
}
