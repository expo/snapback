import assert from 'node:assert/strict';
import test from 'node:test';

import { iosShareProbeTestArguments } from '../lib/ios-device.mjs';

test('iOS extension trigger runs only the shared-scheme UI test in the existing DerivedData', () => {
  const args = iosShareProbeTestArguments({
    udid: 'SIMULATOR-UDID',
    derivedData: '/tmp/custody-derived-data',
    bundleId: 'dev.snapback.custodyprobes',
  });
  assert.deepEqual(args, [
    'test',
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
  assert.equal(args.includes('test-without-building'), false);
});
