import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeMachineReport } from '../../../_kit/harness.mjs';
import { freePort } from '../../../_kit/provenance.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const demoRoot = resolve(here, '..', '..');
const appRoot = join(demoRoot, 'native', 'exact-contract');
const exactRoot = resolve(appRoot, '..', '..', '..', '..', '..', 'exact');
const exactProject = resolve(option('exact-project') ?? join(exactRoot, 'ios', 'ExactApp', 'ExactApp.xcodeproj'));
const carrierPatchId = option('carrier-patch-id');
const output = option('out') ?? 'demos/partiful-matrix/acceptance/results/step0-native-exact.json';
const derivedRoot = resolve(option('derived-root') ?? join(tmpdir(), 'snapback-partitime-exact-step0'));
const shouldBuild = !process.argv.includes('--no-build');
const buildTimeoutMs = Number(option('build-timeout-ms') ?? 900_000);
const backends = (option('backends') ?? 'snapback,supabase,convex,sqlite').split(',').filter(Boolean);
const platforms = (option('platforms') ?? 'macos,ios').split(',').filter(Boolean);
assert.ok(backends.length > 0 && backends.every((value) => ['snapback', 'supabase', 'convex', 'sqlite'].includes(value)), '--backends contains an unsupported backend');
assert.ok(platforms.length > 0 && platforms.every((value) => ['macos', 'ios'].includes(value)), '--platforms contains an unsupported platform');
const protocol = JSON.parse(readFileSync(join(demoRoot, 'acceptance', 'comparison-protocol.v1.json'), 'utf8'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const cleanups = [];

function option(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? null : process.argv[at + 1];
}

function sync(command, args, { cwd = repoRoot } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function commandText(command, args, options) {
  const result = sync(command, args, options);
  return result.status === 0 ? result.stdout.trim() : null;
}

function terminateGroup(child, signal = 'SIGTERM') {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* already gone */ }
  }
}

function run(command, args, {
  cwd = repoRoot,
  env = process.env,
  timeoutMs = 300_000,
  detached = true,
} = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    let timedOut = false;
    let killTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      terminateGroup(child);
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
        stdoutTail: stdout.trim().split('\n').filter(Boolean).slice(-12),
        stderrTail: stderr.trim().split('\n').filter(Boolean).slice(-12),
      });
    });
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise((resolveClose) => child.once('close', resolveClose));
  terminateGroup(child);
  await Promise.race([closed, new Promise((resolveWait) => setTimeout(resolveWait, 5_000))]);
  if (child.exitCode !== null || child.signalCode !== null) return;
  terminateGroup(child, 'SIGKILL');
  const killed = await Promise.race([
    closed.then(() => true),
    new Promise((resolveWait) => setTimeout(() => resolveWait(false), 5_000)),
  ]);
  if (!killed && child.exitCode === null && child.signalCode === null) {
    throw new Error(`process ${child.pid} survived SIGKILL`);
  }
}

async function waitForUrl(url, child, log, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastResponse = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
      const body = await response.text();
      lastResponse = `HTTP ${response.status}: ${body.slice(-2_000)}`;
    } catch { /* readiness retry */ }
    if (child.exitCode !== null) throw new Error(`process exited before readiness: ${log().slice(-3_000)}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(
    `readiness timed out at ${url}: ${lastResponse ?? 'no HTTP response'}\n${log().slice(-3_000)}`,
  );
}

async function startSnapback() {
  const readyDir = mkdtempSync(join(tmpdir(), 'partitime-native-exact-snapback-'));
  const readyFile = join(readyDir, 'ready.json');
  const child = spawn(join(repoRoot, 'target', 'debug', 'snapback'), [
    '--port', '0', '--memory', '--ready-file', readyFile,
  ], { cwd: repoRoot, detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '';
  child.stderr.on('data', (chunk) => { log += chunk; });
  cleanups.push(async () => {
    await stopChild(child);
    rmSync(readyDir, { recursive: true, force: true });
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (existsSync(readyFile)) {
      return `http://127.0.0.1:${JSON.parse(readFileSync(readyFile, 'utf8')).port}`;
    }
    if (child.exitCode !== null) throw new Error(`Snapback exited before readiness: ${log.slice(-2_000)}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Snapback readiness timed out: ${log.slice(-2_000)}`);
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
  await waitForUrl(`${origin}/health`, child, () => log, 30_000);
  const response = await fetch(`${origin}/preflight`, { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.ok, true, `gateway preflight returned HTTP ${response.status}`);
  const preflight = await response.json();
  for (const backend of ['snapback', 'sqlite']) {
    assert.equal(preflight.backends?.[backend]?.ok, true, `required local preflight failed: ${backend}`);
  }
  return { origin, preflight };
}

async function startDevServer(backend, gatewayOrigin, token) {
  const port = await freePort();
  const child = spawn('bun', ['run', 'dev'], {
    cwd: appRoot,
    detached: true,
    env: {
      ...process.env,
      EXACT_AGENT_BOOT: '1',
      EXACT_AGENT_TOKEN: token,
      PARTITIME_BACKEND: backend,
      PARTITIME_GATEWAY_ORIGIN: gatewayOrigin,
      PARTITIME_EXACT_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  cleanups.push(() => stopChild(child));
  const origin = `http://127.0.0.1:${port}`;
  await waitForUrl(`${origin}/@vite/client`, child, () => log);
  return { child, origin, log: () => log };
}

function spawnMac(binary, origin, token) {
  const child = spawn(binary, [], {
    cwd: appRoot,
    detached: true,
    env: {
      ...process.env,
      EXACT_APP_CUSTOM_URL: origin,
      EXACT_DEV_SERVER_URL: origin,
      EXACT_AGENT_BOOT: '1',
      EXACT_AGENT_PORT: '0',
      EXACT_AGENT_TOKEN: token,
      EXACT_AUTO_SHOW_CONSOLE_ON_ERROR: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  return { child, log: () => log };
}

async function launchIos(simulator, app, bundleId, origin, token, backend) {
  const preLaunchTermination = await run(
    'xcrun',
    ['simctl', 'terminate', simulator.udid, bundleId],
    { timeoutMs: 30_000 },
  );
  const carrierLogRoot = join(derivedRoot, 'carrier-logs');
  mkdirSync(carrierLogRoot, { recursive: true });
  const carrierStdoutPath = join(carrierLogRoot, `${backend}-ios.stdout.log`);
  const carrierStderrPath = join(carrierLogRoot, `${backend}-ios.stderr.log`);
  rmSync(carrierStdoutPath, { force: true });
  rmSync(carrierStderrPath, { force: true });
  const requestedAtMs = Date.now();
  const launch = await run('xcrun', [
    'simctl', 'launch',
    `--stdout=${carrierStdoutPath}`,
    `--stderr=${carrierStderrPath}`,
    '--terminate-running-process',
    simulator.udid, bundleId,
  ], {
    timeoutMs: 30_000,
    env: {
      ...process.env,
      SIMCTL_CHILD_EXACT_APP_CUSTOM_URL: origin,
      SIMCTL_CHILD_EXACT_DEV_SERVER_URL: origin,
      SIMCTL_CHILD_EXACT_AGENT_BOOT: '1',
      SIMCTL_CHILD_EXACT_AGENT_PORT: '0',
      SIMCTL_CHILD_EXACT_AGENT_TOKEN: token,
      SIMCTL_CHILD_EXACT_AUTO_SHOW_CONSOLE_ON_ERROR: '0',
    },
  });
  return {
    ...launch,
    carrierLog: () => [
      existsSync(carrierStdoutPath) ? readFileSync(carrierStdoutPath, 'utf8') : '',
      existsSync(carrierStderrPath) ? readFileSync(carrierStderrPath, 'utf8') : '',
    ].filter(Boolean).join('\n'),
    requestedAtMs,
    commandCompletedAtMs: Date.now(),
    preLaunchTermination: {
      status: preLaunchTermination.status,
      signal: preLaunchTermination.signal,
      timedOut: preLaunchTermination.timedOut,
      stdoutSha256: preLaunchTermination.stdoutSha256,
      stderrSha256: preLaunchTermination.stderrSha256,
      stdoutTail: preLaunchTermination.stdoutTail,
      stderrTail: preLaunchTermination.stderrTail,
    },
  };
}

function parseJsonLine(text) {
  for (const line of text.trim().split('\n').reverse()) {
    try { return JSON.parse(line); } catch { /* try preceding line */ }
  }
  return null;
}

async function runActo(platform, backend, origin, token) {
  const result = await run('node', [join(here, 'native-exact-acto.mjs'), platform, backend], {
    env: { ...process.env, EXACT_DEV_URL: origin, EXACT_AGENT_TOKEN: token },
    timeoutMs: 150_000,
  });
  return { ...result, receipt: parseJsonLine(result.stdout) };
}

function workingTreeIdentity(root) {
  const revision = commandText('git', ['rev-parse', 'HEAD'], { cwd: root });
  const dirtyNames = new Set();
  for (const args of [
    ['diff', '--name-only', '-z', 'HEAD'],
    ['ls-files', '--others', '--exclude-standard', '-z'],
  ]) {
    const value = sync('git', args, { cwd: root });
    assert.equal(value.status, 0, `could not inventory working tree: git ${args.join(' ')}`);
    for (const path of value.stdout.split('\0').filter(Boolean)) dirtyNames.add(path);
  }
  const overlay = [...dirtyNames].sort().map((path) => {
    const absolute = join(root, path);
    if (!existsSync(absolute)) return { path, kind: 'deleted', sha256: null };
    const stat = lstatSync(absolute);
    if (stat.isFile() || stat.isSymbolicLink()) {
      const bytes = stat.isSymbolicLink() ? Buffer.from(commandText('readlink', [absolute]) ?? '') : readFileSync(absolute);
      return { path, kind: stat.isSymbolicLink() ? 'symlink' : 'file', sha256: sha256(bytes) };
    }
    const nestedRevision = commandText('git', ['rev-parse', 'HEAD'], { cwd: absolute });
    const nestedStatus = commandText('git', ['status', '--porcelain=v1'], { cwd: absolute });
    return {
      path,
      kind: 'directory',
      revision: nestedRevision,
      statusSha256: nestedStatus === null ? null : sha256(nestedStatus),
    };
  });
  return {
    revision,
    dirty: overlay.length > 0,
    overlayEntries: overlay.length,
    overlaySha256: sha256(JSON.stringify(overlay)),
  };
}

function treeIdentity(root) {
  const entries = [];
  const visit = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      if (name === '.DS_Store' || name === 'xcuserdata') continue;
      const absolute = join(directory, name);
      const path = relative(root, absolute);
      const stat = lstatSync(absolute);
      if (stat.isDirectory()) {
        visit(absolute);
      } else if (stat.isSymbolicLink()) {
        entries.push({ path, kind: 'symlink', target: readlinkSync(absolute) });
      } else if (stat.isFile()) {
        entries.push({ path, kind: 'file', sha256: sha256(readFileSync(absolute)) });
      }
    }
  };
  visit(root);
  return { files: entries.length, sha256: sha256(JSON.stringify(entries)) };
}

function packageIdentity() {
  const links = JSON.parse(readFileSync(join(appRoot, 'exact.links.json'), 'utf8'));
  return {
    appPackageSha256: sha256(readFileSync(join(appRoot, 'package.json'))),
    appLockSha256: sha256(readFileSync(join(appRoot, 'bun.lock'))),
    linksSha256: sha256(readFileSync(join(appRoot, 'exact.links.json'))),
    exactPackages: Object.entries(links).sort().map(([name, path]) => {
      const manifestPath = resolve(appRoot, path, 'package.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      return { name, version: manifest.version ?? null, manifestSha256: sha256(readFileSync(manifestPath)) };
    }),
  };
}

const report = {
  schemaVersion: 'partitime.native-exact-receipt.v1',
  claimId: shouldBuild ? 'STEP0.NATIVE_BASELINE' : null,
  claimEligible: shouldBuild,
  receiptPurpose: shouldBuild ? 'step0-native-baseline' : 'diagnostic-binary-reuse',
  authoring: 'exact-contract',
  workloadVersion: protocol.workloadVersion,
  methodId: protocol.protocolId,
  thresholdFormulaSetId: protocol.thresholdFormulaSetId,
  buildMode: shouldBuild ? 'fresh-xcode-build' : 'reuse-existing-binaries',
  ok: false,
  outcome: 'fail',
  source: {
    snapback: workingTreeIdentity(repoRoot),
    exact: workingTreeIdentity(exactRoot),
    carrierProject: {
      kind: exactProject.startsWith(exactRoot) ? 'exact-working-tree' : 'task-local-copy',
      patchId: carrierPatchId,
      ...treeIdentity(dirname(exactProject)),
    },
  },
  packages: packageIdentity(),
  environment: {
    hardware: commandText('uname', ['-m']),
    os: commandText('sw_vers', ['-productVersion']),
    xcode: commandText('xcodebuild', ['-version'])?.split('\n') ?? null,
    bun: commandText('bun', ['--version']),
    node: process.version,
  },
  buildResults: [],
  cells: [],
  cleanupErrors: [],
  carrierCleanup: [],
  testInventory: [
    'demos/partiful-matrix/tests/acceptance/native-exact.mjs',
    'demos/partiful-matrix/tests/acceptance/native-exact-acto.mjs',
    'demos/partiful-matrix/native/exact-contract/src/app/routes.ts',
    'demos/partiful-matrix/native/exact-contract/src/partitime/provider.ts',
  ].map((path) => ({ path, sha256: sha256(readFileSync(join(repoRoot, path))) })),
};

try {
  const simulatorList = await run('xcrun', ['simctl', 'list', 'devices', 'available', '-j']);
  assert.equal(simulatorList.status, 0, 'could not list iOS simulators');
  const devices = Object.values(JSON.parse(simulatorList.stdout).devices).flat();
  const simulator = devices.find(({ state, isAvailable, name }) =>
    state === 'Booted' && isAvailable !== false && name.includes('iPhone')
  );
  assert.ok(simulator, 'no booted iPhone simulator is available');
  report.simulator = { name: simulator.name, udid: simulator.udid };

  const macDerived = join(derivedRoot, 'step0-macos');
  const iosDerived = join(derivedRoot, 'step0-ios');
  if (shouldBuild) {
    for (const build of [
      { platform: 'macos', scheme: 'ExactAppMac', destination: 'platform=macOS,arch=arm64', derived: macDerived },
      { platform: 'ios', scheme: 'ExactApp', destination: `platform=iOS Simulator,id=${simulator.udid}`, derived: iosDerived },
    ].filter((build) => platforms.includes(build.platform))) {
      console.error(`[partitime/native-exact] build ${build.platform}`);
      const result = await run('xcodebuild', [
        '-project', exactProject,
        '-scheme', build.scheme,
        '-configuration', 'Debug',
        '-destination', build.destination,
        '-derivedDataPath', build.derived,
        '-jobs', '8',
        'CODE_SIGNING_ALLOWED=NO',
        'COMPILER_INDEX_STORE_ENABLE=NO',
        'ONLY_ACTIVE_ARCH=YES',
        'ARCHS=arm64',
        'ASSETCATALOG_COMPILER_APPICON_NAME=',
        'build',
      ], { cwd: exactRoot, timeoutMs: buildTimeoutMs });
      report.buildResults.push({ platform: build.platform, ...result, stdout: undefined, stderr: undefined });
    }
    assert.ok(report.buildResults.every(({ status }) => status === 0), 'one or more Exact carrier builds failed');
  }

  report.source.exactAfterBuild = workingTreeIdentity(exactRoot);
  assert.deepEqual(
    report.source.exactAfterBuild,
    report.source.exact,
    'Exact source changed while the native carriers were building',
  );
  report.source.carrierProjectAfterBuild = {
    kind: report.source.carrierProject.kind,
    patchId: carrierPatchId,
    ...treeIdentity(dirname(exactProject)),
  };
  assert.deepEqual(
    report.source.carrierProjectAfterBuild,
    report.source.carrierProject,
    'carrier project source changed while the native carriers were building',
  );

  const macBinary = join(macDerived, 'Build', 'Products', 'Debug', 'ExactAppMac.app', 'Contents', 'MacOS', 'ExactAppMac');
  const iosApp = join(iosDerived, 'Build', 'Products', 'Debug-iphonesimulator', 'ExactApp.app');
  const iosBinary = join(iosApp, 'ExactApp');
  if (platforms.includes('macos')) assert.ok(existsSync(macBinary), `missing macOS Exact carrier: ${relative(repoRoot, macBinary)}`);
  if (platforms.includes('ios')) assert.ok(existsSync(iosBinary), `missing iOS Exact carrier: ${relative(repoRoot, iosBinary)}`);
  const bundleIdResult = platforms.includes('ios')
    ? sync('plutil', ['-extract', 'CFBundleIdentifier', 'raw', join(iosApp, 'Info.plist')])
    : { status: 0, stdout: '', stderr: '' };
  assert.equal(bundleIdResult.status, 0, `could not read iOS bundle ID: ${bundleIdResult.stderr}`);
  const bundleId = bundleIdResult.stdout.trim();
  report.binaries = {
    macosSha256: platforms.includes('macos') ? sha256(readFileSync(macBinary)) : null,
    iosSha256: platforms.includes('ios') ? sha256(readFileSync(iosBinary)) : null,
    iosBundleId: platforms.includes('ios') ? bundleId : null,
  };

  if (platforms.includes('ios')) {
    const install = await run('xcrun', ['simctl', 'install', simulator.udid, iosApp], { timeoutMs: 60_000 });
    assert.equal(install.status, 0, `could not install iOS Exact carrier: ${install.stderrTail.join('\n')}`);
    report.simulator.installationCleanup = 'uninstall-on-final-cleanup';
    cleanups.push(async () => {
      const uninstall = await run(
        'xcrun',
        ['simctl', 'uninstall', simulator.udid, bundleId],
        { timeoutMs: 60_000 },
      );
      if (uninstall.status !== 0) {
        throw new Error(`could not uninstall iOS Exact carrier: ${uninstall.stderrTail.join('\n')}`);
      }
    });
  }
  const snapbackOrigin = await startSnapback();
  const gateway = await startGateway(snapbackOrigin);
  const gatewayOrigin = gateway.origin;
  report.backendHealth = gateway.preflight;

  for (const backend of backends) {
    const health = gateway.preflight.backends?.[backend];
    if ((backend === 'supabase' || backend === 'convex') && health?.ok !== true) {
      for (const platform of platforms) {
        report.cells.push({
          cell: `exact-contract:${platform}:${backend}`,
          ok: false,
          outcome: 'skip',
          skipClass: 'remote-dependency',
          health,
        });
      }
      continue;
    }
    const token = randomBytes(24).toString('hex');
    console.error(`[partitime/native-exact] backend ${backend}`);
    const dev = await startDevServer(backend, gatewayOrigin, token);
    try {
      if (platforms.includes('macos')) {
        const mac = spawnMac(macBinary, dev.origin, token);
        let macActo;
        try {
          macActo = await runActo('mac', backend, dev.origin, token);
        } finally {
          await stopChild(mac.child);
        }
        report.cells.push({
          cell: `exact-contract:macos:${backend}`,
          ok: macActo.status === 0 && macActo.receipt?.ok === true,
          acto: { ...macActo, stdout: undefined, stderr: undefined },
          carrierLogSha256: sha256(mac.log()),
          carrierLogTail: mac.log().trim().split('\n').filter(Boolean).slice(-12),
          devServerLogSha256: sha256(dev.log()),
          devServerLogTail: dev.log().trim().split('\n').filter(Boolean).slice(-20),
        });
      }

      if (platforms.includes('ios')) {
        let iosLaunch;
        let iosActo;
        let iosCell;
        try {
          iosLaunch = await launchIos(
            simulator,
            iosApp,
            bundleId,
            dev.origin,
            token,
            backend,
          );
          iosActo = await runActo('ios', backend, dev.origin, token);
          iosCell = {
            cell: `exact-contract:ios:${backend}`,
            ok: iosLaunch.status === 0 && iosActo.status === 0 && iosActo.receipt?.ok === true,
            launch: {
              ...iosLaunch,
              stdout: undefined,
              stderr: undefined,
              carrierLog: undefined,
            },
            acto: { ...iosActo, stdout: undefined, stderr: undefined },
            devServerLogSha256: sha256(dev.log()),
            devServerLogTail: dev.log().trim().split('\n').filter(Boolean).slice(-20),
          };
        } finally {
          const termination = await run(
            'xcrun',
            ['simctl', 'terminate', simulator.udid, bundleId],
            { timeoutMs: 30_000 },
          );
          report.carrierCleanup.push({
            backend,
            action: 'terminate-ios-app',
            status: termination.status,
            signal: termination.signal,
            timedOut: termination.timedOut,
            stdoutSha256: termination.stdoutSha256,
            stderrSha256: termination.stderrSha256,
            stdoutTail: termination.stdoutTail,
            stderrTail: termination.stderrTail,
          });
          if (termination.status !== 0) {
            const message = `could not terminate iOS Exact carrier for ${backend}: ${termination.stderrTail.join('\n')}`;
            report.cleanupErrors.push(message);
            throw new Error(message);
          }
          if (iosCell) {
            const carrierLog = iosLaunch.carrierLog();
            iosCell.carrierLogSha256 = sha256(carrierLog);
            iosCell.carrierLogTail = carrierLog.trim().split('\n').filter(Boolean).slice(-40);
            report.cells.push(iosCell);
          }
        }
      }
    } finally {
      await stopChild(dev.child);
    }
  }

  report.source.snapbackAfterRun = workingTreeIdentity(repoRoot);
  assert.deepEqual(
    report.source.snapbackAfterRun,
    report.source.snapback,
    'Snapback source changed while the native cells were running',
  );
  report.source.exactAfterRun = workingTreeIdentity(exactRoot);
  assert.deepEqual(
    report.source.exactAfterRun,
    report.source.exact,
    'Exact source changed while the native cells were running',
  );
  report.source.carrierProjectAfterRun = {
    kind: report.source.carrierProject.kind,
    patchId: carrierPatchId,
    ...treeIdentity(dirname(exactProject)),
  };
  assert.deepEqual(
    report.source.carrierProjectAfterRun,
    report.source.carrierProject,
    'carrier project source changed while the native cells were running',
  );

  report.ok = report.cells.length === backends.length * platforms.length && report.cells.every(
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
