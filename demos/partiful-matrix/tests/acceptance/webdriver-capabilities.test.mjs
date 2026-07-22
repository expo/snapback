import assert from 'node:assert/strict';
import test from 'node:test';

import { webdriverCapabilities } from './webdriver-capabilities.mjs';

test('iOS Safari requests an explicitly identified simulator', () => {
  assert.deepEqual(webdriverCapabilities({
    browserName: 'ios-safari',
    phase4Claim: 'STEP4.UI.RESPONSIVE',
    iosSimulatorUdid: 'SIMULATOR-UDID',
  }), {
    browserName: 'safari',
    platformName: 'ios',
    'safari:useSimulator': true,
    'safari:deviceUDID': 'SIMULATOR-UDID',
  });
});

test('iOS Safari refuses ambient simulator selection', () => {
  assert.throws(
    () => webdriverCapabilities({ browserName: 'ios-safari', phase4Claim: null, iosSimulatorUdid: null }),
    /explicit simulator UDID/,
  );
});

test('desktop Safari remains a distinct host capability', () => {
  assert.deepEqual(webdriverCapabilities({ browserName: 'safari' }), { browserName: 'safari' });
});
