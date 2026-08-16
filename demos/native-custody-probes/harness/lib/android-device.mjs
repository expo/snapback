import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
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

function onlineEmulators(output) {
  return output.split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/u))
    .filter(([serial, state]) => serial?.startsWith('emulator-') && state === 'device')
    .map(([serial]) => serial);
}

export async function createAndroidDevice({ appRoot, evidence, options }) {
  let output = await run('Android device discovery', options.adb, ['devices'], { cwd: appRoot });
  let serial = options.serial ?? onlineEmulators(output)[0] ?? null;
  let emulatorChild = null;
  let metro = null;
  const metroOwnerFile = join(
    appRoot, '..', '.snapback', 'native-custody-android', 'ports',
    `metro-${options.metroPort}.json`,
  );
  try {
  if (serial === null) {
    emulatorChild = spawnOwned('Android emulator', options.emulator, [
      '-avd', options.avd,
      '-no-snapshot-save',
      '-no-boot-anim',
      '-no-audio',
    ], { cwd: appRoot, stdin: 'ignore' });
    serial = await eventually(async () => {
      output = await run('Android emulator discovery', options.adb, ['devices'], { cwd: appRoot });
      return onlineEmulators(output)[0] ?? null;
    }, `emulator ${options.avd}`, 180_000, 500);
  }
  await run('wait for Android emulator', options.adb, ['-s', serial, 'wait-for-device'], { cwd: appRoot });
  await eventually(async () => (
    (await run('Android boot completion', options.adb, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], {
      cwd: appRoot,
    })).trim() === '1'
  ), 'Android emulator boot completion', 240_000, 1_000);

  const apk = options.apk
    ? resolve(appRoot, options.apk)
    : join(appRoot, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  if (!options.skipBuild) {
    await run('Android debug build', './gradlew', [
      ':app:assembleDebug',
      `-PprobeApplicationId=${options.bundleId}`,
      '--no-daemon',
      '--max-workers=4',
    ], {
      cwd: join(appRoot, 'android'), timeoutMs: 40 * 60_000,
    });
  }
  if (!existsSync(apk)) {
    throw new Error(`P0/android-artifact: APK not found at ${apk}; remove --skip-build or pass --apk`);
  }

  await prepareHarnessPort({
    port: options.metroPort,
    ownerFile: metroOwnerFile,
    role: 'metro',
  });
  // --clear mirrors the iOS arm: no stale transform can reach evidence runs.
  metro = spawnOwned('Expo Metro', join(appRoot, 'node_modules', '.bin', 'expo'), [
    'start', '--dev-client', '--port', String(options.metroPort), '--clear',
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
      const response = await fetch(`http://127.0.0.1:${options.metroPort}/status`);
      return response.ok ? true : null;
    } catch { return null; }
  }, 'Expo Metro', 120_000, 250);
  verifyListenerPid(options.metroPort, metro.pid, 'P0/metro-owner');

  const adb = (...args) => run('adb command', options.adb, ['-s', serial, ...args], { cwd: appRoot });
  const forceStop = async () => { await adb('shell', 'am', 'force-stop', options.bundleId); };
  const psRows = async () => {
    const ps = await adb('shell', 'ps', '-A');
    return ps.split('\n').slice(1).map((line) => {
      const cells = line.trim().split(/\s+/u);
      return Object.freeze({
        raw: line,
        pid: Number.parseInt(cells[1] ?? '', 10),
        name: cells.at(-1) ?? '',
      });
    }).filter((row) => Number.isSafeInteger(row.pid));
  };
  const waitPidGone = async (pid) => eventually(async () => (
    (await psRows()).some((row) => row.pid === pid) ? null : true
  ), `Android PID ${pid} disappearance`, 10_000, 25);
  const uninstall = async () => {
    try { await adb('uninstall', options.bundleId); } catch { /* first clean install */ }
  };
  const install = () => adb('install', '-r', apk);

  return Object.freeze({
    platform: 'android',
    origin(serverPort) { return `http://127.0.0.1:${serverPort}`; },
    routing: 'port-forward',
    async installFresh() {
      await forceStop();
      await uninstall();
      await install();
      for (const port of [options.directorPort, options.serverPort, options.metroPort]) {
        await adb('reverse', `tcp:${port}`, `tcp:${port}`);
      }
    },
    async launch(directorPort) {
      const director = encodeURIComponent(`http://10.0.2.2:${directorPort}`);
      await adb(
        'shell', 'am', 'start', '-W',
        '-a', 'android.intent.action.VIEW',
        '-d', `dev.snapback.custodyprobes://probe?director=${director}`,
        options.bundleId,
      );
    },
    async locate() {
      const pid = (await adb('shell', 'pidof', options.bundleId)).trim().split(/\s+/u)[0];
      return /^\d+$/u.test(pid) ? Object.freeze({ pid: Number(pid) }) : null;
    },
    async kill({ midWrite = false, row: providedRow = null } = {}) {
      if (!midWrite) {
        await forceStop();
        return Object.freeze({ mechanism: 'am force-stop', verifiedGone: true });
      }
      const located = providedRow ?? await this.locate();
      if (located === null) throw new Error(`P2/android-kill: no PID for ${options.bundleId}`);
      const numericPid = located.pid;
      const attempts = [];
      let mechanism = null;
      for (const candidate of [
        ['run-as', ['shell', 'run-as', options.bundleId, 'kill', '-9', String(numericPid)]],
        ['plain', ['shell', 'kill', '-9', String(numericPid)]],
      ]) {
        try {
          await adb(...candidate[1]);
          attempts.push({ mechanism: candidate[0], commandSucceeded: true });
          try {
            await waitPidGone(numericPid);
            mechanism = candidate[0];
            break;
          } catch (error) {
            attempts.at(-1).pidGone = false;
            attempts.at(-1).verificationError = error.message;
          }
        } catch (error) {
          attempts.push({
            mechanism: candidate[0],
            commandSucceeded: false,
            error: error.message,
          });
        }
      }
      if (mechanism === null) {
        throw Object.assign(new Error(`P2/android-kill: verified SIGKILL was impossible for PID ${numericPid}`), {
          code: 'SNAPBACK_NATIVE_PROBE_SIGKILL_UNVERIFIED',
          attempts,
        });
      }
      // Cleanup may only broaden to force-stop after the exact SIGKILL target
      // was observed dead; it is not evidence for the interruption itself.
      await forceStop();
      return Object.freeze({
        mechanism: mechanism === 'run-as' ? 'adb shell run-as kill -9' : 'adb shell kill -9',
        pid: numericPid,
        verifiedGone: true,
        cleanup: 'am force-stop after verified death',
        attempts,
      });
    },
    async screenshot(path) {
      const bytes = execFileSync(options.adb, ['-s', serial, 'exec-out', 'screencap', '-p'], {
        cwd: appRoot, maxBuffer: 32 * 1024 * 1024,
      });
      writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
    },
    async observeSecondaryProcess(reportedServicePid) {
      const rows = await psRows();
      const main = rows.find((row) => row.name === options.bundleId) ?? null;
      const serviceName = `${options.bundleId}:probe`;
      const service = rows.find((row) => row.name === serviceName) ?? null;
      if (main === null || service === null) {
        throw new Error(`P4/android-processes: adb shell ps did not show ${options.bundleId} and ${serviceName}`);
      }
      if (service.pid !== reportedServicePid || service.pid === main.pid) {
        throw new Error(`P4/android-processes: reported service PID ${reportedServicePid}; ps main=${main.pid} service=${service.pid}`);
      }
      return Object.freeze({
        source: 'adb shell ps -A',
        main: { pid: main.pid, processName: main.name },
        service: { pid: service.pid, processName: service.name },
      });
    },
    async captureDeviceLogs(path) {
      return runToFileExclusive(
        'capture Android device log',
        options.adb,
        ['-s', serial, 'logcat', '-d', '-v', 'threadtime'],
        path,
        { cwd: appRoot, timeoutMs: 60_000 },
      );
    },
    artifact() {
      return Object.freeze({
        nativeBuildConfiguration: 'debug',
        bundleDelivery: 'metro', kind: 'apk', path: apk, binaryPath: apk });
    },
    async reinstallPreservingOsCustody() {
      await forceStop();
      await uninstall();
      await install();
    },
    async metadata() {
      const [api, release, model, adbVersion] = await Promise.all([
        adb('shell', 'getprop', 'ro.build.version.sdk'),
        adb('shell', 'getprop', 'ro.build.version.release'),
        adb('shell', 'getprop', 'ro.product.model'),
        run('adb version', options.adb, ['version'], { cwd: appRoot }),
      ]);
      return {
        device: `${model.trim()} (${serial})`,
        osVersion: release.trim(),
        sdk: api.trim(),
        avd: options.avd,
        adb: adbVersion.trim().replaceAll('\n', '; '),
        appArtifact: apk,
      };
    },
    async cleanup() {
      try { await forceStop(); } catch { /* device may already be gone */ }
      for (const port of [options.directorPort, options.serverPort, options.metroPort]) {
        try { await adb('reverse', '--remove', `tcp:${port}`); } catch { /* no mapping */ }
      }
      await stopOwned(metro);
      removeHarnessPortOwner(metroOwnerFile, metro?.pid);
      if (emulatorChild !== null) {
        try { await adb('emu', 'kill'); } catch { /* emulator already gone */ }
        await stopOwned(emulatorChild);
      }
    },
  });
  } catch (error) {
    await stopOwned(metro);
    removeHarnessPortOwner(metroOwnerFile, metro?.pid);
    if (emulatorChild !== null) {
      if (serial !== null) {
        try {
          await run('stop Android emulator after setup failure', options.adb, [
            '-s', serial, 'emu', 'kill',
          ], { cwd: appRoot });
        } catch { /* preserve the setup failure */ }
      }
      await stopOwned(emulatorChild);
    }
    throw error;
  }
}
