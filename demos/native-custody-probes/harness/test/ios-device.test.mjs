import assert from 'node:assert/strict';
import test from 'node:test';

import {
  iosBuildForTestingArguments,
  iosShareProbeTestArguments,
  launchctlProcessRows,
} from '../lib/ios-device.mjs';

test('iOS extension trigger runs only the shared-scheme UI test in the existing DerivedData', () => {
  const args = iosShareProbeTestArguments({
    udid: 'SIMULATOR-UDID',
    derivedData: '/tmp/custody-derived-data',
    bundleId: 'dev.snapback.custodyprobes',
  });
  assert.deepEqual(args, [
    'test-without-building',
    '-workspace', 'ios/NativeCustodyProbes.xcworkspace',
    '-scheme', 'NativeCustodyProbes',
    '-destination', 'id=SIMULATOR-UDID',
    '-derivedDataPath', '/tmp/custody-derived-data',
    '-only-testing:NativeCustodyProbesUITests',
    'APP_PRODUCT_BUNDLE_IDENTIFIER=dev.snapback.custodyprobes',
    'NSE_PRODUCT_BUNDLE_IDENTIFIER=dev.snapback.custodyprobes.nse',
    'SHARE_PRODUCT_BUNDLE_IDENTIFIER=dev.snapback.custodyprobes.share',
    'UITEST_PRODUCT_BUNDLE_IDENTIFIER=dev.snapback.custodyprobes.uitests',
  ]);
  assert.equal(args.includes('build'), false);
  assert.equal(args.includes('test-without-building'), true);
});

test('iOS main build prepares the same DerivedData for test-without-building', () => {
  const args = iosBuildForTestingArguments({
    udid: 'SIMULATOR-UDID',
    derivedData: '/tmp/custody-derived-data',
    bundleId: 'dev.snapback.custodyprobes',
  });
  assert.deepEqual(args, [
    '-workspace', 'ios/NativeCustodyProbes.xcworkspace',
    '-scheme', 'NativeCustodyProbes',
    '-configuration', 'Debug',
    '-sdk', 'iphonesimulator',
    '-destination', 'id=SIMULATOR-UDID',
    '-derivedDataPath', '/tmp/custody-derived-data',
    'APP_PRODUCT_BUNDLE_IDENTIFIER=dev.snapback.custodyprobes',
    'NSE_PRODUCT_BUNDLE_IDENTIFIER=dev.snapback.custodyprobes.nse',
    'SHARE_PRODUCT_BUNDLE_IDENTIFIER=dev.snapback.custodyprobes.share',
    'UITEST_PRODUCT_BUNDLE_IDENTIFIER=dev.snapback.custodyprobes.uitests',
    'build-for-testing',
  ]);
});

test('launchctl parser retains every active row containing the share bundle id', () => {
  const rows = launchctlProcessRows(`\
17638\t0\tUIKitApplication:dev.snapback.custodyprobes[abc]
17667\t0\tUIKitApplication:dev.snapback.custodyprobes.share[def]
17668\t0\tcom.apple.xpc.launchd.oneshot.0x1.dev.snapback.custodyprobes.share
-\t0\tUIKitApplication:dev.snapback.custodyprobes.share[inactive]
`, 'dev.snapback.custodyprobes.share');
  assert.deepEqual(rows, [
    { pid: 17667, label: 'UIKitApplication:dev.snapback.custodyprobes.share[def]' },
    { pid: 17668, label: 'com.apple.xpc.launchd.oneshot.0x1.dev.snapback.custodyprobes.share' },
  ]);
});
