#!/usr/bin/env node
import { harnessUsage, parseArgs } from './lib/args.mjs';
import { createAndroidDevice } from './lib/android-device.mjs';
import { runNativeCustodyHarness } from './lib/runner.mjs';

const options = parseArgs(process.argv.slice(2), 'Android', {
  directorPort: Number(process.env.SNAPBACK_CUSTODY_DIRECTOR_PORT ?? 18772),
  serverPort: Number(process.env.SNAPBACK_CUSTODY_SERVER_PORT ?? 4299),
  metroPort: Number(process.env.SNAPBACK_CUSTODY_METRO_PORT ?? 8081),
  iterations: Number(process.env.SNAPBACK_CUSTODY_ITERATIONS ?? 15),
  bundleId: process.env.SNAPBACK_CUSTODY_BUNDLE_ID ?? 'dev.snapback.custodyprobes',
  adb: process.env.ADB ?? 'adb',
  serial: process.env.ANDROID_SERIAL ?? null,
  avd: process.env.SNAPBACK_ANDROID_AVD ?? 'Medium_Phone_API_36.1',
  emulator: process.env.ANDROID_EMULATOR ?? 'emulator',
  apk: process.env.SNAPBACK_ANDROID_APK ?? null,
  iosExtensionEvidence: null,
  email: null,
  password: null,
});

if (options.help) {
  console.log(harnessUsage('Android'));
} else try {
  const result = await runNativeCustodyHarness({
    platform: 'android', options, createDevice: createAndroidDevice, harnessFile: import.meta.dirname,
  });
  console.log(`native custody Android harness: ${result.verdict}; receipt ${result.evidence}`);
} catch (error) {
  console.error(`native custody Android harness failed: ${error.message}`);
  process.exitCode = 1;
}
