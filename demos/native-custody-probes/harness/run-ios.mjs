#!/usr/bin/env node
import { harnessUsage, parseArgs } from './lib/args.mjs';
import { createIosDevice } from './lib/ios-device.mjs';
import { runNativeCustodyHarness } from './lib/runner.mjs';

const options = parseArgs(process.argv.slice(2), 'iOS', {
  directorPort: Number(process.env.SNAPBACK_CUSTODY_DIRECTOR_PORT ?? 18771),
  serverPort: Number(process.env.SNAPBACK_CUSTODY_SERVER_PORT ?? 4298),
  metroPort: Number(process.env.SNAPBACK_CUSTODY_METRO_PORT ?? 8081),
  iterations: Number(process.env.SNAPBACK_CUSTODY_ITERATIONS ?? 15),
  bundleId: process.env.SNAPBACK_CUSTODY_BUNDLE_ID ?? 'dev.snapback.custodyprobes',
  udid: process.env.SNAPBACK_IOS_UDID ?? null,
  derivedData: process.env.SNAPBACK_IOS_DERIVED_DATA ?? null,
  appPath: process.env.SNAPBACK_IOS_APP_PATH ?? null,
  email: null,
  password: null,
});

if (options.help) {
  console.log(harnessUsage('iOS'));
} else try {
  const result = await runNativeCustodyHarness({
    platform: 'ios', options, createDevice: createIosDevice, harnessFile: import.meta.dirname,
  });
  console.log(`native custody iOS harness: ${result.verdict}; receipt ${result.evidence}`);
} catch (error) {
  console.error(`native custody iOS harness failed: ${error.message}`);
  process.exitCode = 1;
}
