import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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

import {
  CLEANUP_LEASE_DIRECTORY_ENV,
  activateCleanupPath,
  cleanupLeasedPath,
  closeCarrierCleanupLease,
  createCarrierCleanupLease,
  releaseCleanupResource,
  reserveCleanupPath,
  spawnLeasedProcess,
  stopProcessGroup,
} from './process-teardown.mjs';

// @ref LLP 0196#program — carrier helpers direct concrete environments around
// the scaffold's registered D2 profile; they do not mint a second proof receipt.
export const TEMPLATE_CARRIER_CONFIG_SCHEMA_VERSION = 'snapback.template-carriers.v1';
export const TEMPLATE_CARRIER_LOG_SCHEMA_VERSION = 'snapback.template-carrier-director.v1';

const CARRIERS = new Set(['headless', 'web-browser', 'native-simulator']);
const OWNED_PROCESS_STATE = new WeakMap();
const SUPERVISOR_PARENT_PID_ENV = 'SNAPBACK_EXPO_SUPERVISOR_PARENT_PID';
const SUPERVISOR_PARENT_START_TIME_ENV = 'SNAPBACK_EXPO_SUPERVISOR_PARENT_START_TIME';
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

function validateArtifactPathTemplate(value, label) {
  if (typeof value !== 'string' || !value.startsWith('{artifacts}/')) {
    throw new TypeError(`${label} must be a path below {artifacts}`);
  }
  const segments = value.slice('{artifacts}/'.length).split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new TypeError(`${label} must stay below {artifacts}`);
  }
  return value;
}

function loopbackHttpOrigin(value, label) {
  let origin;
  try {
    origin = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an absolute URL`);
  }
  const hostname = origin.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  if (origin.protocol !== 'http:'
      || !['127.0.0.1', 'localhost', '::1'].includes(hostname)
      || origin.username
      || origin.password
      || origin.pathname !== '/'
      || origin.search
      || origin.hash) {
    throw new TypeError(`${label} must be a credential-free loopback HTTP origin`);
  }
  return origin;
}

function validateBrowserExpression(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 64 * 1024) {
    throw new TypeError(`${label} must be a non-empty JavaScript expression of at most 65536 characters`);
  }
  return value;
}

function validateDomText(value, label) {
  if (!Array.isArray(value)
      || value.length === 0
      || value.length > 16
      || value.some((marker) => typeof marker !== 'string' || marker.length === 0 || marker.length > 256)) {
    throw new TypeError(`${label} must contain 1 through 16 bounded strings`);
  }
  return Object.freeze([...value]);
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
      const hasStaticOrigin = options.origin !== undefined;
      const hasStructuredReadiness = options.structuredReadiness !== undefined;
      if (hasStaticOrigin === hasStructuredReadiness) {
        throw new TypeError('web-browser must declare exactly one of origin or structuredReadiness');
      }
      const origin = hasStaticOrigin
        ? loopbackHttpOrigin(options.origin, 'web-browser origin').href
        : null;
      let structuredReadiness = null;
      if (hasStructuredReadiness) {
        if (!plainObject(options.structuredReadiness)
            || options.structuredReadiness.kind !== 'expo-supervisor') {
          throw new TypeError('web-browser structuredReadiness kind must be expo-supervisor');
        }
        structuredReadiness = Object.freeze({
          kind: 'expo-supervisor',
          file: validateArtifactPathTemplate(
            options.structuredReadiness.file,
            'web-browser structuredReadiness file',
          ),
        });
      }
      let browserJourney = null;
      if (options.browserJourney !== undefined) {
        if (!plainObject(options.browserJourney)) {
          throw new TypeError('web-browser browserJourney must be an object');
        }
        browserJourney = Object.freeze({
          readyExpression: validateBrowserExpression(
            options.browserJourney.readyExpression,
            'web-browser browserJourney readyExpression',
          ),
          runExpression: validateBrowserExpression(
            options.browserJourney.runExpression,
            'web-browser browserJourney runExpression',
          ),
          requiredDomText: validateDomText(
            options.browserJourney.requiredDomText,
            'web-browser browserJourney requiredDomText',
          ),
          forbiddenDomText: validateDomText(
            options.browserJourney.forbiddenDomText,
            'web-browser browserJourney forbiddenDomText',
          ),
        });
      }
      carriers[name] = Object.freeze({
        command: validateCommand(options.command, 'web-browser command'),
        ...(origin === null ? { structuredReadiness } : { origin }),
        ...(browserJourney === null ? {} : { browserJourney }),
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

function expandedValue(value, replacements) {
  return expandedCommand([value], replacements)[0];
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

function startOwned(command, {
  cwd,
  env,
  logPath = null,
  stdio = ['ignore', 'pipe', 'pipe'],
  cleanupLease = null,
  label = 'carrier child',
  profileDirectory = null,
  finalizationReady = null,
} = {}) {
  const log = logPath === null ? null : createWriteStream(logPath, { flags: 'a', mode: 0o600 });
  const child = spawnLeasedProcess(command, {
    cleanupLease,
    label,
    profileDirectory,
    finalizationReady,
    cwd,
    env,
    stdio,
  });
  if (log !== null) {
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    child.once('close', () => log.end());
  }
  OWNED_PROCESS_STATE.set(child, Object.freeze({
    pid: child.pid,
    processGroup: process.platform !== 'win32',
    exited: new Promise((resolveExit) => child.once('exit', resolveExit)),
  }));
  return child;
}

function signalOwned(child, signal) {
  if (child.pid === undefined) return;
  if (process.platform !== 'win32') {
    try { process.kill(-child.pid, signal); } catch { child.kill(signal); }
  } else child.kill(signal);
}

async function stopOwned(child) {
  const state = OWNED_PROCESS_STATE.get(child) ?? Object.freeze({
    pid: child.pid,
    processGroup: process.platform !== 'win32',
    exited: new Promise((resolveExit) => child.once('exit', resolveExit)),
  });
  const releasePipes = () => {
    for (const stream of child.stdio ?? []) stream?.destroy?.();
  };
  await stopProcessGroup(child, {
    processGroup: state.processGroup,
    graceMs: 10_000,
    killWaitMs: 2_000,
  });
  await state.exited;
  // ChildProcess `close` also waits for every inherited stdio descriptor.
  // A detached grandchild outside the recorded group must not hold carrier
  // cleanup open after the owned group and its leader are both gone.
  releasePipes();
}

function createSignalInterruption() {
  let interrupted = null;
  let resolveInterruption;
  const interruption = new Promise((resolveInterrupt) => {
    resolveInterruption = resolveInterrupt;
  });
  const handlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const handler = () => {
      if (interrupted !== null) return;
      const error = new Error(`web carrier interrupted by ${signal}`);
      error.carrierStatus = 'interrupted';
      error.signal = signal;
      interrupted = error;
      resolveInterruption(error);
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  return Object.freeze({
    race(operation) {
      if (interrupted !== null) return Promise.reject(interrupted);
      return Promise.race([
        operation,
        interruption.then((error) => Promise.reject(error)),
      ]);
    },
    close() {
      for (const [signal, handler] of handlers) process.off(signal, handler);
    },
  });
}

async function waitForHttp(origin, timeoutMs, child, fetchImpl = fetch) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`web carrier exited ${child.exitCode ?? child.signalCode} before readiness`);
    }
    try {
      const response = await fetchImpl(origin, { redirect: 'manual', signal: AbortSignal.timeout(2_000) });
      if (response.status < 500) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`web carrier did not reach ${origin}: ${lastError?.message ?? 'timeout'}`);
}

function processInventory() {
  const result = spawnSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,lstart='], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error('web carrier could not enumerate supervised process identities');
  }
  return result.stdout.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/u.exec(line);
    if (match === null) return [];
    return [{
      pid: Number(match[1]),
      ppid: Number(match[2]),
      processGroup: Number(match[3]),
      startTime: match[4],
    }];
  });
}

function processDescendants(rootPid, inventory) {
  const found = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const { pid, ppid } of inventory) {
      if (found.has(ppid) && !found.has(pid)) {
        found.add(pid);
        changed = true;
      }
    }
  }
  return found;
}

function lsofBinary() {
  for (const path of ['/usr/sbin/lsof', '/usr/bin/lsof']) {
    if (existsSync(path)) return path;
  }
  return null;
}

function lsofListenerAddress(name) {
  const trimmed = name.replace(/\s+\(LISTEN\)$/u, '');
  if (trimmed.startsWith('[')) {
    const closing = trimmed.lastIndexOf(']:');
    if (closing === -1) return null;
    return { host: trimmed.slice(1, closing), port: Number(trimmed.slice(closing + 2)) };
  }
  const colon = trimmed.lastIndexOf(':');
  if (colon === -1) return null;
  return { host: trimmed.slice(0, colon), port: Number(trimmed.slice(colon + 1)) };
}

function liveTcpListeners(port) {
  const binary = lsofBinary();
  if (binary === null) throw new Error('lsof is required to revalidate the supervised Metro listener');
  const result = spawnSync(binary, [
    '-nP', '-a', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpcn',
  ], { encoding: 'utf8', timeout: 10_000 });
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error('web carrier could not re-enumerate the supervised Metro listener');
  }
  const listeners = [];
  let pid = null;
  let command = null;
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('c')) command = line.slice(1);
    else if (line.startsWith('n') && Number.isSafeInteger(pid)) {
      const address = lsofListenerAddress(line.slice(1));
      if (address !== null) listeners.push({ pid, command, ...address });
    }
  }
  return listeners;
}

// @ref LLP 0181#web-browser — an Expo browser may navigate only after the
// exact spawned supervisor atomically publishes its verified Metro listener.
function readExpoSupervisorWebReadiness(path, child) {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw new Error('Expo supervisor readiness must be an owner-only regular file');
  }
  const descriptor = JSON.parse(readFileSync(path, 'utf8'));
  if (descriptor?.schemaVersion !== 'snapback.expo-supervisor.v1'
      || descriptor.formatVersion !== 1
      || descriptor.state !== 'ready'
      || descriptor.platform !== 'web'
      || descriptor.connectCarrier !== 'supervisor-rendezvous'
      || descriptor.pid !== child.pid
      || descriptor.supervisor?.pid !== descriptor.pid
      || typeof descriptor.supervisor?.startTime !== 'string'
      || descriptor.supervisor.startTime.length === 0
      || typeof descriptor.correlationId !== 'string'
      || descriptor.correlationId.length === 0
      || typeof descriptor.supervisorGeneration !== 'string'
      || descriptor.supervisorGeneration.length === 0
      || !Number.isSafeInteger(descriptor.metro?.pid)
      || descriptor.metro.pid < 1
      || typeof descriptor.metro.startTime !== 'string'
      || descriptor.metro.startTime.length === 0
      || typeof descriptor.metro.upstreamOrigin !== 'string'
      || typeof descriptor.attestation?.path !== 'string'
      || !/^\/[A-Za-z0-9._/-]+$/u.test(descriptor.attestation.path)
      || descriptor.attestation.path.includes('..')
      || typeof descriptor.attestation?.nonce !== 'string'
      || descriptor.attestation.nonce.length < 32
      || !Array.isArray(descriptor.listeners)
      || descriptor.listeners.length === 0) {
    throw new Error('Expo supervisor readiness does not belong to the exact web carrier child');
  }
  const origin = loopbackHttpOrigin(
    descriptor.metro.origin,
    'Expo supervisor Metro origin',
  );
  const metroHost = origin.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  const metroPort = Number(origin.port || 80);
  const upstream = loopbackHttpOrigin(
    descriptor.metro.upstreamOrigin,
    'Expo supervisor Metro upstream origin',
  );
  const upstreamHost = upstream.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  const upstreamPort = Number(upstream.port || 80);
  const listener = descriptor.listeners.find((candidate) => (
    candidate?.owner === 'metro-front'
      && candidate.loopback === true
      && typeof candidate.host === 'string'
      && candidate.host.toLowerCase().replace(/^\[|\]$/gu, '') === metroHost
      && candidate.port === metroPort
      && Number.isSafeInteger(candidate.pid)
      && candidate.pid > 0
      && typeof candidate.startTime === 'string'
      && candidate.startTime.length > 0
  ));
  const metroListener = descriptor.listeners.find((candidate) => (
    candidate?.owner === 'metro'
      && candidate.loopback === true
      && typeof candidate.host === 'string'
      && candidate.host.toLowerCase().replace(/^\[|\]$/gu, '') === upstreamHost
      && candidate.port === upstreamPort
      && Number.isSafeInteger(candidate.pid)
      && candidate.pid > 0
      && typeof candidate.startTime === 'string'
      && candidate.startTime.length > 0
  ));
  if (!listener || !metroListener
      || descriptor.listeners.some((candidate) => candidate?.loopback !== true)) {
    throw new Error('Expo supervisor readiness lacks its verified loopback Metro front or upstream listener');
  }
  return Object.freeze({
    origin: origin.origin,
    correlationId: descriptor.correlationId,
    supervisorGeneration: descriptor.supervisorGeneration,
    supervisorPid: descriptor.pid,
    supervisorStartTime: descriptor.supervisor.startTime,
    metroPid: descriptor.metro.pid,
    metroStartTime: descriptor.metro.startTime,
    metroUpstreamOrigin: upstream.origin,
    attestation: Object.freeze({
      path: descriptor.attestation.path,
      nonce: descriptor.attestation.nonce,
    }),
    listener: Object.freeze({
      pid: listener.pid,
      startTime: listener.startTime,
      host: listener.host,
      port: listener.port,
    }),
    metroListener: Object.freeze({
      pid: metroListener.pid,
      startTime: metroListener.startTime,
      host: metroListener.host,
      port: metroListener.port,
    }),
  });
}

function assertExpoSupervisorWebOwnership(readiness, child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    throw new Error('Expo supervisor exited before browser launch');
  }
  try {
    process.kill(child.pid, 0);
  } catch {
    throw new Error('Expo supervisor is not live before browser launch');
  }
  const inventory = processInventory();
  const supervisor = inventory.find(({ pid }) => pid === readiness.supervisorPid);
  if (supervisor?.startTime !== readiness.supervisorStartTime || supervisor.ppid !== process.pid) {
    throw new Error('Expo supervisor process identity changed before browser launch');
  }
  const supervisorTree = processDescendants(readiness.supervisorPid, inventory);
  const metro = inventory.find(({ pid }) => pid === readiness.metroPid);
  if (metro?.startTime !== readiness.metroStartTime || !supervisorTree.has(readiness.metroPid)) {
    throw new Error('Expo Metro process identity changed before browser launch');
  }
  const metroTree = processDescendants(readiness.metroPid, inventory);
  const frontListenerProcess = inventory.find(({ pid }) => pid === readiness.listener.pid);
  if (frontListenerProcess?.startTime !== readiness.listener.startTime
      || !supervisorTree.has(readiness.listener.pid)) {
    throw new Error('Expo Metro front listener ownership changed before browser launch');
  }
  const metroListenerProcess = inventory.find(({ pid }) => pid === readiness.metroListener.pid);
  if (metroListenerProcess?.startTime !== readiness.metroListener.startTime
      || !metroTree.has(readiness.metroListener.pid)) {
    throw new Error('Expo Metro upstream listener ownership changed before browser launch');
  }
  for (const [label, expected] of [
    ['front', readiness.listener],
    ['upstream', readiness.metroListener],
  ]) {
    const listeners = liveTcpListeners(expected.port);
    if (listeners.length === 0 || listeners.some(({ pid }) => pid !== expected.pid)) {
      throw new Error(`Expo Metro ${label} listener was replaced before browser launch`);
    }
  }
}

function assertExpoSupervisorReadinessUnchanged(readiness, confirmed, context) {
  if (confirmed.origin !== readiness.origin
      || confirmed.correlationId !== readiness.correlationId
      || confirmed.supervisorGeneration !== readiness.supervisorGeneration
      || confirmed.supervisorPid !== readiness.supervisorPid
      || confirmed.supervisorStartTime !== readiness.supervisorStartTime
      || confirmed.metroPid !== readiness.metroPid
      || confirmed.metroStartTime !== readiness.metroStartTime
      || confirmed.metroUpstreamOrigin !== readiness.metroUpstreamOrigin
      || confirmed.listener.pid !== readiness.listener.pid
      || confirmed.listener.startTime !== readiness.listener.startTime
      || confirmed.listener.host !== readiness.listener.host
      || confirmed.listener.port !== readiness.listener.port
      || confirmed.metroListener.pid !== readiness.metroListener.pid
      || confirmed.metroListener.startTime !== readiness.metroListener.startTime
      || confirmed.metroListener.host !== readiness.metroListener.host
      || confirmed.metroListener.port !== readiness.metroListener.port
      || confirmed.attestation.path !== readiness.attestation.path
      || confirmed.attestation.nonce !== readiness.attestation.nonce) {
    throw new Error(`Expo supervisor readiness changed ${context}`);
  }
}

// @ref LLP 0181#diagnostics — startup failures retain both the canonical
// child-lifecycle fact and the missing structured-readiness capability.
async function waitForExpoSupervisorWebReadiness(path, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Expo web carrier exited ${child.exitCode ?? child.signalCode} before readiness; did not write structured readiness ${path}`,
      );
    }
    if (existsSync(path)) return readExpoSupervisorWebReadiness(path, child);
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Expo web carrier did not write structured readiness ${path}`);
}

function startCaptured(command, {
  cwd,
  env,
  cleanupLease = null,
  profileDirectory = null,
  maximumBytes = 8 * 1024 * 1024,
} = {}) {
  const child = startOwned(command, {
    cwd,
    env,
    cleanupLease,
    label: 'carrier browser capture',
    profileDirectory,
  });
  const stdout = [];
  const stderr = [];
  let capturedBytes = 0;
  let captureError = null;
  const append = (chunks, chunk) => {
    if (captureError !== null) return;
    capturedBytes += chunk.length;
    if (capturedBytes > maximumBytes) {
      captureError = new Error(`browser output exceeded ${maximumBytes} bytes`);
      signalOwned(child, 'SIGTERM');
      return;
    }
    chunks.push(chunk);
  };
  child.stdout.on('data', (chunk) => append(stdout, chunk));
  child.stderr.on('data', (chunk) => append(stderr, chunk));
  const completion = new Promise((resolveCompletion, rejectCompletion) => {
    child.once('error', rejectCompletion);
    child.once('close', (code, signal) => {
      if (captureError !== null) rejectCompletion(captureError);
      else if (code !== 0) {
        rejectCompletion(new Error(
          `${command.join(' ')} failed (${code ?? signal}): ${Buffer.concat(stderr).toString('utf8').trim()}`,
        ));
      } else resolveCompletion(Buffer.concat(stdout).toString('utf8'));
    });
  });
  return Object.freeze({ child, completion });
}

async function waitForCaptured(capture, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      capture.completion,
      new Promise((_, rejectTimeout) => {
        timer = setTimeout(
          () => rejectTimeout(new Error(`browser capture timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function startCdpBrowser(command, {
  cwd,
  env,
  logPath,
  cleanupLease = null,
  profileDirectory = null,
  finalizationReady = null,
}) {
  const child = startOwned(command, {
    cwd,
    env,
    logPath,
    cleanupLease,
    label: 'carrier browser',
    profileDirectory,
    finalizationReady,
    stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'],
  });
  const input = child.stdio[3];
  const output = child.stdio[4];
  if (!input || !output) throw new Error('browser did not expose its DevTools pipe');
  let nextId = 1;
  let buffer = Buffer.alloc(0);
  let closed = false;
  const pending = new Map();
  const rejectPending = (error) => {
    for (const [id, operation] of pending) {
      clearTimeout(operation.timer);
      operation.reject(error);
      pending.delete(id);
    }
  };
  const onData = (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const boundary = buffer.indexOf(0);
      if (boundary === -1) break;
      const frame = buffer.subarray(0, boundary).toString('utf8');
      buffer = buffer.subarray(boundary + 1);
      if (!frame) continue;
      let message;
      try { message = JSON.parse(frame); } catch { continue; }
      const operation = pending.get(message.id);
      if (!operation) continue;
      pending.delete(message.id);
      clearTimeout(operation.timer);
      if (message.error) operation.reject(new Error(message.error.message));
      else operation.resolve(message.result ?? {});
    }
  };
  output.on('data', onData);
  const onPipeError = (error) => {
    closed = true;
    rejectPending(error);
  };
  input.on('error', onPipeError);
  output.on('error', onPipeError);
  child.once('close', () => {
    closed = true;
    rejectPending(new Error('browser DevTools pipe closed'));
  });
  return Object.freeze({
    child,
    send(method, params = {}, sessionId = null, timeoutMs = 30_000) {
      if (closed) return Promise.reject(new Error('browser DevTools pipe is closed'));
      const id = nextId++;
      const message = sessionId === null
        ? { id, method, params }
        : { id, method, params, sessionId };
      return new Promise((resolveCommand, rejectCommand) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          rejectCommand(new Error(`browser DevTools command timed out: ${method}`));
        }, timeoutMs);
        pending.set(id, { resolve: resolveCommand, reject: rejectCommand, timer });
        input.write(`${JSON.stringify(message)}\0`);
      });
    },
    close() {
      if (closed) return;
      closed = true;
      output.off('data', onData);
      rejectPending(new Error('browser DevTools client closed'));
      input.destroy();
      output.destroy();
    },
  });
}

async function attachCdpPage(browser, origin, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let target = null;
  while (Date.now() < deadline && target === null) {
    const inventory = await browser.send('Target.getTargets');
    target = inventory.targetInfos?.find((candidate) => (
      candidate.type === 'page'
        && typeof candidate.url === 'string'
        && (() => {
          try { return new URL(candidate.url).origin === origin; } catch { return false; }
        })()
    )) ?? null;
    if (target === null) await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  if (target === null) throw new Error(`browser did not open the supervised page ${origin}`);
  const attached = await browser.send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  });
  const { sessionId } = attached;
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error('browser did not return a DevTools page session');
  }
  await browser.send('Runtime.enable', {}, sessionId);
  await browser.send('Page.enable', {}, sessionId);
  return Object.freeze({
    async evaluate(expression, timeout = 30_000) {
      const response = await browser.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      }, sessionId, timeout);
      if (response.exceptionDetails) {
        throw new Error(
          response.exceptionDetails.exception?.description
            ?? response.exceptionDetails.text
            ?? 'browser evaluation failed',
        );
      }
      return response.result?.value;
    },
    async screenshot() {
      const response = await browser.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
      }, sessionId);
      if (typeof response.data !== 'string' || response.data.length === 0) {
        throw new Error('browser screenshot command returned no bytes');
      }
      return Buffer.from(response.data, 'base64');
    },
  });
}

async function verifyBrowserSupervisorAttestation(page, readiness) {
  const attestationUrl = new URL(
    readiness.attestation.path,
    readiness.origin,
  ).href;
  const result = await page.evaluate(`(async () => {
    const pageOrigin = globalThis.location?.origin ?? null;
    if (pageOrigin !== ${JSON.stringify(readiness.origin)}) {
      return { ok: false, pageOrigin, url: null, body: null };
    }
    const response = await fetch(${JSON.stringify(attestationUrl)}, {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    });
    return {
      ok: response.ok,
      pageOrigin,
      url: response.url,
      body: await response.text(),
    };
  })()`);
  let responseOrigin = null;
  try { responseOrigin = new URL(result?.url).origin; } catch { /* fail below */ }
  if (result?.ok !== true
      || result.pageOrigin !== readiness.origin
      || responseOrigin !== readiness.origin
      || result.body !== `${readiness.attestation.nonce}\n`) {
    throw new Error('browser did not receive the exact supervised Metro run attestation');
  }
}

async function waitForBrowserExpression(page, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      if (await page.evaluate(expression, Math.min(5_000, timeoutMs))) return;
    } catch (error) { lastError = error; }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`browser application readiness timed out${lastError ? `: ${lastError.message}` : ''}`);
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

async function runWebCarrier({
  config,
  options,
  testHooks,
  root,
  artifacts,
  verifyReceipt,
  fetchImpl,
}) {
  const carrier = config.carriers['web-browser'];
  const logPath = join(artifacts, 'web-dev.log');
  const replacements = { artifacts };
  const command = expandedCommand(carrier.command, replacements);
  const structuredReadinessPath = carrier.structuredReadiness === undefined
    ? null
    : resolve(root, expandedValue(carrier.structuredReadiness.file, replacements));
  const signals = createSignalInterruption();
  const carrierProcess = structuredReadinessPath === null
    ? null
    : processInventory().find(({ pid }) => pid === process.pid);
  if (structuredReadinessPath !== null && carrierProcess === undefined) {
    signals.close();
    throw new Error('web carrier could not establish its supervisor parent lease');
  }
  let cleanupLease = null;
  let readinessLease = null;
  try {
    cleanupLease = await createCarrierCleanupLease();
    readinessLease = structuredReadinessPath === null
      ? null
      : reserveCleanupPath(cleanupLease, structuredReadinessPath, {
        type: 'file',
        label: 'Expo supervisor readiness',
      });
    if (structuredReadinessPath !== null) rmSync(structuredReadinessPath, { force: true });
  } catch (error) {
    releaseCleanupResource(readinessLease);
    if (cleanupLease !== null) {
      try {
        await closeCarrierCleanupLease(cleanupLease);
      } catch (cleanupError) {
        signals.close();
        throw new AggregateError([error, cleanupError], 'web carrier setup cleanup failed');
      }
    }
    signals.close();
    throw error;
  }
  let child;
  try {
    child = startOwned(command, {
      cleanupLease,
      label: 'Expo CLI supervisor',
      cwd: root,
      env: {
        ...process.env,
        CI: '1',
        ...(cleanupLease === null ? {} : {
          [CLEANUP_LEASE_DIRECTORY_ENV]: cleanupLease.directory,
        }),
        ...(carrierProcess === null ? {} : {
          [SUPERVISOR_PARENT_PID_ENV]: String(process.pid),
          [SUPERVISOR_PARENT_START_TIME_ENV]: carrierProcess.startTime,
        }),
      },
      logPath,
    });
  } catch (error) {
    releaseCleanupResource(readinessLease);
    await closeCarrierCleanupLease(cleanupLease);
    signals.close();
    throw error;
  }
  let browserProcess = null;
  let browserCdp = null;
  let browserProfile = null;
  let browserProfileLease = null;
  let readiness = null;
  let observations = null;
  let readinessFileRemoved = structuredReadinessPath === null;
  let supervisorRemovedReadiness = structuredReadinessPath === null;
  let browserProfileRemoved = true;
  let browserExited = true;
  let childExited = false;
  try {
    const startupStartedAt = Date.now();
    readiness = structuredReadinessPath === null
      ? Object.freeze({ origin: new URL(carrier.origin).origin })
      : await signals.race(waitForExpoSupervisorWebReadiness(
        structuredReadinessPath,
        carrier.startupTimeoutMs,
        child,
      ));
    if (structuredReadinessPath !== null) {
      activateCleanupPath(readinessLease, {
        runIdField: 'supervisorGeneration',
        runId: readiness.supervisorGeneration,
      });
    }
    const elapsed = Date.now() - startupStartedAt;
    await signals.race(waitForHttp(
      readiness.origin,
      Math.max(1, carrier.startupTimeoutMs - elapsed),
      child,
      fetchImpl,
    ));
    if (structuredReadinessPath !== null) {
      const confirmed = readExpoSupervisorWebReadiness(structuredReadinessPath, child);
      assertExpoSupervisorReadinessUnchanged(
        readiness,
        confirmed,
        'during HTTP admission',
      );
    }
    const browser = findBrowser(options.browser);
    browserProfile = join(tmpdir(), `snapback-carrier-browser-${randomUUID()}`);
    browserProfileLease = reserveCleanupPath(cleanupLease, browserProfile, {
      type: 'browser-profile',
      label: 'carrier browser profile',
    });
    mkdirSync(browserProfile, { mode: 0o700 });
    browserProfileRemoved = false;
    const screenshot = join(artifacts, 'web-browser.png');
    const html = join(artifacts, 'web-browser.html');
    let journey = null;
    if (structuredReadinessPath !== null) {
      // This is deliberately adjacent to Chrome spawn: it re-enumerates the
      // child, Metro leader, exact listener owner, start times, and live port
      // after the HTTP probe and the final descriptor read.
      assertExpoSupervisorWebOwnership(readiness, child);
      await testHooks.onWebOwnershipValidated?.(readiness);
    }
    if (carrier.browserJourney || structuredReadinessPath !== null) {
      const browserLog = join(artifacts, 'web-browser-process.log');
      browserProcess = startCdpBrowser([
        browser,
        '--headless=new',
        '--disable-gpu',
        '--no-default-browser-check',
        '--no-first-run',
        '--remote-debugging-pipe',
        `--user-data-dir=${browserProfile}`,
        '--window-size=1280,900',
        readiness.origin,
      ], {
        cwd: root,
        env: process.env,
        logPath: browserLog,
        cleanupLease,
        profileDirectory: browserProfile,
        finalizationReady: testHooks.browserLeaseFinalizationReady ?? null,
      });
      await testHooks.onBrowserLeaseReserved?.(Object.freeze({
        directory: cleanupLease?.directory ?? null,
        processId: browserProcess.pid,
        profileDirectory: browserProfile,
      }));
      browserExited = false;
      browserCdp = browserProcess;
      const page = await signals.race(attachCdpPage(browserCdp, readiness.origin));
      if (structuredReadinessPath !== null) {
        // Target discovery can observe the destination URL just before Chrome
        // replaces the initial about:blank document. Do not spend the
        // single-use attestation while the page is in that transient state.
        await signals.race(waitForBrowserExpression(
          page,
          `globalThis.location?.origin === ${JSON.stringify(readiness.origin)}
            && document.readyState !== 'loading'`,
          30_000,
        ));
        await signals.race(verifyBrowserSupervisorAttestation(page, readiness));
        const postNavigation = readExpoSupervisorWebReadiness(
          structuredReadinessPath,
          child,
        );
        assertExpoSupervisorReadinessUnchanged(
          readiness,
          postNavigation,
          'after browser navigation and one-shot attestation',
        );
        assertExpoSupervisorWebOwnership(postNavigation, child);
      }
      const marker = carrier.browserJourney ? `snapback-carrier-${randomUUID()}` : null;
      let result = null;
      if (carrier.browserJourney) {
        await signals.race(page.evaluate(
          `globalThis.__snapbackCarrierJourneyId = ${JSON.stringify(marker)}`,
        ));
        await signals.race(waitForBrowserExpression(
          page,
          carrier.browserJourney.readyExpression,
          45_000,
        ));
        await testHooks.onBrowserJourneyReady?.(readiness);
        result = await signals.race(page.evaluate(
          carrier.browserJourney.runExpression,
          45_000,
        ));
        if (result?.marker !== marker
            || result.readObserved !== true
            || result.writeObserved !== true) {
          throw new Error('browser journey did not return its exact read/write witness');
        }
      }
      const retainedDom = await signals.race(page.evaluate(
        'document.documentElement.outerHTML',
      ));
      if (typeof retainedDom !== 'string' || retainedDom.length === 0) {
        throw new Error('browser journey did not return retained DOM');
      }
      const missing = (carrier.browserJourney?.requiredDomText ?? []).filter(
        (candidate) => !retainedDom.includes(candidate),
      );
      if ((marker !== null && !retainedDom.includes(marker)) || missing.length > 0) {
        const absent = [
          ...(marker === null || retainedDom.includes(marker) ? [] : ['<journey write marker>']),
          ...missing,
        ];
        throw new Error(
          `browser retained DOM lacks its write marker or ready UI: ${absent.join(', ')}`,
        );
      }
      const forbidden = (carrier.browserJourney?.forbiddenDomText ?? []).filter(
        (candidate) => retainedDom.includes(candidate),
      );
      if (forbidden.length > 0) {
        throw new Error(`browser retained DOM contains forbidden diagnostics: ${forbidden.join(', ')}`);
      }
      const screenshotBytes = await signals.race(page.screenshot());
      writeFileSync(screenshot, screenshotBytes);
      writeFileSync(html, retainedDom);
      if (carrier.browserJourney) {
        journey = {
          marker,
          readObserved: true,
          writeObserved: true,
          result,
        };
      }
      observations = { browserProcessLog: browserLog };
    } else {
      browserProcess = startCaptured([
        browser,
        '--headless=new',
        '--disable-gpu',
        '--no-default-browser-check',
        '--no-first-run',
        `--user-data-dir=${browserProfile}`,
        '--window-size=1280,900',
        `--screenshot=${screenshot}`,
        '--dump-dom',
        readiness.origin,
      ], {
        cwd: root,
        env: process.env,
        cleanupLease,
        profileDirectory: browserProfile,
      });
      browserExited = false;
      const stdout = await signals.race(waitForCaptured(browserProcess, 60_000));
      writeFileSync(html, stdout);
    }
    if (!existsSync(screenshot) || statSync(screenshot).size === 0) {
      throw new Error('headless browser did not write a screenshot');
    }
    observations = {
      ...(observations ?? {}),
      origin: readiness.origin,
      ...(structuredReadinessPath === null ? {} : {
        structuredReadiness: {
          schemaVersion: 'snapback.expo-supervisor.v1',
          correlationId: readiness.correlationId,
          supervisorGeneration: readiness.supervisorGeneration,
          supervisorPid: readiness.supervisorPid,
          supervisorStartTime: readiness.supervisorStartTime,
          metroPid: readiness.metroPid,
          metroStartTime: readiness.metroStartTime,
          listener: readiness.listener,
          metroListener: readiness.metroListener,
          attestation: {
            path: readiness.attestation.path,
            verified: true,
            singleUse: true,
          },
        },
      }),
      screenshot,
      html,
      ...(journey === null ? {} : { journey }),
      processLog: logPath,
    };
  } finally {
    const cleanupFailures = [];
    browserCdp?.close();
    if (browserProcess !== null) {
      try {
        await stopOwned(browserProcess.child);
        browserExited = browserProcess.child.exitCode !== null
          || browserProcess.child.signalCode !== null;
      } catch (error) { cleanupFailures.push(error); }
    }
    if (browserProfile !== null) {
      try {
        rmSync(browserProfile, { recursive: true, force: true });
        browserProfileRemoved = !existsSync(browserProfile);
        releaseCleanupResource(browserProfileLease);
      } catch (error) { cleanupFailures.push(error); }
    }
    try {
      await stopOwned(child);
      childExited = child.exitCode !== null || child.signalCode !== null;
    } catch (error) { cleanupFailures.push(error); }
    if (structuredReadinessPath !== null) {
      supervisorRemovedReadiness = !existsSync(structuredReadinessPath);
      try {
        if (readinessLease === null) rmSync(structuredReadinessPath, { force: true });
        else cleanupLeasedPath(readinessLease);
        readinessFileRemoved = !existsSync(structuredReadinessPath);
      } catch (error) { cleanupFailures.push(error); }
    }
    try { await closeCarrierCleanupLease(cleanupLease); } catch (error) {
      cleanupFailures.push(error);
    }
    signals.close();
    if (cleanupFailures.length > 0) {
      throw new AggregateError(cleanupFailures, 'web carrier cleanup failed');
    }
  }
  return writeDirectorLog(artifacts, {
    schemaVersion: TEMPLATE_CARRIER_LOG_SCHEMA_VERSION,
    status: 'completed',
    carrier: 'web-browser',
    proofAuthority: { kind: 'llp-0146-d2', receipt: verifyReceipt },
    observations: {
      ...observations,
      cleanup: {
        readinessFileRemoved,
        supervisorRemovedReadiness,
        browserProfileRemoved,
        browserExited,
        childExited,
      },
    },
    nonClaim: 'carrier director output is not an acceptance receipt or product-completeness claim',
  });
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
      testHooks: options,
      root,
      artifacts,
      verifyReceipt,
      fetchImpl: options.fetch ?? fetch,
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
