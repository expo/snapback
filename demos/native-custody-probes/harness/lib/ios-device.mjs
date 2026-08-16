import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  eventually,
  prepareHarnessPort,
  removeHarnessPortOwner,
  run,
  runToFileExclusive,
  spawnOwned,
  stopOwned,
  verifyListenerPid,
  writeHarnessPortOwner,
} from './process.mjs';
import { iosAppBundleIdentity } from './integrity.mjs';

function availableDevice(catalog, requested) {
  const devices = Object.entries(catalog.devices ?? {})
    .flatMap(([runtime, entries]) => entries.map((device) => ({ ...device, runtime })))
    .filter((device) => device.isAvailable !== false);
  if (requested) {
    const match = devices.find((device) => device.udid === requested);
    if (!match) throw new Error(`P0/ios-device: requested simulator ${requested} is not available`);
    return match;
  }
  return devices.find((device) => device.state === 'Booted' && /iPhone/u.test(device.name))
    ?? devices.find((device) => /iPhone/u.test(device.name))
    ?? devices[0]
    ?? null;
}

export async function createIosDevice({ appRoot, evidence, options }) {
  if (Number(options.metroPort) !== 8081) {
    throw new Error(
      `P0/ios-metro-port: the Debug app's RCTBundleURLProvider is fixed at Metro port 8081; got ${options.metroPort}. `
      + 'Run the iOS harness with --metro-port 8081.',
    );
  }
  const catalog = JSON.parse(await run(
    'iOS simulator discovery', 'xcrun', ['simctl', 'list', 'devices', 'available', '-j'], { cwd: appRoot },
  ));
  const device = availableDevice(catalog, options.udid);
  if (device === null) throw new Error('P0/ios-device: no available iOS simulator was discovered');
  const bootedByHarness = device.state !== 'Booted';
  let metro = null;
  let jsBundleSha256 = null;
  let jsBundleByteLength = null;
  const metroOwnerFile = join(
    appRoot, '..', '.snapback', 'native-custody-ios', 'ports',
    `metro-${options.metroPort}.json`,
  );
  try {
  if (bootedByHarness) {
    await run('boot iOS simulator', 'xcrun', ['simctl', 'boot', device.udid], { cwd: appRoot });
  }
  await run('wait for iOS simulator boot', 'xcrun', ['simctl', 'bootstatus', device.udid, '-b'], {
    cwd: appRoot, timeoutMs: 180_000,
  });
  const derivedData = options.derivedData
    ? resolve(appRoot, options.derivedData)
    : join(appRoot, '.build', 'ios-derived-data');
  const appPath = options.appPath
    ? resolve(appRoot, options.appPath)
    : join(derivedData, 'Build', 'Products', 'Debug-iphonesimulator', 'NativeCustodyProbes.app');
  if (!options.skipBuild) {
    if (!existsSync(join(appRoot, 'ios', 'Pods'))) {
      await run('CocoaPods install', 'pod', ['install', '--project-directory=ios'], {
        cwd: appRoot, timeoutMs: 20 * 60_000,
      });
    }
    await run('iOS Debug simulator build', 'xcodebuild', [
      '-workspace', 'ios/NativeCustodyProbes.xcworkspace',
      '-scheme', 'NativeCustodyProbes',
      '-configuration', 'Debug',
      '-sdk', 'iphonesimulator',
      '-destination', `platform=iOS Simulator,id=${device.udid}`,
      '-derivedDataPath', derivedData,
      // Simulator builds sign with the automatic ad-hoc identity. A fully
      // unsigned app (CODE_SIGNING_ALLOWED=NO) has no application-identifier,
      // and securityd refuses its SecItem calls with -34018
      // (errSecMissingEntitlement), which would break the Keychain custody
      // module under test.
      `PRODUCT_BUNDLE_IDENTIFIER=${options.bundleId}`,
      'build',
    ], { cwd: appRoot, timeoutMs: 40 * 60_000 });
  }
  if (!existsSync(appPath)) {
    throw new Error(`P0/ios-artifact: app bundle not found at ${appPath}; remove --skip-build or pass --app-path`);
  }
  const appIdentity = iosAppBundleIdentity(appPath);
  const bundleId = appIdentity.bundleId;
  // Keychain custody requires a signed app (unsigned apps receive -34018
  // errSecMissingEntitlement), so the signature is verified and recorded
  // rather than asserted in a comment.
  const codesignOutput = await run('verify iOS app signature', 'codesign', [
    '--display', '--verbose=2', appPath,
  ], { cwd: appRoot }).catch((error) => {
    throw new Error(`P0/ios-codesign: the built app is not signed; Keychain custody cannot run: ${error.message}`);
  });
  const signingIdentifier = /Identifier=([^\n]+)/u.exec(codesignOutput)?.[1] ?? 'present';

  await prepareHarnessPort({
    port: options.metroPort,
    ownerFile: metroOwnerFile,
    role: 'metro',
  });
  // --clear drops Metro's persisted transform cache: evidence runs must never
  // serve a stale transform (mtime-based invalidation misses backdated files).
  metro = spawnOwned('Expo Metro', join(appRoot, 'node_modules', '.bin', 'expo'), [
    'start', '--port', String(options.metroPort), '--clear',
  ], {
    cwd: appRoot,
    env: { CI: '1', EXPO_NO_TELEMETRY: '1' },
    logPath: evidence.pathFor('metro.log'),
  });
  writeHarnessPortOwner({
    port: options.metroPort,
    ownerFile: metroOwnerFile,
    role: 'metro',
    pid: metro.pid,
    commandToken: `--port ${options.metroPort}`,
  });
  await eventually(async () => {
    if (metro.exitCode !== null || metro.signalCode !== null) {
      throw new Error(`Metro exited: ${metro.capturedOutput().slice(-8_000)}`);
    }
    try {
      return verifyListenerPid(options.metroPort, metro.pid, 'P0/metro-owner');
    } catch { return null; }
  }, 'harness-owned Expo Metro listener', 120_000, 250);
  const bundleResponse = await fetch(
    `http://127.0.0.1:${options.metroPort}/index.bundle?platform=ios&dev=true`,
  );
  if (!bundleResponse.ok) {
    throw new Error(`P0/ios-metro-bundle: Metro returned HTTP ${bundleResponse.status}`);
  }
  const bundleBytes = Buffer.from(await bundleResponse.arrayBuffer());
  jsBundleSha256 = `sha256:${createHash('sha256').update(bundleBytes).digest('hex')}`;
  jsBundleByteLength = bundleBytes.byteLength;

  const processRow = async () => {
    const output = await run('locate iOS probe process', 'xcrun', [
      'simctl', 'spawn', device.udid, 'launchctl', 'list',
    ], { cwd: appRoot });
    const marker = `UIKitApplication:${bundleId}[`;
    const line = output.split('\n').find((entry) => entry.includes(marker));
    if (line === undefined) return null;
    const pid = Number.parseInt(line.trim().split(/\s+/u)[0], 10);
    return Number.isSafeInteger(pid) && pid > 0 ? Object.freeze({ pid, marker }) : null;
  };

  const terminate = async () => {
    try {
      await run('terminate iOS probe app', 'xcrun', ['simctl', 'terminate', device.udid, bundleId], {
        cwd: appRoot, timeoutMs: 15_000,
      });
    } catch { /* first launch or already dead */ }
  };
  const install = () => run('install iOS probe app', 'xcrun', ['simctl', 'install', device.udid, appPath], { cwd: appRoot });
  const uninstall = async () => {
    try {
      await run('uninstall iOS probe app', 'xcrun', ['simctl', 'uninstall', device.udid, bundleId], { cwd: appRoot });
    } catch { /* first clean install */ }
  };

  return Object.freeze({
    platform: 'ios',
    // The simulator reaches the host directly, so iOS needs no reverse forwarding.
    origin(serverPort) { return `http://127.0.0.1:${serverPort}`; },
    routing: 'loopback',
    async installFresh() {
      await terminate();
      await uninstall();
      if (!options.preserveKeychain) {
        await run('reset iOS simulator keychain for fresh-install precondition', 'xcrun', [
          'simctl', 'keychain', device.udid, 'reset',
        ], { cwd: appRoot });
      }
      await install();
    },
    async launch(directorPort) {
      // simctl openurl silently no-ops as a cold-start on headless-booted
      // simulators, so the launch is a plain simctl launch and the witness
      // reaches the director through its fixed default origin. That default
      // is port 18771, which pins the iOS director port.
      if (Number(directorPort) !== 18771) {
        throw new Error(
          `iOS launch: the witness default director origin is fixed at port 18771; got ${directorPort}. `
          + 'Run the iOS harness with --director-port 18771.',
        );
      }
      await run('launch iOS probe app', 'xcrun', [
        'simctl', 'launch', '--terminate-running-process', device.udid, bundleId,
      ], { cwd: appRoot });
    },
    locate: processRow,
    async kill({ midWrite = false, row: providedRow = null } = {}) {
      const row = providedRow ?? await processRow();
      if (row === null) {
        throw new Error(`P${midWrite ? '2' : '1'}/ios-kill: no PID for ${bundleId}`);
      }
      let mechanism = 'xcrun simctl spawn kill -9';
      try {
        await run('SIGKILL iOS simulator app', 'xcrun', [
          'simctl', 'spawn', device.udid, 'kill', '-9', String(row.pid),
        ], { cwd: appRoot, timeoutMs: 15_000 });
      } catch (error) {
        if (!/(?:unable to spawn|no such file|not found|unsupported)/iu.test(error.message)) throw error;
        process.kill(row.pid, 'SIGKILL');
        mechanism = 'host kill -9 fallback (simctl spawn-kill unsupported)';
      }
      await eventually(async () => ((await processRow())?.pid === row.pid ? null : true),
        `iOS PID ${row.pid} disappearance`, 10_000, 25);
      return Object.freeze({ mechanism, pid: row.pid, verifiedGone: true, launchLabel: row.marker });
    },
    async screenshot(path) {
      if (existsSync(path)) throw new Error(`P6/ios-screenshot: refusing to overwrite ${path}`);
      await run('iOS milestone screenshot', 'xcrun', ['simctl', 'io', device.udid, 'screenshot', path], {
        cwd: appRoot,
      });
    },
    async captureDeviceLogs(path) {
      return runToFileExclusive(
        'capture iOS simulator log',
        'xcrun',
        [
          'simctl', 'spawn', device.udid,
          'log', 'show', '--last', '30m', '--style', 'compact',
          '--predicate', 'process == "NativeCustodyProbes"',
        ],
        path,
        { cwd: appRoot, timeoutMs: 120_000 },
      );
    },
    async observeSecondaryProcess() {
      throw new Error('P4/ios-processes: iOS extension evidence is externally supplied');
    },
    artifact() {
      return Object.freeze({
        kind: 'app-bundle',
        path: appPath,
        binaryPath: join(appPath, 'NativeCustodyProbes'),
        bundleId,
        nativeBuildConfiguration: 'Debug',
        bundleDelivery: 'metro',
        appPathOverride: options.appPath ?? null,
        codesign: signingIdentifier,
        sha256: `sha256:${appIdentity.sha256}`,
        inventoryFormat: appIdentity.inventoryFormat,
        inventoryFileCount: appIdentity.fileCount,
      });
    },
    async reinstallPreservingOsCustody() {
      await terminate();
      await uninstall();
      await install();
    },
    async metadata() {
      // iOS simulator runtimes ship no shell, so the version comes from the
      // runtime catalog rather than a spawned process.
      const [xcode, runtimeCatalog] = await Promise.all([
        run('Xcode version', 'xcodebuild', ['-version'], { cwd: appRoot }),
        run('iOS runtime catalog', 'xcrun', ['simctl', 'list', 'runtimes', '--json'], { cwd: appRoot }),
      ]);
      const catalogEntry = JSON.parse(runtimeCatalog).runtimes
        .find((entry) => entry.identifier === device.runtime);
      if (!catalogEntry?.version) {
        throw new Error(`iOS runtime version: runtime ${device.runtime} not present in the simctl catalog`);
      }
      const runtimeVersion = catalogEntry.version;
      return {
        device: `${device.name} (${device.udid})`,
        simulatorRuntime: device.runtime,
        osVersion: runtimeVersion.trim(),
        xcode: xcode.trim().replaceAll('\n', '; '),
        appArtifact: appPath,
        appBundleIdentifier: bundleId,
        freshInstallKeychainReset: !options.preserveKeychain,
        nativeBuildConfiguration: 'Debug',
        jsBundleCondition: 'development (served by harness-owned Metro; supervised-dev binding vocabulary is pruned from production bundles per LLP 0176 G4)',
        appStateSource: 'pinned-active by the probe app (headless-booted simulators report RN AppState inactive); lifecycle pause/resume is NOT exercised by these probes',
        codesignVerified: signingIdentifier,
        bundleDelivery: 'metro',
        metroReadinessBundleSha256: jsBundleSha256,
        metroBundleProvenance: 'readiness fetch of index.bundle?platform=ios&dev=true; the app-consumed bytes are served by the same harness-owned Metro but are not independently hashed',
        jsBundleByteLength,
      };
    },
    async cleanup() {
      await terminate();
      await stopOwned(metro);
      removeHarnessPortOwner(metroOwnerFile, metro?.pid);
      if (bootedByHarness) {
        try {
          await run('shutdown harness-owned iOS simulator', 'xcrun', ['simctl', 'shutdown', device.udid], { cwd: appRoot });
        } catch { /* already shut down */ }
      }
    },
  });
  } catch (error) {
    await stopOwned(metro);
    removeHarnessPortOwner(metroOwnerFile, metro?.pid);
    if (bootedByHarness) {
      try {
        await run('shutdown iOS simulator after setup failure', 'xcrun', [
          'simctl', 'shutdown', device.udid,
        ], { cwd: appRoot });
      } catch { /* preserve the setup failure */ }
    }
    throw error;
  }
}
