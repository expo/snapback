import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { eventually, run, spawnOwned, stopOwned } from './process.mjs';

function onlineEmulators(output) {
  return output.split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/u))
    .filter(([serial, state]) => serial?.startsWith('emulator-') && state === 'device')
    .map(([serial]) => serial);
}

export async function createAndroidDevice({ appRoot, options }) {
  let output = await run('Android device discovery', options.adb, ['devices'], { cwd: appRoot });
  let serial = options.serial ?? onlineEmulators(output)[0] ?? null;
  let emulatorChild = null;
  let metro = null;
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

  metro = spawnOwned('Expo Metro', join(appRoot, 'node_modules', '.bin', 'expo'), [
    'start', '--dev-client', '--port', String(options.metroPort),
  ], { cwd: appRoot, env: { CI: '1', EXPO_NO_TELEMETRY: '1' } });
  await eventually(async () => {
    if (metro.exitCode !== null || metro.signalCode !== null) {
      throw new Error(`Metro exited: ${metro.capturedOutput().slice(-8_000)}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${options.metroPort}/status`);
      return response.ok ? true : null;
    } catch { return null; }
  }, 'Expo Metro', 120_000, 250);

  const adb = (...args) => run('adb command', options.adb, ['-s', serial, ...args], { cwd: appRoot });
  const forceStop = async () => { await adb('shell', 'am', 'force-stop', options.bundleId); };
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
    async kill({ midWrite = false } = {}) {
      if (!midWrite) {
        await forceStop();
        return;
      }
      const pid = (await adb('shell', 'pidof', options.bundleId)).trim().split(/\s+/u)[0];
      if (!/^\d+$/u.test(pid)) throw new Error(`P2/android-kill: no PID for ${options.bundleId}`);
      try { await adb('shell', 'kill', '-9', pid); } catch { /* the process died at the syscall */ }
      await forceStop();
    },
    async screenshot(path) {
      const bytes = execFileSync(options.adb, ['-s', serial, 'exec-out', 'screencap', '-p'], {
        cwd: appRoot, maxBuffer: 32 * 1024 * 1024,
      });
      writeFileSync(path, bytes);
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
      if (emulatorChild !== null) {
        try { await adb('emu', 'kill'); } catch { /* emulator already gone */ }
        await stopOwned(emulatorChild);
      }
    },
  });
  } catch (error) {
    await stopOwned(metro);
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
