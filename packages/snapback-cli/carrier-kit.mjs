import { spawn, spawnSync } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

// @ref LLP 0196#program — carrier helpers direct concrete environments around
// the scaffold's registered D2 profile; they do not mint a second proof receipt.
export const TEMPLATE_CARRIER_CONFIG_SCHEMA_VERSION = 'snapback.template-carriers.v1';
export const TEMPLATE_CARRIER_LOG_SCHEMA_VERSION = 'snapback.template-carrier-director.v1';

const CARRIERS = new Set(['headless', 'web-browser', 'native-simulator']);
const PLIST_UPDATE_SOURCE = String.raw`
import json
import plistlib
import sys
from pathlib import Path

path = Path(sys.argv[1])
scheme = sys.argv[2]
bundle_id = sys.argv[3]
path.parent.mkdir(parents=True, exist_ok=True)
if path.exists():
    with path.open('rb') as source:
        preferences = plistlib.load(source)
else:
    preferences = {}
key = f"com.apple.CoreSimulator.CoreSimulatorBridge-->{scheme}"
preferences[key] = bundle_id
temporary = path.with_name(path.name + '.tmp')
with temporary.open('wb') as destination:
    plistlib.dump(preferences, destination, fmt=plistlib.FMT_BINARY)
temporary.replace(path)
with path.open('rb') as source:
    verified = plistlib.load(source)
if verified.get(key) != bundle_id:
    raise SystemExit('literal scheme-approval key did not persist')
print(json.dumps({'literalKey': key, 'bundleId': verified[key]}))
`;

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateCommand(command, label) {
  if (!Array.isArray(command) || command.length === 0
      || command.some((part) => typeof part !== 'string' || part.length === 0)) {
    throw new TypeError(`${label} must be a non-empty string array`);
  }
  return Object.freeze([...command]);
}

function validateRelativePath(value, label) {
  if (typeof value !== 'string' || value.length === 0 || isAbsolute(value)) {
    throw new TypeError(`${label} must be a non-empty relative path`);
  }
  return value;
}

export function defineTemplateCarrierConfig(value) {
  if (!plainObject(value)
      || value.schemaVersion !== TEMPLATE_CARRIER_CONFIG_SCHEMA_VERSION) {
    throw new TypeError(`carrier config must use ${TEMPLATE_CARRIER_CONFIG_SCHEMA_VERSION}`);
  }
  const verifyCommand = validateCommand(value.verifyCommand, 'verifyCommand');
  const verifyReceipt = validateRelativePath(value.verifyReceipt, 'verifyReceipt');
  const artifactsDirectory = validateRelativePath(
    value.artifactsDirectory ?? '.snapback/carriers',
    'artifactsDirectory',
  );
  if (!plainObject(value.carriers) || Object.keys(value.carriers).length === 0) {
    throw new TypeError('carrier config must declare at least one carrier');
  }
  const carriers = {};
  for (const [name, options] of Object.entries(value.carriers)) {
    if (!CARRIERS.has(name) || !plainObject(options)) {
      throw new TypeError(`unsupported carrier config ${name}`);
    }
    if (name === 'headless') {
      carriers[name] = Object.freeze({});
      continue;
    }
    if (name === 'web-browser') {
      let origin;
      try {
        origin = new URL(options.origin);
      } catch {
        throw new TypeError('web-browser origin must be an absolute URL');
      }
      if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(origin.hostname)) {
        throw new TypeError('web-browser origin must be loopback HTTP');
      }
      carriers[name] = Object.freeze({
        command: validateCommand(options.command, 'web-browser command'),
        origin: origin.href,
        startupTimeoutMs: positiveBoundedInteger(
          options.startupTimeoutMs ?? 60_000,
          'web-browser startupTimeoutMs',
          120_000,
        ),
      });
      continue;
    }
    const scheme = options.scheme;
    const bundleId = options.bundleId;
    if (typeof scheme !== 'string' || !/^[A-Za-z][A-Za-z0-9+.-]*$/u.test(scheme)) {
      throw new TypeError('native-simulator scheme is invalid');
    }
    if (typeof bundleId !== 'string' || !/^[A-Za-z0-9.-]+$/u.test(bundleId)) {
      throw new TypeError('native-simulator bundleId is invalid');
    }
    const driveUrl = validateDriveUrl(options.driveUrl, scheme);
    carriers[name] = Object.freeze({
      command: validateCommand(options.command, 'native-simulator command'),
      readyFile: validateRelativePath(
        options.readyFile ?? '.snapback/dev.ready.json',
        'native-simulator readyFile',
      ),
      scheme,
      bundleId,
      driveUrl,
      settleMs: positiveBoundedInteger(options.settleMs ?? 8_000, 'settleMs', 60_000),
      startupTimeoutMs: positiveBoundedInteger(
        options.startupTimeoutMs ?? 60_000,
        'native-simulator startupTimeoutMs',
        120_000,
      ),
      expoGo: options.expoGo !== false,
    });
  }
  return Object.freeze({
    schemaVersion: TEMPLATE_CARRIER_CONFIG_SCHEMA_VERSION,
    verifyCommand,
    verifyReceipt,
    artifactsDirectory,
    carriers: Object.freeze(carriers),
  });
}

function positiveBoundedInteger(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${label} must be an integer from 1 through ${maximum}`);
  }
  return value;
}

function validateDriveUrl(value, expectedScheme) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('native-simulator driveUrl must be an absolute URL');
  }
  if (url.protocol !== `${expectedScheme}:`) {
    throw new TypeError(`native-simulator driveUrl must use ${expectedScheme}:`);
  }
  if (url.username || url.password) {
    throw new TypeError('native-simulator driveUrl may not carry URL credentials');
  }
  for (const key of url.searchParams.keys()) {
    if (/(?:auth|bearer|credential|key|password|secret|token)/iu.test(key)) {
      throw new TypeError(`native-simulator driveUrl may not carry secret-like query key ${key}`);
    }
  }
  return url.href;
}

function parseArguments(argv) {
  const args = [...argv];
  const parsed = {
    carrier: null,
    artifacts: null,
    browser: null,
    udid: null,
    appPath: null,
    driveUrl: null,
    settleMs: null,
    keepSimulator: false,
    selfCheck: false,
    json: false,
  };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--self-check' || argument === '--keep-simulator' || argument === '--json') {
      if (seen.has(argument)) throw new TypeError(`duplicate ${argument}`);
      seen.add(argument);
      if (argument === '--self-check') parsed.selfCheck = true;
      else if (argument === '--keep-simulator') parsed.keepSimulator = true;
      else parsed.json = true;
      continue;
    }
    if (['--artifacts', '--browser', '--udid', '--app-path', '--drive-url', '--settle-ms'].includes(argument)) {
      if (seen.has(argument)) throw new TypeError(`duplicate ${argument}`);
      seen.add(argument);
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new TypeError(`${argument} requires a value`);
      if (argument === '--artifacts') parsed.artifacts = value;
      else if (argument === '--browser') parsed.browser = value;
      else if (argument === '--udid') parsed.udid = value;
      else if (argument === '--app-path') parsed.appPath = value;
      else if (argument === '--drive-url') parsed.driveUrl = value;
      else parsed.settleMs = Number(value);
      continue;
    }
    if (argument.startsWith('-') || parsed.carrier !== null) {
      throw new TypeError(`unrecognized carrier argument ${argument}`);
    }
    parsed.carrier = argument;
  }
  if (!parsed.selfCheck && !CARRIERS.has(parsed.carrier)) {
    throw new TypeError('carrier must be headless, web-browser, or native-simulator');
  }
  return parsed;
}

function run(command, { cwd, env = process.env, capture = false, timeout = 180_000 } = {}) {
  const [executable, ...args] = command;
  const result = spawnSync(executable, args, {
    cwd,
    env,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = capture ? (result.stderr || result.stdout || result.error?.message) : result.error?.message;
    throw new Error(`${command.join(' ')} failed${detail ? `: ${String(detail).trim()}` : ''}`);
  }
  return capture ? result.stdout : '';
}

function expandedCommand(command, replacements) {
  return command.map((part) => part.replace(/\{([a-z]+)\}/gu, (match, key) => {
    if (!Object.hasOwn(replacements, key)) throw new TypeError(`unknown command placeholder ${match}`);
    return replacements[key];
  }));
}

function writeDirectorLog(artifacts, record) {
  mkdirSync(artifacts, { recursive: true });
  const path = join(artifacts, 'director-log.json');
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  return path;
}

function verifyScaffold(config, root) {
  const receiptPath = resolve(root, config.verifyReceipt);
  run(config.verifyCommand, {
    cwd: root,
    env: { ...process.env, CI: '1' },
    timeout: 240_000,
  });
  if (!existsSync(receiptPath) || !lstatSync(receiptPath).isFile()) {
    throw new Error(`registered verify command did not write ${receiptPath}`);
  }
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  if (receipt?.schemaVersion !== 'snapback.verify-receipt.v1' || receipt.ok !== true) {
    throw new Error('registered verify command did not produce a passing LLP 0146 D2 receipt');
  }
  return receiptPath;
}

function startOwned(command, { cwd, env, logPath }) {
  const log = createWriteStream(logPath, { flags: 'a', mode: 0o600 });
  const [executable, ...args] = command;
  const child = spawn(executable, args, {
    cwd,
    env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.once('close', () => log.end());
  return child;
}

async function stopOwned(child) {
  if (child.exitCode !== null) return;
  if (process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  } else child.kill('SIGTERM');
  const closed = new Promise((resolveClose) => child.once('close', resolveClose));
  const graceful = await Promise.race([
    closed.then(() => true),
    new Promise((resolveWait) => setTimeout(() => resolveWait(false), 10_000)),
  ]);
  if (!graceful && child.exitCode === null) {
    if (process.platform !== 'win32') {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    } else child.kill('SIGKILL');
    await closed;
  }
}

async function waitForHttp(origin, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`web carrier exited ${child.exitCode} before readiness`);
    try {
      const response = await fetch(origin, { redirect: 'manual', signal: AbortSignal.timeout(2_000) });
      if (response.status < 500) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`web carrier did not reach ${origin}: ${lastError?.message ?? 'timeout'}`);
}

function findBrowser(explicit) {
  const candidates = [
    explicit,
    process.env.SNAPBACK_BROWSER_EXECUTABLE,
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate) && lstatSync(candidate).isFile()) return candidate;
  }
  for (const name of ['google-chrome', 'chromium', 'chromium-browser']) {
    const found = spawnSync('sh', ['-lc', `command -v ${name}`], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  throw new Error('web-browser kit requires --browser or SNAPBACK_BROWSER_EXECUTABLE');
}

async function runWebCarrier({ config, options, root, artifacts, verifyReceipt }) {
  const carrier = config.carriers['web-browser'];
  const logPath = join(artifacts, 'web-dev.log');
  const command = expandedCommand(carrier.command, { artifacts });
  const child = startOwned(command, {
    cwd: root,
    env: { ...process.env, CI: '1' },
    logPath,
  });
  try {
    await waitForHttp(carrier.origin, carrier.startupTimeoutMs, child);
    const browser = findBrowser(options.browser);
    const browserProfile = mkdtempSync(join(tmpdir(), 'snapback-carrier-browser-'));
    const screenshot = join(artifacts, 'web-browser.png');
    const html = join(artifacts, 'web-browser.html');
    try {
      const stdout = run([
        browser,
        '--headless=new',
        '--disable-gpu',
        '--no-default-browser-check',
        '--no-first-run',
        `--user-data-dir=${browserProfile}`,
        '--window-size=1280,900',
        `--screenshot=${screenshot}`,
        '--dump-dom',
        carrier.origin,
      ], { cwd: root, capture: true, timeout: 60_000 });
      writeFileSync(html, stdout);
    } finally {
      rmSync(browserProfile, { recursive: true, force: true });
    }
    if (!existsSync(screenshot) || statSync(screenshot).size === 0) {
      throw new Error('headless browser did not write a screenshot');
    }
    return writeDirectorLog(artifacts, {
      schemaVersion: TEMPLATE_CARRIER_LOG_SCHEMA_VERSION,
      status: 'completed',
      carrier: 'web-browser',
      proofAuthority: { kind: 'llp-0146-d2', receipt: verifyReceipt },
      observations: { origin: carrier.origin, screenshot, html, processLog: logPath },
      nonClaim: 'carrier director output is not an acceptance receipt or product-completeness claim',
    });
  } finally {
    await stopOwned(child);
  }
}

function simctl(args, options = {}) {
  return run(['xcrun', 'simctl', ...args], { capture: true, timeout: 60_000, ...options });
}

function chooseSimulator(explicitUdid) {
  const inventory = JSON.parse(simctl(['list', 'devices', 'available', '-j']));
  const devices = Object.entries(inventory.devices ?? {}).flatMap(([runtime, entries]) => (
    entries.map((device) => ({ ...device, runtime }))
  ));
  if (explicitUdid) {
    const selected = devices.find((device) => device.udid === explicitUdid
      && device.isAvailable !== false);
    if (!selected) throw new Error(`--udid is not an available simulator: ${explicitUdid}`);
    return selected;
  }
  const candidates = devices
    .filter((device) => device.state === 'Shutdown' && /iPhone/u.test(device.name))
    .sort((left, right) => right.runtime.localeCompare(left.runtime, undefined, { numeric: true }));
  if (!candidates[0]?.udid) {
    throw new Error('no available shut-down iPhone simulator; pass --udid');
  }
  return candidates[0];
}

export function updateSimulatorSchemeApproval({ plistPath, scheme, bundleId }) {
  const output = run(
    ['python3', '-c', PLIST_UPDATE_SOURCE, plistPath, scheme, bundleId],
    { capture: true, timeout: 20_000 },
  );
  return JSON.parse(output);
}

function simulatorApprovalPlist(udid) {
  return join(
    homedir(),
    'Library',
    'Developer',
    'CoreSimulator',
    'Devices',
    udid,
    'data',
    'Library',
    'Preferences',
    'com.apple.launchservices.schemeapproval.plist',
  );
}

async function waitForFile(path, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    if (child.exitCode !== null) throw new Error(`native dev carrier exited ${child.exitCode} before readiness`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`native dev carrier did not write ${path}`);
}

function screenshot(udid, path) {
  simctl(['io', udid, 'screenshot', path]);
  if (!existsSync(path) || statSync(path).size === 0) {
    throw new Error(`simulator did not write ${path}`);
  }
}

async function runNativeCarrier({ config, options, root, artifacts, verifyReceipt }) {
  if (process.platform !== 'darwin') throw new Error('native-simulator kit requires macOS');
  const carrier = config.carriers['native-simulator'];
  const simulator = chooseSimulator(options.udid);
  const { udid } = simulator;
  const settleMs = options.settleMs === null
    ? carrier.settleMs
    : positiveBoundedInteger(options.settleMs, '--settle-ms', 60_000);
  const driveUrl = options.driveUrl === null
    ? carrier.driveUrl
    : validateDriveUrl(options.driveUrl, carrier.scheme);
  const approvalPlist = simulatorApprovalPlist(udid);
  const priorApproval = existsSync(approvalPlist) ? readFileSync(approvalPlist) : null;
  const appPath = options.appPath === null ? null : resolve(root, options.appPath);
  if (appPath !== null && (!existsSync(appPath) || !lstatSync(appPath).isDirectory())) {
    throw new Error(`--app-path must name an .app directory: ${appPath}`);
  }
  let installedByKit = false;
  let approvalChanged = false;
  let dev = null;
  const logPath = join(artifacts, 'native-dev.log');
  const onlineScreenshot = join(artifacts, 'native-online.png');
  const offlineScreenshot = join(artifacts, 'native-offline-relaunch.png');
  try {
    try { simctl(['shutdown', udid]); } catch {}
    const approval = updateSimulatorSchemeApproval({
      plistPath: approvalPlist,
      scheme: carrier.scheme,
      bundleId: carrier.bundleId,
    });
    approvalChanged = true;
    simctl(['boot', udid]);
    simctl(['bootstatus', udid, '-b']);
    if (appPath !== null) {
      simctl(['install', udid, appPath]);
      installedByKit = true;
    }
    try {
      simctl(['get_app_container', udid, carrier.bundleId, 'app']);
    } catch {
      throw new Error(`${carrier.bundleId} is not installed; pass --app-path for the carrier app`);
    }
    if (carrier.expoGo) {
      // Diary 0069 residue 4: dismiss Expo Go's first-run sheet before launch.
      simctl([
        'spawn', udid, 'defaults', 'write', 'host.exp.Exponent',
        'EXDevMenuIsOnboardingFinished', '-bool', 'YES',
      ]);
    }
    const command = expandedCommand(carrier.command, { artifacts, udid });
    const readyFile = resolve(root, carrier.readyFile);
    rmSync(readyFile, { force: true });
    dev = startOwned(command, {
      cwd: root,
      env: { ...process.env, CI: '1' },
      logPath,
    });
    await waitForFile(readyFile, carrier.startupTimeoutMs, dev);
    const ready = JSON.parse(readFileSync(readyFile, 'utf8'));
    if (ready?.ready !== true) throw new Error('native dev ready descriptor is not ready');
    await new Promise((resolveWait) => setTimeout(resolveWait, settleMs));
    // The URL is a tap-less director channel. The app must still route it to
    // ordinary product actions and the retained screenshot/receipt is the witness.
    simctl(['openurl', udid, driveUrl]);
    await new Promise((resolveWait) => setTimeout(resolveWait, settleMs));
    screenshot(udid, onlineScreenshot);
    await stopOwned(dev);
    dev = null;
    simctl(['terminate', udid, carrier.bundleId]);
    simctl(['launch', udid, carrier.bundleId]);
    await new Promise((resolveWait) => setTimeout(resolveWait, settleMs));
    screenshot(udid, offlineScreenshot);
    return writeDirectorLog(artifacts, {
      schemaVersion: TEMPLATE_CARRIER_LOG_SCHEMA_VERSION,
      status: 'completed',
      carrier: 'native-simulator',
      proofAuthority: { kind: 'llp-0146-d2', receipt: verifyReceipt },
      observations: {
        udid,
        runtime: simulator.runtime,
        schemeApproval: { plist: approvalPlist, ...approval },
        schemeApprovalRestoredOnCleanup: !options.keepSimulator,
        expoGoOnboardingDismissed: carrier.expoGo,
        driveUrl: redactedDriveUrl(driveUrl),
        onlineScreenshot,
        backendStoppedBeforeOfflineRelaunch: true,
        offlineScreenshot,
        processLog: logPath,
      },
      nonClaim: 'carrier director output is not an LLP 0064 tuple receipt or product-completeness claim',
    });
  } finally {
    if (dev) await stopOwned(dev);
    try { simctl(['terminate', udid, carrier.bundleId]); } catch {}
    if (installedByKit) {
      try { simctl(['uninstall', udid, carrier.bundleId]); } catch {}
    }
    if (!options.keepSimulator) {
      try { simctl(['shutdown', udid]); } catch {}
      if (approvalChanged) {
        if (priorApproval === null) rmSync(approvalPlist, { force: true });
        else writeFileSync(approvalPlist, priorApproval);
      }
    }
  }
}

function redactedDriveUrl(value) {
  const url = new URL(value);
  return `${url.protocol}//${url.host}${url.pathname}`;
}

export async function selfCheckTemplateCarrierConfig(config) {
  const normalized = defineTemplateCarrierConfig(config);
  let plistlib = null;
  if (normalized.carriers['native-simulator']) {
    const temporary = mkdtempSync(join(tmpdir(), 'snapback-carrier-plist-self-check-'));
    try {
      const path = join(temporary, 'schemeapproval.plist');
      const native = normalized.carriers['native-simulator'];
      plistlib = updateSimulatorSchemeApproval({
        plistPath: path,
        scheme: native.scheme,
        bundleId: native.bundleId,
      });
      if (plistlib.literalKey.split('.').length < 3) {
        throw new Error('plistlib self-check did not retain a dotted literal key');
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
  return Object.freeze({
    schemaVersion: 'snapback.template-carrier-self-check.v1',
    ok: true,
    carriers: Object.keys(normalized.carriers).sort(),
    plistlib,
  });
}

export async function runTemplateCarrierCli(configValue, argv, options = {}) {
  const config = defineTemplateCarrierConfig(configValue);
  const parsed = parseArguments(argv);
  if (parsed.selfCheck) {
    const result = await selfCheckTemplateCarrierConfig(config);
    console.log(JSON.stringify(result, null, parsed.json ? 2 : 0));
    return 0;
  }
  const carrier = config.carriers[parsed.carrier];
  if (!carrier) throw new Error(`template does not support carrier ${parsed.carrier}`);
  const root = resolve(options.root ?? process.cwd());
  const artifacts = resolve(root, parsed.artifacts ?? join(config.artifactsDirectory, parsed.carrier));
  mkdirSync(artifacts, { recursive: true });
  const verifyReceipt = verifyScaffold(config, root);
  let directorLog;
  if (parsed.carrier === 'headless') {
    directorLog = writeDirectorLog(artifacts, {
      schemaVersion: TEMPLATE_CARRIER_LOG_SCHEMA_VERSION,
      status: 'completed',
      carrier: 'headless',
      proofAuthority: { kind: 'llp-0146-d2', receipt: verifyReceipt },
      observations: { receipt: verifyReceipt },
      nonClaim: 'the D2 receipt is authoritative; this director log adds no proof format',
    });
  } else if (parsed.carrier === 'web-browser') {
    directorLog = await runWebCarrier({
      config,
      options: parsed,
      root,
      artifacts,
      verifyReceipt,
    });
  } else {
    directorLog = await runNativeCarrier({
      config,
      options: parsed,
      root,
      artifacts,
      verifyReceipt,
    });
  }
  const result = {
    schemaVersion: 'snapback.template-carrier-command.v1',
    ok: true,
    carrier: parsed.carrier,
    verifyReceipt,
    directorLog,
  };
  console.log(JSON.stringify(result, null, parsed.json ? 2 : 0));
  return 0;
}
