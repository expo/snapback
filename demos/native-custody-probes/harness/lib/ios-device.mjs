import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { eventually, run, runToFileExclusive } from './process.mjs';
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
  const catalog = JSON.parse(await run(
    'iOS simulator discovery', 'xcrun', ['simctl', 'list', 'devices', 'available', '-j'], { cwd: appRoot },
  ));
  const device = availableDevice(catalog, options.udid);
  if (device === null) throw new Error('P0/ios-device: no available iOS simulator was discovered');
  const bootedByHarness = device.state !== 'Booted';
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
    : join(derivedData, 'Build', 'Products', 'Release-iphonesimulator', 'NativeCustodyProbes.app');
  if (!options.skipBuild) {
    if (!existsSync(join(appRoot, 'ios', 'Pods'))) {
      await run('CocoaPods install', 'pod', ['install', '--project-directory=ios'], {
        cwd: appRoot, timeoutMs: 20 * 60_000,
      });
    }
    await run('iOS Release simulator build', 'xcodebuild', [
      '-workspace', 'ios/NativeCustodyProbes.xcworkspace',
      '-scheme', 'NativeCustodyProbes',
      '-configuration', 'Release',
      '-sdk', 'iphonesimulator',
      '-destination', `platform=iOS Simulator,id=${device.udid}`,
      '-derivedDataPath', derivedData,
      'CODE_SIGNING_ALLOWED=NO',
      `PRODUCT_BUNDLE_IDENTIFIER=${options.bundleId}`,
      'build',
    ], { cwd: appRoot, timeoutMs: 40 * 60_000 });
  }
  if (!existsSync(appPath)) {
    throw new Error(`P0/ios-artifact: app bundle not found at ${appPath}; remove --skip-build or pass --app-path`);
  }
  const appIdentity = iosAppBundleIdentity(appPath);
  const bundleId = appIdentity.bundleId;
  evidence.writeArtifact(
    'metro.log',
    'Metro was not spawned: the iOS Release simulator build carries its bundled JavaScript.\n',
  );

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
      const director = encodeURIComponent(`http://127.0.0.1:${directorPort}`);
      await run('launch iOS probe app', 'xcrun', [
        'simctl', 'openurl', device.udid, `dev.snapback.custodyprobes://probe?director=${director}`,
      ], { cwd: appRoot });
    },
    async kill({ midWrite = false } = {}) {
      const row = await processRow();
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
      const [xcode, runtimeVersion] = await Promise.all([
        run('Xcode version', 'xcodebuild', ['-version'], { cwd: appRoot }),
        run('iOS runtime version', 'xcrun', [
          'simctl', 'spawn', device.udid, 'sh', '-c', 'sw_vers -productVersion',
        ], { cwd: appRoot }),
      ]);
      return {
        device: `${device.name} (${device.udid})`,
        simulatorRuntime: device.runtime,
        osVersion: runtimeVersion.trim(),
        xcode: xcode.trim().replaceAll('\n', '; '),
        appArtifact: appPath,
        appBundleIdentifier: bundleId,
        freshInstallKeychainReset: !options.preserveKeychain,
      };
    },
    async cleanup() {
      await terminate();
      if (bootedByHarness) {
        try {
          await run('shutdown harness-owned iOS simulator', 'xcrun', ['simctl', 'shutdown', device.udid], { cwd: appRoot });
        } catch { /* already shut down */ }
      }
    },
  });
  } catch (error) {
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
