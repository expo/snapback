import assert from 'node:assert/strict';

import {
  SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_HOOK,
  installSupervisedDevIdentityCheckoutNonce,
} from './install-core.mjs';

const firstNonce = `checkout-${'a'.repeat(40)}`;
const rotatedNonce = `checkout-${'b'.repeat(40)}`;
const target = {};
const bootOrder = [];

const first = installSupervisedDevIdentityCheckoutNonce(firstNonce, { globalObject: target });
bootOrder.push('checkout-installed');
assert.equal(target[SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_HOOK], firstNonce);
bootOrder.push('application-module-evaluated');
assert.deepEqual(bootOrder, ['checkout-installed', 'application-module-evaluated']);
assert.deepEqual(first, { installed: true, replaced: false, value: firstNonce });

const descriptor = Object.getOwnPropertyDescriptor(
  target,
  SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_HOOK,
);
assert.equal(descriptor.enumerable, false);
assert.equal(descriptor.writable, false);
assert.equal(descriptor.configurable, true, 'a fresh native launch delivery may rotate the hook');

const repeated = installSupervisedDevIdentityCheckoutNonce(firstNonce, { globalObject: target });
assert.deepEqual(repeated, { installed: false, replaced: false, value: firstNonce });

const rotated = installSupervisedDevIdentityCheckoutNonce(rotatedNonce, { globalObject: target });
assert.deepEqual(rotated, { installed: true, replaced: true, value: rotatedNonce });
assert.equal(target[SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_HOOK], rotatedNonce);

assert.deepEqual(
  installSupervisedDevIdentityCheckoutNonce(null, { globalObject: target }),
  { installed: false, replaced: false, value: null },
);
assert.equal(
  target[SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_HOOK],
  rotatedNonce,
  'an absent later delivery cannot resurrect or clear checkout state',
);

const conflicted = {};
Object.defineProperty(conflicted, SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_HOOK, {
  configurable: false,
  value: 'occupied',
});
assert.throws(
  () => installSupervisedDevIdentityCheckoutNonce(firstNonce, { globalObject: conflicted }),
  (error) => error?.code === 'SNAPBACK_EXPO_NATIVE_CHECKOUT_HOOK_CONFLICT'
    && !error.message.includes(firstNonce),
);

console.log('install.test.mjs: pre-application order, once-only install, non-enumerability, and rotation replacement pass');
