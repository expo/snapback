#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { freePort } from '../../../_kit/provenance.mjs';
import { writeMachineReport } from '../../../_kit/harness.mjs';

// @ref LLP 0063#workstream-8--performance-and-packaging-budgets — the Exact
// native cost row is sampled from the same Release/Simulator/Hermes lane as
// React Expo. The product HBC owns its first-authoritative-data marker; Acto,
// the Exact dev server, and debug overlays are absent from the launch path.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const demoRoot = resolve(here, '../..');
const appRoot = resolve(demoRoot, 'native/exact-contract');
const serverBin = resolve(repoRoot, 'target/debug/snapback');
const observerAmendmentPath = resolve(
  demoRoot,
  'acceptance/native-performance-observer-amendment.2026-07-23.json',
);
const observerAmendment = JSON.parse(readFileSync(observerAmendmentPath, 'utf8'));
const option = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? null : process.argv[at + 1];
};
const quick = process.argv.includes('--quick');
const exactRoot = resolve(
  option('exact-root')
    ?? process.env.EXACT_ROOT
    ?? resolve(repoRoot, '../exact'),
);
const exactProject = resolve(
  option('exact-project')
    ?? resolve(exactRoot, 'ios/ExactApp/ExactApp.xcodeproj'),
);
const deviceId = option('device')
  ?? process.env.PARTITIME_IOS_DEVICE
  ?? 'E0E49A2F-54A7-4355-8EB4-D52138E3361B';
const receiptPath = resolve(
  option('receipt')
    ?? resolve(demoRoot, 'acceptance/results/step4-native-exact-performance.json'),
);
const derivedRoot = resolve(
  option('derived-root')
    ?? resolve(tmpdir(), 'partitime-native-exact-performance-derived'),
);
const buildTimeoutMs = Number(option('build-timeout-ms') ?? 1_200_000);
const launchTimeoutMs = Number(option('launch-timeout-ms') ?? 45_000);
const bytecodeName = 'partitime-ws8';
const nativeBundleConfig = resolve(appRoot, 'vite.native-performance.config.mjs');
const hermesCompiler = resolve(exactRoot, 'tools/hermes/hermesc-macos-arm64');
const generatedHydrationDescriptor = resolve(
  appRoot,
  'public/__exact/hydration-build-descriptors.json',
);
const hydrationDescriptorBytesAtStart = existsSync(generatedHydrationDescriptor)
  ? readFileSync(generatedHydrationDescriptor)
  : null;
const stagedHbcPath = resolve(
  exactRoot,
  `ios/ExactApp/ExactApp/Resources/bytecode/${bytecodeName}.hbc`,
);
const lane = {
  laneId: 'partitime.native-ios-release-simulator-hbc-agent-off.v1',
  buildConfiguration: 'Release',
  simulatorBuild: true,
  artifactMode: 'hermes-hbc',
  agentLoadedBeforeFirstFrame: false,
  debugOverlayEnabled: false,
  firstFrameObserver: 'native-host',
  authoritativeDataObserver: 'structured-product-marker',
};
const observerId = observerAmendment.observer.id;
assert.equal(
  observerAmendment.requiredRatificationStatement,
  'I ratify partitime-ws8-native-observer-v3-2026-07-23.',
  'native observer ratification statement drifted',
);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const cleanups = [];
const cleanupErrors = [];
const report = {
  schemaVersion: 'partitime.native-exact-performance-receipt.v2',
  profileId: 'exact-contract/ios',
  claimId: quick ? null : 'STEP4.BUDGETS.NATIVE_PERFORMANCE',
  claimEligible: !quick,
  quick,
  recordedAt: new Date().toISOString(),
  ok: false,
  outcome: 'fail',
  repository: { sourceDirty: true },
  source: {},
  environment: hostIdentity(),
  lane,
  observer: {
    amendment: {
      path: relative(repoRoot, observerAmendmentPath),
      sha256: sha256(readFileSync(observerAmendmentPath)),
      status: observerAmendment.status,
    },
    id: observerId,
    claimUseAuthorized: observerAmendment.status === 'ratified',
    build: null,
    runtime: null,
  },
  build: null,
  productionBundle: null,
  hbcCompile: null,
  startupArtifact: null,
  releaseArtifact: null,
  performance: { sample: null },
  cleanupErrors,
};

try {
  assert(existsSync(serverBin), `missing Snapback server ${serverBin}`);
  if (!quick) {
    assert.equal(
      observerAmendment.status,
      'ratified',
      'native performance observer amendment must be ratified before claim sampling',
    );
    assert.equal(
      observerAmendment.ratificationStatement,
      observerAmendment.requiredRatificationStatement,
      'native observer sampling requires the exact owner ratification statement',
    );
  }
  assert(existsSync(exactProject), `missing Exact Xcode project ${exactProject}`);
  assert(existsSync(nativeBundleConfig), `missing native production bundle config ${nativeBundleConfig}`);
  assert(existsSync(hermesCompiler), `missing Exact Hermes compiler ${hermesCompiler}`);
  assert(!existsSync(stagedHbcPath), `refusing to overwrite staged source artifact ${stagedHbcPath}`);
  if (hydrationDescriptorBytesAtStart === null) {
    cleanups.push(function removeGeneratedHydrationDescriptor() {
      rmSync(generatedHydrationDescriptor, { force: true });
    });
  }
  assert(Number.isFinite(buildTimeoutMs) && buildTimeoutMs > 0, '--build-timeout-ms must be positive');
  assert(Number.isFinite(launchTimeoutMs) && launchTimeoutMs > 0, '--launch-timeout-ms must be positive');

  const snapbackBefore = workingTreeIdentity(repoRoot);
  const exactBefore = workingTreeIdentity(exactRoot);
  report.source = { snapback: snapbackBefore, exact: exactBefore };
  report.repository.sourceDirty = snapbackBefore.dirty || exactBefore.dirty;
  if (!quick) {
    assert.equal(report.repository.sourceDirty, false, 'claim sampling requires clean Snapback and Exact sources');
  }

  ensureExactPackageLinks();
  if (!existsSync(resolve(appRoot, 'node_modules/@exact/runtime/package.json'))) {
    const install = await run('bun', ['install', '--frozen-lockfile'], {
      cwd: appRoot,
      env: {
        ...process.env,
        EXACT_ROOT: exactRoot,
      },
      timeoutMs: 300_000,
    });
    assert.equal(install.status, 0, `Exact app dependency install failed: ${install.stderrTail.join('\n')}`);
    ensureExactPackageLinks();
  }

  const snapback = await startSnapback();
  cleanups.push(() => snapback.stop());
  const gateway = await startGateway(snapback.origin);
  cleanups.push(() => gateway.stop());
  report.backendHealth = gateway.preflight;

  const witness = await startWitness();
  cleanups.push(() => witness.stop());

  const startup = await buildProductionArtifact(gateway.origin, witness.origin);
  report.startupArtifact = startup.report;
  mkdirSync(dirname(stagedHbcPath), { recursive: true });
  writeFileSync(stagedHbcPath, startup.hbc);
  cleanups.push(function removeStagedHbc() {
    rmSync(stagedHbcPath, { force: true });
  });

  const buildStartedAtMs = Date.now();
  const build = await run('xcodebuild', [
    '-quiet',
    '-project', exactProject,
    '-scheme', 'ExactApp',
    '-configuration', 'Release',
    '-destination', `platform=iOS Simulator,id=${deviceId}`,
    '-derivedDataPath', derivedRoot,
    '-jobs', '8',
    'CODE_SIGNING_ALLOWED=NO',
    'COMPILER_INDEX_STORE_ENABLE=NO',
    'ONLY_ACTIVE_ARCH=YES',
    'ARCHS=arm64',
    'ASSETCATALOG_COMPILER_APPICON_NAME=',
    'SWIFT_ACTIVE_COMPILATION_CONDITIONS=$(inherited) EXACT_PARTITIME_NATIVE_PERFORMANCE_OBSERVER',
    'build',
  ], {
    cwd: exactRoot,
    env: {
      ...process.env,
      EXACT_PARTITIME_NATIVE_PERFORMANCE_OBSERVER: '1',
    },
    timeoutMs: buildTimeoutMs,
  });
  report.build = {
    performed: true,
    configuration: 'Release',
    simulatorBuild: true,
    startedAtMs: buildStartedAtMs,
    completedAtMs: Date.now(),
    status: build.status,
    timedOut: build.timedOut,
    stdoutSha256: build.stdoutSha256,
    stderrSha256: build.stderrSha256,
    stdoutTail: build.stdoutTail,
    stderrTail: build.stderrTail,
  };
  assert.equal(build.status, 0, `Exact Release build failed: ${build.stderrTail.join('\n')}`);
  const runtimeBuildStamp = resolve(
    exactRoot,
    'ios/GeneratedLibs/libexact_runtime-sim.a.build-stamp',
  );
  assert(existsSync(runtimeBuildStamp), 'Exact observer build omitted the runtime archive stamp');
  const runtimeBuildStampBytes = readFileSync(runtimeBuildStamp);
  const runtimeBuildStampText = runtimeBuildStampBytes.toString('utf8');
  assert.match(
    runtimeBuildStampText,
    /^features=--no-default-features --features standard,host-http-server,capsec-simulator-performance-observer$/m,
    'linked Exact runtime archive was not built with the simulator performance observer',
  );
  report.observer.build = {
    exactEnvironment: 'EXACT_PARTITIME_NATIVE_PERFORMANCE_OBSERVER=1',
    swiftCompileCondition: 'EXACT_PARTITIME_NATIVE_PERFORMANCE_OBSERVER',
    cargoFeature: observerAmendment.observer.ibexCargoFeature,
    archiveStampPath: relative(exactRoot, runtimeBuildStamp),
    archiveStampSha256: sha256(runtimeBuildStampBytes),
    featureBound: true,
  };

  rmSync(stagedHbcPath, { force: true });
  const app = resolve(
    derivedRoot,
    'Build/Products/Release-iphonesimulator/ExactApp.app',
  );
  assert(existsSync(app), `missing Exact Release carrier ${app}`);
  const bundledHbc = findFile(app, `${bytecodeName}.hbc`);
  assert(bundledHbc, `Release carrier omitted ${bytecodeName}.hbc`);
  assert.equal(
    sha256(readFileSync(bundledHbc)),
    startup.report.hbc.sha256,
    'Release carrier HBC differs from the admitted startup artifact',
  );
  report.releaseArtifact = digestArtifact(app);

  const exactAfterBuild = workingTreeIdentity(exactRoot);
  const snapbackAfterBuild = workingTreeIdentity(repoRoot);
  report.source.exactAfterBuild = exactAfterBuild;
  report.source.snapbackAfterBuild = snapbackAfterBuild;
  assert.deepEqual(exactAfterBuild, exactBefore, 'Exact source changed while building the Release carrier');
  assert.deepEqual(
    snapbackAfterBuild,
    snapbackBefore,
    'Snapback source changed while building the Release carrier',
  );

  const bundleId = plistValue(resolve(app, 'Info.plist'), 'CFBundleIdentifier');
  assert(bundleId, 'Exact Release carrier has no CFBundleIdentifier');
  const install = await run('xcrun', ['simctl', 'install', deviceId, app], {
    timeoutMs: 60_000,
  });
  assert.equal(install.status, 0, `could not install Exact Release carrier: ${install.stderrTail.join('\n')}`);
  cleanups.push(async function uninstallExactCarrier() {
    const result = await run('xcrun', ['simctl', 'uninstall', deviceId, bundleId], {
      timeoutMs: 60_000,
    });
    if (result.status !== 0) {
      throw new Error(`could not uninstall Exact carrier: ${result.stderrTail.join('\n')}`);
    }
  });

  const measured = await collectLaunch({
    bundleId,
    witness,
    startupAssetWeightBytes: startup.hbc.byteLength,
  });
  report.observer.runtime = measured.observer;
  report.performance.sample = {
    definitionVersion: 'partitime.native-launch-stage.v2',
    lane,
    ...measured.metrics,
    launchRequest: measured.launchRequest,
    events: measured.events,
    startupAssets: [{
      path: relative(app, bundledHbc),
      sizeBytes: statSync(bundledHbc).size,
      sha256: sha256(readFileSync(bundledHbc)),
    }],
    productMarker: measured.productMarker,
    candidateObserver: {
      id: observerId,
      targetAdvertisementSubstituted: true,
      rootLoopbackFetchSubstituted: true,
      ordinaryAbiPreserved: observerAmendment.observer.ordinaryAbiPreserved,
      runtimeMarkers: measured.observer.markers,
      diagnosticRuntimeObserved: measured.observer.diagnosticRuntimeObserved,
      agentObservedBeforeFirstFrame: measured.observer.agentObservedBeforeFirstFrame,
    },
  };
  for (const name of [
    'hermesEvaluationMs',
    'startupAssetWeightBytes',
    'coldLaunchMs',
    'firstAuthoritativeDataMs',
  ]) {
    assert(
      Number.isFinite(report.performance.sample[name])
        && report.performance.sample[name] >= 0,
      `invalid ${name}: ${report.performance.sample[name]}`,
    );
  }
  assert.equal(measured.productMarker.schemaVersion, 'partitime.native-product-marker.v1');
  assert.equal(measured.productMarker.event, 'first-authoritative-data');
  assert.equal(measured.productMarker.profileId, 'exact-contract/ios');
  assert.equal(measured.productMarker.details?.backend, 'snapback');
  assert(measured.productMarker.details?.rowCount > 0, 'authoritative marker has no product rows');
  assert.equal(measured.observer.markers.ibexAuthenticatedSubstitution, true);
  assert.equal(measured.observer.markers.ibexLoopbackFetchSubstituted, true);
  assert.equal(measured.observer.markers.ibexPostureVerified, true);
  assert.equal(measured.observer.markers.exactObserverEnabled, true);
  assert.equal(measured.observer.markers.exactObserverRuntimeCreated, true);
  assert.equal(measured.observer.markers.exactCarrierDispatchInstalled, true);
  assert.equal(measured.observer.diagnosticRuntimeObserved, false);
  assert.equal(measured.observer.agentObservedBeforeFirstFrame, false);

  const exactAfterRun = workingTreeIdentity(exactRoot);
  const snapbackAfterRun = workingTreeIdentity(repoRoot);
  report.source.exactAfterRun = exactAfterRun;
  report.source.snapbackAfterRun = snapbackAfterRun;
  assert.deepEqual(exactAfterRun, exactBefore, 'Exact source changed during native sampling');
  assert.deepEqual(snapbackAfterRun, snapbackBefore, 'Snapback source changed during native sampling');
  report.ok = true;
  report.outcome = 'pass';
} catch (error) {
  report.error = error instanceof Error ? error.stack ?? error.message : String(error);
} finally {
  rmSync(stagedHbcPath, { force: true });
  for (const cleanup of cleanups.reverse()) {
    try {
      await cleanup();
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (cleanupErrors.length > 0) {
    report.ok = false;
    report.outcome = 'fail';
  }
  writeMachineReport(receiptPath, report);
}

console.log(JSON.stringify(report));
process.exit(report.ok ? 0 : 1);

function hostIdentity() {
  return {
    hardware: commandText('uname', ['-m']),
    model: commandText('sysctl', ['-n', 'hw.model']),
    os: commandText('sw_vers', ['-productVersion']),
    osBuild: commandText('sw_vers', ['-buildVersion']),
    xcode: commandText('xcodebuild', ['-version'])?.split('\n') ?? null,
    node: process.version,
    bun: commandText('bun', ['--version']),
    simulator: simulatorIdentity(deviceId),
  };
}

function simulatorIdentity(udid) {
  const result = spawnSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return { udid, available: false };
  const devices = JSON.parse(result.stdout).devices;
  for (const [runtime, entries] of Object.entries(devices)) {
    const match = entries.find((device) => device.udid === udid);
    if (match) {
      return {
        udid,
        name: match.name,
        state: match.state,
        runtime,
        available: match.isAvailable !== false,
      };
    }
  }
  return { udid, available: false };
}

function workingTreeIdentity(root) {
  const revision = commandText('git', ['rev-parse', 'HEAD'], { cwd: root });
  assert(revision, `cannot read git revision under ${root}`);
  const status = spawnSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(status.status, 0, `cannot read git status under ${root}`);
  const paths = status.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3))
    .sort();
  return {
    revision,
    dirty: paths.length > 0,
    dirtyPaths: paths,
    statusSha256: sha256(status.stdout),
  };
}

function ensureExactPackageLinks() {
  const links = JSON.parse(
    readFileSync(resolve(appRoot, 'exact.links.json'), 'utf8'),
  );
  for (const [name, configuredTarget] of Object.entries(links)) {
    const marker = '/exact/';
    const normalized = configuredTarget.replaceAll('\\', '/');
    const markerAt = normalized.lastIndexOf(marker);
    assert(
      markerAt >= 0,
      `Exact link ${name} does not identify an Exact-root-relative package`,
    );
    const target = resolve(exactRoot, normalized.slice(markerAt + marker.length));
    assert(
      existsSync(resolve(target, 'package.json')),
      `Exact link ${name} has no package under selected Exact root: ${target}`,
    );
    const linkPath = resolve(appRoot, 'node_modules', name);
    mkdirSync(dirname(linkPath), { recursive: true });
    rmSync(linkPath, { recursive: true, force: true });
    symlinkSync(target, linkPath, 'dir');
  }
}

async function startSnapback() {
  const root = mkdtempSync(resolve(tmpdir(), 'partitime-native-performance-snapback-'));
  const ready = resolve(root, 'ready.json');
  const child = spawn(serverBin, ['--port', '0', '--memory', '--ready-file', ready], {
    cwd: repoRoot,
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Snapback exited before readiness: ${stderr.slice(-2000)}`);
    if (existsSync(ready)) {
      const descriptor = JSON.parse(readFileSync(ready, 'utf8'));
      return {
        origin: `http://127.0.0.1:${descriptor.port}`,
        stop: async () => {
          await stopChild(child);
          rmSync(root, { recursive: true, force: true });
        },
      };
    }
    await sleep(100);
  }
  throw new Error(`Snapback readiness timed out: ${stderr.slice(-2000)}`);
}

async function startGateway(snapbackOrigin) {
  const port = await freePort();
  const child = spawn('bun', ['run', 'server.ts'], {
    cwd: resolve(demoRoot, 'backends/gateway'),
    detached: true,
    env: {
      ...process.env,
      PARTIFUL_MATRIX_GATEWAY_PORT: String(port),
      PARTIFUL_MATRIX_SNAPBACK_ORIGIN: snapbackOrigin,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const origin = `http://127.0.0.1:${port}`;
  await waitForUrl(`${origin}/health`, child, () => output, 30_000);
  const response = await fetch(`${origin}/preflight`, {
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.ok, true, `gateway preflight returned HTTP ${response.status}`);
  const preflight = await response.json();
  assert.equal(preflight.backends?.snapback?.ok, true, 'Snapback gateway preflight failed');
  return { origin, preflight, stop: () => stopChild(child) };
}

async function startWitness() {
  const events = [];
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/event') {
      response.writeHead(404).end();
      return;
    }
    let body = '';
    for await (const chunk of request) body += chunk;
    try {
      events.push({ payload: JSON.parse(body), receivedAtMs: Date.now() });
      response.writeHead(204).end();
    } catch (error) {
      response.writeHead(400).end(String(error));
    }
  });
  const port = await freePort();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, '0.0.0.0', resolveListen);
  });
  return {
    origin: `http://127.0.0.1:${port}`,
    events,
    clear: () => events.splice(0, events.length),
    stop: () => new Promise((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose());
    }),
  };
}

async function buildProductionArtifact(gatewayOrigin, witnessOrigin) {
  const outputRoot = mkdtempSync(resolve(tmpdir(), 'partitime-native-production-bundle-'));
  cleanups.push(function removeProductionBundleScratch() {
    rmSync(outputRoot, { recursive: true, force: true });
  });
  const viteCli = resolve(
    appRoot,
    'node_modules/@exact/devtools/src/scripts/vite-cli.mjs',
  );
  const build = await run(process.execPath, [
    viteCli,
    'build',
    '--config',
    nativeBundleConfig,
  ], {
    cwd: appRoot,
    env: {
      ...process.env,
      EXACT_AGENT_BOOT: '0',
      PARTITIME_BACKEND: 'snapback',
      PARTITIME_GATEWAY_ORIGIN: gatewayOrigin,
      PARTITIME_PERFORMANCE_WITNESS_ORIGIN: witnessOrigin,
      PARTITIME_NATIVE_BUNDLE_OUT: outputRoot,
    },
    timeoutMs: 300_000,
  });
  assert.equal(
    build.status,
    0,
    `Exact production Rollup build failed: ${build.stderrTail.join('\n')}`,
  );
  if (hydrationDescriptorBytesAtStart === null) {
    rmSync(generatedHydrationDescriptor, { force: true });
  } else {
    assert(
      existsSync(generatedHydrationDescriptor),
      'Exact production build removed the committed hydration descriptor',
    );
    assert.deepEqual(
      readFileSync(generatedHydrationDescriptor),
      hydrationDescriptorBytesAtStart,
      'Exact production build changed the committed hydration descriptor',
    );
  }

  const sourcePath = resolve(outputRoot, 'partitime-native.js');
  const sourceMapPath = `${sourcePath}.map`;
  assert(existsSync(sourcePath), `Exact production build omitted ${sourcePath}`);
  assert(existsSync(sourceMapPath), `Exact production build omitted ${sourceMapPath}`);
  const source = readFileSync(sourcePath, 'utf8');
  const sourceMap = JSON.parse(readFileSync(sourceMapPath, 'utf8'));
  const sourceModules = [...new Set(sourceMap.sources ?? [])].sort();
  const dynamicImportCount = source.match(/\bimport\s*\(/g)?.length ?? 0;
  const forbiddenDevelopmentMarkers = [
    '__exactDevModules',
    'import.meta.hot',
    '@exact/devtools/agent',
    'agent-bootstrap',
    'agent/server',
  ].filter((marker) => source.includes(marker));
  report.productionBundle = {
    kind: 'vite-production-rollup-single-entry-iife',
    path: relative(repoRoot, sourcePath),
    sizeBytes: Buffer.byteLength(source),
    sha256: sha256(source),
    sourceMap: {
      sizeBytes: statSync(sourceMapPath).size,
      sha256: sha256(readFileSync(sourceMapPath)),
      moduleCount: sourceModules.length,
    },
    dynamicImportCount,
    forbiddenDevelopmentMarkers,
    viteBuild: {
      status: build.status,
      stdoutSha256: build.stdoutSha256,
      stderrSha256: build.stderrSha256,
    },
  };
  assert.deepEqual(
    forbiddenDevelopmentMarkers,
    [],
    `development transforms entered the production Rollup graph: ${forbiddenDevelopmentMarkers.join(', ')}`,
  );
  assert.equal(
    dynamicImportCount,
    0,
    'Exact production Rollup graph retains dynamic imports and cannot form the ratified single-HBC carrier',
  );

  const hbcPath = resolve(outputRoot, 'partitime-native.hbc');
  const compile = await run(hermesCompiler, [
    '-emit-binary',
    '-O',
    '-out',
    hbcPath,
    sourcePath,
  ], {
    cwd: outputRoot,
    timeoutMs: 300_000,
  });
  report.hbcCompile = {
    status: compile.status,
    timedOut: compile.timedOut,
    stdoutSha256: compile.stdoutSha256,
    stderrSha256: compile.stderrSha256,
    stdoutTail: compile.stdoutTail,
    stderrTail: compile.stderrTail.map((line) => line.slice(0, 2_000)),
  };
  assert.equal(
    compile.status,
    0,
    `Hermes rejected the production Rollup graph: ${compile.stderrTail.slice(-8).join('\n')}`,
  );
  const hbc = readFileSync(hbcPath);
  assert(hbc.byteLength > 0, 'Exact production HBC is empty');
  const version = await run(hermesCompiler, ['-dump-bytecode', hbcPath], {
    cwd: outputRoot,
    timeoutMs: 60_000,
  });
  assert.equal(version.status, 0, 'Exact production HBC cannot be inspected');
  const versionMatch = version.stdoutHead.join('\n').match(/Bytecode version number:\s*(\d+)/);
  assert(versionMatch, 'Exact production HBC omitted its bytecode version');

  return {
    hbc,
    report: {
      source: report.productionBundle,
      hbc: {
        sizeBytes: hbc.byteLength,
        sha256: sha256(hbc),
        hermesBytecodeVersion: Number(versionMatch[1]),
        hermesCompilerVersion: commandText(hermesCompiler, ['--version']),
      },
      diagnostics: {
        moduleCount: sourceModules.length,
        sourceBytesRootIndependent: Buffer.byteLength(source),
        hbcStatus: 'ready',
        hbcBytes: hbc.byteLength,
        hermesBytecodeVersion: Number(versionMatch[1]),
      },
    },
  };
}

async function collectLaunch({ bundleId, witness, startupAssetWeightBytes }) {
  const marks = {};
  const observerMarkers = {
    ibexAuthenticatedSubstitution: false,
    ibexLoopbackFetchSubstituted: false,
    ibexPostureVerified: false,
    exactObserverEnabled: false,
    exactObserverRuntimeCreated: false,
    exactCarrierDispatchInstalled: false,
  };
  let diagnosticRuntimeObserved = false;
  let agentObservedBeforeFirstFrame = false;
  const recent = [];
  let launchError = null;
  let genericLaunchFailure = null;
  const predicate = [
    'process == "ExactApp"',
    'AND',
    '(',
    'eventMessage CONTAINS "[ContentView]"',
    'OR eventMessage CONTAINS "[ExactRuntimeEngine]"',
    'OR eventMessage CONTAINS "[Ibex]"',
    'OR eventMessage CONTAINS "[ExactAgent]"',
    ')',
  ].join(' ');
  const log = spawn('xcrun', [
    'simctl', 'spawn', deviceId,
    'log', 'stream',
    '--style', 'compact',
    '--predicate', predicate,
  ], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let consoleLaunch = null;
  let consoleLaunchPid = null;
  let consoleLaunchError = null;
  const scanLine = (line, source) => {
    recent.push(`[${source}] ${line}`);
    if (recent.length > 240) recent.shift();
    if (source.startsWith('console')) {
      const pidPrefix = `${bundleId}: `;
      const trimmed = line.trim();
      if (trimmed.startsWith(pidPrefix)) {
        const parsedPid = Number(trimmed.slice(pidPrefix.length));
        if (Number.isInteger(parsedPid) && parsedPid > 0) {
          consoleLaunchPid = parsedPid;
        }
      }
      const appPid = line.match(/\bExactApp\[(\d+):/);
      if (appPid) {
        consoleLaunchPid = Number(appPid[1]);
      }
    }
    if (
      line.includes('Embedded bytecode eval failed')
      || line.includes('Embedded runtime context eval failed')
    ) {
      launchError = new Error(
        `${line}\npreceding carrier logs:\n${recent.slice(-80).join('\n')}`,
      );
    }
    if (line.includes('Startup mark: failed:')) {
      genericLaunchFailure = {
        line,
        observedAtMs: Date.now(),
      };
    }
    if (
      line.includes(
        '[Ibex] CAPSEC_SIMULATOR_PERFORMANCE_OBSERVER_V1: '
        + 'authenticated artifacts; report target cells substituted',
      )
    ) {
      observerMarkers.ibexAuthenticatedSubstitution = true;
    }
    if (
      line.includes(
        '[Ibex] CAPSEC_SIMULATOR_PERFORMANCE_OBSERVER_V1 stage=posture-verified',
      )
    ) {
      observerMarkers.ibexPostureVerified = true;
    }
    if (
      line.includes(
        '[Ibex] CAPSEC_SIMULATOR_PERFORMANCE_OBSERVER_V1 '
        + 'stage=loopback-fetch-substituted',
      )
    ) {
      observerMarkers.ibexLoopbackFetchSubstituted = true;
    }
    if (
      line.includes(
        '[ExactRuntimeEngine] PARTITIME_CAPSEC_SIMULATOR_PERFORMANCE_OBSERVER_V1 enabled',
      )
    ) {
      observerMarkers.exactObserverEnabled = true;
    }
    if (
      line.includes(
        '[ExactRuntimeEngine] PARTITIME_CAPSEC_SIMULATOR_PERFORMANCE_OBSERVER_V1 runtime created',
      )
    ) {
      observerMarkers.exactObserverRuntimeCreated = true;
    }
    if (
      line.includes(
        '[ExactRuntimeEngine] PARTITIME_CAPSEC_SIMULATOR_PERFORMANCE_OBSERVER_V1 carrier dispatch installed',
      )
    ) {
      observerMarkers.exactCarrierDispatchInstalled = true;
    }
    if (line.includes('DIAGNOSTIC runtime created')) {
      diagnosticRuntimeObserved = true;
    }
    const agentStartupObserved = [
      '[ExactAgent] Agent API listening on',
      '[ExactAgent] Agent isolate is the public control plane:',
      'Agent server started',
    ].some((marker) => line.includes(marker));
    if (agentStartupObserved && marks['first-app-frame'] == null) {
      // A warning or an explicitly disabled/on-demand diagnostic under the
      // ExactAgent namespace is not evidence that an agent carrier started.
      // Once a real pre-frame start is seen, later lines may not clear it.
      agentObservedBeforeFirstFrame = true;
    }
    const mark = line.match(/Startup mark:\s+([^\s]+)\s*$/);
    if (mark) marks[mark[1]] = parseLogTimestampMs(line);
  };
  const attachLineScanner = (stream, source) => {
    let pending = '';
    stream.on('data', (chunk) => {
      pending += chunk.toString();
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) scanLine(line, source);
    });
    stream.on('end', () => {
      if (pending) scanLine(pending, source);
      pending = '';
    });
  };
  attachLineScanner(log.stdout, 'unified-log');
  attachLineScanner(log.stderr, 'unified-log-error');
  try {
    await run('xcrun', ['simctl', 'terminate', deviceId, bundleId], {
      timeoutMs: 30_000,
    });
    witness.clear();
    await sleep(300);
    const requestedAtMs = Date.now();
    consoleLaunch = spawn('xcrun', [
      'simctl', 'launch', '--terminate-running-process', '--console',
      deviceId, bundleId,
    ], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SIMCTL_CHILD_EXACT_EMBEDDED_BYTECODE_NAME: bytecodeName,
        SIMCTL_CHILD_EXACT_APP_CUSTOM_URL: 'http://127.0.0.1',
        SIMCTL_CHILD_EXACT_DEV_SERVER_URL: '',
        SIMCTL_CHILD_EXACT_PRECOMPUTED_FIRST_FRAME: '0',
        SIMCTL_CHILD_EXACT_AGENT_BOOT: '0',
        SIMCTL_CHILD_EXACT_AUTO_SHOW_CONSOLE_ON_ERROR: '0',
        SIMCTL_CHILD_EXACT_STARTUP_TRACE: '1',
        SIMCTL_CHILD_EXACT_RUNTIME_THREAD: '1',
      },
    });
    consoleLaunch.once('error', (error) => {
      consoleLaunchError = error;
    });
    attachLineScanner(consoleLaunch.stdout, 'console');
    attachLineScanner(consoleLaunch.stderr, 'console-error');
    const launchDeadline = Date.now() + 30_000;
    while (consoleLaunchPid == null && Date.now() < launchDeadline) {
      if (consoleLaunchError) throw consoleLaunchError;
      if (consoleLaunch.exitCode !== null) {
        throw new Error(
          `Exact console launch exited with status ${consoleLaunch.exitCode}: `
            + recent.slice(-40).join('\n'),
        );
      }
      await sleep(20);
    }
    assert(
      Number.isInteger(consoleLaunchPid) && consoleLaunchPid > 0,
      `Exact console launch was not acknowledged: ${recent.slice(-40).join('\n')}`,
    );
    const commandCompletedAtMs = Date.now();
    const deadline = Date.now() + launchTimeoutMs;
    let product = null;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (consoleLaunchError) throw consoleLaunchError;
      if (consoleLaunch.exitCode !== null) {
        throw new Error(
          `Exact carrier exited before a qualifying native sample (status `
            + `${consoleLaunch.exitCode}): ${recent.slice(-40).join('\n')}`,
        );
      }
      if (
        genericLaunchFailure
        && Date.now() - genericLaunchFailure.observedAtMs >= 500
      ) {
        throw new Error(
          'Exact production startup failed before a qualifying native sample: '
          + genericLaunchFailure.line,
        );
      }
      product = witness.events.find(({ payload }) =>
        payload?.schemaVersion === 'partitime.native-product-marker.v1'
        && payload?.event === 'first-authoritative-data');
      if (
        marks['bytecode-eval-begin'] != null
        && marks['bytecode-eval-end'] != null
        && marks['first-app-frame'] != null
        && Object.values(observerMarkers).every(Boolean)
        && product
      ) {
        const firstAuthoritativeAtMs = Number.isFinite(product.payload.observedAtEpochMs)
          ? product.payload.observedAtEpochMs
          : product.receivedAtMs;
        return {
          metrics: {
            hermesEvaluationMs:
              marks['bytecode-eval-end'] - marks['bytecode-eval-begin'],
            startupAssetWeightBytes,
            coldLaunchMs: marks['first-app-frame'] - requestedAtMs,
            firstAuthoritativeDataMs: firstAuthoritativeAtMs - requestedAtMs,
          },
          launchRequest: {
            requestedAtMs,
            commandCompletedAtMs,
            status: 0,
            pid: consoleLaunchPid,
          },
          events: {
            bytecodeEvalBeginAtMs: marks['bytecode-eval-begin'],
            bytecodeEvalEndAtMs: marks['bytecode-eval-end'],
            firstAppFrameAtMs: marks['first-app-frame'],
            firstAuthoritativeAtMs,
            productMarkerReceivedAtMs: product.receivedAtMs,
          },
          productMarker: product.payload,
          observer: {
            id: observerId,
            markers: observerMarkers,
            diagnosticRuntimeObserved,
            agentObservedBeforeFirstFrame,
          },
        };
      }
      await sleep(50);
    }
    throw new Error(
      `timed out waiting for Release/HBC stages; marks=${JSON.stringify(marks)} `
        + `witness=${JSON.stringify(witness.events)} logs=${recent.slice(-80).join('\n')}`,
    );
  } finally {
    await stopChild(log);
    await stopChild(consoleLaunch);
    await run('xcrun', ['simctl', 'terminate', deviceId, bundleId], {
      timeoutMs: 30_000,
    });
  }
}

function parseLogTimestampMs(line) {
  const match = line.match(
    /^([0-9]{4}-[0-9]{2}-[0-9]{2})\s+([0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3})/,
  );
  if (!match) return Date.now();
  const parsed = Date.parse(`${match[1]}T${match[2]}`);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function findFile(root, name) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      const nested = findFile(path, name);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name === name) {
      return path;
    }
  }
  return null;
}

function digestArtifact(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
      else if (entry.isSymbolicLink()) files.push(path);
    }
  };
  visit(root);
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for (const path of files.sort()) {
    const payload = lstatSync(path).isSymbolicLink()
      ? Buffer.from(readlinkSync(path))
      : readFileSync(path);
    const framedPath = Buffer.from(relative(root, path));
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
    path: relative(repoRoot, root),
    kind: 'directory',
    files: files.length,
    sizeBytes,
    sha256: hash.digest('hex'),
  };
}

function plistValue(plist, key) {
  const result = spawnSync('plutil', ['-extract', key, 'raw', plist], {
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

async function waitForUrl(url, child, output, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`process exited before ${url} became ready: ${output().slice(-3000)}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Bounded readiness retry.
    }
    await sleep(100);
  }
  throw new Error(`readiness timed out at ${url}: ${output().slice(-3000)}`);
}

function run(command, args, {
  cwd = repoRoot,
  env = process.env,
  timeoutMs = 300_000,
} = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      terminateGroup(child);
      setTimeout(() => terminateGroup(child, 'SIGKILL'), 5_000).unref();
    }, timeoutMs);
    child.once('close', (status, signal) => {
      clearTimeout(timer);
      resolveRun({
        status,
        signal,
        timedOut,
        stdoutSha256: sha256(stdout),
        stderrSha256: sha256(stderr),
        stdoutHead: stdout.trim().split('\n').filter(Boolean).slice(0, 20),
        stderrHead: stderr.trim().split('\n').filter(Boolean).slice(0, 20),
        stdoutTail: stdout.trim().split('\n').filter(Boolean).slice(-20),
        stderrTail: stderr.trim().split('\n').filter(Boolean).slice(-20),
      });
    });
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise((resolveClose) => child.once('close', resolveClose));
  terminateGroup(child);
  const graceful = await Promise.race([
    closed.then(() => true),
    sleep(5_000).then(() => false),
  ]);
  if (graceful) return;
  terminateGroup(child, 'SIGKILL');
  const killed = await Promise.race([
    closed.then(() => true),
    sleep(5_000).then(() => false),
  ]);
  if (!killed) throw new Error(`process ${child.pid} survived SIGKILL`);
}

function terminateGroup(child, signal = 'SIGTERM') {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* already gone */ }
  }
}

function commandText(command, args, { cwd = repoRoot } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
