#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const RECORD = resolve(
  ROOT,
  'benchmarks/runs/2026-08-27-clique-published-0129-matrix/l18-correction-loop-baseline.json',
);
const record = JSON.parse(readFileSync(RECORD, 'utf8'));
const failures = [];

function requireFact(condition, message) {
  if (!condition) failures.push(message);
}

function normalizedTokens(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9.>=_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function evidenceContains(lines, locator) {
  const haystack = normalizedTokens(lines.join('\n'));
  const wanted = normalizedTokens(locator);
  return wanted.every((token) => haystack.includes(token));
}

function markdownHeadingAnchors(source) {
  return new Set(source
    .split(/\r?\n/u)
    .filter((line) => /^#{1,6}\s+/u.test(line))
    .map((line) => line
      .replace(/^#{1,6}\s+/u, '')
      .replace(/\s+#+\s*$/u, '')
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}_\-\s]/gu, '')
      .replace(/\s/gu, '-')));
}

requireFact(record.schemaVersion === 'llp-0317-l18-retrospective-baseline.v1', 'unexpected schemaVersion');
requireFact(record.scope?.retainedInstrumentPin === 'social-messenger@0.3.4-m8', 'retained instrument pin must be 0.3.4-m8');
requireFact(record.scope?.fixedInstrumentPin === 'social-messenger@0.3.6-m8', 'fixed instrument pin must be 0.3.6-m8');
requireFact(record.interpretation?.floorClaim === 'existence-only', 'floor must be existence-only');
requireFact(record.interpretation?.totalLoopCount?.status === 'inapplicable', 'total loop count must remain inapplicable');
requireFact(record.interpretation?.comparativeBaseline?.status === 'required-not-run', 'comparative baseline must remain required-not-run');
for (const governingRef of record.governingRefs ?? []) {
  const [relativePath, anchor] = governingRef.split('#');
  try {
    const source = readFileSync(resolve(ROOT, relativePath), 'utf8');
    requireFact(Boolean(anchor), `governing ref lacks an anchor: ${governingRef}`);
    requireFact(markdownHeadingAnchors(source).has(anchor), `governing ref anchor does not resolve: ${governingRef}`);
  } catch {
    requireFact(false, `governing ref does not resolve: ${governingRef}`);
  }
}

const currentManifest = JSON.parse(readFileSync(resolve(ROOT, 'benchmarks/instrument.manifest.json'), 'utf8'));
requireFact(currentManifest.instrumentPin === record.scope.fixedInstrumentPin, 'current instrument manifest must match the fixed pin');

const expectedCells = new Set([
  'sol-snapback-explicit',
  'sol-snapback-familiar',
  'grok-snapback-explicit',
  'grok-snapback-familiar',
  'terra-snapback-explicit',
  'terra-snapback-familiar',
  'glm-snapback-explicit',
  'glm-snapback-familiar',
]);
requireFact(record.cells?.length === expectedCells.size, 'record must contain exactly eight retained cells');

const ids = new Set();
const attributionCounts = {
  'snapback-defect': 0,
  'agent-error': 0,
  environment: 0,
  ambiguous: 0,
};
let loopCount = 0;
let applicableCells = 0;
let inapplicableCells = 0;

for (const cell of record.cells ?? []) {
  requireFact(expectedCells.delete(cell.cellId), `unexpected or duplicate cell ${cell.cellId}`);
  if (cell.evidenceStatus === 'inapplicable') {
    inapplicableCells += 1;
    requireFact(Boolean(cell.inapplicableReason), `${cell.cellId}: inapplicable cell lacks reason`);
    requireFact(cell.certifiedLoopCount === null, `${cell.cellId}: inapplicable cell count must be null, never zero`);
    requireFact(cell.loops?.length === 0, `${cell.cellId}: inapplicable cell must not certify loops`);
    requireFact(cell.registeredFields?.all?.status === 'inapplicable', `${cell.cellId}: all registered fields must be inapplicable`);
  } else {
    applicableCells += 1;
    requireFact(cell.evidenceStatus === 'applicable-for-certified-existence-only', `${cell.cellId}: invalid evidence posture`);
    requireFact(Number.isInteger(cell.certifiedLoopCount) && cell.certifiedLoopCount >= 0, `${cell.cellId}: invalid certifiedLoopCount`);
    requireFact(cell.certifiedLoopCount === cell.loops?.length, `${cell.cellId}: certifiedLoopCount does not match loop rows`);
    requireFact(cell.registeredFields?.milestoneStatus?.status === 'recorded', `${cell.cellId}: milestone status missing`);
    requireFact(Boolean(cell.registeredFields?.firstGreenAt), `${cell.cellId}: first-green field missing`);
    requireFact(cell.registeredFields?.tokensPhases?.status === 'inapplicable', `${cell.cellId}: historical token phases must be inapplicable`);
  }

  const logPath = resolve(dirname(RECORD), cell.runLog);
  const logLines = readFileSync(logPath, 'utf8').split(/\r?\n/);
  for (const loop of cell.loops ?? []) {
    loopCount += 1;
    requireFact(!ids.has(loop.id), `duplicate loop id ${loop.id}`);
    ids.add(loop.id);
    requireFact(Object.hasOwn(attributionCounts, loop.attribution), `${loop.id}: invalid attribution ${loop.attribution}`);
    if (Object.hasOwn(attributionCounts, loop.attribution)) attributionCounts[loop.attribution] += 1;
    if (loop.attribution === 'snapback-defect') {
      requireFact(['defect', 'knowledge-gap'].includes(loop.subAttribution), `${loop.id}: snapback-defect lacks closed subAttribution`);
    } else {
      requireFact(loop.subAttribution === undefined, `${loop.id}: non-Snapback attribution has subAttribution`);
    }

    for (const role of ['done', 'contrary', 'revision']) {
      const evidence = loop[role];
      requireFact(Boolean(evidence?.locator), `${loop.id}: ${role} locator missing`);
      requireFact(Array.isArray(evidence?.lines) && evidence.lines.length > 0, `${loop.id}: ${role} lines missing`);
      const selected = [];
      for (const lineNumber of evidence?.lines ?? []) {
        requireFact(Number.isInteger(lineNumber) && lineNumber > 0 && lineNumber <= logLines.length, `${loop.id}: ${role} line ${lineNumber} out of range`);
        if (Number.isInteger(lineNumber) && lineNumber > 0 && lineNumber <= logLines.length) selected.push(logLines[lineNumber - 1]);
      }
      requireFact(evidenceContains(selected, evidence?.locator ?? ''), `${loop.id}: ${role} locator not found on cited lines`);
    }

    for (const foldedLocator of loop.foldedLocators ?? []) {
      requireFact(evidenceContains(logLines, foldedLocator), `${loop.id}: folded retry locator not found: ${foldedLocator}`);
    }
  }
}

requireFact(expectedCells.size === 0, `missing cells: ${[...expectedCells].join(', ')}`);
requireFact(loopCount === record.counts.certifiedExistenceLoops, 'top-level certified loop count mismatch');
requireFact(applicableCells === record.counts.applicableCells, 'applicable cell count mismatch');
requireFact(inapplicableCells === record.counts.inapplicableCells, 'inapplicable cell count mismatch');
for (const [attribution, count] of Object.entries(attributionCounts)) {
  requireFact(count === record.counts.byAttribution[attribution], `${attribution} count mismatch`);
}

if (failures.length > 0) {
  process.stderr.write(`L18 baseline invalid:\n${failures.map((failure) => `- ${failure}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(
  `L18 baseline valid: ${loopCount} certified existence loops; ${applicableCells} applicable cells; ${inapplicableCells} inapplicable cells; comparative baseline ${record.interpretation.comparativeBaseline.status}.\n`,
);
