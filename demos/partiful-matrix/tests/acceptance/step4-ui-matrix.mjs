#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluatePartitimeUiClaim,
  inspectAttendedTextEvidence,
  inspectPartitimeEngineClaim,
  inspectPartitimeManualDeviceGate,
  validateCitizenshipReceipt,
} from './step4-closure-helpers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(here, '..', '..');
const repoRoot = resolve(demoRoot, '..', '..');
const generatorPath = fileURLToPath(import.meta.url);
const closureHelpersPath = join(here, 'step4-closure-helpers.mjs');
const exactRoot = resolve(option('exact-root') ?? process.env.EXACT_ROOT ?? join(repoRoot, '..', 'exact'));
const resultsRoot = join(demoRoot, 'acceptance', 'results');
const outputPath = join(resultsRoot, 'step4-ui-matrix.json');
const oq9Path = join(exactRoot, 'tests', 'partitime-ui', 'oq9-resolution.json');
const visualPath = join(resultsRoot, 'phase4-visual-baselines', 'index.json');
const manualPath = join(resultsRoot, 'step4-web-citizenship.json');
const iosTextSupplementPath = join(resultsRoot, 'step4-ui-claims-ios-safari-physical-text.json');
const manualDeviceRequiredRowIds = [
  'ios-safari-current:autofill-password-manager',
  'ios-safari-current:bfcache-restore',
  'ios-safari-current:find-on-page',
  'ios-safari-current:focus-trap-restore',
  'ios-safari-current:ime-composition',
];
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
const snapbackFixtureRevision = visual.revisions?.snapback ?? null;
const fixtureSourceParity = inspectFixtureSourceParity(snapbackFixtureRevision);
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
  const automated = engineCells.map((engine) => inspectPartitimeEngineClaim(engine, claimId));
  const needsManual = ['STEP4.UI.KEYBOARD', 'STEP4.UI.FOCUS', 'STEP4.UI.A11Y'].includes(claimId);
  const result = evaluatePartitimeUiClaim({
    claimId,
    automated,
    manualStatus: manual.status,
    visualStatus: visualApproval.status,
    fixtureSourceParityStatus: fixtureSourceParity.status,
  });
  return {
    claimId,
    ...result,
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
    passRule: 'Current product sources must match the approved fixture revision, and every automated OQ9 browser cell, applicable real-device manual row, and the recorded visual approval must pass. Missing or stale evidence is red.',
  },
  engines: engineCells,
  manualDeviceGate: manual,
  visualApproval,
  inputs: {
    generator: { path: relative(repoRoot, generatorPath), sha256: digest(generatorPath) },
    manualGateHelper: { path: relative(repoRoot, closureHelpersPath), sha256: digest(closureHelpersPath) },
    fixtureSourceParity,
  },
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
  const revisionMatches = receipt.revisions?.exact === exactRevision
    && receipt.revisions?.snapback === snapbackFixtureRevision;
  const receiptComplete = receipt.expectedRuns === claims.length * 2
    && receipt.completedRuns === receipt.expectedRuns
    && receipt.claimResults?.length === claims.length
    && claims.every((claimId) => receipt.claimResults.filter((claim) => claim.claimId === claimId).length === 1);
  const supplement = cell.id === 'safari-ios-latest'
    ? inspectIosTextSupplement(receipt)
    : null;
  const claimResults = (receipt.claimResults ?? []).map((claim) => {
    const replacement = supplement?.claimResults?.find(
      ({ claimId }) => claimId === claim.claimId,
    );
    if (
      revisionMatches
      && receiptComplete
      && claim.status !== 'pass'
      && supplement?.status === 'pass'
      && replacement?.status === 'pass'
    ) {
      return {
        ...claim,
        status: 'pass',
        baseStatus: claim.status,
        qualifyingReplacementEvidence: replacement,
      };
    }
    return claim;
  });
  const effectiveComplete = revisionMatches
    && receiptComplete
    && claims.every(
      (claimId) => claimResults.find((claim) => claim.claimId === claimId)?.status === 'pass',
    );
  return {
    browserId: cell.id,
    role: cell.role,
    status: effectiveComplete ? 'pass' : 'red',
    reason: !revisionMatches
      ? 'fixture-revision-mismatch'
      : !receiptComplete
        ? 'claim-receipt-incomplete'
        : effectiveComplete
          ? null
          : 'claim-receipt-not-passing',
    revisionMatches,
    revisionReason: revisionMatches ? null : 'fixture-revision-mismatch',
    receiptComplete,
    path: relative(repoRoot, path),
    sha256: digest(path),
    environment: receipt.browser ?? receipt.environment ?? null,
    revisions: receipt.revisions ?? null,
    claimResults,
    ...(supplement ? { physicalTextSupplement: supplement } : {}),
  };
}

function inspectFixtureSourceParity(revision) {
  if (typeof revision !== 'string' || !/^[a-f0-9]{40}$/.test(revision)) {
    return {
      status: 'red',
      reason: 'visual-fixture-revision-missing',
      revision,
      files: [],
      changedPaths: [],
    };
  }
  const roots = [
    'demos/partiful-matrix/surfaces/react/src',
    'demos/partiful-matrix/surfaces/react/index.html',
    'demos/partiful-matrix/surfaces/react/vite.config.ts',
    'demos/partiful-matrix/surfaces/contract',
    'demos/partiful-matrix/shared',
    'demos/partiful-matrix/snapback',
    'demos/partiful-matrix/acceptance/visual-spec.v1.json',
  ];
  const inventory = spawnSync('git', [
    'ls-tree', '-r', '--name-only', revision, '--', ...roots,
  ], { cwd: repoRoot, encoding: 'utf8' });
  if (inventory.status !== 0) {
    return {
      status: 'red',
      reason: 'visual-fixture-revision-unreadable',
      revision,
      diagnostic: inventory.stderr.trim(),
      files: [],
      changedPaths: [],
    };
  }
  const excluded = new Set([
    'demos/partiful-matrix/surfaces/contract/package.json',
    'demos/partiful-matrix/surfaces/contract/bun.lock',
  ]);
  const paths = inventory.stdout.trim().split('\n')
    .filter(Boolean)
    .filter((path) => !excluded.has(path));
  const files = paths.map((path) => {
    const committed = spawnSync('git', ['show', `${revision}:${path}`], {
      cwd: repoRoot,
      encoding: null,
    });
    const currentPath = join(repoRoot, path);
    const current = existsSync(currentPath) ? readFileSync(currentPath) : null;
    const expectedSha256 = committed.status === 0 ? createHash('sha256').update(committed.stdout).digest('hex') : null;
    const currentSha256 = current ? createHash('sha256').update(current).digest('hex') : null;
    return {
      path,
      expectedSha256,
      currentSha256,
      matches: expectedSha256 !== null && currentSha256 === expectedSha256,
    };
  });
  const changedPaths = files.filter(({ matches }) => !matches).map(({ path }) => path);
  return {
    status: changedPaths.length === 0 && files.length > 0 ? 'pass' : 'red',
    reason: changedPaths.length === 0 && files.length > 0 ? null : 'physical-carrier-fixture-source-drift',
    revision,
    files,
    changedPaths,
  };
}

function inspectIosTextSupplement(baseReceipt) {
  // @tactical @ref https://github.com/ccheever/exact/blob/83ffa30bc56924252660fcefa7bf7185bf432c11/llp/0373-contract-and-exact-after-partitime.plan.md#12-implementation-record-2026-07-20
  // A physical run may replace only the two retained simulator failures whose
  // causal gap is text delivery. It cannot waive the base engine inventory,
  // change the pinned product fixture, or satisfy LLP 0211's separate manual
  // citizenship matrix.
  const result = {
    status: 'red',
    reason: 'physical-text-supplement-missing',
    path: relative(repoRoot, iosTextSupplementPath),
    sha256: null,
    claimResults: [],
    errors: [],
  };
  if (!existsSync(iosTextSupplementPath)) return result;
  result.sha256 = digest(iosTextSupplementPath);
  let receipt;
  try {
    receipt = readJson(iosTextSupplementPath);
  } catch (error) {
    result.reason = 'physical-text-supplement-invalid-json';
    result.errors.push(error instanceof Error ? error.message : String(error));
    return result;
  }
  const expectedClaimIds = ['STEP4.UI.KEYBOARD', 'STEP4.UI.REDUCED-MOTION'];
  const error = (message) => result.errors.push(message);
  if (fixtureSourceParity.status !== 'pass') error('current Partitime product sources do not match the visual fixture revision');
  if (receipt.$schema !== 'partitime-step4-ui-claims/v1') error('supplement schema mismatch');
  if (receipt.browser !== 'ios-safari-device') error('supplement browser identity mismatch');
  if (receipt.ok !== true) error('supplement aggregate is not green');
  if (receipt.expectedRuns !== 4 || receipt.completedRuns !== 4) error('supplement run inventory is incomplete');
  if (receipt.revisions?.exact !== exactRevision) error('supplement Exact revision does not match the visual fixture');
  if (receipt.attended?.deviceUdid == null || receipt.attended?.operator == null) error('supplement attended identity is incomplete');
  if (JSON.stringify(receipt.qualifyingScope) !== JSON.stringify(expectedClaimIds)) error('supplement qualifying scope drifted');
  if (
    !Array.isArray(receipt.claimResults)
    || receipt.claimResults.length !== expectedClaimIds.length
    || !expectedClaimIds.every(
      (claimId) => receipt.claimResults.filter((claim) => claim.claimId === claimId && claim.status === 'pass').length === 1,
    )
  ) {
    error('supplement claim inventory is not exactly the two passing text-dependent claims');
  }

  const baseContractCell = baseReceipt.claimResults
    ?.find(({ claimId }) => claimId === 'STEP4.UI.KEYBOARD')
    ?.cells?.find(({ arm }) => arm === 'contract');
  const baseContractReceipt = readBoundRawReceipt(baseContractCell, error, 'base Contract keyboard');
  const expectedExactPackages = exactPackageIdentity(baseContractReceipt?.packages?.contract);
  const replacements = [];
  for (const claimId of expectedClaimIds) {
    const claim = receipt.claimResults?.find((entry) => entry.claimId === claimId);
    const rawCells = [];
    for (const arm of ['react', 'contract']) {
      const cell = claim?.cells?.find((entry) => entry.arm === arm);
      const raw = readBoundRawReceipt(cell, error, `${arm} ${claimId}`);
      if (!raw) continue;
      validatePhysicalRawReceipt({
        raw,
        arm,
        claimId,
        aggregate: receipt,
        expectedExactPackages,
        error,
      });
      rawCells.push({
        arm,
        receiptPath: cell.receiptPath,
        receiptSha256: cell.receiptSha256,
      });
    }
    replacements.push({
      claimId,
      status: rawCells.length === 2 && claim?.status === 'pass' ? 'pass' : 'red',
      witness: 'attended physical-iOS replacement for the simulator text-carrier gap only',
      baseSimulatorStatus: baseReceipt.claimResults?.find((entry) => entry.claimId === claimId)?.status ?? null,
      cells: rawCells,
    });
  }
  result.claimResults = replacements;
  if (result.errors.length === 0 && replacements.every(({ status }) => status === 'pass')) {
    result.status = 'pass';
    result.reason = null;
  } else {
    result.reason = 'physical-text-supplement-invalid';
  }
  return result;
}

function readBoundRawReceipt(cell, error, label) {
  if (!cell?.receiptPath || !cell?.receiptSha256) {
    error(`${label} raw receipt identity is missing`);
    return null;
  }
  const path = resolve(repoRoot, cell.receiptPath);
  const allowedRoot = `${resolve(resultsRoot, 'phase4-ui-claims')}/`;
  if (!path.startsWith(allowedRoot) || !existsSync(path)) {
    error(`${label} raw receipt is outside the governed results root or missing`);
    return null;
  }
  if (digest(path) !== cell.receiptSha256) {
    error(`${label} raw receipt digest mismatch`);
    return null;
  }
  try {
    return readJson(path);
  } catch (parseError) {
    error(`${label} raw receipt is invalid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
    return null;
  }
}

function exactPackageIdentity(packageRecord) {
  if (!packageRecord?.resolvedDependencies) return null;
  return Object.fromEntries(
    Object.entries(packageRecord.resolvedDependencies)
      .filter(([name]) => name.startsWith('@exact/'))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => [name, {
        resolvedName: value.resolvedName,
        resolvedVersion: value.resolvedVersion,
        manifestSha256: value.manifestSha256,
      }]),
  );
}

function validatePhysicalRawReceipt({
  raw,
  arm,
  claimId,
  aggregate,
  expectedExactPackages,
  error,
}) {
  const label = `${arm} ${claimId}`;
  if (raw.ok !== true || raw.passed !== 1 || raw.total !== 1) error(`${label} raw receipt is not one passing claim`);
  if (raw.revision?.exact !== exactRevision) error(`${label} raw Exact revision mismatch`);
  if (raw.environment?.browser !== 'ios-safari-device') error(`${label} raw browser identity mismatch`);
  if (raw.environment?.iosDevice?.resolved !== true) error(`${label} physical device identity did not resolve`);
  if (raw.environment?.iosDevice?.pairingState !== 'paired') error(`${label} physical device was not paired`);
  if (raw.environment?.iosDevice?.udid !== aggregate.attended?.deviceUdid) error(`${label} physical device UDID mismatch`);
  if (raw.environment?.attendedOperator !== aggregate.attended?.operator) error(`${label} attended operator mismatch`);
  if (raw.environment?.attended !== true) error(`${label} is not marked attended`);
  if (typeof raw.environment?.webdriverSessionCapabilities?.browserVersion !== 'string') {
    error(`${label} physical Mobile Safari version is missing`);
  }
  if (typeof raw.environment?.webdriverSessionCapabilities?.['safari:platformVersion'] !== 'string') {
    error(`${label} physical iOS platform version is missing`);
  }
  if (arm === 'contract' && JSON.stringify(exactPackageIdentity(raw.packages?.contract)) !== JSON.stringify(expectedExactPackages)) {
    error(`${label} resolved Exact package identity differs from the pinned simulator fixture`);
  }
  const details = raw.results?.length === 1 ? raw.results[0]?.details : null;
  if (details?.claimId !== claimId) error(`${label} result claim identity mismatch`);
  const expectedValues = claimId === 'STEP4.UI.KEYBOARD'
    ? ['Keyboard Picnic', 'Dolores Park', 'Keyboard picnic']
    : ['Reduced motion status'];
  const evidence = details?.attendedTextEvidence;
  const attendedInspection = inspectAttendedTextEvidence(
    evidence,
    expectedValues,
    aggregate.attended?.operator,
  );
  for (const issue of attendedInspection.errors) error(`${label} ${issue}`);
  if (attendedInspection.status !== 'pass') {
    return;
  }
  for (const entry of evidence) {
    const screenshotPath = resolve(repoRoot, entry.screenshot?.path ?? '');
    const allowedRoot = `${resolve(resultsRoot, 'phase4-ui-claims', 'ios-safari-physical-text')}/`;
    if (!screenshotPath.startsWith(allowedRoot) || !existsSync(screenshotPath)) {
      error(`${label} attended screenshot is outside the governed root or missing`);
      continue;
    }
    const screenshotBytes = readFileSync(screenshotPath);
    if (createHash('sha256').update(screenshotBytes).digest('hex') !== entry.screenshot.sha256) {
      error(`${label} attended screenshot digest mismatch`);
    }
    if (screenshotBytes.length !== entry.screenshot.bytes) error(`${label} attended screenshot byte count mismatch`);
  }
}

function inspectManual() {
  if (!existsSync(manualPath)) return { status: 'red', reason: 'required-real-device-artifact-missing', path: relative(repoRoot, manualPath), sha256: null, rows: [] };
  const receipt = readJson(manualPath);
  try {
    validateCitizenshipReceipt(
      receipt,
      'docs/reports/web-citizenship-ime-forms.json',
      'scripts/check-web-citizenship-ime-forms.mjs',
      'demos/partiful-matrix/tests/acceptance/step4-web-citizenship.mjs',
    );
  } catch (error) {
    return {
      status: 'red',
      reason: 'governed-device-receipt-invalid',
      validationError: error instanceof Error ? error.message : String(error),
      path: relative(repoRoot, manualPath),
      sha256: digest(manualPath),
      rows: [],
    };
  }
  return {
    ...inspectPartitimeManualDeviceGate(receipt, manualDeviceRequiredRowIds),
    path: relative(repoRoot, manualPath),
    sha256: digest(manualPath),
  };
}

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function digest(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function option(name) { const at = process.argv.indexOf(`--${name}`); return at < 0 ? null : process.argv[at + 1]; }
function gitRevision(cwd) { const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }); return result.status === 0 ? result.stdout.trim() : null; }
