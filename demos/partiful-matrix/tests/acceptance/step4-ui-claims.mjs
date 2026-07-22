#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(here, '..', '..');
const repoRoot = resolve(demoRoot, '..', '..');
const browserHarness = join(here, 'browser-matrix.mjs');
const exactRevision = option('exact-revision') ?? process.env.PARTITIME_EXACT_REVISION;
const selectedArm = option('arm');
const selectedClaim = option('claim');
const selectedBrowser = option('browser') ?? 'chrome';
const iosSimulatorUdid = option('ios-simulator-udid') ?? process.env.PARTITIME_IOS_SIMULATOR_UDID ?? null;
const resultsRoot = join(demoRoot, 'acceptance', 'results', 'phase4-ui-claims', ...(selectedBrowser === 'chrome' ? [] : [selectedBrowser]));
const aggregatePath = join(demoRoot, 'acceptance', 'results', selectedBrowser === 'chrome' ? 'step4-ui-claims.json' : `step4-ui-claims-${selectedBrowser}.json`);

const arms = selectedArm ? [selectedArm] : ['react', 'contract'];
const claims = selectedClaim ? [selectedClaim] : [
  'STEP4.UI.RESPONSIVE',
  'STEP4.UI.KEYBOARD',
  'STEP4.UI.FOCUS',
  'STEP4.UI.REDUCED-MOTION',
  'STEP4.UI.A11Y',
  'STEP4.UI.VISUAL',
];

if (!exactRevision) throw new Error('authoritative Phase 4 evidence requires --exact-revision or PARTITIME_EXACT_REVISION');
if (arms.some((arm) => !['react', 'contract'].includes(arm))) throw new Error(`unknown arm: ${selectedArm}`);
if (claims.some((claim) => !claim.startsWith('STEP4.UI.'))) throw new Error(`unknown claim: ${selectedClaim}`);
if (!['chrome', 'firefox', 'safari', 'ios-safari'].includes(selectedBrowser)) throw new Error(`unknown browser: ${selectedBrowser}`);
if (selectedBrowser === 'ios-safari' && !iosSimulatorUdid) throw new Error('--browser ios-safari requires --ios-simulator-udid or PARTITIME_IOS_SIMULATOR_UDID');

mkdirSync(resultsRoot, { recursive: true });
const runs = [];
for (const arm of arms) {
  for (const claimId of claims) {
    const receiptPath = join(resultsRoot, arm, `${claimId.toLowerCase().replaceAll('.', '-')}.json`);
    mkdirSync(dirname(receiptPath), { recursive: true });
    const execution = spawnSync(process.execPath, [
      browserHarness,
      '--product-ui',
      '--phase4-only',
      '--phase4-claim', claimId,
      '--browser', selectedBrowser,
      '--arm', arm,
      '--receipt', receiptPath,
      ...(selectedBrowser === 'ios-safari' ? ['--ios-simulator-udid', iosSimulatorUdid] : []),
    ], {
      cwd: repoRoot,
      env: { ...process.env, PARTITIME_EXACT_REVISION: exactRevision },
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
    let receipt = null;
    try { receipt = JSON.parse(readFileSync(receiptPath, 'utf8')); } catch { /* recorded below */ }
    const run = {
      arm,
      claimId,
      exitCode: execution.status,
      receiptPath: receiptPath.slice(repoRoot.length + 1),
      receiptSha256: receipt ? digest(receiptPath) : null,
      receipt,
      ok: execution.status === 0 && receipt?.ok === true && receipt?.passed === 1 && receipt?.total === 1,
    };
    runs.push(run);
    console.log(`  ${run.ok ? '✓' : '✗'} ${arm} ${claimId}`);
    if (!run.ok) console.error((execution.stderr || execution.stdout || 'child produced no diagnostic output').trim().split('\n').slice(-12).join('\n'));
  }
}

const a11y = compareA11y(runs);
const claimResults = claims.map((claimId) => {
  const cells = runs.filter((run) => run.claimId === claimId);
  const expectedArms = arms;
  const complete = cells.length === expectedArms.length && expectedArms.every((arm) => cells.some((cell) => cell.arm === arm && cell.ok));
  const deltaOk = claimId !== 'STEP4.UI.A11Y' || arms.length !== 2 || a11y.ok;
  return {
    claimId,
    status: complete && deltaOk ? 'pass' : 'red',
    cells: cells.map(({ arm, ok, exitCode, receiptPath, receiptSha256 }) => ({ arm, ok, exitCode, receiptPath, receiptSha256 })),
    ...(claimId === 'STEP4.UI.A11Y' ? { delta: a11y } : {}),
    ...(claimId === 'STEP4.UI.VISUAL' ? { scope: '13-state structural preflight only; the 156-cell approved-baseline lane remains separate and approval-gated' } : {}),
  };
});

const report = {
  $schema: 'partitime-step4-ui-claims/v1',
  generatedAt: new Date().toISOString(),
  revisions: {
    snapback: gitRevision(repoRoot),
    exact: exactRevision,
  },
  browser: selectedBrowser,
  isolation: `Each arm × claim cell starts a fresh in-memory Snapback server, gateway, Vite server, ${selectedBrowser} process/session, and page. Mutating keyboard evidence therefore cannot alter visual or accessibility fixtures.`,
  arms,
  claims,
  expectedRuns: arms.length * claims.length,
  completedRuns: runs.length,
  claimResults,
  ok: runs.length === arms.length * claims.length && claimResults.every((result) => result.status === 'pass'),
};
mkdirSync(dirname(aggregatePath), { recursive: true });
writeFileSync(aggregatePath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n${report.ok ? 'PASS' : 'FAIL'} Phase 4 isolated UI claims — ${claimResults.filter((result) => result.status === 'pass').length}/${claimResults.length}`);
console.log(`Receipt: ${aggregatePath}`);
process.exitCode = report.ok ? 0 : 1;

function compareA11y(allRuns) {
  const react = claimDetails(allRuns, 'react', 'STEP4.UI.A11Y');
  const contract = claimDetails(allRuns, 'contract', 'STEP4.UI.A11Y');
  if (!react || !contract) return { ok: arms.length < 2, reason: 'both arm receipts are required for the delta oracle' };
  const reactSerious = react.criticalSerious ?? [];
  const contractSerious = contract.criticalSerious ?? [];
  const newCriticalSerious = contractSerious.filter((item) => !reactSerious.some((baseline) => baseline.id === item.id));
  return {
    oracle: 'zero new critical/serious; Contract total violations <= React control',
    react: { criticalSerious: reactSerious, totalViolations: react.totalViolations },
    contract: { criticalSerious: contractSerious, totalViolations: contract.totalViolations },
    newCriticalSerious,
    ok: newCriticalSerious.length === 0
      && contractSerious.length <= reactSerious.length
      && contract.totalViolations <= react.totalViolations,
  };
}

function claimDetails(allRuns, arm, claimId) {
  return allRuns.find((run) => run.arm === arm && run.claimId === claimId && run.ok)?.receipt?.results?.[0]?.details ?? null;
}

function option(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? null : process.argv[at + 1];
}

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function gitRevision(cwd) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}
