import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert, assertEqual, createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import { stopChild } from '../../../_kit/server-process.mjs';
import { SnapbackClient } from '../../../../packages/snapback-client/index.mjs';
import api from '../../snapback/generated/api.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const appRoot = resolve(repoRoot, 'demos/partiful-matrix/native/react-expo');
const serverBin = resolve(repoRoot, 'target/debug/snapback');
const androidSdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || resolve(process.env.HOME, 'Library/Android/sdk');
const adb = resolve(androidSdk, 'platform-tools/adb');
const javaHome = process.env.JAVA_HOME || '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
const deviceId = process.env.PARTITIME_IOS_DEVICE || 'E0E49A2F-54A7-4355-8EB4-D52138E3361B';
const dataPort = 18763;
const witnessPort = 18764;
const schemaManifest = JSON.parse(readFileSync(resolve(repoRoot, 'demos/partiful-matrix/snapback/generated/schema.manifest.json'), 'utf8'));
const functionsManifest = JSON.parse(readFileSync(resolve(repoRoot, 'demos/partiful-matrix/snapback/generated/functions.manifest.json'), 'utf8'));
const seed = JSON.parse(readFileSync(resolve(repoRoot, 'demos/partiful-matrix/snapback/seed.json'), 'utf8'));
const option = (name) => { const at = process.argv.indexOf(`--${name}`); return at < 0 ? null : process.argv[at + 1]; };
const platform = option('platform');
if (!['ios', 'android'].includes(platform)) throw new Error('--platform must be ios or android');
const performanceOnly = process.argv.includes('--performance-only');
if (performanceOnly && platform !== 'ios') throw new Error('--performance-only currently requires --platform ios');
const profileId = `react-expo/${platform}`;
const suite = createSuite(`partitime / ${profileId} Online profile`, { expectedChecks: performanceOnly ? 3 : 7 });
const tempRoot = mkdtempSync(resolve(tmpdir(), `partitime-${platform}-online-`));
const dbPath = resolve(tempRoot, 'snapback.sqlite3');
const readyPath = resolve(tempRoot, 'snapback.ready.json');
const events = [];
const cleanups = [() => rmSync(tempRoot, { recursive: true, force: true })];
let dataServer = null;
let activeLaunchId = null;
const sourceRoots = [
  'demos/partiful-matrix/native/react-expo',
  'demos/partiful-matrix/tests/acceptance/native-react-expo.mjs',
  'demos/partiful-matrix/snapback/generated',
  'demos/partiful-matrix/snapback/seed.json',
  'packages/snapback-client',
  'packages/snapback-react',
];
const sourcePaths = execFileSync('git', ['ls-files', '--', ...sourceRoots], {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim().split('\n').filter(Boolean).sort();
const reportExtra = {
  profileId,
  capabilityClass: 'Online',
  generatedApi: 'demos/partiful-matrix/snapback/generated/api.mjs',
  directTableWrites: false,
  localHandlerExecutionClaimed: false,
  repository: {
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    sourceDirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', ...sourceRoots], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim() !== '',
  },
  environment: hostIdentity(),
  releaseArtifact: null,
  build: { performed: false, startedAtMs: null, completedAtMs: null },
  performance: performanceOnly ? { sample: null } : null,
  events,
  sourceInventory: sourcePaths.map((path) => ({
    path,
    sha256: createHash('sha256').update(readFileSync(resolve(repoRoot, path))).digest('hex'),
  })),
};

function hostIdentity() {
  const commandText = (command, args) => {
    try {
      return execFileSync(command, args, { encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  };
  const simulatorList = JSON.parse(
    commandText('xcrun', ['simctl', 'list', 'devices', 'available', '-j'])
      ?? '{"devices":{}}',
  );
  let simulator = { udid: deviceId, available: false };
  for (const [runtime, devices] of Object.entries(simulatorList.devices)) {
    const match = devices.find((device) => device.udid === deviceId);
    if (match) {
      simulator = {
        udid: deviceId,
        name: match.name,
        state: match.state,
        runtime,
        available: match.isAvailable !== false,
      };
      break;
    }
  }
  return {
    hardware: commandText('uname', ['-m']),
    model: commandText('sysctl', ['-n', 'hw.model']),
    os: commandText('sw_vers', ['-productVersion']),
    osBuild: commandText('sw_vers', ['-buildVersion']),
    xcode: commandText('xcodebuild', ['-version'])?.split('\n') ?? null,
    node: process.version,
    bun: commandText('bun', ['--version']),
    simulator,
  };
}

const witness = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/event') {
    response.writeHead(404).end();
    return;
  }
  let body = '';
  for await (const chunk of request) body += chunk;
  try {
    const event = JSON.parse(body);
    if (activeLaunchId !== null && event.launchId !== activeLaunchId && event.event !== 'native-launch-stage') {
      response.writeHead(204).end();
      return;
    }
    events.push({ ...event, receivedAtMs: Date.now() });
    response.writeHead(204).end();
  } catch (error) {
    response.writeHead(400).end(String(error));
  }
});
await new Promise((resolveListen, rejectListen) => {
  witness.once('error', rejectListen);
  witness.listen(witnessPort, '0.0.0.0', resolveListen);
});
cleanups.push(() => new Promise((resolveClose) => witness.close(resolveClose)));

await runAcceptance(suite, async () => {
  await stopInstalledCarrier();
  events.length = 0;
  reportExtra.build.startedAtMs = Date.now();
  await buildCarrier();
  reportExtra.build.completedAtMs = Date.now();
  reportExtra.build.performed = true;
  const artifact = carrierArtifact();
  reportExtra.releaseArtifact = digestArtifact(artifact);

  await suite.check(`${profileId} builds a release carrier`, async () => {
    assert(existsSync(artifact), `missing carrier artifact ${artifact}`);
    assert(reportExtra.build.performed, 'native receipt requires an in-process release rebuild');
    assert(!reportExtra.repository.sourceDirty, 'native receipt refuses uncommitted carrier/build inputs');
    assert(reportExtra.sourceInventory.length > 0, 'native receipt requires a hashed source inventory');
    assert(reportExtra.releaseArtifact?.sha256, 'native receipt requires a release artifact digest');
  });

  dataServer = await startDataServer();
  cleanups.push(async () => { if (dataServer) await stopChild(dataServer); });
  await installCarrier(artifact);
  const launchRequest = await launchCarrier();

  const launch = await waitEvent('device-launch');
  activeLaunchId = launch.launchId;
  const activeLaunchEvents = events.filter((event) => event.launchId === activeLaunchId || event.event === 'native-launch-stage');
  events.splice(0, events.length, ...activeLaunchEvents);
  const fromLaunch = (event) => event.launchId === activeLaunchId;
  const providerReady = await waitEvent('provider-ready', fromLaunch);
  const initialSnapshot = await waitEvent(
    'authoritative-snapshot',
    (event) => fromLaunch(event) && event.details.userId === 'user_eve' && event.details.rowCount > 0,
  );
  const initial = await waitEvent('initial-authoritative', fromLaunch);
  await suite.check(`${profileId} launches generated-function Online data on-device`, async () => {
    assertEqual(launch.profileId, profileId, 'launch profile');
    assertEqual(launch.capabilityClass, 'Online', 'capability class');
    assert(providerReady.atMs >= launch.atMs, 'provider readiness follows launch');
    assert(initialSnapshot.details.deliverySequence > 0, JSON.stringify(initialSnapshot));
    assert(initial.details.rowCount > 0, JSON.stringify(initial));
  });

  if (performanceOnly) {
    const nativeStage = await waitEvent('native-launch-stage');
    const startupAssets = digestStartupAssets(artifact);
    reportExtra.performance.sample = {
      definitionVersion: 'partitime.native-launch-stage.v2',
      lane: {
        laneId: 'partitime.native-ios-release-simulator-hbc-agent-off.v1',
        buildConfiguration: 'Release',
        simulatorBuild: true,
        artifactMode: 'hermes-hbc',
        agentLoadedBeforeFirstFrame: false,
        debugOverlayEnabled: false,
        firstFrameObserver: 'native-host',
        authoritativeDataObserver: 'structured-product-marker',
      },
      hermesEvaluationMs: nativeStage.details.hermesEvaluationMs,
      startupAssetWeightBytes: startupAssets.sizeBytes,
      coldLaunchMs: launch.atMs - launchRequest.requestedAtMs,
      firstAuthoritativeDataMs: initial.atMs - launchRequest.requestedAtMs,
      launchRequest,
      events: {
        nativeStageAtMs: nativeStage.atMs,
        deviceLaunchAtMs: launch.atMs,
        firstAuthoritativeAtMs: initial.atMs,
      },
      startupAssets,
    };
    await suite.check(`${profileId} records comparable native launch stages`, async () => {
      for (const name of ['hermesEvaluationMs', 'startupAssetWeightBytes', 'coldLaunchMs', 'firstAuthoritativeDataMs']) {
        assert(Number.isFinite(reportExtra.performance.sample[name]) && reportExtra.performance.sample[name] >= 0, JSON.stringify(reportExtra.performance.sample));
      }
      assert(startupAssets.files.length > 0, 'release carrier has no admitted JavaScript/Hermes startup asset');
      assertEqual(
        nativeStage.details.definitionVersion,
        'partitime.native-launch-stage.v2',
        'native launch-stage method',
      );
    });
    return;
  }

  const optimisticPending = await waitEvent('optimistic-pending', fromLaunch);
  const optimisticConfirmed = await waitEvent('optimistic-confirmed', fromLaunch);
  const optimisticAuthoritative = await waitEvent('optimistic-authoritative', fromLaunch);
  await suite.check(`${profileId} exposes optimistic pending and authoritative settlement`, async () => {
    assertEqual(optimisticPending.details.rendered, true, 'optimistic row rendered while pending');
    assert(optimisticConfirmed.atMs >= optimisticPending.atMs, 'confirmation follows pending');
    assert(optimisticAuthoritative.atMs >= optimisticConfirmed.atMs, 'authoritative reconciliation follows confirmation');
    assertEqual(optimisticAuthoritative.details.hostId, 'user_eve', 'committed row authority');
    assert(optimisticAuthoritative.details.rowId !== 'optimistic-native-event', 'authoritative row replaces optimistic identity');
  });

  const authMutationPending = await waitEvent('auth-mutation-pending', fromLaunch);
  const authMutationConfirmed = await waitEvent('auth-mutation-confirmed', fromLaunch);
  const authResumed = await waitEvent('auth-resumed', fromLaunch);
  await suite.check(`${profileId} rotates authority and resumes from a fresh generated query`, async () => {
    assert(authMutationConfirmed.atMs >= authMutationPending.atMs, 'successor-authority mutation settles after pending');
    assertEqual(authResumed.details.userId, 'user_ada', 'resumed authority');
    assertEqual(authResumed.details.hostId, 'user_ada', 'server-authored row uses successor authority');
    assert(authResumed.details.rowCount > 0, JSON.stringify(authResumed));
  });

  const lifecycleStart = events.length;
  await backgroundAndForeground();
  const background = await waitEvent('app-state', (event) => fromLaunch(event) && event.details.state === 'background', lifecycleStart);
  const quiesced = await waitEvent('provider-quiesced', fromLaunch, lifecycleStart);
  const foreground = await waitEvent('app-state', (event) => fromLaunch(event) && event.details.state === 'active' && event.receivedAtMs >= background.receivedAtMs, lifecycleStart);
  const resumed = await waitEvent('provider-resumed', fromLaunch, lifecycleStart);
  await suite.check(`${profileId} witnesses OS background and foreground lifecycle`, async () => {
    assert(foreground.receivedAtMs >= background.receivedAtMs, 'foreground follows background');
    assert(quiesced.receivedAtMs <= foreground.receivedAtMs, 'provider quiesces before foreground resume');
    assertEqual(quiesced.details.activeHandles, 0, 'background closes transport handles');
    assert(resumed.receivedAtMs >= foreground.receivedAtMs, 'provider resumes after foreground');
    assert(resumed.details.activeHandles > 0, JSON.stringify(resumed));
  });

  const reconnectStart = events.length;
  const deliveryBeforeReconnect = Math.max(
    ...events.filter((event) => fromLaunch(event) && event.event === 'authoritative-snapshot')
      .map((event) => event.details.deliverySequence),
  );
  await stopChild(dataServer);
  dataServer = null;
  const offline = await waitEvent('connection', (event) => fromLaunch(event) && ['stale', 'disconnected'].includes(event.details.value), reconnectStart, 35_000);
  dataServer = await startDataServer();
  const reconnectSentinelTitle = `Reconnect Sentinel ${platform} ${Date.now()}`;
  const reconnectWriter = new SnapbackClient(`http://127.0.0.1:${dataPort}`);
  await reconnectWriter.mutate(api.createEvent, {
    userId: 'user_ada',
    args: {
      title: reconnectSentinelTitle,
      emoji: '🔁',
      description: 'Authoritative reconnect convergence sentinel',
      location: 'Acceptance host',
      startsAt: Date.now() + 180_000,
      hostName: 'Ada',
      accent: 'tangerine',
    },
  });
  // A restarted server invalidates both the socket and its in-memory
  // connection grant. The native carrier must witness the full stale-grant
  // refresh plus a fresh subscription, and slower emulators can consume most
  // of one freshness-budget cycle before reporting that sequence.
  const reconnected = await waitEvent('connection', (event) => fromLaunch(event) && event.details.value === 'live' && event.receivedAtMs >= offline.receivedAtMs, reconnectStart, 65_000);
  const reconnectSnapshot = await waitEvent(
    'authoritative-snapshot',
    (event) => fromLaunch(event)
      && event.receivedAtMs >= offline.receivedAtMs
      && event.details.deliverySequence > deliveryBeforeReconnect
      && event.details.rowTitles?.includes(reconnectSentinelTitle),
    reconnectStart,
    65_000,
  );
  await suite.check(`${profileId} retains the prior snapshot offline and reconnects`, async () => {
    assert(offline.details.rowCount > 0, `offline render lost its previous rows: ${JSON.stringify(offline)}`);
    assert(reconnected.details.rowCount > 0, `reconnect lacked authoritative rows: ${JSON.stringify(reconnected)}`);
    assert(reconnectSnapshot.details.rowCount > 0, `reconnect emitted no fresh authoritative snapshot: ${JSON.stringify(reconnectSnapshot)}`);
  });

  await suite.check(`${profileId} release artifact excludes Snapback server code`, async () => {
    const packageManifest = readFileSync(resolve(appRoot, 'package.json'), 'utf8');
    assert(!packageManifest.includes('snapback-server'), packageManifest);
    const inspectionRoot = platform === 'android'
      ? resolve(tempRoot, 'release-artifact')
      : artifact;
    if (platform === 'android') {
      // Android release APKs may legitimately contain duplicate resource
      // entry names. Extract deterministically without an interactive prompt;
      // the payload scan still visits the resulting complete file set.
      execFileSync('unzip', ['-oq', artifact, '-d', inspectionRoot]);
    }
    const dependencyGraph = platform === 'android'
      ? execFileSync(resolve(appRoot, 'android/gradlew'), [
        ':app:dependencies', '--configuration', 'releaseRuntimeClasspath', '--no-daemon', '--max-workers=4',
      ], {
        cwd: resolve(appRoot, 'android'),
        env: { ...process.env, JAVA_HOME: javaHome },
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      })
      : readFileSync(resolve(appRoot, 'ios/Podfile.lock'), 'utf8');
    const forbidden = [
      'snapback-server',
      'snapback_server',
      'src/server.rs',
      'LocalSnapback',
      '__snapbackHandlers',
      'IbexModule',
    ];
    for (const marker of forbidden) {
      assert(!dependencyGraph.includes(marker), `release dependency graph contains server-only marker ${marker}`);
    }
    for (const file of artifactFiles(inspectionRoot)) {
      const payload = readFileSync(file);
      for (const marker of forbidden) {
        assert(payload.indexOf(marker) < 0, `release payload ${file} contains server-only marker ${marker}`);
      }
    }
  });
}, {
  cleanups,
  reportFile: option('receipt'),
  reportExtra,
});

async function buildCarrier() {
  if (platform === 'android') {
    await run('android release build', resolve(appRoot, 'android'), resolve(appRoot, 'android/gradlew'), [
      ':app:assembleRelease', '--no-daemon', '--max-workers=4',
    ], { JAVA_HOME: javaHome });
    return;
  }
  await run('iOS simulator release build', appRoot, 'xcodebuild', [
    '-quiet',
    '-workspace', 'ios/PartitimeNativeOnline.xcworkspace',
    '-scheme', 'PartitimeNativeOnline',
    '-configuration', 'Release',
    '-sdk', 'iphonesimulator',
    '-destination', `platform=iOS Simulator,id=${deviceId}`,
    '-derivedDataPath', 'build/ios-profile-derived',
    'CODE_SIGNING_ALLOWED=NO',
    'build',
  ]);
}

function carrierArtifact() {
  if (platform === 'android') return resolve(appRoot, 'android/app/build/outputs/apk/release/app-release.apk');
  return resolve(appRoot, 'build/ios-profile-derived/Build/Products/Release-iphonesimulator/PartitimeNativeOnline.app');
}

async function installCarrier(artifact) {
  if (platform === 'android') {
    await run('adb reverse data', appRoot, adb, ['reverse', `tcp:${dataPort}`, `tcp:${dataPort}`]);
    await run('adb reverse witness', appRoot, adb, ['reverse', `tcp:${witnessPort}`, `tcp:${witnessPort}`]);
    await run('adb install', appRoot, adb, ['install', '-r', artifact]);
    return;
  }
  await run('simulator install', appRoot, 'xcrun', ['simctl', 'install', deviceId, artifact]);
}

async function launchCarrier() {
  const requestedAtMs = Date.now();
  if (platform === 'android') {
    await run('adb launch', appRoot, adb, ['shell', 'am', 'start', '-W', '-n', 'com.snapback.partitime.nativeonline/.MainActivity']);
  } else {
    await run('simulator launch', appRoot, 'xcrun', ['simctl', 'launch', deviceId, 'com.snapback.partitime.nativeonline']);
  }
  return { requestedAtMs, commandCompletedAtMs: Date.now() };
}

async function stopInstalledCarrier() {
  try {
    if (platform === 'android') {
      await run('adb stop prior carrier', appRoot, adb, ['shell', 'am', 'force-stop', 'com.snapback.partitime.nativeonline']);
      return;
    }
    await run('simulator stop prior carrier', appRoot, 'xcrun', ['simctl', 'terminate', deviceId, 'com.snapback.partitime.nativeonline']);
  } catch {
    // A first run has no installed/running predecessor to stop.
  }
}

async function backgroundAndForeground() {
  if (platform === 'android') {
    await run('adb background', appRoot, adb, ['shell', 'input', 'keyevent', '3']);
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
    await run('adb foreground', appRoot, adb, ['shell', 'am', 'start', '-W', '-n', 'com.snapback.partitime.nativeonline/.MainActivity']);
    return;
  }
  // @ref LLP 0063#workstream-2--first-class-react-expo-and-vanilla-projections —
  // Exercise the simulator's application lifecycle without depending on GUI
  // focus or macOS Accessibility permission for a synthetic Home shortcut.
  await run('simulator background', appRoot, 'xcrun', [
    'simctl', 'launch', '--terminate-running-process', deviceId, 'com.apple.Preferences',
  ]);
  await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  await run('simulator foreground', appRoot, 'xcrun', ['simctl', 'launch', deviceId, 'com.snapback.partitime.nativeonline']);
}

async function startDataServer() {
  const child = spawn(serverBin, ['--host', '127.0.0.1', '--port', String(dataPort), '--db', dbPath, '--ready-file', readyPath], {
    cwd: repoRoot,
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Snapback exited ${child.exitCode}: ${stderr.slice(-2000)}`);
    let healthy = false;
    try {
      const response = await fetch(`http://127.0.0.1:${dataPort}/health`, { signal: AbortSignal.timeout(500) });
      healthy = response.ok;
    } catch { /* keep waiting */ }
    if (healthy) {
      try {
        // The database is durable across this test restart, while the server's
        // executable function registry is intentionally process-local. Model
        // deployment startup before returning the new process to the device.
        const deployer = new SnapbackClient(`http://127.0.0.1:${dataPort}`);
        await deployer.ensureApp({ schema: schemaManifest, functions: functionsManifest, seed });
        return child;
      } catch (error) {
        await stopChild(child);
        throw new Error(`Snapback app deployment failed after restart: ${error.message}`, { cause: error });
      }
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Snapback did not become ready: ${stderr.slice(-2000)}`);
}

async function waitEvent(name, predicate = () => true, startIndex = 0, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = events.slice(startIndex).find((event) => event.event === name && predicate(event));
    if (match) return match;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`timed out waiting for ${name}: ${JSON.stringify(events.slice(startIndex), null, 2)}`);
}

function run(label, cwd, command, args, extraEnv = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', rejectRun);
    child.on('close', (code) => {
      if (code === 0) resolveRun(output);
      else rejectRun(new Error(`${label} exited ${code}: ${output.slice(-4000)}`));
    });
  });
}

function artifactFiles(root) {
  if (!statSync(root).isDirectory()) return [root];
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return files;
}

function digestArtifact(artifact) {
  const files = artifactFiles(artifact);
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for (const file of files.sort()) {
    const payload = readFileSync(file);
    const path = relative(artifact, file) || relative(repoRoot, file);
    const framedPath = Buffer.from(path);
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(payload.length));
    hash.update(Buffer.from([0x01]));
    hash.update(framedPath);
    hash.update(Buffer.from([0x00]));
    hash.update(length);
    hash.update(payload);
    sizeBytes += payload.length;
  }
  return {
    path: relative(repoRoot, artifact),
    kind: statSync(artifact).isDirectory() ? 'directory' : 'file',
    files: files.length,
    sizeBytes,
    sha256: hash.digest('hex'),
  };
}

function digestStartupAssets(artifact) {
  const files = artifactFiles(artifact)
    .filter((file) => /(?:main\.jsbundle|\.hbc)$/i.test(file))
    .sort();
  return {
    files: files.map((file) => ({
      path: relative(artifact, file) || relative(repoRoot, file),
      sizeBytes: statSync(file).size,
      sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
    })),
    sizeBytes: files.reduce((sum, file) => sum + statSync(file).size, 0),
  };
}
