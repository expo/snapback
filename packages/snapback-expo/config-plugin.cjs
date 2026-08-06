'use strict';

const { createHash } = require('node:crypto');
const {
  lstatSync,
  readFileSync,
  realpathSync,
} = require('node:fs');
const { createRequire } = require('node:module');
const { isAbsolute, relative, resolve, sep } = require('node:path');

const packageManifest = require('./package.json');
const RECEIPT_FORMAT = 'snapback.expo-integration-receipt.v1';
const DEFAULT_DESCRIPTOR = 'snapback/generated/app.descriptor.json';
const SUPPORTED = Object.freeze({
  expo: Object.freeze({ major: 57 }),
  react: Object.freeze({ major: 19 }),
  reactNative: Object.freeze({ major: 0, minor: 86 }),
  snapback: Object.freeze({ major: 0, minor: 1 }),
});

function failure(code, message, details = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code,
    severity: 'error',
    message,
    details: Object.freeze({ ...details }),
  });
  return error;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function inside(parent, child) {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function readDescriptor(projectRoot, input) {
  if (typeof input !== 'string' || input.length === 0 || isAbsolute(input)) {
    throw failure(
      'SNAPBACK_EXPO_DESCRIPTOR_PATH_INVALID',
      'The AppDescriptor input must be a project-relative path.',
      { descriptor: input ?? null },
    );
  }
  const requested = resolve(projectRoot, input);
  if (!inside(projectRoot, requested)) {
    throw failure(
      'SNAPBACK_EXPO_DESCRIPTOR_PATH_INVALID',
      'The AppDescriptor input must remain inside the Expo project.',
      { descriptor: input },
    );
  }
  let path;
  try {
    path = realpathSync(requested);
    const stat = lstatSync(path);
    if (!stat.isFile()) throw new Error('not a regular file');
  } catch (error) {
    throw failure(
      'SNAPBACK_APP_DESCRIPTOR_UNAVAILABLE',
      `The generated AppDescriptor could not be read: ${error.message}`,
      { descriptor: input },
    );
  }
  if (!inside(projectRoot, path)) {
    throw failure(
      'SNAPBACK_EXPO_DESCRIPTOR_PATH_INVALID',
      'The resolved AppDescriptor must remain inside the Expo project.',
      { descriptor: input },
    );
  }
  const bytes = readFileSync(path);
  let descriptor;
  try {
    descriptor = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw failure(
      'SNAPBACK_APP_DESCRIPTOR_INVALID',
      `The generated AppDescriptor is not JSON: ${error.message}`,
      { descriptor: input },
    );
  }
  const identityKeys = ['app', 'descriptor', 'functions', 'schema'];
  if (
    descriptor?.format !== 'snapback.app.v1'
    || !exactKeys(descriptor.identity, identityKeys)
    || identityKeys.some((key) => (
      typeof descriptor.identity[key] !== 'string' || descriptor.identity[key].length === 0
    ))
    || !Array.isArray(descriptor.capabilities?.required)
    || descriptor.capabilities.required.some((entry) => typeof entry !== 'string')
  ) {
    throw failure(
      'SNAPBACK_APP_DESCRIPTOR_INVALID',
      'The config plugin requires an LLP 0179 snapback.app.v1 descriptor.',
      { descriptor: input, observedFormat: descriptor?.format ?? null },
    );
  }
  return Object.freeze({
    bytes,
    descriptor,
    relativePath: relative(projectRoot, path).split(sep).join('/'),
  });
}

function packageVersion(projectRoot, name) {
  try {
    const request = createRequire(resolve(projectRoot, 'package.json'));
    const path = request.resolve(`${name}/package.json`);
    return JSON.parse(readFileSync(path, 'utf8')).version;
  } catch (error) {
    throw failure(
      'SNAPBACK_EXPO_COMPATIBILITY_UNSUPPORTED',
      `Could not resolve ${name}/package.json from the Expo project.`,
      { package: name, cause: error.code ?? error.message },
    );
  }
}

function tuple(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(version ?? '');
  return match ? match.slice(1).map(Number) : null;
}

function assertVersion(name, version, expected) {
  const actual = tuple(version);
  const supported = actual !== null
    && actual[0] === expected.major
    && (expected.minor === undefined || actual[1] === expected.minor);
  if (!supported) {
    throw failure(
      'SNAPBACK_EXPO_COMPATIBILITY_UNSUPPORTED',
      `${name}@${version ?? '<missing>'} is outside this package's supported E0 tuple.`,
      { package: name, version: version ?? null, expected },
    );
  }
}

function compatibility(projectRoot, config) {
  const versions = Object.freeze({
    expo: packageVersion(projectRoot, 'expo'),
    react: packageVersion(projectRoot, 'react'),
    reactNative: packageVersion(projectRoot, 'react-native'),
    snapbackClient: packageVersion(projectRoot, '@expo/snapback-client'),
    snapbackReact: packageVersion(projectRoot, '@expo/snapback-react'),
  });
  assertVersion('expo', versions.expo, SUPPORTED.expo);
  assertVersion('react', versions.react, SUPPORTED.react);
  assertVersion('react-native', versions.reactNative, SUPPORTED.reactNative);
  assertVersion('@expo/snapback-client', versions.snapbackClient, SUPPORTED.snapback);
  assertVersion('@expo/snapback-react', versions.snapbackReact, SUPPORTED.snapback);
  assertVersion('@expo/snapback-expo', packageManifest.version, SUPPORTED.snapback);
  if (config.sdkVersion !== undefined) assertVersion('expo.sdkVersion', config.sdkVersion, SUPPORTED.expo);
  return versions;
}

function createReceipt({ descriptor, versions }) {
  const pluginBytes = readFileSync(__filename);
  const manifestBytes = readFileSync(resolve(__dirname, 'package.json'));
  return Object.freeze({
    format: RECEIPT_FORMAT,
    package: Object.freeze({
      name: packageManifest.name,
      version: packageManifest.version,
    }),
    descriptor: Object.freeze({
      path: descriptor.relativePath,
      identity: descriptor.descriptor.identity.descriptor,
      digest: sha256(descriptor.bytes),
    }),
    compatibility: versions,
    native: Object.freeze({
      adapters: Object.freeze(['react-native-app-state']),
      permissions: Object.freeze({ ios: Object.freeze([]), android: Object.freeze([]) }),
    }),
    buildInvalidation: Object.freeze({
      inputs: Object.freeze([
        Object.freeze({ kind: 'app-descriptor', digest: sha256(descriptor.bytes) }),
        Object.freeze({ kind: 'config-plugin', digest: sha256(pluginBytes) }),
        Object.freeze({ kind: 'package', digest: sha256(manifestBytes) }),
      ]),
    }),
    changes: Object.freeze([
      'app-descriptor-input:registered',
      'build-invalidation:descriptor-plugin-package',
      'lifecycle:react-native-app-state',
      'native-permissions:none-in-e0',
    ]),
  });
}

// @ref LLP 0181#config-plugin — E0 has one native lifecycle adapter and no
// native permission-bearing feature. The receipt records that exact empty
// permission delta plus descriptor/plugin/package invalidation inputs; it
// contains no binding, endpoint, session, pairing, or credential material.
function withSnapbackExpo(config, options = {}) {
  if (!isRecord(config)) throw new TypeError('Expo config must be an object');
  const projectRootInput = options.projectRoot ?? config._internal?.projectRoot;
  if (typeof projectRootInput !== 'string' || projectRootInput.length === 0) {
    throw failure(
      'SNAPBACK_EXPO_PROJECT_ROOT_REQUIRED',
      'Expo must provide _internal.projectRoot to the Snapback config plugin.',
    );
  }
  const projectRoot = realpathSync(projectRootInput);
  const descriptor = readDescriptor(projectRoot, options.descriptor ?? DEFAULT_DESCRIPTOR);
  const versions = compatibility(projectRoot, config);
  const receipt = createReceipt({ descriptor, versions });
  const extra = isRecord(config.extra) ? config.extra : {};
  const snapback = isRecord(extra.snapback) ? extra.snapback : {};
  return {
    ...config,
    extra: {
      ...extra,
      snapback: {
        ...snapback,
        integrationReceipt: receipt,
      },
    },
  };
}

module.exports = withSnapbackExpo;
module.exports.withSnapbackExpo = withSnapbackExpo;
module.exports.SNAPBACK_EXPO_INTEGRATION_RECEIPT_FORMAT = RECEIPT_FORMAT;
