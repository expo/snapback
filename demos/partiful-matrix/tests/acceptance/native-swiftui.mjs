import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeMachineReport } from '../../../_kit/harness.mjs';
import { freePort } from '../../../_kit/provenance.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const demoRoot = resolve(here, '..', '..');
const swiftRoot = join(demoRoot, 'native', 'swiftui');
const output = option('out') ?? 'demos/partiful-matrix/acceptance/results/step0-native-swiftui.json';
const shouldBuild = !process.argv.includes('--no-build');
const backends = ['snapback', 'supabase', 'convex', 'sqlite'];
const protocol = JSON.parse(readFileSync(join(demoRoot, 'acceptance', 'comparison-protocol.v1.json'), 'utf8'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const cleanups = [];
const receiptResult = ({ stdout: _stdout, stderr: _stderr, ...result }) => result;

function commandText(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function treeIdentity(root, ignored = new Set()) {
  const files = [];
  const visit = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      if (ignored.has(name) || name === '.DS_Store' || name === 'xcuserdata') continue;
      const absolute = join(directory, name);
      const path = relative(root, absolute);
      const stat = lstatSync(absolute);
      if (stat.isDirectory()) visit(absolute);
      else if (stat.isFile()) files.push({ path, sha256: sha256(readFileSync(absolute)) });
    }
  };
  visit(root);
  return { files: files.length, sha256: sha256(JSON.stringify(files)) };
}

function option(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? null : process.argv[at + 1];
}

function run(command, args, { cwd = repoRoot, env = process.env, timeoutMs = 300_000 } = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    let timedOut = false;
    let killTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      terminateGroup(child, 'SIGTERM');
      killTimer = setTimeout(() => terminateGroup(child, 'SIGKILL'), 5_000);
    }, timeoutMs);
    child.once('close', (status, signal) => {
      clearTimeout(timer);
      if (killTimer !== null) clearTimeout(killTimer);
      resolveRun({
        status,
        signal,
        timedOut,
        stdout,
        stderr,
        stdoutSha256: sha256(stdout),
        stderrSha256: sha256(stderr),
        stdoutTail: stdout.trim().split('\n').slice(-8),
        stderrTail: stderr.trim().split('\n').filter(Boolean).slice(-8),
      });
    });
  });
}

async function startSnapback() {
  const readyDir = mkdtempSync(join(tmpdir(), 'partitime-native-snapback-'));
  const readyFile = join(readyDir, 'ready.json');
  const child = spawn(join(repoRoot, 'target', 'debug', 'snapback'), [
    '--port', '0', '--memory', '--ready-file', readyFile,
  ], { cwd: repoRoot, detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
  cleanups.push(() => rmSync(readyDir, { recursive: true, force: true }), () => stopChild(child));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (existsSync(readyFile)) return `http://127.0.0.1:${JSON.parse(readFileSync(readyFile, 'utf8')).port}`;
    if (child.exitCode !== null) throw new Error(`Snapback exited before readiness: ${child.exitCode}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('Snapback readiness timed out');
}

async function startGateway(snapbackOrigin) {
  const port = await freePort();
  const child = spawn('bun', ['run', 'server.ts'], {
    cwd: join(demoRoot, 'backends', 'gateway'),
    detached: true,
    env: {
      ...process.env,
      PARTIFUL_MATRIX_GATEWAY_PORT: String(port),
      PARTIFUL_MATRIX_SNAPBACK_ORIGIN: snapbackOrigin,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  cleanups.push(() => stopChild(child));
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return origin;
    } catch { /* readiness retry */ }
    if (child.exitCode !== null) throw new Error(`gateway exited before readiness: ${log.slice(-2000)}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`gateway readiness timed out: ${log.slice(-2000)}`);
}

async function gatewayPreflight(origin) {
  const response = await fetch(`${origin}/preflight`, { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.ok, true, `gateway preflight returned HTTP ${response.status}`);
  const preflight = await response.json();
  for (const backend of ['snapback', 'sqlite']) {
    assert.equal(preflight.backends?.[backend]?.ok, true, `required local preflight failed: ${backend}`);
  }
  return preflight;
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise((resolveClose) => child.once('close', resolveClose));
  terminateGroup(child, 'SIGTERM');
  const stopped = await Promise.race([
    closed.then(() => true),
    new Promise((resolveWait) => setTimeout(() => resolveWait(false), 5_000)),
  ]);
  if (stopped) return;
  terminateGroup(child, 'SIGKILL');
  const killed = await Promise.race([
    closed.then(() => true),
    new Promise((resolveWait) => setTimeout(() => resolveWait(false), 5_000)),
  ]);
  if (!killed && child.exitCode === null && child.signalCode === null) {
    throw new Error(`process ${child.pid} survived SIGKILL`);
  }
}

function terminateGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* already gone */ }
  }
}

const report = {
  schemaVersion: 'partitime.native-swiftui-receipt.v1',
  claimId: shouldBuild ? 'STEP0.NATIVE_BASELINE' : null,
  claimEligible: shouldBuild,
  receiptPurpose: shouldBuild ? 'step0-native-baseline' : 'diagnostic-binary-reuse',
  authoring: 'swiftui',
  workloadVersion: protocol.workloadVersion,
  methodId: protocol.protocolId,
  thresholdFormulaSetId: protocol.thresholdFormulaSetId,
  buildMode: shouldBuild ? 'fresh-xcode-build' : 'reuse-existing-binaries',
  ok: false,
  outcome: 'fail',
  buildResults: [],
  cells: [],
  cleanupErrors: [],
  source: {
    snapbackRevision: commandText('git', ['rev-parse', 'HEAD']),
    exactRevision: commandText('git', ['rev-parse', 'HEAD'], resolve(repoRoot, '..', 'exact')),
    project: treeIdentity(swiftRoot, new Set(['.build'])),
    collectorSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    gatewaySha256: treeIdentity(join(demoRoot, 'backends', 'gateway')).sha256,
  },
  packages: {
    rootLockSha256: sha256(readFileSync(join(repoRoot, 'bun.lock'))),
  },
  environment: {
    os: `${platform()}-${release()}-${arch()}`,
    cpu: cpus()[0]?.model ?? null,
    logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(),
    xcode: commandText('xcodebuild', ['-version'])?.split('\n') ?? null,
    bun: commandText('bun', ['--version']),
    node: process.version,
  },
  testInventory: [
    'demos/partiful-matrix/tests/acceptance/native-swiftui.mjs',
    'demos/partiful-matrix/native/swiftui/Sources/PartitimeStore.swift',
    'demos/partiful-matrix/native/swiftui/Sources/PartitimeApp.swift',
  ].map((path) => ({ path, sha256: sha256(readFileSync(join(repoRoot, path))) })),
};

try {
  const simulatorList = await run('xcrun', ['simctl', 'list', 'devices', 'available', '-j']);
  assert.equal(simulatorList.status, 0, 'could not list iOS simulators');
  const devices = Object.values(JSON.parse(simulatorList.stdout).devices).flat();
  const simulator = devices.find(({ state, isAvailable }) => state === 'Booted' && isAvailable !== false);
  assert.ok(simulator, 'no booted iOS simulator is available');
  report.simulator = { name: simulator.name, udid: simulator.udid };

  const macDerived = join(swiftRoot, '.build', 'step0-macos');
  const iosDerived = join(swiftRoot, '.build', 'step0-ios');
  if (shouldBuild) {
    for (const build of [
      { platform: 'macos', derived: macDerived, destination: 'generic/platform=macOS', scheme: 'PartitimeSwiftUI-macOS' },
      { platform: 'ios', derived: iosDerived, destination: `platform=iOS Simulator,id=${simulator.udid}`, scheme: 'PartitimeSwiftUI-iOS' },
    ]) {
      console.error(`[partitime/native-swiftui] build ${build.platform}`);
      const result = await run('xcodebuild', [
        '-project', join(swiftRoot, 'PartitimeSwiftUI.xcodeproj'),
        '-scheme', build.scheme,
        '-configuration', 'Debug',
        '-destination', build.destination,
        '-derivedDataPath', build.derived,
        'CODE_SIGNING_ALLOWED=NO',
        'build',
      ], { timeoutMs: 600_000 });
      report.buildResults.push({ platform: build.platform, ...receiptResult(result) });
      assert.equal(result.status, 0, `${build.platform} SwiftUI build failed`);
    }
  }

  const macBinary = join(macDerived, 'Build', 'Products', 'Debug', 'PartitimeSwiftUI.app', 'Contents', 'MacOS', 'PartitimeSwiftUI');
  const iosApp = join(iosDerived, 'Build', 'Products', 'Debug-iphonesimulator', 'PartitimeSwiftUI.app');
  const iosBinary = join(iosApp, 'PartitimeSwiftUI');
  assert.ok(existsSync(macBinary), `missing macOS app binary: ${macBinary}`);
  assert.ok(existsSync(iosBinary), `missing iOS app binary: ${iosBinary}`);
  report.binaries = { macosSha256: sha256(readFileSync(macBinary)), iosSha256: sha256(readFileSync(iosBinary)) };

  const snapbackOrigin = await startSnapback();
  const gatewayOrigin = await startGateway(snapbackOrigin);
  const backendHealth = await gatewayPreflight(gatewayOrigin);
  report.backendHealth = backendHealth;

  for (const backend of backends) {
    const health = backendHealth.backends?.[backend];
    if ((backend === 'supabase' || backend === 'convex') && health?.ok !== true) {
      report.cells.push({
        cell: `swiftui:macos:${backend}`,
        ok: false,
        outcome: 'skip',
        skipClass: 'remote-dependency',
        health,
      });
      continue;
    }
    console.error(`[partitime/native-swiftui] macos:${backend}`);
    const result = await run(macBinary, [
      '--backend', backend,
      '--gateway', gatewayOrigin,
      '--acceptance',
    ], { timeoutMs: 60_000 });
    const passed = result.status === 0 && result.stdout.includes(`PARTITIME_ACCEPTANCE backend=${backend} result=pass`);
    report.cells.push({ cell: `swiftui:macos:${backend}`, ok: passed, ...receiptResult(result) });
    assert.equal(passed, true, `SwiftUI macOS ${backend} acceptance failed`);
  }

  const install = await run('xcrun', ['simctl', 'install', simulator.udid, iosApp]);
  assert.equal(install.status, 0, `could not install SwiftUI iOS app: ${install.stderr}`);
  for (const backend of backends) {
    const health = backendHealth.backends?.[backend];
    if ((backend === 'supabase' || backend === 'convex') && health?.ok !== true) {
      report.cells.push({
        cell: `swiftui:ios:${backend}`,
        ok: false,
        outcome: 'skip',
        skipClass: 'remote-dependency',
        health,
      });
      continue;
    }
    console.error(`[partitime/native-swiftui] ios:${backend}`);
    const result = await run('xcrun', [
      'simctl', 'launch', '--console-pty', '--terminate-running-process',
      simulator.udid, 'dev.snapback.partitime.swiftui.ios',
      '--backend', backend,
      '--gateway', gatewayOrigin,
      '--acceptance',
    ], { timeoutMs: 60_000 });
    const outputText = `${result.stdout}\n${result.stderr}`;
    const passed = result.status === 0 && outputText.includes(`PARTITIME_ACCEPTANCE backend=${backend} result=pass`);
    report.cells.push({ cell: `swiftui:ios:${backend}`, ok: passed, ...receiptResult(result) });
    assert.equal(passed, true, `SwiftUI iOS ${backend} acceptance failed`);
  }

  report.ok = report.cells.length === 8 && report.cells.every(
    ({ ok, outcome, skipClass }) => ok || (outcome === 'skip' && skipClass === 'remote-dependency'),
  );
  report.outcome = report.ok ? 'pass' : 'fail';
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  for (const cleanup of cleanups.reverse()) {
    try {
      await cleanup();
    } catch (error) {
      report.cleanupErrors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (report.cleanupErrors.length > 0) {
    report.ok = false;
    report.outcome = 'fail';
  }
  writeMachineReport(resolve(repoRoot, output), report);
}

console.log(JSON.stringify(report));
process.exit(report.ok ? 0 : 1);
