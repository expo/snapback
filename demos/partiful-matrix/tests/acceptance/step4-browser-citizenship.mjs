import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const demoRoot = resolve(here, '..', '..');
const defaultOut = resolve(demoRoot, 'acceptance', 'results', 'step4-web-citizenship.json');
const defaultFocusReceipt = resolve(demoRoot, 'acceptance', 'results', 'step4-product-ui-browser.json');
const defaultFindReceipt = resolve(demoRoot, 'acceptance', 'results', 'step4-web-citizenship-desktop-chrome-find.json');

const assertions = {
  'ime-composition': 'Composing text stays local, commits once, and remains visible.',
  'autofill-password-manager': 'Browser or password-manager autofill populates native controls without losing Contract state.',
  'focus-trap-restore': 'The create-event dialog traps focus and restores it to its trigger.',
  'bfcache-restore': 'Back/forward cache restores the route with authored state and interactivity intact.',
  'find-on-page': 'Browser find selects visible event text and leaves the route usable.',
};

const mobileAssertions = Object.keys(assertions);
const desktopAssertions = ['focus-trap-restore', 'find-on-page'];
const environments = [
  { id: 'ios-safari-current', label: 'iOS Safari current', channel: 'current', assertions: mobileAssertions },
  { id: 'ios-safari-current-1', label: 'iOS Safari current-1', channel: 'current-1', assertions: mobileAssertions },
  { id: 'android-chrome-current', label: 'Android Chrome current', channel: 'current', assertions: mobileAssertions },
  { id: 'desktop-safari', label: 'desktop Safari', channel: null, assertions: desktopAssertions },
  { id: 'desktop-chrome', label: 'desktop Chrome', channel: null, assertions: desktopAssertions },
  { id: 'desktop-firefox', label: 'desktop Firefox', channel: null, assertions: desktopAssertions },
];

const fixtures = [
  { id: 'partitime-create-form', route: '/partitime/', assertions: ['ime-composition', 'autofill-password-manager'] },
  { id: 'partitime-create-dialog', route: '/partitime/', assertions: ['focus-trap-restore'] },
  { id: 'partitime-feed-event-bfcache', route: '/partitime/ -> /partitime/events/event_sunset/ -> history.back', assertions: ['bfcache-restore'] },
  { id: 'partitime-visible-event-copy', route: '/partitime/', assertions: ['find-on-page'] },
];

const requiredResults = environments.flatMap((environment) => environment.assertions.map((assertion) => ({
  environment: environment.id,
  assertion,
  acceptedFixtures: fixtures.filter((fixture) => fixture.assertions.includes(assertion)).map(({ id }) => id),
})));

const option = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? null : process.argv[at + 1];
};
const outPath = resolve(option('out') ?? defaultOut);
const focusPath = resolve(option('focus-receipt') ?? defaultFocusReceipt);
const findPath = resolve(option('find-receipt') ?? defaultFindReceipt);
const manualPath = option('manual-evidence') ? resolve(option('manual-evidence')) : null;
const allowRed = process.argv.includes('--allow-red');

if (process.argv.includes('--list-required-results')) {
  console.log(JSON.stringify({ environments, assertions, fixtures, requiredResults }, null, 2));
  process.exit(0);
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const displayPath = (path) => {
  const local = relative(repoRoot, path);
  return local.startsWith('..') ? path : local;
};
const identity = (path) => {
  const bytes = readFileSync(path);
  return { path: displayPath(path), sha256: sha256(bytes), bytes: bytes.length };
};
const command = (program, args) => {
  const result = spawnSync(program, args, { cwd: repoRoot, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
};
const appVersion = (path) => existsSync(path)
  ? command('/usr/bin/mdls', ['-raw', '-name', 'kMDItemVersion', path])
  : null;
const androidChromeVersion = () => {
  const text = command('adb', ['shell', 'dumpsys', 'package', 'com.android.chrome']);
  return text?.match(/versionName=([^\s]+)/)?.[1] ?? null;
};

function requiredFor(environment, assertion) {
  return requiredResults.find((entry) => entry.environment === environment && entry.assertion === assertion);
}

function validatePassingRow(row, source) {
  if (!isRecord(row)) throw new Error(`${source} row must be an object`);
  const required = requiredFor(row.environment, row.assertion);
  if (!required) throw new Error(`${source} contains a non-required row: ${row.environment}/${row.assertion}`);
  if (row.status !== 'pass') throw new Error(`${source} ${row.environment}/${row.assertion} must have status pass`);
  if (!required.acceptedFixtures.includes(row.fixture)) {
    throw new Error(`${source} ${row.environment}/${row.assertion} has unsupported fixture ${row.fixture}`);
  }
  if (!nonempty(row.notes)) throw new Error(`${source} ${row.environment}/${row.assertion} needs notes`);
  if (!Array.isArray(row.evidence) || !row.evidence.some((item) => isRecord(item) && nonempty(item.kind) && nonempty(item.ref))) {
    throw new Error(`${source} ${row.environment}/${row.assertion} needs durable evidence`);
  }
  for (const group of ['browser', 'os']) {
    if (!isRecord(row[group]) || !nonempty(row[group].name) || !nonempty(row[group].version)) {
      throw new Error(`${source} ${row.environment}/${row.assertion} needs ${group} name and version`);
    }
  }
  const environment = environments.find(({ id }) => id === row.environment);
  if (environment.channel !== null && row.channel !== environment.channel) {
    throw new Error(`${source} ${row.environment}/${row.assertion} must record channel ${environment.channel}`);
  }
  return row;
}

function rowsFromManualEvidence(path) {
  if (path === null) return [];
  if (!existsSync(path)) throw new Error(`manual evidence is missing: ${path}`);
  const evidence = readJson(path);
  if (evidence.schemaVersion !== 'partitime.web-citizenship-evidence.v1') {
    throw new Error('manual evidence has the wrong schemaVersion');
  }
  for (const field of ['id', 'operator', 'baseCommit', 'startedAt', 'completedAt']) {
    if (!nonempty(evidence.run?.[field])) throw new Error(`manual evidence run.${field} is required`);
  }
  if (!Array.isArray(evidence.rows)) throw new Error('manual evidence rows must be an array');
  return evidence.rows.map((row) => validatePassingRow(row, displayPath(path)));
}

function validateMachineReceipt(path, label) {
  if (!existsSync(path)) return null;
  const receipt = readJson(path);
  if (receipt.ok !== true || receipt.failed !== 0 || receipt.skipped !== 0 || receipt.cleanupErrorCount !== 0) {
    throw new Error(`${label} is not completely green`);
  }
  for (const entry of receipt.testInventory ?? []) {
    const actual = identity(resolve(repoRoot, entry.path));
    if (actual.sha256 !== entry.sha256) throw new Error(`${label} input drifted: ${entry.path}`);
  }
  return receipt;
}

function rowsFromDesktopChrome(focusReceiptPath, findReceiptPath) {
  const focusReceipt = validateMachineReceipt(focusReceiptPath, 'desktop Chrome focus receipt');
  const findReceipt = validateMachineReceipt(findReceiptPath, 'desktop Chrome find receipt');
  if (focusReceipt === null || findReceipt === null) return [];
  if (findReceipt.claimEligible !== true || findReceipt.repository?.dirty !== false) {
    throw new Error('desktop Chrome find receipt is not claim-eligible clean-checkout evidence');
  }
  for (const [receipt, label] of [[focusReceipt, 'focus'], [findReceipt, 'find']]) {
    if (!Array.isArray(receipt.cells) || !receipt.cells.includes('contract:snapback')) {
      throw new Error(`desktop Chrome ${label} receipt does not identify Contract × Snapback`);
    }
  }
  const installedChromeVersion = command('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--version']);
  if (!nonempty(installedChromeVersion)) throw new Error('installed desktop Chrome version is unavailable');
  if (focusReceipt.environment?.chromeVersion !== installedChromeVersion || findReceipt.environment?.chromeVersion !== installedChromeVersion) {
    throw new Error('desktop Chrome evidence does not match the currently installed browser version');
  }
  const find = (receipt, name) => receipt.results?.find((result) => result.name === name && result.ok === true);
  const focusName = 'contract × snapback provides an accessible portal form and keyboard focus scope';
  const findName = 'contract × snapback exposes visible content to browser find-on-page';
  const focus = find(focusReceipt, focusName);
  const browserFind = find(findReceipt, findName);
  if (!focus || !browserFind) throw new Error('desktop Chrome receipts are missing a required citizenship check');
  const focusEvidence = identity(focusReceiptPath);
  const findEvidence = identity(findReceiptPath);
  return [
    {
      environment: 'desktop-chrome', assertion: 'focus-trap-restore', fixture: 'partitime-create-dialog', status: 'pass',
      notes: 'Fresh Chrome CDP run trapped focus inside the create-event dialog and restored it to the trigger after Escape.',
      evidence: [{ kind: 'machine-receipt', ref: focusEvidence.path, sha256: focusEvidence.sha256, result: focusName }],
      browser: { name: 'Google Chrome', version: focusReceipt.environment.chromeVersion },
      os: { name: 'desktop host', version: focusReceipt.environment.os }, channel: null,
      details: focus.details,
    },
    {
      environment: 'desktop-chrome', assertion: 'find-on-page', fixture: 'partitime-visible-event-copy', status: 'pass',
      notes: 'Fresh Chrome CDP run selected visible canonical event text with browser find and opened the event afterward.',
      evidence: [{ kind: 'machine-receipt', ref: findEvidence.path, sha256: findEvidence.sha256, result: findName }],
      browser: { name: 'Google Chrome', version: findReceipt.environment.chromeVersion },
      os: { name: 'desktop host', version: findReceipt.environment.os }, channel: null,
      details: browserFind.details,
    },
  ].map((row) => validatePassingRow(row, 'desktop Chrome machine receipts'));
}

const candidates = [...rowsFromDesktopChrome(focusPath, findPath), ...rowsFromManualEvidence(manualPath)];
const byKey = new Map();
for (const row of candidates) {
  const key = `${row.environment}:${row.assertion}`;
  if (byKey.has(key)) throw new Error(`duplicate passing evidence row: ${key}`);
  byKey.set(key, row);
}

const rows = requiredResults.map((required) => byKey.get(`${required.environment}:${required.assertion}`) ?? {
  ...required,
  status: 'red',
  reasonCode: 'STEP4_CITIZENSHIP_REQUIRED_EVIDENCE_MISSING',
  notes: 'No admitted versioned browser/device evidence was supplied; missing is red, not skipped or N/A.',
  evidence: [],
});
const passed = rows.filter(({ status }) => status === 'pass').length;
const red = rows.length - passed;
const revision = command('git', ['rev-parse', 'HEAD']);
const dirty = command('git', ['status', '--porcelain=v1']) !== '';
const recordedAt = new Date().toISOString();
const report = {
  schemaVersion: 'partitime.web-citizenship.v1',
  claimId: 'STEP4.WEB_CITIZENSHIP',
  ok: red === 0,
  outcome: red === 0 ? 'pass' : 'red',
  claimEligible: red === 0 && !dirty,
  recordedAt,
  authority: ['Snapback LLP 0063 Step 4', 'Exact LLP 0211 §4.3'],
  repository: { revision, dirty },
  summary: { required: rows.length, passed, red, skipped: 0 },
  passed,
  red,
  skipped: 0,
  environments,
  assertions,
  fixtures,
  rows,
  inventory: {
    host: `${platform()}-${release()}-${arch()}`,
    desktop: {
      safari: appVersion('/Applications/Safari.app'),
      chrome: command('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--version']),
      firefox: command('/Applications/Firefox.app/Contents/MacOS/firefox', ['--version']),
    },
    android: { chrome: androidChromeVersion() },
    ios: { current: null, currentMinusOne: null },
  },
  inputs: [focusPath, findPath, manualPath].filter((path) => path && existsSync(path)).map(identity),
  testInventory: [identity(fileURLToPath(import.meta.url))],
  nonClaims: red === 0 ? [] : [
    'This receipt does not pass the strict browser citizenship gate.',
    'Synthetic composition events, Chromium emulation, and inferred browser compatibility are not admitted as mobile/device evidence.',
  ],
};

writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
if (!report.ok && !allowRed) process.exit(1);
