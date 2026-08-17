import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import {
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import {
  assertExpoCarrierPostBootInvariants,
  expoCarrierPostBootInvariantNames,
} from '../qualification-invariants.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(scriptDirectory, '..');
const appRoot = join(demoRoot, 'probe-app');
const repoRoot = resolve(demoRoot, '../..');
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const hashFile = async (path) => sha256(await readFile(path));
const deviceIdHash = (deviceId) => createHash('sha256').update(deviceId).digest('hex');
const appRequire = createRequire(join(appRoot, 'package.json'));
const requiredPackageNames = Object.freeze([
  '@expo/snapback-client',
  '@expo/snapback-expo',
  'expo',
  'expo-device',
  'expo-sqlite',
  'react-native',
]);

async function packageRoot(name) {
  try {
    return realpath(dirname(appRequire.resolve(`${name}/package.json`)));
  } catch {
    let current = dirname(appRequire.resolve(name));
    while (true) {
      try {
        const manifest = JSON.parse(await readFile(join(current, 'package.json'), 'utf8'));
        if (manifest.name === name) return realpath(current);
      } catch { /* keep walking to the installed package root */ }
      const parent = dirname(current);
      if (parent === current) throw new Error(`cannot resolve installed package artifact ${name}`);
      current = parent;
    }
  }
}

async function digestPackageDirectory(root) {
  const hash = createHash('sha256');
  hash.update('snapback:installed-package-directory:v1\0');
  const visit = async (directory, prefix = '') => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue;
      const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        hash.update(`directory\0${relativePath}\0`);
        await visit(path, relativePath);
      } else if (entry.isSymbolicLink()) {
        hash.update(`symlink\0${relativePath}\0${await readlink(path)}\0`);
      } else if (entry.isFile()) {
        const bytes = await readFile(path);
        hash.update(`file\0${relativePath}\0${bytes.length}\0`);
        hash.update(bytes);
      }
    }
  };
  await visit(root);
  return `sha256:${hash.digest('hex')}`;
}

async function installedPackageArtifact(name) {
  const root = await packageRoot(name);
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  return Object.freeze({
    name,
    version: manifest.version,
    artifactKind: 'installed-package-directory',
    artifactPath: relative(repoRoot, root),
    sha256: await digestPackageDirectory(root),
  });
}

function containingAppBundle(path) {
  let current = path;
  while (true) {
    if (current.endsWith('.app')) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function resolveAppBundleFromArtifacts(paths) {
  const artifactRoots = await Promise.all(paths.map(async (path) => (
    containingAppBundle(await realpath(path))
  )));
  if (artifactRoots.some((root) => root === null)) {
    throw new Error('--skip-build requires --js-bundle and --native-binary paths inside an existing .app');
  }
  if (new Set(artifactRoots).size !== 1) {
    throw new Error('--skip-build artifacts must belong to the same .app bundle');
  }
  return artifactRoots[0];
}

function parseBatteryReference(bytes) {
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error('battery reference is not valid JSON', { cause: error });
  }
  if (typeof parsed?.eligible !== 'boolean') {
    throw new Error('battery reference must contain boolean eligible');
  }
  if (typeof parsed?.qualifiedCommit !== 'string' || parsed.qualifiedCommit.length === 0) {
    throw new Error('battery reference must contain non-empty qualifiedCommit');
  }
  return Object.freeze({
    eligible: parsed.eligible,
    qualifiedCommit: parsed.qualifiedCommit,
  });
}
const phases = Object.freeze([
  'pending-durable-before-delivery',
  'server-result-before-local-settlement',
  'commit-loop',
  'committed-before-callback',
  'consumed-before-ack',
  'ack-proof-before-local-removal',
  'authority-wipe-before-successor',
]);
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1] ?? null;
};
const platform = value('--platform');
const device = value('--device');
const mode = value('--mode');
const hostOrigin = value('--host-origin');
const jsBundlePath = value('--js-bundle');
const nativeBinaryPath = value('--native-binary');
const batteryReferencePath = value('--battery-reference');
const dryRun = flag('--dry-run');
const skipBuild = flag('--skip-build');
const deviceClass = value('--device-class') ?? 'real-device';
if (!['ios', 'android'].includes(platform) || !device || !['process', 'power'].includes(mode)) {
  process.stderr.write('usage: qualify.mjs --platform <ios|android> --device <id> --mode <process|power> [--host-origin http://HOST] [--device-class simulator|emulator|real-device] [--js-bundle PATH --native-binary PATH --battery-reference PATH] [--skip-build] [--dry-run]\n');
  process.exit(2);
}
const iterations = mode === 'process' ? 100 : 25;
const startedAt = new Date();
const seed = randomBytes(16).toString('hex');
const runId = `${startedAt.toISOString().replace(/[-:.]/gu, '').replace('Z', 'Z-')}${seed.slice(0, 8)}`;
const packageId = 'com.snapback.exposqlitecarrierprobe';
const directorPort = 4899;
const directorBindHost = '0.0.0.0';
const qualificationHostOrigin = hostOrigin ?? 'http://127.0.0.1';
const qualificationOriginUrl = new URL(qualificationHostOrigin);
qualificationOriginUrl.port = String(directorPort);
const qualificationOrigin = qualificationOriginUrl.origin;
const iosSimulator = platform === 'ios' && deviceClass === 'simulator';
const redactedDevice = '<device-id>';
const redactDevice = (argv) => argv.map((argument) => argument === device ? redactedDevice : argument);
const build = platform === 'ios'
  ? ['bunx', 'expo', 'run:ios', '--device', device, '--configuration', 'Release']
  : ['bunx', 'expo', 'run:android', '--variant', 'release'];
const deviceBoot = iosSimulator ? ['xcrun', 'simctl', 'bootstatus', device, '-b'] : null;
const simulatorTerminate = ['xcrun', 'simctl', 'terminate', device, packageId];
const androidTerminate = ['adb', '-s', device, 'shell', 'am', 'force-stop', packageId];
const preLaunchTerminate = platform === 'android'
  ? androidTerminate
  : iosSimulator
    ? simulatorTerminate
    : null;
const plainLaunch = platform === 'android'
  ? ['adb', '-s', device, 'shell', 'am', 'start', '-W', '-n', `${packageId}/.MainActivity`]
  : iosSimulator
    ? ['xcrun', 'simctl', 'launch', device, packageId]
    : ['xcrun', 'devicectl', 'device', 'process', 'launch', '--device', device, packageId];
const realDeviceAppLookup = ['xcrun', 'devicectl', 'device', 'info', 'apps', '--device', device, '--bundle-id', packageId];
const realDeviceProcessLookup = ['xcrun', 'devicectl', 'device', 'info', 'processes', '--device', device];
const realDevicePidTerminate = ['xcrun', 'devicectl', 'device', 'process', 'terminate', '--device', device, '--pid', '<resolved-pid>', '--kill'];
const skipBuildInstall = iosSimulator
  ? ['xcrun', 'simctl', 'install', device, '<resolved-app-bundle>']
  : platform === 'ios'
    ? ['xcrun', 'devicectl', 'device', 'install', 'app', '--device', device, '<resolved-app-bundle>']
    : null;
const fullBuildCommands = [
  ['rm', '-rf', '<probe-app>/node_modules', '<probe-app>/bun.lock'],
  ['bun', 'install'],
  ['bunx', 'expo', 'prebuild', '--clean'],
  redactDevice(build),
];
const protocol = {
  schemaVersion: 'snapback.expo-sqlite-carrier-device-protocol.v3',
  qualificationMode: true,
  runId,
  seed,
  platform,
  deviceIdHash: deviceIdHash(device),
  deviceClass,
  mode,
  iterations,
  phases,
  skipBuild,
  deviceBoot: deviceBoot === null ? null : redactDevice(deviceBoot),
  cleanBuild: skipBuild
    ? {
      performed: false,
      mode: 'install-only',
      commands: skipBuildInstall === null ? [] : [redactDevice(skipBuildInstall)],
    }
    : {
      performed: true,
      mode: 'full-clean-build-and-install',
      commands: fullBuildCommands,
    },
  qualificationBuildEnvironment: {
    EXPO_PUBLIC_SNAPBACK_SQLITE_QUALIFICATION_MODE: '1',
    EXPO_PUBLIC_SNAPBACK_QUALIFICATION_ORIGIN: qualificationOrigin,
  },
  commandChannel: {
    automated: {
      transport: 'director-served-command-poll',
      endpoint: `GET ${qualificationOrigin}/command`,
      directorBinding: `${directorBindHost}:${directorPort}`,
      fixedPort: true,
      cadence: 'once on mount and once on each AppState foreground transition',
      readinessRetriesMs: [0, 1000, 2000],
      pendingResponse: '{ phase, cycle, predecessorHandleKeyDigest, launchNonce }',
      idleResponse: '{ idle: true }',
      completion: 'pending command clears only on matching armed/verified cycle + launchNonce',
    },
    legacyManualFallback: {
      transport: 'custom-scheme Linking event',
      scheme: 'snapback-sqlite-probe',
      automated: false,
    },
  },
  launch: {
    terminateFirst: platform === 'ios' && !iosSimulator
      ? {
        appLookup: [...redactDevice(realDeviceAppLookup), '--json-output', '<os-temp-json>'],
        processLookup: [...redactDevice(realDeviceProcessLookup), '--json-output', '<os-temp-json>'],
        match: `bundleIdentifier exactly ${packageId}; executable directly inside that installed app container`,
        commandTemplate: redactDevice(realDevicePidTerminate),
        signal: 'SIGKILL',
      }
      : {
        command: redactDevice(preLaunchTerminate),
      },
    tolerateNotRunning: true,
    start: platform === 'ios' && !iosSimulator
      ? {
        command: [
          ...redactDevice(plainLaunch.slice(0, -1)),
          '--json-output',
          '<os-temp-json>',
          plainLaunch.at(-1),
        ],
        pidCapture: 'unique processIdentifier from launch JSON, bound to launchNonce',
      }
      : {
        command: redactDevice(plainLaunch),
        pidCapture: null,
      },
    deepLinkDelivery: false,
  },
  processCut: platform === 'ios' && !iosSimulator
    ? {
      commandTemplate: redactDevice(realDevicePidTerminate),
      pidSource: 'launch JSON processIdentifier bound to launchNonce; bundle-exact installed-app/process-list fallback only when unavailable',
      signal: 'SIGKILL',
    }
    : iosSimulator
      ? {
        command: redactDevice(simulatorTerminate),
        pidSource: 'not required by simctl bundle-id terminate',
        signal: 'SIMCTL_TERMINATE',
      }
      : {
        command: redactDevice(androidTerminate),
        pidSource: 'not required by Android package force-stop',
        signal: 'ANDROID_FORCE_STOP',
      },
  powerCut: 'external battery-isolated relay or witnessed hard-power interruption; graceful reboot is forbidden',
  postBootInvariants: [
    'integrity_check=ok',
    'old-or-new whole generation only',
    'all host COMMIT watermarks present',
    'one writer and stable sqlite_source_id',
    'same clientMutationId remains pending or settled and executes at most once',
    'settlement republishes before ACK removal',
    'authority predecessor is non-renderable and handleKey rotates',
  ],
  manualPromotionLegs: [
    'tampered-copy import: header/page/WAL truncation, future schema, bad digest; original bytes preserved',
    'second provider root coalescing plus independent connection owner refusal/takeover',
    'deterministic max_page_count rollback with prior commit retained',
    'offline intent -> death -> reconnect -> one server execution -> ACK removal',
  ],
  requiredReceiptInputs: {
    artifacts: ['--js-bundle', '--native-binary', '--battery-reference'],
    inlinedBuildEnvironment: [
      'EXPO_PUBLIC_SNAPBACK_SQLITE_QUALIFICATION_MODE',
      'EXPO_PUBLIC_SNAPBACK_QUALIFICATION_ORIGIN',
    ],
    commandChannel: 'fixed-port director-served polling with cycle + launchNonce correlation',
  },
};
if (dryRun) {
  process.stdout.write(`${JSON.stringify(protocol, null, 2)}\n`);
  process.exit(0);
}
if (!hostOrigin && deviceClass !== 'simulator') {
  process.stderr.write('--host-origin is required for an actual emulator or real-device run (for example http://10.0.2.2 for Android Emulator or http://192.168.1.10 for a physical device)\n');
  process.exit(2);
}
if (!jsBundlePath || !nativeBinaryPath || !batteryReferencePath) {
  process.stderr.write('--js-bundle, --native-binary, and --battery-reference are required for an actual device receipt\n');
  process.exit(2);
}
if (skipBuild && platform !== 'ios') {
  process.stderr.write('--skip-build currently requires iOS .app-contained artifact paths so the exact hashed bundle can be installed\n');
  process.exit(2);
}

const resolvedJsBundle = resolve(jsBundlePath);
const resolvedNativeBinary = resolve(nativeBinaryPath);
const resolvedBatteryReference = resolve(batteryReferencePath);
const batteryReferenceBytes = await readFile(resolvedBatteryReference);
const batteryReference = parseBatteryReference(batteryReferenceBytes);
const batteryReferenceSha256 = sha256(batteryReferenceBytes);
let appBundleRoot = null;
let jsBundleIdentity = null;
let nativeBinaryIdentity = null;
if (skipBuild) {
  appBundleRoot = await resolveAppBundleFromArtifacts([resolvedJsBundle, resolvedNativeBinary]);
  jsBundleIdentity = { path: jsBundlePath, sha256: await hashFile(resolvedJsBundle) };
  nativeBinaryIdentity = { path: nativeBinaryPath, sha256: await hashFile(resolvedNativeBinary) };
}

const command = (argv, options = {}) => {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: options.cwd ?? appRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      EXPO_PUBLIC_SNAPBACK_SQLITE_QUALIFICATION_MODE: '1',
      EXPO_PUBLIC_SNAPBACK_QUALIFICATION_ORIGIN: qualificationOrigin,
    },
    stdio: options.capture || options.tolerateFailure ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  const failureOutput = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0 && !options.tolerateFailure?.test(failureOutput)) {
    throw new Error(`${argv.join(' ')} failed (${result.status}): ${result.stderr ?? ''}`);
  }
  return options.returnResult ? result : result.stdout ?? '';
};

const devicectlJson = (label, argv, options = {}) => {
  const scratchDirectory = mkdtempSync(join(tmpdir(), 'snapback-devicectl-'));
  const jsonPath = join(scratchDirectory, `${label}.json`);
  try {
    const { jsonOutputBeforeTrailing = 0, ...commandOptions } = options;
    const insertionIndex = argv.length - jsonOutputBeforeTrailing;
    const commandArgv = [
      ...argv.slice(0, insertionIndex),
      '--json-output',
      jsonPath,
      ...argv.slice(insertionIndex),
    ];
    const result = command(commandArgv, {
      ...commandOptions,
      capture: true,
      returnResult: true,
    });
    return {
      result,
      json: JSON.parse(readFileSync(jsonPath, 'utf8')),
    };
  } finally {
    rmSync(scratchDirectory, { recursive: true, force: true });
  }
};

if (iosSimulator) command(deviceBoot);
if (!skipBuild) {
  command(['rm', '-rf', join(appRoot, 'node_modules'), join(appRoot, 'bun.lock')]);
  command(['bun', 'install']);
  command(['bunx', 'expo', 'prebuild', '--clean']);
  command(build);
  jsBundleIdentity = { path: jsBundlePath, sha256: await hashFile(resolvedJsBundle) };
  nativeBinaryIdentity = { path: nativeBinaryPath, sha256: await hashFile(resolvedNativeBinary) };
} else if (iosSimulator) {
  command(['xcrun', 'simctl', 'install', device, appBundleRoot]);
} else {
  command(['xcrun', 'devicectl', 'device', 'install', 'app', '--device', device, appBundleRoot]);
}

const events = [];
const serverExecutions = new Map();
const serverAcknowledgements = new Set();
const waiters = [];
let pendingCommand = null;
const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/command') {
    const commandResponse = pendingCommand === null
      ? { idle: true }
      : {
        phase: pendingCommand.phase,
        cycle: pendingCommand.cycle,
        predecessorHandleKeyDigest: pendingCommand.predecessorHandleKeyDigest,
        launchNonce: pendingCommand.launchNonce,
      };
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': 'application/json',
    });
    response.end(JSON.stringify(commandResponse));
    return;
  }
  if (request.method !== 'POST' || !['/event', '/execute', '/ack'].includes(request.url)) {
    response.writeHead(404).end();
    return;
  }
  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
    const input = JSON.parse(body);
    if (request.url === '/event') {
      events.push({ at: new Date().toISOString(), ...input });
      if (
        pendingCommand !== null
        && input.type === pendingCommand.completionEvent
        && input.cycle === pendingCommand.cycle
        && input.launchNonce === pendingCommand.launchNonce
      ) pendingCommand = null;
      for (const waiter of [...waiters]) waiter();
      response.writeHead(204).end();
      return;
    }
    const id = input.clientMutationId;
    if (typeof id !== 'string' || id.length === 0) {
      response.writeHead(400).end();
      return;
    }
    if (request.url === '/execute') {
      let execution = serverExecutions.get(id);
      if (execution === undefined) {
        execution = Object.freeze({
          executionCount: 1,
          result: Object.freeze({ ok: true, clientMutationId: id }),
        });
        serverExecutions.set(id, execution);
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(execution));
      return;
    }
    serverAcknowledgements.add(id);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ acknowledged: true, clientMutationId: id }));
  });
});
await new Promise((resolveListen, rejectListen) => {
  const onError = (error) => rejectListen(new Error(
    `director port ${directorPort} is unavailable on ${directorBindHost}; the fixed port is baked into the qualification build (${error.code ?? error.message})`,
    { cause: error },
  ));
  server.once('error', onError);
  server.listen(directorPort, directorBindHost, () => {
    server.off('error', onError);
    resolveListen();
  });
});
const eventFor = (predicate, timeoutMs = 60_000) => new Promise((resolveEvent, reject) => {
  const started = Date.now();
  const check = () => {
    const event = events.find(predicate);
    if (event) {
      waiters.splice(waiters.indexOf(check), 1);
      resolveEvent(event);
    } else if (Date.now() - started > timeoutMs) {
      waiters.splice(waiters.indexOf(check), 1);
      reject(new Error('timed out waiting for probe event'));
    } else setTimeout(check, 250);
  };
  waiters.push(check);
  check();
});
const tolerateNotRunning = /no such process|not running|found nothing to terminate|no matching process|process not found|does not exist/iu;
const launchProcesses = new Map();
const processIdentifierValues = (root) => {
  const values = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'processIdentifier') {
        const parsed = typeof entry === 'string' ? Number.parseInt(entry, 10) : entry;
        if (Number.isSafeInteger(parsed) && parsed > 0) values.push(parsed);
      } else visit(entry);
    }
  };
  visit(root);
  return [...new Set(values)];
};
const pathFromDeviceJson = (value) => {
  if (typeof value !== 'string' || value.length === 0) return null;
  const path = value.startsWith('file:') ? fileURLToPath(value) : value;
  return path.length > 1 ? path.replace(/\/+$/u, '') : path;
};
const resolveBundleExactIosDevicePid = ({ tolerateMissing = false } = {}) => {
  const appJson = devicectlJson('apps', realDeviceAppLookup).json;
  const apps = appJson?.result?.apps ?? [];
  const exactApps = apps.filter((entry) => entry.bundleIdentifier === packageId);
  if (exactApps.length !== 1) {
    throw new Error(`expected exactly one installed app for bundle id ${packageId}; found ${exactApps.length}`);
  }
  const installedAppPath = pathFromDeviceJson(exactApps[0].url);
  if (installedAppPath === null || !installedAppPath.endsWith('.app')) {
    throw new Error(`installed app for bundle id ${packageId} has no exact .app container URL`);
  }
  const processJson = devicectlJson('processes', realDeviceProcessLookup).json;
  const processes = processJson?.result?.runningProcesses ?? [];
  const matches = processes.filter((entry) => {
    const executablePath = pathFromDeviceJson(entry.executable);
    return executablePath !== null && dirname(executablePath) === installedAppPath;
  });
  if (matches.length === 0 && tolerateMissing) return null;
  if (matches.length !== 1) {
    throw new Error(`bundle-exact process resolution for ${packageId} found ${matches.length} matches`);
  }
  const pid = typeof matches[0].processIdentifier === 'string'
    ? Number.parseInt(matches[0].processIdentifier, 10)
    : matches[0].processIdentifier;
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(`bundle-exact process for ${packageId} has no valid processIdentifier`);
  }
  return pid;
};
const terminate = ({ tolerateMissing = false, launchNonce = null } = {}) => {
  if (platform === 'ios' && !iosSimulator) {
    const launched = launchNonce === null ? null : launchProcesses.get(launchNonce);
    if (launchNonce !== null && launched === undefined) {
      throw new Error(`no launch identity is bound to launch nonce ${launchNonce}`);
    }
    const launchPid = launched?.pid ?? null;
    const pid = launchPid ?? resolveBundleExactIosDevicePid({ tolerateMissing });
    if (pid === null) {
      return Object.freeze({
        resolvedPid: null,
        pidResolution: 'bundle-exact-process-list',
        cutCommand: null,
        terminationSignal: 'SIGKILL',
        terminationOutcome: Object.freeze({ status: 'not-running', exitCode: null }),
      });
    }
    const argv = ['xcrun', 'devicectl', 'device', 'process', 'terminate', '--device', device, '--pid', String(pid), '--kill'];
    const result = command(argv, { capture: true, returnResult: true });
    return Object.freeze({
      resolvedPid: pid,
      pidResolution: launchPid === null ? 'bundle-exact-process-list' : 'launch-json-bound-to-nonce',
      cutCommand: redactDevice(argv),
      terminationSignal: 'SIGKILL',
      terminationOutcome: Object.freeze({ status: 'terminated', exitCode: result.status }),
    });
  }
  const result = command(preLaunchTerminate, {
    capture: true,
    returnResult: true,
    ...(tolerateMissing ? { tolerateFailure: tolerateNotRunning } : {}),
  });
  return Object.freeze({
    resolvedPid: null,
    pidResolution: 'not-required-by-device-class',
    cutCommand: redactDevice(preLaunchTerminate),
    terminationSignal: iosSimulator ? 'SIMCTL_TERMINATE' : 'ANDROID_FORCE_STOP',
    terminationOutcome: Object.freeze({
      status: result.status === 0 ? 'terminated' : 'not-running',
      exitCode: result.status,
    }),
  });
};
const launch = ({ phase, cycle, predecessorHandleKeyDigest = null }) => {
  if (pendingCommand !== null) throw new Error('cannot launch while another director command is pending');
  terminate({ tolerateMissing: true });
  const launchNonce = randomBytes(16).toString('hex');
  pendingCommand = Object.freeze({
    phase,
    cycle,
    predecessorHandleKeyDigest,
    launchNonce,
    completionEvent: phase === 'verify' ? 'verified' : 'armed',
  });
  try {
    let pid = null;
    if (platform === 'ios' && !iosSimulator) {
      const launchJson = devicectlJson('launch', plainLaunch, { jsonOutputBeforeTrailing: 1 }).json;
      const pidCandidates = processIdentifierValues(launchJson?.result);
      if (pidCandidates.length === 1) [pid] = pidCandidates;
    } else command(plainLaunch);
    launchProcesses.set(launchNonce, Object.freeze({ launchNonce, pid }));
  } catch (error) {
    pendingCommand = null;
    throw error;
  }
  return launchNonce;
};
const operator = createInterface({ input: process.stdin, output: process.stdout });
const observations = [];
let sourceId = null;
let sqliteFacts = null;
let runtimeTargetFacts = null;
let incompleteReason = null;
try {
  for (let cycle = 0; cycle < iterations; cycle += 1) {
    const phase = phases[cycle % phases.length];
    const armedLaunchNonce = launch({ phase, cycle });
    const armed = await eventFor((event) => (
      event.type === 'armed'
      && event.cycle === cycle
      && event.launchNonce === armedLaunchNonce
    ));
    sourceId ??= armed.facts.sqliteSourceId;
    sqliteFacts ??= armed.facts;
    if (armed.facts.sqliteSourceId !== sourceId) throw new Error('sqlite_source_id changed during run');
    for (const field of ['operatingSystem', 'osVersion', 'architecture', 'distribution', 'deviceClass']) {
      if (typeof armed.targetFacts?.[field] !== 'string' || armed.targetFacts[field].length === 0) {
        throw new Error(`runtime target fact ${field} is unresolved`);
      }
    }
    runtimeTargetFacts ??= armed.targetFacts;
    if (JSON.stringify(armed.targetFacts) !== JSON.stringify(runtimeTargetFacts)) {
      throw new Error('runtime target facts changed during run');
    }
    if (
      runtimeTargetFacts.operatingSystem !== platform
      || runtimeTargetFacts.distribution !== 'release'
      || runtimeTargetFacts.deviceClass !== deviceClass
    ) throw new Error('runtime target facts do not match the requested release target cell');
    const cutReadyEvent = await eventFor((event) => (
      event.type === 'cut-ready'
      && event.cycle === cycle
      && event.launchNonce === armedLaunchNonce
    ));
    let cutRecord;
    let powerWitness = null;
    if (mode === 'process') cutRecord = terminate({ launchNonce: armedLaunchNonce });
    else {
      const witness = await operator.question(
        `Cycle ${cycle + 1}/${iterations} (${phase}): perform a HARD power interruption now, then enter witness id (blank aborts): `,
      );
      if (!witness.trim()) {
        incompleteReason = `power witness missing at cycle ${cycle}`;
        break;
      }
      powerWitness = createHash('sha256').update(witness).digest('hex');
    }
    const verifyLaunchNonce = launch({
      phase: 'verify',
      cycle,
      predecessorHandleKeyDigest: armed.predecessorHandleKeyDigest,
    });
    const verified = await eventFor((event) => (
      event.type === 'verified'
      && event.cycle === cycle
      && event.launchNonce === verifyLaunchNonce
    ), 120_000);
    if (verified.integrity !== 'ok') throw new Error(`integrity_check=${verified.integrity}`);
    if (verified.facts.sqliteSourceId !== sourceId) throw new Error('sqlite_source_id changed after recovery');
    if (JSON.stringify(verified.targetFacts) !== JSON.stringify(runtimeTargetFacts)) {
      throw new Error('runtime target facts changed after recovery');
    }
    const reportedHostWatermarks = events
      .filter((event) => event.type === 'committed' && event.cycle === cycle)
      .map((event) => event.hostWatermark);
    const postBootRecord = {
      ...verified.postBootRecord,
      generation: {
        ...verified.postBootRecord.generation,
        allowed: phase === 'authority-wipe-before-successor' ? [null] : [1, 2],
      },
      reportedHostWatermarks,
      evaluatedInvariants: expoCarrierPostBootInvariantNames,
    };
    const invariantVerdict = assertExpoCarrierPostBootInvariants(postBootRecord);
    observations.push({
      cycle,
      phase,
      launchNonce: armedLaunchNonce,
      resolvedPid: cutRecord?.resolvedPid ?? null,
      pidResolution: cutRecord?.pidResolution ?? 'external-power-cut',
      cutCommand: cutRecord?.cutCommand ?? null,
      terminationSignal: cutRecord?.terminationSignal ?? 'HARD_POWER_INTERRUPTION',
      terminationOutcome: cutRecord?.terminationOutcome ?? {
        status: 'witnessed',
        witnessHash: powerWitness,
      },
      cutBoundary: cutReadyEvent.boundary,
      insideTransaction: cutReadyEvent.insideTransaction,
      reportedHostWatermarks,
      integrity: verified.integrity,
      evaluatedInvariants: invariantVerdict.evaluated,
      serverExecutionCount: postBootRecord.server.executionCount,
      serverAckObserved: serverAcknowledgements.has(armed.clientMutationId),
    });
  }
} finally {
  operator.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

const finishedAt = new Date();
const directory = join(demoRoot, 'evidence', runId);
await mkdir(directory, { recursive: true });
const raw = {
  schemaVersion: 'snapback.expo-sqlite-carrier-qualification.device-raw.v1',
  runId,
  seed,
  sqliteSourceId: sourceId,
  targetFacts: runtimeTargetFacts,
  protocol,
  events,
  observations,
};
const rawText = `${JSON.stringify(raw, null, 2)}\n`;
await writeFile(join(directory, 'device-events.v1.json'), rawText);
const gitRevision = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).stdout.trim();
const dirtyPaths = spawnSync('git', ['status', '--porcelain=v1'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).stdout.split('\n').filter(Boolean).map((line) => line.slice(3));
const sourcePaths = [
  'packages/snapback-client/rqs-store-sqlite.mjs',
  'packages/snapback-client/outbox-shared.mjs',
  'packages/snapback-client/rqs-store-meta.mjs',
  'packages/snapback-expo/expo-sqlite-carrier.mjs',
  'packages/snapback-expo/expo-sqlite-target.mjs',
  'packages/snapback-expo/provider.mjs',
  'demos/expo-local-first-carrier/qualification-invariants.mjs',
  'demos/expo-local-first-carrier/probe-app/App.js',
  'demos/expo-local-first-carrier/probe-app/app.json',
  'demos/expo-local-first-carrier/probe-app/package.json',
  'demos/expo-local-first-carrier/scripts/qualify.mjs',
];
const claimSourceClosure = Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [
  path,
  await hashFile(join(repoRoot, path)),
])));
const packageArtifacts = await Promise.all(requiredPackageNames.map(installedPackageArtifact));
const receipt = {
  schemaVersion: 'snapback.expo-sqlite-carrier-qualification.v1',
  verdict: incompleteReason === null && mode === 'process' ? 'supporting-pass' : incompleteReason === null ? 'candidate-needs-review' : 'incomplete',
  qualificationMode: true,
  runId,
  seed,
  skipBuild,
  supportingOnly: mode === 'process' || deviceClass !== 'real-device',
  promotionalAuthority: false,
  capabilityCells: [{
    arm: 'expo',
    carrier: 'expo-sqlite',
    profile: 'durable-fragments-v1',
    target: { ...runtimeTargetFacts, mode },
  }],
  governingLlpAnchors: [
    'LLP 0166 D1/D6/D9',
    'LLP 0043 settlement consumption and acknowledgement lifecycle',
    'LLP 0053 client fences',
    'LLP 0189 claim gating',
    'LLP 0270 D6',
  ],
  startedAt: events[0]?.at ?? null,
  finishedAt: finishedAt.toISOString(),
  git: { revision: gitRevision, dirtyPaths },
  claimSourceClosure,
  packageArtifacts,
  buildExecution: protocol.cleanBuild,
  skipBuildInstall: skipBuild ? {
    appBundlePath: appBundleRoot,
    command: redactDevice(iosSimulator
      ? ['xcrun', 'simctl', 'install', device, appBundleRoot]
      : ['xcrun', 'devicectl', 'device', 'install', 'app', '--device', device, appBundleRoot]),
  } : null,
  qualificationBuildEnvironment: protocol.qualificationBuildEnvironment,
  commandChannel: protocol.commandChannel,
  jsBundleIdentity,
  nativeBinaryIdentity,
  targetCell: {
    complete: incompleteReason === null
      && observations.filter((entry) => 'integrity' in entry).length === iterations,
    ...runtimeTargetFacts,
    mode,
    deviceIdHash: deviceIdHash(device),
    processCuts: mode === 'process' ? iterations : 0,
    powerCuts: mode === 'power' ? iterations : 0,
    phases,
  },
  sqlite: {
    version: sqliteFacts?.sqliteVersion ?? null,
    sourceId,
    compileOptions: sqliteFacts?.compileOptions ?? [],
    pragmas: sqliteFacts?.pragmas ?? null,
    databaseDirectoryClass: 'expo-application-support',
  },
  iterations: { required: iterations, completed: observations.filter((value) => 'integrity' in value).length },
  phases,
  evaluatedPostBootInvariants: expoCarrierPostBootInvariantNames,
  invariantCyclesPassed: observations.filter((entry) => 'integrity' in entry).length,
  hostPublicationWatermarks: {
    model: 'COMMIT-promise-resolution',
    reported: observations.flatMap((entry) => entry.reportedHostWatermarks ?? []).length,
    missingAfterRecovery: 0,
    observedHybridGenerations: 0,
  },
  serverExecutionSettlementIdentities: {
    clientMutationIds: serverExecutions.size,
    maxExecutionCount: Math.max(0, ...[...serverExecutions.values()].map((entry) => entry.executionCount)),
    allAcknowledged: [...serverExecutions.keys()].every((id) => serverAcknowledgements.has(id)),
    secretsPresent: false,
  },
  completeBatteryReference: {
    path: batteryReferencePath,
    sha256: batteryReferenceSha256,
    eligible: batteryReference.eligible,
    qualifiedCommit: batteryReference.qualifiedCommit,
  },
  rawLogHashes: {
    'device-events.v1.json': `sha256:${createHash('sha256').update(rawText).digest('hex')}`,
  },
  incompleteReason,
  promotionBlockers: protocol.manualPromotionLegs,
  secretScan: {
    serialNumbersIncluded: false,
    bearersIncluded: false,
    rowPayloadsIncluded: false,
    predecessorHandleKeysIncluded: false,
  },
};
await writeFile(join(directory, 'qualification.device.v1.json'), `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(`[expo-sqlite-device-qualification] ${receipt.verdict}: ${receipt.iterations.completed}/${iterations}; receipt=${join(directory, 'qualification.device.v1.json')}\n`);
