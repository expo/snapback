'use strict';

const packageManifest = require('./package.json');

const EXPO_GO_IOS_BUNDLE_IDENTIFIER = 'host.exp.Exponent';
const EXPO_GO_ANDROID_PACKAGE = 'host.exp.exponent';

function configError(platform, field, value) {
  const error = new Error(
    `SNAPBACK_EXPO_NATIVE_CHECKOUT_OWN_BUNDLE_REQUIRED: ${platform} ${field} must name the application's development-client bundle`,
  );
  error.code = 'SNAPBACK_EXPO_NATIVE_CHECKOUT_OWN_BUNDLE_REQUIRED';
  error.diagnostic = Object.freeze({
    code: error.code,
    message: 'Native dev-identity checkout requires an application-owned Expo development client.',
    details: Object.freeze({ platform, field, configured: typeof value === 'string' }),
  });
  return error;
}

function validateSnapbackExpoDevIdentityConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new TypeError('Expo config must be an object');
  }
  const platforms = Array.isArray(config.platforms)
    ? new Set(config.platforms)
    : new Set(['ios', 'android']);
  if (platforms.has('ios')) {
    const bundleIdentifier = config.ios?.bundleIdentifier;
    if (
      typeof bundleIdentifier !== 'string'
      || bundleIdentifier.length === 0
      || bundleIdentifier === EXPO_GO_IOS_BUNDLE_IDENTIFIER
    ) {
      throw configError('ios', 'bundleIdentifier', bundleIdentifier);
    }
  }
  if (platforms.has('android')) {
    const androidPackage = config.android?.package;
    if (
      typeof androidPackage !== 'string'
      || androidPackage.length === 0
      || androidPackage === EXPO_GO_ANDROID_PACKAGE
    ) {
      throw configError('android', 'package', androidPackage);
    }
  }
  return config;
}

function withSnapbackExpoDevIdentity(config) {
  const { createRunOncePlugin } = require('expo/config-plugins');
  const validated = validateSnapbackExpoDevIdentityConfig(config);
  return createRunOncePlugin(
    (next) => next,
    packageManifest.name,
    packageManifest.version,
  )(validated);
}

module.exports = withSnapbackExpoDevIdentity;
module.exports.withSnapbackExpoDevIdentity = withSnapbackExpoDevIdentity;
module.exports.validateSnapbackExpoDevIdentityConfig = validateSnapbackExpoDevIdentityConfig;
