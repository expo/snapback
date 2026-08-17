import assert from 'node:assert/strict';
import test from 'node:test';

import { iosShareExtensionProbeSatisfied } from '../lib/runner.mjs';

const bundleId = 'dev.snapback.custodyprobes';

function passingCandidate() {
  return {
    trigger: {
      mechanism: 'XCUITest-driven share sheet',
      testTarget: 'NativeCustodyProbesUITests',
      exitStatus: 0,
      timedOut: false,
    },
    mainApp: { pid: 17638 },
    osObservedExtensionProcesses: [
      { pid: 17667, label: `UIKitApplication:${bundleId}.share[instance]` },
    ],
    extension: {
      bundleIdentifier: `${bundleId}.share`,
      extensionPointIdentifier: 'com.apple.share-services',
      pid: 17667,
      code: 'SNAPBACK_AUTH_CUSTODY_SINGLE_RUNTIME_REFUSED',
      reason: 'app-extension',
      ioOccurred: false,
    },
  };
}

test('P4 refuses a forged extension report PID absent from the OS-observed set', () => {
  const candidate = passingCandidate();
  assert.equal(iosShareExtensionProbeSatisfied(candidate, bundleId), true);
  assert.equal(iosShareExtensionProbeSatisfied({
    ...candidate,
    extension: { ...candidate.extension, pid: 4242 },
  }, bundleId), false);
});
