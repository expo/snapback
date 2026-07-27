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
const iosDeviceUdid = option('ios-device-udid') ?? process.env.PARTITIME_IOS_DEVICE_UDID ?? null;
const physicalNetworkHost = option('physical-network-host') ?? process.env.PARTITIME_PHYSICAL_NETWORK_HOST ?? null;
const attendedOperator = option('attended-operator') ?? process.env.PARTITIME_ATTENDED_OPERATOR ?? null;
const attended = process.argv.includes('--attended');
const physicalIos = selectedBrowser === 'ios-safari-device';
const resultBrowserId = physicalIos ? 'ios-safari-physical-text' : selectedBrowser;
const resultsRoot = join(demoRoot, 'acceptance', 'results', 'phase4-ui-claims', ...(selectedBrowser === 'chrome' ? [] : [resultBrowserId]));
const aggregatePath = join(demoRoot, 'acceptance', 'results', selectedBrowser === 'chrome' ? 'step4-ui-claims.json' : `step4-ui-claims-${resultBrowserId}.json`);

const arms = selectedArm ? [selectedArm] : ['react', 'contract'];
const completeClaims = [
  'STEP4.UI.RESPONSIVE',
  'STEP4.UI.KEYBOARD',
  'STEP4.UI.FOCUS',
  'STEP4.UI.REDUCED-MOTION',
  'STEP4.UI.A11Y',
  'STEP4.UI.VISUAL',
];
const physicalTextClaims = [
  'STEP4.UI.KEYBOARD',
  'STEP4.UI.REDUCED-MOTION',
];
const claims = selectedClaim
  ? [selectedClaim]
  : physicalIos
    ? physicalTextClaims
    : completeClaims;

if (!exactRevision) throw new Error('authoritative Phase 4 evidence requires --exact-revision or PARTITIME_EXACT_REVISION');
if (arms.some((arm) => !['react', 'contract'].includes(arm))) throw new Error(`unknown arm: ${selectedArm}`);
if (claims.some((claim) => !claim.startsWith('STEP4.UI.'))) throw new Error(`unknown claim: ${selectedClaim}`);
if (!['chrome', 'firefox', 'safari', 'ios-safari', 'ios-safari-device'].includes(selectedBrowser)) throw new Error(`unknown browser: ${selectedBrowser}`);
if (selectedBrowser === 'ios-safari' && !iosSimulatorUdid) throw new Error('--browser ios-safari requires --ios-simulator-udid or PARTITIME_IOS_SIMULATOR_UDID');
if (physicalIos && !iosDeviceUdid) throw new Error('--browser ios-safari-device requires --ios-device-udid or PARTITIME_IOS_DEVICE_UDID');
if (physicalIos && !physicalNetworkHost) throw new Error('--browser ios-safari-device requires --physical-network-host or PARTITIME_PHYSICAL_NETWORK_HOST');
if (physicalIos && !attendedOperator) throw new Error('--browser ios-safari-device requires --attended-operator or PARTITIME_ATTENDED_OPERATOR');
if (physicalIos && !attended) throw new Error('--browser ios-safari-device requires --attended');
if (physicalIos && claims.some((claim) => !physicalTextClaims.includes(claim))) {
  throw new Error('physical iOS Safari is a supplemental text carrier for STEP4.UI.KEYBOARD and STEP4.UI.REDUCED-MOTION only');
}

mkdirSync(resultsRoot, { recursive: true });
const iosSimulatorPreparation = selectedBrowser === 'ios-safari'
  ? prepareIosSimulatorAccessibility(iosSimulatorUdid)
  : null;
const macosSafariPreparation = selectedBrowser === 'safari'
  ? prepareMacosSafariAccessibility()
  : null;
let iosSimulatorRestoration = null;
let iosSimulatorRestored = false;
let macosSafariRestoration = null;
let macosSafariRestored = false;
process.once('exit', () => {
  if (iosSimulatorPreparation && !iosSimulatorRestored) restoreIosSimulatorAccessibility(iosSimulatorPreparation);
  if (macosSafariPreparation && !macosSafariRestored) restoreMacosSafariAccessibility(macosSafariPreparation);
});
const runs = [];
try {
  for (const arm of arms) {
    for (const claimId of claims) {
      const receiptPath = join(resultsRoot, arm, `${claimId.toLowerCase().replaceAll('.', '-')}.json`);
      const attendedArtifactDir = join(
        dirname(receiptPath),
        `${claimId.toLowerCase().replaceAll('.', '-')}-artifacts`,
      );
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
        ...(physicalIos ? [
          '--ios-device-udid', iosDeviceUdid,
          '--physical-network-host', physicalNetworkHost,
          '--attended-operator', attendedOperator,
          '--attended-artifact-dir', attendedArtifactDir,
          '--attended',
        ] : []),
      ], {
        cwd: repoRoot,
        env: { ...process.env, PARTITIME_EXACT_REVISION: exactRevision },
        encoding: 'utf8',
        // Physical-iOS runs are attended: the child prints the exact text and
        // device-setting action while it polls the phone. Forward stdout so
        // the operator can act before that poll expires, while retaining
        // stderr for the governed per-cell failure diagnostic below.
        stdio: ['ignore', 'inherit', 'pipe'],
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
} finally {
  if (iosSimulatorPreparation) iosSimulatorRestoration = restoreIosSimulatorAccessibility(iosSimulatorPreparation);
  if (macosSafariPreparation) macosSafariRestoration = restoreMacosSafariAccessibility(macosSafariPreparation);
  iosSimulatorRestored = true;
  macosSafariRestored = true;
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
  role: physicalIos
    ? 'supplemental attended physical-iOS text carrier; it may replace only failed simulator text-dependent claims'
    : 'complete automated engine receipt',
  qualifyingScope: physicalIos ? physicalTextClaims : completeClaims,
  attended: physicalIos ? {
    operator: attendedOperator,
    deviceUdid: iosDeviceUdid,
    networkHost: physicalNetworkHost,
    inputPolicy: 'The operator types requested values on the real iPhone soft keyboard; the harness polls DOM outcomes and never sends an element value command.',
  } : null,
  iosSimulatorAccessibility: iosSimulatorPreparation
    ? { preparation: iosSimulatorPreparation.attestation, restoration: iosSimulatorRestoration }
    : null,
  macosSafariAccessibility: macosSafariPreparation
    ? { preparation: macosSafariPreparation.attestation, restoration: macosSafariRestoration }
    : null,
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

function prepareMacosSafariAccessibility() {
  const before = readMacosPreference('com.apple.universalaccess', 'reduceMotion');
  const changed = before !== true;
  if (changed) writeMacosPreference('com.apple.universalaccess', 'reduceMotion', true);
  const during = readMacosPreference('com.apple.universalaccess', 'reduceMotion');
  if (during !== true) {
    throw new Error(`macOS Safari accessibility preflight failed: ${JSON.stringify({ before, during })}`);
  }
  return {
    before,
    changed,
    attestation: {
      domain: 'com.apple.universalaccess',
      preference: 'reduceMotion',
      before,
      during,
      changed,
      policy: 'Reduce Motion is enabled before desktop Safari evidence; the prior value is restored afterward. SafariDriver reads the host preference when each isolated session starts.',
    },
  };
}

function restoreMacosSafariAccessibility(preparation) {
  if (preparation.changed) {
    if (preparation.before === null) deleteMacosPreference('com.apple.universalaccess', 'reduceMotion');
    else writeMacosPreference('com.apple.universalaccess', 'reduceMotion', preparation.before);
  }
  const restored = readMacosPreference('com.apple.universalaccess', 'reduceMotion');
  const ok = restored === preparation.before;
  if (!ok) {
    throw new Error(`macOS Safari accessibility restoration failed: ${JSON.stringify({ expected: preparation.before, restored })}`);
  }
  return { restored, ok };
}

function readMacosPreference(domain, preference) {
  const result = spawnSync('/usr/bin/defaults', ['read', domain, preference], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const value = result.stdout.trim();
  if (value === '1') return true;
  if (value === '0') return false;
  throw new Error(`unexpected macOS preference ${domain} ${preference}: ${JSON.stringify(value)}`);
}

function writeMacosPreference(domain, preference, value) {
  const result = spawnSync('/usr/bin/defaults', ['write', domain, preference, '-bool', value ? 'YES' : 'NO'], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`defaults write ${domain} ${preference} failed: ${(result.stderr || result.stdout).trim()}`);
  }
}

function deleteMacosPreference(domain, preference) {
  const result = spawnSync('/usr/bin/defaults', ['delete', domain, preference], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`defaults delete ${domain} ${preference} failed: ${(result.stderr || result.stdout).trim()}`);
  }
}

function prepareIosSimulatorAccessibility(udid) {
  const inventory = JSON.parse(runXcrun(['simctl', 'list', 'devices', '--json']));
  const device = Object.entries(inventory.devices ?? {}).flatMap(([runtime, devices]) => devices.map((entry) => ({ ...entry, runtime }))).find((entry) => entry.udid.toLowerCase() === udid.toLowerCase());
  if (!device) throw new Error(`unknown iOS Simulator UDID: ${udid}`);
  const wasBooted = device.state === 'Booted';
  if (!wasBooted) {
    runXcrun(['simctl', 'boot', udid]);
    runXcrun(['simctl', 'bootstatus', udid, '-b']);
  }
  const before = {
    FullKeyboardAccessEnabled: readSimulatorPreference(udid, 'FullKeyboardAccessEnabled'),
    ReduceMotionEnabled: readSimulatorPreference(udid, 'ReduceMotionEnabled'),
  };
  const changed = Object.entries(before).filter(([, value]) => value !== true).map(([preference]) => preference);
  for (const preference of changed) writeSimulatorPreference(udid, preference, true);
  if (changed.length > 0) restartSimulator(udid, 'Booted');
  const during = {
    FullKeyboardAccessEnabled: readSimulatorPreference(udid, 'FullKeyboardAccessEnabled'),
    ReduceMotionEnabled: readSimulatorPreference(udid, 'ReduceMotionEnabled'),
  };
  if (Object.values(during).some((value) => value !== true)) throw new Error(`iOS Simulator accessibility preflight failed: ${JSON.stringify({ udid, during })}`);
  return {
    udid,
    before,
    changed,
    wasBooted,
    attestation: {
      udid,
      name: device.name,
      runtime: device.runtime,
      before,
      during,
      changed,
      policy: 'Full Keyboard Access and Reduce Motion are enabled on the explicit simulator before Safari evidence; prior values and boot state are restored afterward.',
    },
  };
}

function restoreIosSimulatorAccessibility(preparation) {
  for (const preference of preparation.changed) {
    const value = preparation.before[preference];
    if (value === null) runXcrun(['simctl', 'spawn', preparation.udid, 'defaults', 'delete', 'com.apple.Accessibility', preference], { allowFailure: true });
    else writeSimulatorPreference(preparation.udid, preference, value);
  }
  if (preparation.changed.length > 0 && preparation.wasBooted) restartSimulator(preparation.udid, 'Booted');
  const restored = Object.fromEntries(Object.keys(preparation.before).map((preference) => [preference, readSimulatorPreference(preparation.udid, preference)]));
  const ok = Object.entries(preparation.before).every(([preference, value]) => restored[preference] === value);
  if (!ok) throw new Error(`iOS Simulator accessibility restoration failed: ${JSON.stringify({ expected: preparation.before, restored })}`);
  if (preparation.changed.length > 0 && !preparation.wasBooted) runXcrun(['simctl', 'shutdown', preparation.udid]);
  return { restored, booted: preparation.wasBooted, ok };
}

function restartSimulator(udid, state, leaveBooted = true) {
  if (state === 'Booted') runXcrun(['simctl', 'shutdown', udid]);
  if (!leaveBooted) return;
  runXcrun(['simctl', 'boot', udid]);
  runXcrun(['simctl', 'bootstatus', udid, '-b']);
}

function readSimulatorPreference(udid, preference) {
  const result = spawnSync('xcrun', ['simctl', 'spawn', udid, 'defaults', 'read', 'com.apple.Accessibility', preference], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const value = result.stdout.trim();
  if (value === '1') return true;
  if (value === '0') return false;
  throw new Error(`unexpected iOS Simulator preference ${preference}: ${JSON.stringify(value)}`);
}

function writeSimulatorPreference(udid, preference, value) {
  runXcrun(['simctl', 'spawn', udid, 'defaults', 'write', 'com.apple.Accessibility', preference, '-bool', value ? 'YES' : 'NO']);
}

function runXcrun(args, { allowFailure = false } = {}) {
  const result = spawnSync('xcrun', args, { encoding: 'utf8' });
  if (result.status !== 0 && !allowFailure) throw new Error(`xcrun ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}
