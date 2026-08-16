import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validateSnapbackExpoDevIdentityConfig } = require('./config-plugin.cjs');

const ownBundle = {
  platforms: ['ios', 'android'],
  ios: { bundleIdentifier: 'dev.snapback.checkoutwitness' },
  android: { package: 'dev.snapback.checkoutwitness' },
};
assert.equal(validateSnapbackExpoDevIdentityConfig(ownBundle), ownBundle);
assert.equal(
  validateSnapbackExpoDevIdentityConfig({
    platforms: ['ios'],
    ios: { bundleIdentifier: 'dev.snapback.checkoutwitness' },
  }).platforms[0],
  'ios',
);
for (const config of [
  { platforms: ['ios'], ios: {} },
  { platforms: ['ios'], ios: { bundleIdentifier: 'host.exp.Exponent' } },
  { platforms: ['android'], android: {} },
  { platforms: ['android'], android: { package: 'host.exp.exponent' } },
]) {
  assert.throws(
    () => validateSnapbackExpoDevIdentityConfig(config),
    (error) => error?.code === 'SNAPBACK_EXPO_NATIVE_CHECKOUT_OWN_BUNDLE_REQUIRED',
  );
}

console.log('config-plugin.test.mjs: own development-client identifiers pass and Expo Go identifiers refuse');
