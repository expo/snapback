#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(here, '..', '..');
const repoRoot = resolve(demoRoot, '..', '..');
const exactRoot = resolve(option('exact-root') ?? process.env.EXACT_ROOT ?? join(repoRoot, '..', 'exact'));
const resultsRoot = join(demoRoot, 'acceptance', 'results');
const outputPath = join(resultsRoot, 'step4-ui-matrix.json');
const oq9Path = join(exactRoot, 'tests', 'partitime-ui', 'oq9-resolution.json');
const visualPath = join(resultsRoot, 'phase4-visual-baselines', 'index.json');
const manualPath = join(resultsRoot, 'step4-ui-manual-device.json');
const claims = [
  'STEP4.UI.RESPONSIVE',
  'STEP4.UI.KEYBOARD',
  'STEP4.UI.FOCUS',
  'STEP4.UI.REDUCED-MOTION',
  'STEP4.UI.A11Y',
  'STEP4.UI.VISUAL',
];
const engineReceipts = {
  'chrome-macos-latest': join(resultsRoot, 'step4-ui-claims.json'),
  'firefox-macos-latest': join(resultsRoot, 'step4-ui-claims-firefox.json'),
  'safari-macos-latest': join(resultsRoot, 'step4-ui-claims-safari.json'),
  'safari-ios-latest': join(resultsRoot, 'step4-ui-claims-ios-safari.json'),
};

if (!existsSync(oq9Path)) throw new Error(`OQ9 resolution is required: ${oq9Path}`);
if (!existsSync(visualPath)) throw new Error(`visual baseline index is required: ${visualPath}`);
const oq9 = readJson(oq9Path);
const visual = readJson(visualPath);
const exactRevision = visual.revisions?.exact ?? null;
const engineCells = oq9.browserMatrix.v1.map((cell) => inspectEngine(cell));
const manual = inspectManual();
const visualApproval = {
  status: visual.captureComplete === true && visual.approval?.status === 'approved' && visual.outcome === 'pass' ? 'pass' : 'red',
  captureComplete: visual.captureComplete === true,
  approvalStatus: visual.approval?.status ?? null,
  artifactCount: visual.artifacts?.length ?? 0,
  requiredArtifactCount: visual.matrix?.expectedArtifacts ?? null,
  path: relative(repoRoot, visualPath),
  sha256: digest(visualPath),
};

const claimResults = claims.map((claimId) => {
  const automated = engineCells.map((engine) => {
    const claim = engine.claimResults?.find((entry) => entry.claimId === claimId);
    return {
      browserId: engine.browserId,
      status: engine.status === 'pass' && claim?.status === 'pass' ? 'pass' : 'red',
      reason: engine.status !== 'pass' ? engine.reason : claim?.status === 'pass' ? null : 'claim-not-passing',
    };
  });
  const needsManual = ['STEP4.UI.KEYBOARD', 'STEP4.UI.FOCUS', 'STEP4.UI.A11Y'].includes(claimId);
  const status = automated.every((cell) => cell.status === 'pass')
    && (!needsManual || manual.status === 'pass')
    && (claimId !== 'STEP4.UI.VISUAL' || visualApproval.status === 'pass')
    ? 'pass'
    : 'red';
  return {
    claimId,
    status,
    automated,
    ...(needsManual ? { manualDeviceGate: { status: manual.status, reason: manual.reason } } : {}),
    ...(claimId === 'STEP4.UI.VISUAL' ? { visualApproval } : {}),
  };
});

const report = {
  $schema: 'partitime-step4-ui-matrix/v1',
  generatedAt: new Date().toISOString(),
  revisions: { snapback: gitRevision(repoRoot), exact: exactRevision },
  oq9: { path: relative(exactRoot, oq9Path), sha256: digest(oq9Path), status: oq9.status },
  policy: {
    skip: 'forbidden',
    passRule: 'Every automated OQ9 browser cell, applicable real-device manual row, and the recorded visual approval must pass. Missing evidence is red.',
  },
  engines: engineCells,
  manualDeviceGate: manual,
  visualApproval,
  documentedSupportLimitations: oq9.browserMatrix.explicitlyDeferredFromV1,
  claimResults,
  ok: claimResults.every((claim) => claim.status === 'pass'),
};
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`${report.ok ? 'PASS' : 'RED'} Phase 4 OQ9 matrix — ${claimResults.filter((claim) => claim.status === 'pass').length}/${claimResults.length} claims`);
console.log(outputPath);
if (process.argv.includes('--require-pass') && !report.ok) process.exitCode = 1;

function inspectEngine(cell) {
  const path = engineReceipts[cell.id];
  if (!path || !existsSync(path)) return { browserId: cell.id, role: cell.role, status: 'red', reason: 'required-artifact-missing', path: path ? relative(repoRoot, path) : null, sha256: null, claimResults: [] };
  const receipt = readJson(path);
  const revisionMatches = receipt.revisions?.exact === exactRevision;
  const complete = receipt.ok === true && receipt.claimResults?.length === claims.length && claims.every((claimId) => receipt.claimResults.some((claim) => claim.claimId === claimId && claim.status === 'pass'));
  return {
    browserId: cell.id,
    role: cell.role,
    status: complete && revisionMatches ? 'pass' : 'red',
    reason: !revisionMatches ? 'exact-revision-mismatch' : complete ? null : 'claim-receipt-not-passing',
    path: relative(repoRoot, path),
    sha256: digest(path),
    environment: receipt.browser ?? receipt.environment ?? null,
    revisions: receipt.revisions ?? null,
    claimResults: receipt.claimResults ?? [],
  };
}

function inspectManual() {
  if (!existsSync(manualPath)) return { status: 'red', reason: 'required-real-device-artifact-missing', path: relative(repoRoot, manualPath), sha256: null, rows: [] };
  const receipt = readJson(manualPath);
  const pass = receipt.ok === true && receipt.status === 'pass' && Array.isArray(receipt.rows) && receipt.rows.length > 0 && receipt.rows.every((row) => row.status === 'pass');
  return { status: pass ? 'pass' : 'red', reason: pass ? null : 'manual-device-rows-not-passing', path: relative(repoRoot, manualPath), sha256: digest(manualPath), rows: receipt.rows ?? [] };
}

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function digest(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function option(name) { const at = process.argv.indexOf(`--${name}`); return at < 0 ? null : process.argv[at + 1]; }
function gitRevision(cwd) { const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }); return result.status === 0 ? result.stdout.trim() : null; }
