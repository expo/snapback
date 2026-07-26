import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isPrivateDeviceReachableIpv4,
  webdriverCapabilities,
} from './webdriver-capabilities.mjs';

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

test('physical iOS Safari requests one explicitly paired iPhone', () => {
  assert.deepEqual(webdriverCapabilities({
    browserName: 'ios-safari-device',
    phase4Claim: 'STEP4.UI.KEYBOARD',
    iosDeviceUdid: 'PHYSICAL-DEVICE-UDID',
  }), {
    browserName: 'safari',
    platformName: 'ios',
    'safari:useSimulator': false,
    'safari:deviceType': 'iPhone',
    'safari:deviceUDID': 'PHYSICAL-DEVICE-UDID',
  });
});

test('physical iOS Safari refuses ambient device selection', () => {
  assert.throws(
    () => webdriverCapabilities({
      browserName: 'ios-safari-device',
      phase4Claim: null,
      iosDeviceUdid: null,
    }),
    /explicit device UDID/,
  );
});

test('desktop Safari remains a distinct host capability', () => {
  assert.deepEqual(webdriverCapabilities({ browserName: 'safari' }), { browserName: 'safari' });
});

test('physical carrier binds only a device-reachable private IPv4 address', () => {
  for (const address of ['10.0.0.2', '172.16.2.3', '192.168.1.13', '169.254.2.4', '100.106.94.95']) {
    assert.equal(isPrivateDeviceReachableIpv4(address), true, address);
  }
  for (const address of ['127.0.0.1', '8.8.8.8', 'example.com', '192.168.1.999', '']) {
    assert.equal(isPrivateDeviceReachableIpv4(address), false, address);
  }
});
