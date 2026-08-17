import {
  AuthCoordinator,
  SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract/auth-coordinator';
import {
  createIndexedDbAuthCustodyStorage,
} from '@expo/snapback-contract/auth-custody-indexeddb';

import { snapbackDiagnosticError } from './diagnostic-error.mjs';
import {
  installDevIdentityCapability,
  validateDevIdentityCapability,
} from './dev-identity-capability.mjs';
import { SnapbackClient } from './index.mjs';

export const DEFAULT_AUTH_STORAGE_PARTITION = 'default';

const OWNER_REGISTRY = new Map();
const PROJECTION_OWNERS = new WeakMap();
const PROVIDER_VALIDATED_NATIVE_GRADES = new WeakMap();
const POLICY_KEYS = [
  'anonymousPublic',
  'appId',
  'custody',
  'entryMechanisms',
  'format',
  'lifecycleProtocol',
  'mode',
];
const BINDING_KEYS = [
  'capabilities',
  'descriptorIdentity',
  'format',
  'integrity',
  'provenance',
  'source',
  'target',
];
const TARGET_KEYS = ['app', 'functions', 'origin', 'routing', 'schema'];
const POLICY_MECHANISMS = [
  'password-v1',
  'email-code-v1',
  'external-session-explicit-v1',
];
const HOSTED_DEVELOPMENT_ADMISSION = Symbol.for(
  '@expo/snapback-client/hosted-development-admission.v1',
);
const HOSTED_DEVELOPMENT_ADMISSION_KEYS = [
  'descriptorIdentity',
  'format',
  'targetTuple',
];

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const exactKeys = (value, expected) => {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
};

const remediation = (kind, description, precondition = {}, {
  riskClass = 'mechanical',
  machineApplicable = false,
  requiresApproval = false,
  authorityEffect = 'none',
} = {}) => Object.freeze({
  kind,
  riskClass,
  machineApplicable,
  requiresApproval,
  authorityEffect,
  precondition: Object.freeze({ ...precondition }),
  description,
});

const refusal = (code, message, details = {}, remediations = [], facts = {}) => {
  const error = snapbackDiagnosticError(code, message, details, facts);
  error.remediations = Object.freeze([...remediations]);
  return error;
};

const retryBootstrap = (code) => remediation(
  'retryAuthBootstrap',
  'Retry application authentication bootstrap after repairing the named condition.',
  { code },
  { machineApplicable: true },
);

const signOutFirst = () => remediation(
  'signOut',
  'Call auth.signOut() before entering as a different application principal.',
  { principalStatus: 'authenticated' },
  { authorityEffect: 'clears-session' },
);

const freezeSnapshot = (value) => {
  const visit = (entry) => {
    if (!isRecord(entry) && !Array.isArray(entry)) return entry;
    if (Object.isFrozen(entry)) return entry;
    for (const child of Object.values(entry)) visit(child);
    return Object.freeze(entry);
  };
  return visit(structuredClone(value));
};

const MAX_BOOTSTRAP_HISTORY_FOR_TESTS = 16;

const emitSnapshot = (owner, snapshot) => {
  owner.snapshot = freezeSnapshot(snapshot);
  owner.bootstrapHistory?.push(owner.snapshot);
  if (owner.bootstrapHistory?.length > MAX_BOOTSTRAP_HISTORY_FOR_TESTS) {
    owner.bootstrapHistory.splice(0, owner.bootstrapHistory.length - MAX_BOOTSTRAP_HISTORY_FOR_TESTS);
  }
  for (const listener of [...owner.bootstrapListeners]) {
    try { listener(); } catch { /* bootstrap observation cannot own lifecycle */ }
  }
  for (const observer of [...owner.bootstrapObservers]) {
    try { observer(owner.snapshot); } catch { /* bootstrap observation cannot own lifecycle */ }
  }
};

const starting = (owner, stage) => emitSnapshot(owner, { status: 'starting', stage });

const canonicalSupervisedRelayPath = (value) => {
  if (
    !nonEmptyString(value)
    || value.includes('%')
    || value.includes('\\')
    || /[?#\u0000-\u001f\u007f]/u.test(value)
    || value.endsWith('/')
  ) return null;
  // packages/snapback-vite serves only these documented supervised relay
  // namespaces. Children are admitted as plain path segments so URL decoding
  // cannot widen the allowlist into Vite or Snapback control routes.
  for (const prefix of ['/__snapback', '/__exact/snapback']) {
    if (value === prefix) return value;
    if (!value.startsWith(`${prefix}/`)) continue;
    const segments = value.slice(prefix.length + 1).split('/');
    if (segments.every((segment) => (
      segment !== ''
      && segment !== '.'
      && segment !== '..'
      && /^[A-Za-z0-9._~-]+$/u.test(segment)
    ))) return value;
  }
  return null;
};

// @ref LLP 0030#generated-app-facts — a managed browser app receives the
// same-origin relay base, never the private loopback backend origin. Release
// bindings remain exact absolute HTTPS origins.
const canonicalTargetBase = (value) => {
  if (!nonEmptyString(value)) return null;
  if (value.startsWith('/')) {
    const relayPath = canonicalSupervisedRelayPath(value);
    if (relayPath === null) return null;
    try {
      const parsed = new URL(relayPath, 'http://snapback-vite-relay.invalid');
      if (
        parsed.origin !== 'http://snapback-vite-relay.invalid'
        || parsed.pathname !== relayPath
        || parsed.search !== ''
        || parsed.hash !== ''
      ) return null;
      return Object.freeze({ kind: 'same-origin-relay', url: parsed });
    } catch {
      return null;
    }
  }
  try {
    const parsed = new URL(value);
    if (
      parsed.username !== ''
      || parsed.password !== ''
      || parsed.pathname !== '/'
      || parsed.search !== ''
      || parsed.hash !== ''
      || parsed.origin === 'null'
      || parsed.origin !== value.replace(/\/$/u, '')
    ) return null;
    return Object.freeze({ kind: 'absolute-origin', url: parsed });
  } catch {
    return null;
  }
};

const isLoopbackHost = (hostname) => hostname === 'localhost'
  || hostname === '[::1]'
  || hostname === '::1'
  || /^127(?:\.[0-9]{1,3}){3}$/u.test(hostname);

const ipv4Octets = (hostname) => {
  const parts = hostname.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part))) return null;
  const octets = parts.map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
};

const ipv6Bytes = (hostname) => {
  const literal = hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (!literal.includes(':')) return null;
  const halves = literal.split('::');
  if (halves.length > 2) return null;
  const parseHalf = (half) => {
    if (half === '') return [];
    const fields = half.split(':');
    if (fields.some((field) => !/^[0-9a-f]{1,4}$/u.test(field))) return null;
    return fields.map((field) => Number.parseInt(field, 16));
  };
  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] ?? '');
  if (left === null || right === null) return null;
  const omitted = 8 - left.length - right.length;
  if ((halves.length === 1 && omitted !== 0) || (halves.length === 2 && omitted < 1)) return null;
  const fields = [...left, ...Array.from({ length: omitted }, () => 0), ...right];
  if (fields.length !== 8) return null;
  return fields.flatMap((field) => [field >>> 8, field & 0xff]);
};

const privateIpv4Class = (octets) => {
  if (octets === null) return null;
  if (octets.every((octet) => octet === 0)) return 'unspecified-address';
  if (octets[0] === 127) return 'loopback';
  if (
    octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 169 && octets[1] === 254)
  ) return 'private-ip-literal';
  return null;
};

// @ref LLP 0181#hosted-development-binding — this intentionally classifies
// only loopback names, unspecified addresses, and private IP literals.
// DNS-named private origins stay outside the client arm's guarantees while
// packet ruling 6 remains open.
export function __classifyHostedDevelopmentHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/u, '');
  if (isLoopbackHost(normalized) || normalized.endsWith('.localhost')) return 'loopback';
  const ipv4Class = privateIpv4Class(ipv4Octets(normalized));
  if (ipv4Class !== null) return ipv4Class;
  const bytes = ipv6Bytes(normalized);
  if (bytes === null) return null;
  if (bytes.every((byte) => byte === 0)) return 'unspecified-address';
  const ipv6Loopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  if (ipv6Loopback) return 'loopback';
  // RFC 5156 §2.3 reserves the deprecated IPv4-compatible ::/96 block.
  // Refuse the complete block, not only compatible spellings whose embedded
  // IPv4 value independently falls into the private/loopback classifier.
  const ipv4Compatible = bytes.slice(0, 12).every((byte) => byte === 0);
  if (ipv4Compatible) return 'ipv4-compatible-ipv6';
  const ipv4Mapped = bytes.slice(0, 10).every((byte) => byte === 0)
    && bytes[10] === 0xff
    && bytes[11] === 0xff;
  if (ipv4Mapped) return privateIpv4Class(bytes.slice(12));
  if ((bytes[0] & 0xfe) === 0xfc || (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80)) {
    return 'private-ip-literal';
  }
  return null;
}

const targetTuple = (target) => TARGET_KEYS.map((key) => target?.[key]).join('\u0000');
const hasHostedDevelopmentAdmission = (binding) => {
  const admission = binding?.[HOSTED_DEVELOPMENT_ADMISSION];
  return exactKeys(admission, HOSTED_DEVELOPMENT_ADMISSION_KEYS)
    && admission.format === 'snapback.hosted-development-admission.v1'
    && admission.descriptorIdentity === binding.descriptorIdentity
    && admission.targetTuple === targetTuple(binding.target);
};

function validateAppPolicy(app) {
  if (
    !isRecord(app)
    || app.format !== 'snapback.app.v1'
    || !isRecord(app.identity)
    || !['app', 'schema', 'functions', 'descriptor'].every(
      (field) => nonEmptyString(app.identity[field]),
    )
    || app.identity.app.trim() !== app.identity.app
  ) {
    throw refusal(
      'SNAPBACK_AUTH_BOOTSTRAP_APP_INVALID',
      'Application authentication bootstrap requires a generated snapback.app.v1 descriptor.',
      { observedFormat: app?.format ?? null },
      [remediation(
        'regenerateAppDescriptor',
        'Regenerate the application descriptor and pass its generated app export.',
        { expectedFormat: 'snapback.app.v1' },
        { machineApplicable: true },
      )],
    );
  }
  const policy = app.authBootstrap;
  const canonicalMechanisms = Array.isArray(policy?.entryMechanisms)
    && policy.entryMechanisms.every((entry) => POLICY_MECHANISMS.includes(entry))
    && new Set(policy.entryMechanisms).size === policy.entryMechanisms.length
    && policy.entryMechanisms.every((entry, index) => (
      index === 0
      || POLICY_MECHANISMS.indexOf(policy.entryMechanisms[index - 1])
        < POLICY_MECHANISMS.indexOf(entry)
    ));
  if (
    !exactKeys(policy, POLICY_KEYS)
    || policy.format !== 'snapback.application-auth-bootstrap.v1'
    || policy.appId !== app.identity.app
    || policy.mode !== 'sessions'
    || !['durable-required', 'volatile-explicit'].includes(policy.custody)
    || !['allowed', 'refused'].includes(policy.anonymousPublic)
    || policy.lifecycleProtocol !== 1
    || !canonicalMechanisms
  ) {
    throw refusal(
      'SNAPBACK_AUTH_BOOTSTRAP_POLICY_INVALID',
      'The generated ApplicationAuthBootstrapV1 policy is missing or invalid.',
      { appId: app.identity.app },
      [remediation(
        'regenerateAppDescriptor',
        'Regenerate the application descriptor from its normalized auth program.',
        { expectedFormat: 'snapback.application-auth-bootstrap.v1' },
        { machineApplicable: true },
      )],
    );
  }
  return policy;
}

function validateBinding(binding, app, policy, now = Date.now) {
  if (
    !exactKeys(binding, BINDING_KEYS)
    || binding.format !== 'snapback.app-binding.v1'
    || !['supervised-dev', 'hosted-development', 'release'].includes(binding.source)
    || !nonEmptyString(binding.descriptorIdentity)
    || !exactKeys(binding.target, TARGET_KEYS)
    || !TARGET_KEYS.filter((key) => key !== 'routing').every(
      (field) => nonEmptyString(binding.target[field]),
    )
    || !isRecord(binding.capabilities)
    || !exactKeys(binding.capabilities, ['offered'])
    || !Array.isArray(binding.capabilities.offered)
    || binding.capabilities.offered.some((entry) => !nonEmptyString(entry))
    || new Set(binding.capabilities.offered).size !== binding.capabilities.offered.length
  ) {
    throw refusal(
      'SNAPBACK_AUTH_BOOTSTRAP_BINDING_INVALID',
      'Application authentication bootstrap requires a closed admitted AppBindingV1.',
      { appId: app.identity.app },
      [retryBootstrap('SNAPBACK_AUTH_BOOTSTRAP_BINDING_INVALID')],
    );
  }
  const targetBase = canonicalTargetBase(binding.target.origin);
  // @ref LLP 0181#appbinding-v1 — hosted-development is a closed HTTPS-only
  // arm; it cannot inherit supervised loopback/forwarding semantics.
  const supervised = binding.source === 'supervised-dev';
  const hostedDevelopment = binding.source === 'hosted-development';
  const supervisedProvenance = exactKeys(
    binding.provenance,
    ['expiresAt', 'issuedAt', 'supervisorGeneration'],
  )
    && nonEmptyString(binding.provenance.supervisorGeneration)
    && Number.isFinite(Date.parse(binding.provenance.issuedAt))
    && Number.isFinite(Date.parse(binding.provenance.expiresAt))
    && Date.parse(binding.provenance.expiresAt) > Date.parse(binding.provenance.issuedAt)
    && Date.parse(binding.provenance.expiresAt) > now();
  const releaseProvenance = exactKeys(
    binding.provenance,
    ['buildReceipt', 'environment', 'releaseChannel'],
  ) && Object.values(binding.provenance).every(nonEmptyString);
  const hostedDevelopmentProvenance = exactKeys(
    binding.provenance,
    ['hostedTargetReceipt'],
  ) && nonEmptyString(binding.provenance.hostedTargetReceipt);
  const supervisedIntegrity = exactKeys(binding.integrity, ['channel'])
    && binding.integrity.channel === 'local-supervised-ipc';
  const releaseIntegrity = (
    exactKeys(binding.integrity, ['channel'])
    && binding.integrity.channel === 'embedded-at-build'
  ) || (
    exactKeys(binding.integrity, ['channel', 'signature'])
    && binding.integrity.channel === 'signed-artifact'
    && nonEmptyString(binding.integrity.signature)
  );
  const hostedDevelopmentIntegrity = exactKeys(binding.integrity, ['channel'])
    && binding.integrity.channel === 'hosted-target-admission';
  const hostedDevelopmentOrigin = hostedDevelopment
    && targetBase !== null && targetBase.kind === 'absolute-origin'
    ? targetBase.url
    : null;
  const hostedDevelopmentOriginClassification = hostedDevelopmentOrigin !== null
    ? __classifyHostedDevelopmentHostname(hostedDevelopmentOrigin.hostname)
    : null;
  if (
    hostedDevelopment
    && (
      hostedDevelopmentOrigin === null
      || binding.target.routing !== 'https'
      || hostedDevelopmentOrigin.protocol !== 'https:'
      || hostedDevelopmentOriginClassification !== null
    )
  ) {
    throw refusal(
      'SNAPBACK_APP_BINDING_TARGET_INVALID',
      'Hosted-development bindings require a public HTTPS origin, not a loopback name, unspecified address, or private IP literal.',
      {
        appId: app.identity.app,
        hostname: hostedDevelopmentOrigin?.hostname ?? null,
        classification: hostedDevelopmentOriginClassification,
      },
      [retryBootstrap('SNAPBACK_APP_BINDING_TARGET_INVALID')],
    );
  }
  const validRoute = targetBase !== null && (supervised
    ? targetBase.kind === 'same-origin-relay'
      ? binding.target.routing === 'loopback'
      : ['loopback', 'port-forward'].includes(binding.target.routing)
        && ['http:', 'https:'].includes(targetBase.url.protocol)
        && (isLoopbackHost(targetBase.url.hostname)
          || (binding.target.routing === 'port-forward'
            && targetBase.url.hostname === '10.0.2.2'))
    : targetBase.kind === 'absolute-origin'
      && binding.target.routing === 'https'
      && targetBase.url.protocol === 'https:');
  if (
    !validRoute
    || (supervised
      ? !supervisedProvenance || !supervisedIntegrity
      : hostedDevelopment
        ? !hostedDevelopmentProvenance || !hostedDevelopmentIntegrity
        : !releaseProvenance || !releaseIntegrity)
    || binding.target.app !== app.identity.app
    || binding.target.schema !== app.identity.schema
    || binding.target.functions !== app.identity.functions
    || binding.descriptorIdentity !== app.identity.descriptor
  ) {
    throw refusal(
      'SNAPBACK_AUTH_BOOTSTRAP_BINDING_INVALID',
      'The AppBinding does not admit the generated application identities and route.',
      { appId: app.identity.app, source: binding.source },
      [retryBootstrap('SNAPBACK_AUTH_BOOTSTRAP_BINDING_INVALID')],
    );
  }
  if (hostedDevelopment && !hasHostedDevelopmentAdmission(binding)) {
    throw refusal(
      'SNAPBACK_APP_BINDING_INTEGRITY_INVALID',
      'Hosted-development bootstrap requires the exact binding object admitted through the generated app-binding module.',
      { appId: app.identity.app, channel: binding.integrity.channel },
      [retryBootstrap('SNAPBACK_APP_BINDING_INTEGRITY_INVALID')],
    );
  }
  if (!binding.capabilities.offered.includes('auth.application-bootstrap.v1')) {
    throw refusal(
      'SNAPBACK_AUTH_BOOTSTRAP_CAPABILITY_UNAVAILABLE',
      'The admitted binding does not offer the application-auth bootstrap capability.',
      { appId: app.identity.app, missingCapability: 'auth.application-bootstrap.v1' },
      [remediation(
        'selectCompatibleBinding',
        'Select a binding that offers auth.application-bootstrap.v1.',
        { capability: 'auth.application-bootstrap.v1' },
      )],
    );
  }
  if (
    policy.entryMechanisms.includes('password-v1')
    && !binding.capabilities.offered.includes('auth.passwords')
  ) {
    throw refusal(
      'SNAPBACK_AUTH_BOOTSTRAP_MECHANISM_UNAVAILABLE',
      'The selected target does not offer the generated password entry mechanism.',
      { mechanism: 'password-v1', missingCapability: 'auth.passwords' },
      [remediation(
        'selectCompatibleBinding',
        'Select a target binding that offers auth.passwords.',
        { requiredCapability: 'auth.passwords' },
      )],
    );
  }
}

function validateStoragePartition(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 128
    || value.includes('\0')
  ) {
    throw refusal(
      'SNAPBACK_AUTH_BOOTSTRAP_PARTITION_INVALID',
      'storagePartition must be a non-empty string of at most 128 characters without NUL.',
      {},
    );
  }
  return value;
}

function normalizePlatform(platform) {
  const normalized = typeof platform === 'string' ? { kind: platform } : platform;
  const allowedKeys = new Set([
    'authCustodyStorage',
    'broadcastChannelFactory',
    'cryptoObject',
    'databaseName',
    'hintStorage',
    'indexedDB',
    'kind',
    'lockManager',
  ]);
  if (
    !isRecord(normalized)
    || !nonEmptyString(normalized.kind)
    || Object.keys(normalized).some((key) => !allowedKeys.has(key))
    || (normalized.kind === 'expo-native'
      && ['indexedDB', 'lockManager', 'databaseName'].some(
        (key) => Object.hasOwn(normalized, key),
      ))
  ) {
    throw refusal(
      'SNAPBACK_AUTH_BOOTSTRAP_PLATFORM_UNSUPPORTED',
      'Application authentication bootstrap requires an admitted platform kind.',
      {},
    );
  }
  const injectedNativeCustody = normalized.kind === 'expo-native'
    && normalized.authCustodyStorage !== null
    && (typeof normalized.authCustodyStorage === 'object'
      || typeof normalized.authCustodyStorage === 'function')
    && normalized.authCustodyStorage.ownerKeyCapability === 'owner-key-v1'
    && typeof normalized.authCustodyStorage.withOwnership === 'function';
  if (
    (!['browser', 'expo-web', 'memory'].includes(normalized.kind) && !injectedNativeCustody)
    || (normalized.kind !== 'expo-native'
      && Object.hasOwn(normalized, 'authCustodyStorage'))
  ) {
    throw refusal(
      'SNAPBACK_AUTH_BOOTSTRAP_PLATFORM_UNSUPPORTED',
      `No Phase 1 custody adapter is available for platform ${JSON.stringify(normalized.kind)}.`,
      { platform: normalized.kind },
      [remediation(
        'selectSupportedPlatform',
        'Use browser, expo-web, or explicitly volatile memory custody in Phase 1.',
        { platform: normalized.kind },
      )],
    );
  }
  return normalized;
}

function preflight(input) {
  if (!isRecord(input)) throw new TypeError('createSnapbackAppClient requires an options object');
  const expectedInputKeys = ['app', 'binding', 'platform'];
  if (Object.hasOwn(input, 'storagePartition')) expectedInputKeys.push('storagePartition');
  if (Object.hasOwn(input, 'now')) expectedInputKeys.push('now');
  if (Object.hasOwn(input, 'signal')) expectedInputKeys.push('signal');
  if (Object.hasOwn(input, 'rqsStore')) expectedInputKeys.push('rqsStore');
  if (!exactKeys(input, expectedInputKeys)) {
    throw refusal(
      'SNAPBACK_AUTH_BOOTSTRAP_INPUT_INVALID',
      'createSnapbackAppClient accepts only app, binding, platform, and optional storagePartition, now, signal, and rqsStore.',
      { actualKeys: Object.keys(input).sort() },
    );
  }
  const { app, binding } = input;
  const now = input.now ?? Date.now;
  if (typeof now !== 'function' || !Number.isFinite(now())) {
    throw new TypeError('createSnapbackAppClient `now` must be a function returning a finite timestamp');
  }
  const signal = input.signal ?? null;
  if (
    signal !== null
    && (
      typeof signal !== 'object'
      || typeof signal.aborted !== 'boolean'
      || typeof signal.addEventListener !== 'function'
      || typeof signal.removeEventListener !== 'function'
    )
  ) {
    throw new TypeError('createSnapbackAppClient `signal` must be an AbortSignal');
  }
  const policy = validateAppPolicy(app);
  validateBinding(binding, app, policy, now);
  const platform = normalizePlatform(input.platform);
  const storagePartition = validateStoragePartition(
    input.storagePartition ?? DEFAULT_AUTH_STORAGE_PARTITION,
  );
  if (policy.custody === 'durable-required') {
    const indexedDB = platform.indexedDB ?? globalThis.indexedDB;
    const injectedNativeCustody = platform.kind === 'expo-native'
      && platform.authCustodyStorage?.ownerKeyCapability === 'owner-key-v1';
    if (
      !injectedNativeCustody
      && (!['browser', 'expo-web'].includes(platform.kind) || !indexedDB?.open)
    ) {
      throw refusal(
        'SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE',
        'The generated policy requires durable custody, but this platform has no qualifying adapter.',
        { platform: platform.kind, requiredGrade: 'durable' },
        [remediation(
          'installDurableCustody',
          'Provide the first-party durable custody capability for this platform.',
          { requiredGrade: 'durable' },
        )],
      );
    }
  }
  return Object.freeze({
    app,
    binding,
    platform,
    policy,
    storagePartition,
    signal,
    rqsStore: input.rqsStore,
    rqsStoreIdentity: Object.hasOwn(input, 'rqsStore') ? input.rqsStore : undefined,
  });
}

const ownerKey = (appId, storagePartition) => (
  // @ref LLP 0258#d2-one-bootstrap-owner-constructs-the-auth-bearing-application-client
  // — process ownership is exactly the canonical app id plus stable storage
  // partition; binding and supervisor generations are intentionally absent.
  JSON.stringify([appId, storagePartition])
);

const policyIdentity = (policy) => JSON.stringify([
  policy.format,
  policy.appId,
  policy.mode,
  policy.custody,
  policy.entryMechanisms,
  policy.anonymousPublic,
  policy.lifecycleProtocol,
]);
const generationIdentity = (input) => JSON.stringify([
  input.app.identity.schema,
  input.app.identity.functions,
  input.app.identity.descriptor,
]);
const conflictIdentity = (binding) => JSON.stringify([
  binding.target.app,
  binding.target.origin,
  binding.target.routing,
]);
const exactCapture = (left, right) => left !== null && right !== null
  && left.authorityEpoch === right.authorityEpoch
  && left.authorityKey === right.authorityKey;

async function partitionIdentityHash(appId, storagePartition, cryptoObject) {
  if (!cryptoObject?.subtle || typeof TextEncoder !== 'function') {
    throw refusal(
      'SNAPBACK_AUTH_BOOTSTRAP_PLATFORM_UNSUPPORTED',
      'The selected custody platform does not provide WebCrypto identity hashing.',
      {},
    );
  }
  const bytes = new TextEncoder().encode(
    `snapback.auth-storage-partition.v1\n${JSON.stringify([appId, storagePartition])}`,
  );
  const digest = new Uint8Array(await cryptoObject.subtle.digest('SHA-256', bytes));
  return `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function resolveCustody(preflighted) {
  const { app, platform, policy, storagePartition } = preflighted;
  const cryptoObject = platform.cryptoObject ?? globalThis.crypto;
  const storagePartitionIdentityHash = await partitionIdentityHash(
    app.identity.app,
    storagePartition,
    cryptoObject,
  );
  if (policy.custody === 'volatile-explicit') {
    return Object.freeze({
      storage: createMemoryAuthCustodyStorage(),
      facts: Object.freeze({
        carrier: 'memory',
        grade: 'volatile',
        storagePartitionIdentityHash,
        formatVersion: SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
        recoveryAvailable: false,
      }),
    });
  }
  if (platform.kind === 'expo-native') {
    // @ref LLP 0258#d3-custody-is-selected-by-capability-never-convenience-fallback — ordinary native admission is Expo-provider evidence-gated; this layer re-checks the provider-threaded or advanced-injection grade.
    let reportedGrade;
    try {
      const providerValidatedGrade = PROVIDER_VALIDATED_NATIVE_GRADES.get(platform);
      if (providerValidatedGrade !== undefined) {
        reportedGrade = providerValidatedGrade;
      } else {
        if (typeof platform.authCustodyStorage.platformGrade !== 'function') {
          throw new TypeError('injected native custody has no platformGrade method');
        }
        reportedGrade = await platform.authCustodyStorage.platformGrade();
      }
    } catch (error) {
      throw refusal(
        'SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE',
        'The injected native custody adapter did not establish its durability grade.',
        {
          platform: platform.kind,
          requiredGrade: 'single-runtime-or-durable',
          causeCode: safeCauseCode(error),
        },
        [remediation(
          'installDurableCustody',
          'Provide an adapter whose platformGrade() reports an admitted grade and mechanism.',
          { requiredGrade: 'single-runtime-or-durable' },
        )],
      );
    }
    if (
      !isRecord(reportedGrade)
      || !['single-runtime', 'durable'].includes(reportedGrade.grade)
      || !reportedGrade.mechanism
    ) {
      throw refusal(
        'SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE',
        'The injected native custody adapter reported a malformed or insufficient durability grade.',
        {
          platform: platform.kind,
          requiredGrade: 'single-runtime-or-durable',
          reportedGrade: isRecord(reportedGrade) ? (reportedGrade.grade ?? null) : null,
        },
        [remediation(
          'installDurableCustody',
          'Provide an adapter whose platformGrade() reports an admitted grade and mechanism.',
          { requiredGrade: 'single-runtime-or-durable' },
        )],
      );
    }
    return Object.freeze({
      storage: platform.authCustodyStorage,
      facts: Object.freeze({
        carrier: 'expo-native-injected',
        grade: reportedGrade.grade,
        mechanism: reportedGrade.mechanism,
        storagePartitionIdentityHash,
        formatVersion: SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
        recoveryAvailable: true,
      }),
    });
  }
  const lockManager = platform.lockManager ?? globalThis.navigator?.locks ?? null;
  const storage = createIndexedDbAuthCustodyStorage({
    indexedDB: platform.indexedDB ?? globalThis.indexedDB,
    lockManager,
    cryptoObject,
    ...(platform.databaseName === undefined ? {} : { databaseName: platform.databaseName }),
  });
  return Object.freeze({
    storage,
    facts: Object.freeze({
      carrier: lockManager?.request ? 'indexeddb-web-locks' : 'indexeddb-fenced-lease',
      grade: 'durable',
      storagePartitionIdentityHash,
      formatVersion: SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
      recoveryAvailable: true,
    }),
  });
}

function authCoordinatorCrossContextOptions(platform) {
  if (platform.kind === 'browser' || platform.kind === 'expo-web') {
    // @ref LLP 0059#cross-context-ownership — omitted browser mechanisms use
    // the coordinator's BroadcastChannel/localStorage wakeup defaults; an
    // explicit injected value (including null) remains testable and host-owned.
    return {
      ...(Object.hasOwn(platform, 'broadcastChannelFactory')
        ? { broadcastChannelFactory: platform.broadcastChannelFactory }
        : {}),
      ...(Object.hasOwn(platform, 'hintStorage')
        ? { hintStorage: platform.hintStorage }
        : {}),
    };
  }
  return {
    broadcastChannelFactory: platform.broadcastChannelFactory ?? null,
    hintStorage: platform.hintStorage ?? null,
  };
}

const safeCauseCode = (error) => {
  const observed = error?.diagnostic?.code ?? error?.code;
  return nonEmptyString(observed) ? observed : 'SNAPBACK_AUTH_BOOTSTRAP_FAILED';
};

function failureSnapshot(error) {
  const causeCode = safeCauseCode(error);
  const status = causeCode === 'SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE'
    || causeCode === 'SNAPBACK_AUTH_BOOTSTRAP_PLATFORM_UNSUPPORTED'
    ? 'unsupported'
    : (causeCode === 'SNAPBACK_AUTH_POLICY_UNAVAILABLE'
      || causeCode.includes('AUTH_MODE'))
      ? 'authority-required'
      : causeCode.includes('CUSTODY') || causeCode.includes('AUTHORITY')
        ? 'blocked'
        : 'error';
  const diagnostic = error?.diagnostic?.schemaVersion === 'snapback.client-diagnostic.v1'
    ? error.diagnostic
    : refusal(
        'SNAPBACK_AUTH_BOOTSTRAP_FAILED',
        'Application authentication bootstrap failed before public release.',
        { causeCode },
      ).diagnostic;
  return freezeSnapshot({
    status,
    diagnostic,
    remediations: error?.remediations ?? [retryBootstrap(causeCode)],
  });
}

function publishReady(owner) {
  emitSnapshot(owner, {
    status: 'ready',
    custody: owner.custodyFacts,
    authoritySource: owner.authoritySource,
    advisories: owner.advisories,
  });
}

const supervisedConflictAdvisory = (owner, supervisedPrincipal) => Object.freeze({
  diagnostic: refusal(
    'SNAPBACK_AUTH_SUPERVISED_PRINCIPAL_CONFLICT',
    'The supervised development principal did not replace restored or application authority.',
    {
      appId: owner.app.identity.app,
      currentPrincipalStatus: owner.client.auth.currentPrincipal().status,
      supervisedUserId: supervisedPrincipal?.userId ?? null,
    },
  ).diagnostic,
  remediations: Object.freeze([
    remediation(
      'keepCurrentPrincipal',
      'Keep the current application principal; no action is required.',
      { appId: owner.app.identity.app },
    ),
    remediation(
      'signOut',
      'Call auth.signOut(); the next supervisor event may then admit the development principal.',
      { principalStatus: 'authenticated' },
      { authorityEffect: 'clears-session' },
    ),
    remediation(
      'useStoragePartition',
      'Construct the development projection with an explicit distinct storagePartition.',
      { appId: owner.app.identity.app },
    ),
  ]),
});

function replaceSupervisedConflictAdvisory(owner, advisory) {
  owner.advisories = Object.freeze([
    ...owner.advisories.filter(
      (entry) => entry.diagnostic.code !== 'SNAPBACK_AUTH_SUPERVISED_PRINCIPAL_CONFLICT',
    ),
    ...(advisory === null ? [] : [advisory]),
  ]);
}

const constructionAbortReason = (signal) => signal?.reason
  ?? Object.assign(new Error('Application auth bootstrap construction was aborted.'), {
    name: 'AbortError',
  });

function throwIfConstructionAborted(signal) {
  if (signal?.aborted === true) throw constructionAbortReason(signal);
}

function awaitConstructionBoundary(value, signal, disposeLateValue = null) {
  if (signal === null) return Promise.resolve(value);
  if (signal.aborted) return Promise.reject(constructionAbortReason(signal));
  const pending = Promise.resolve(value);
  return new Promise((resolve, reject) => {
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      signal.removeEventListener('abort', onAbort);
      reject(constructionAbortReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    pending.then(
      (result) => {
        signal.removeEventListener('abort', onAbort);
        if (aborted) {
          try { void Promise.resolve(disposeLateValue?.(result)).catch(() => {}); } catch { /* abort owns outcome */ }
          return;
        }
        resolve(result);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        if (!aborted) reject(error);
      },
    );
  });
}

async function constructOwner(preflighted, bootstrapObservers, onOwner) {
  const owner = {
    app: preflighted.app,
    binding: preflighted.binding,
    platform: preflighted.platform,
    storagePartition: preflighted.storagePartition,
    rqsStoreIdentity: preflighted.rqsStoreIdentity,
    policy: preflighted.policy,
    policyIdentity: policyIdentity(preflighted.policy),
    generationIdentity: generationIdentity(preflighted),
    conflictIdentity: conflictIdentity(preflighted.binding),
    retiredGenerations: new Set(),
    bootstrapListeners: new Set(),
    bootstrapObservers,
    snapshot: freezeSnapshot({ status: 'starting', stage: 'binding' }),
    bootstrapHistory: [],
    operationTail: Promise.resolve(),
    entryInFlight: false,
    ownerTransitionInFlight: false,
    supervisedAdoptionCapture: null,
    advisories: Object.freeze([]),
    authoritySource: 'fresh-anonymous',
    storage: null,
    coordinator: null,
    client: null,
    currentPrincipalUnsubscribe: null,
    closed: false,
  };
  owner.bootstrapHistory.push(owner.snapshot);
  onOwner(owner);
  for (const observer of [...owner.bootstrapObservers]) {
    try { observer(owner.snapshot); } catch { /* bootstrap observation cannot own lifecycle */ }
  }
  try {
    throwIfConstructionAborted(preflighted.signal);
    starting(owner, 'custody');
    const custody = await awaitConstructionBoundary(
      resolveCustody(preflighted),
      preflighted.signal,
      (lateCustody) => lateCustody?.storage?.close?.(),
    );
    owner.storage = custody.storage;
    owner.custodyFacts = custody.facts;

    throwIfConstructionAborted(preflighted.signal);
    starting(owner, 'authority');
    owner.coordinator = new AuthCoordinator({
      appId: preflighted.app.identity.app,
      storagePartition: preflighted.storagePartition,
      storage: owner.storage,
      ...authCoordinatorCrossContextOptions(preflighted.platform),
    });

    throwIfConstructionAborted(preflighted.signal);
    starting(owner, 'client');
    owner.client = new SnapbackClient(preflighted.binding.target.origin, {
      authCoordinator: owner.coordinator,
      authClientProtocol: 1,
      // @ref LLP 0096#22-authlive--auth-scoped-live--invalidation-acknowledge
      // — the first-party application owner feeds generated live-query
      // surfaces, so it must offer both auth/live carriers rather than
      // constructing an auth/rr-only client that every protected subscribe
      // will correctly refuse.
      authInvalidationProtocol: 1,
      authorityDescriptorProtocol: 1,
      rqsStore: preflighted.rqsStore,
    });
    const restoredCapture = await awaitConstructionBoundary(
      owner.coordinator.synchronize(),
      preflighted.signal,
    );
    await awaitConstructionBoundary(
      owner.client.auth.authSession({ force: true }),
      preflighted.signal,
    );
    owner.authoritySource = restoredCapture === null
      ? 'fresh-anonymous'
      : 'durable-restored';
    owner.currentPrincipalUnsubscribe = owner.client.auth.subscribeCurrentPrincipal(() => {
      if (
        owner.supervisedAdoptionCapture !== null
        && !owner.ownerTransitionInFlight
        && !exactCapture(owner.supervisedAdoptionCapture, owner.client.captureAuthority())
      ) owner.supervisedAdoptionCapture = null;
    });
    publishReady(owner);
    return owner;
  } catch (error) {
    emitSnapshot(owner, failureSnapshot(error));
    error.bootstrapState = owner.snapshot;
    try { owner.currentPrincipalUnsubscribe?.(); } catch { /* best effort */ }
    try { await owner.client?.closeAuth?.(); } catch { /* preserve construction error */ }
    try { await owner.coordinator?.close?.(); } catch { /* preserve construction error */ }
    try { await owner.storage?.close?.(); } catch { /* preserve construction error */ }
    throw error;
  }
}

const serializeOwner = async (owner, operation) => {
  const previous = owner.operationTail;
  let release;
  owner.operationTail = new Promise((resolve) => { release = resolve; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
};

const serializeEntry = async (entry, operation) => {
  const previous = entry.tail;
  let release;
  entry.tail = new Promise((resolve) => { release = resolve; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
};

function assertCompatibleRebind(owner, candidate) {
  if (owner.rqsStoreIdentity !== candidate.rqsStoreIdentity) {
    throw refusal(
      'SNAPBACK_AUTH_BOOTSTRAP_RQS_STORE_CONFLICT',
      'This live application owner is already bound to a different RQS store identity.',
      { appId: candidate.app.identity.app },
      [remediation(
        'disposeAndReconstruct',
        'Dispose every projection for this owner key before changing its RQS store.',
        { appId: candidate.app.identity.app },
        { authorityEffect: 'none' },
      )],
    );
  }
  if (owner.conflictIdentity !== conflictIdentity(candidate.binding)) {
    throw refusal(
      'SNAPBACK_AUTH_BOOTSTRAP_BINDING_CONFLICT',
      'This live application auth owner is already bound to a different app, origin, or routing target.',
      { appId: candidate.app.identity.app },
      [remediation(
        'disposeAndReconstruct',
        'Dispose every projection for this owner key before constructing the different target.',
        { appId: candidate.app.identity.app },
        { authorityEffect: 'none' },
      )],
    );
  }
  // @ref LLP 0258#d2-one-bootstrap-owner-constructs-the-auth-bearing-application-client
  // — a live custody/mechanism policy is never mutated across an LLP 0241
  // semantic rotation; reconstruction is the only admitted boundary.
  if (owner.policyIdentity !== policyIdentity(candidate.policy)) {
    throw refusal(
      'SNAPBACK_AUTH_BOOTSTRAP_POLICY_ROTATION',
      'The generated auth bootstrap policy changed while its owner key is live.',
      { appId: candidate.app.identity.app },
      [remediation(
        'disposeAndReconstruct',
        'Dispose every projection for this owner key, then reconstruct under the new policy.',
        { appId: candidate.app.identity.app },
        { authorityEffect: 'none' },
      )],
    );
  }
  // @ref LLP 0258#d2-one-bootstrap-owner-constructs-the-auth-bearing-application-client
  // — today's binding has no LLP 0241 predecessor receipt, so enforce the
  // available sound subset: stable admission channel, unexpired validation,
  // non-rewinding provenance, exact generated identities, and retired cuts.
  const nextGeneration = generationIdentity(candidate);
  if (owner.binding.source !== candidate.binding.source) {
    throw refusal(
      'SNAPBACK_AUTH_BOOTSTRAP_BINDING_STALE',
      'A live application owner cannot switch binding admission channels during rebind.',
      { appId: candidate.app.identity.app },
      [retryBootstrap('SNAPBACK_AUTH_BOOTSTRAP_BINDING_STALE')],
    );
  }
  const currentIssuedAt = owner.binding.source === 'supervised-dev'
    ? Date.parse(owner.binding.provenance.issuedAt)
    : Number.NaN;
  const nextIssuedAt = candidate.binding.source === 'supervised-dev'
    ? Date.parse(candidate.binding.provenance.issuedAt)
    : Number.NaN;
  if (
    owner.binding.source === 'supervised-dev'
    && candidate.binding.source === 'supervised-dev'
    && Number.isFinite(currentIssuedAt)
    && Number.isFinite(nextIssuedAt)
    && (
      nextIssuedAt < currentIssuedAt
      || (
        nextIssuedAt === currentIssuedAt
        && JSON.stringify(candidate.binding.provenance)
          !== JSON.stringify(owner.binding.provenance)
      )
    )
  ) {
    throw refusal(
      'SNAPBACK_AUTH_BOOTSTRAP_BINDING_STALE',
      'The supervised binding provenance would rewind the live owner watermark.',
      { appId: candidate.app.identity.app },
      [retryBootstrap('SNAPBACK_AUTH_BOOTSTRAP_BINDING_STALE')],
    );
  }
  if (nextGeneration === owner.generationIdentity) {
    owner.app = candidate.app;
    owner.binding = candidate.binding;
    return;
  }
  if (owner.retiredGenerations.has(nextGeneration)) {
    throw refusal(
      'SNAPBACK_AUTH_BOOTSTRAP_BINDING_STALE',
      'A displaced application binding generation cannot retake a live owner.',
      { appId: candidate.app.identity.app },
      [retryBootstrap('SNAPBACK_AUTH_BOOTSTRAP_BINDING_STALE')],
    );
  }
  if (
    owner.binding.source !== 'supervised-dev'
    || candidate.binding.source !== 'supervised-dev'
    || !Number.isFinite(currentIssuedAt)
    || !Number.isFinite(nextIssuedAt)
    || nextIssuedAt <= currentIssuedAt
  ) {
    throw refusal(
      'SNAPBACK_AUTH_BOOTSTRAP_BINDING_STALE',
      'The binding does not prove it is a successor of the live application generation.',
      { appId: candidate.app.identity.app },
      [retryBootstrap('SNAPBACK_AUTH_BOOTSTRAP_BINDING_STALE')],
    );
  }
  owner.retiredGenerations.add(owner.generationIdentity);
  owner.generationIdentity = nextGeneration;
  owner.app = candidate.app;
  owner.binding = candidate.binding;
}

function unsettledEntryError(status) {
  return refusal(
    'SNAPBACK_AUTH_ENTRY_UNSETTLED',
    `Credential entry requires a settled anonymous principal; current state is ${status}.`,
    { principalStatus: status },
    [retryBootstrap('SNAPBACK_AUTH_ENTRY_UNSETTLED')],
    { operation: 'auth-entry', effectCommitted: false, effectMayHaveCommitted: false },
  );
}

function recoveryRotateUnsettledError(status) {
  return refusal(
    'SNAPBACK_AUTH_RECOVERY_ROTATE_REQUIRES_AUTHENTICATED',
    `Recovery-code rotation requires a settled authenticated principal; current state is ${status}.`,
    { principalStatus: status },
    [retryBootstrap('SNAPBACK_AUTH_RECOVERY_ROTATE_REQUIRES_AUTHENTICATED')],
    { operation: 'auth-recovery-rotate', effectCommitted: false, effectMayHaveCommitted: false },
  );
}

function requirePasswordMechanism(owner) {
  if (owner.policy.entryMechanisms.includes('password-v1')) return;
  throw refusal(
    'SNAPBACK_AUTH_BOOTSTRAP_MECHANISM_UNAVAILABLE',
    'The generated application auth policy does not admit password-v1.',
    { mechanism: 'password-v1', policyAdmitted: false },
    [remediation(
      'regenerateAppDescriptor',
      'Declare the password mechanism in the application auth program and regenerate.',
      { mechanism: 'password-v1' },
    )],
    { operation: 'auth-entry', effectCommitted: false, effectMayHaveCommitted: false },
  );
}

function entryFailure(error, signedOut, principalStatus) {
  const causeCode = safeCauseCode(error);
  const settledAnonymous = signedOut && principalStatus === 'anonymous';
  return refusal(
    'SNAPBACK_AUTH_ENTRY_FAILED',
    settledAnonymous
      ? 'Credential issuance failed after supervised sign-out settled; the principal remains anonymous.'
      : 'Credential entry failed against the exact settled predecessor.',
    { causeCode, principalStatus, settledAnonymous },
    [retryBootstrap(causeCode)],
    {
      operation: 'auth-entry',
      effectCommitted: signedOut,
      effectMayHaveCommitted: false,
      cause: error,
    },
  );
}

async function enterWith(owner, operation, { requirePassword = false } = {}) {
  return serializeOwner(owner, async () => {
    if (requirePassword) requirePasswordMechanism(owner);
    const principal = owner.client.auth.currentPrincipal();
    if (['loading', 'refreshing', 'blocked'].includes(principal.status)) {
      throw unsettledEntryError(principal.status);
    }
    if (principal.status !== 'anonymous') {
      const supervised = owner.supervisedAdoptionCapture !== null
        && exactCapture(owner.supervisedAdoptionCapture, owner.client.captureAuthority());
      if (!supervised) {
        throw refusal(
          'SNAPBACK_AUTH_ENTRY_AUTHENTICATED',
          'An authenticated application or restored principal must sign out before credential entry.',
          { principalStatus: principal.status },
          [signOutFirst()],
          { operation: 'auth-entry', effectCommitted: false, effectMayHaveCommitted: false },
        );
      }
      // @ref LLP 0258#d5-application-authority-wins-over-ambient-development-adoption
      // — only the exact process-local capture the owner adopted as supervised
      // may authorize the composed sign-out -> anonymous -> issuance sequence.
      const releasePublication = owner.client.__withholdCurrentPrincipalPublication();
      const displacedCapture = owner.supervisedAdoptionCapture;
      owner.entryInFlight = true;
      owner.ownerTransitionInFlight = true;
      let signedOut = false;
      try {
        await owner.client.__authLogoutExpectedCapture(displacedCapture);
        signedOut = true;
        owner.supervisedAdoptionCapture = null;
        // @ref LLP 0258#d5-application-authority-wins-over-ambient-development-adoption
        // — the intermediate anonymous state stays unpublished; bootstrap
        // subscribers observe one predecessor->successor exposure in this
        // context.
        owner.authoritySource = 'fresh-anonymous';
        const result = await operation();
        owner.authoritySource = 'application-entry';
        publishReady(owner);
        return result;
      } catch (error) {
        let currentCapture = null;
        try { currentCapture = owner.client.captureAuthority(); } catch { /* clearing is displaced */ }
        const predecessorDisplaced = signedOut || !exactCapture(displacedCapture, currentCapture);
        if (predecessorDisplaced) {
          owner.supervisedAdoptionCapture = null;
          const settledStatus = owner.coordinator.authority?.kind === 'anonymous'
            ? 'anonymous'
            : owner.coordinator.authority?.kind === 'session'
              ? 'authenticated'
              : 'loading';
          owner.authoritySource = settledStatus === 'anonymous'
            ? 'fresh-anonymous'
            : 'external-transition';
          publishReady(owner);
          throw entryFailure(error, predecessorDisplaced, settledStatus);
        }
        throw entryFailure(error, signedOut, owner.client.auth.currentPrincipal().status);
      } finally {
        owner.ownerTransitionInFlight = false;
        owner.entryInFlight = false;
        releasePublication();
      }
    }
    owner.ownerTransitionInFlight = true;
    try {
      const result = await operation();
      owner.authoritySource = 'application-entry';
      owner.supervisedAdoptionCapture = null;
      publishReady(owner);
      return result;
    } finally {
      owner.ownerTransitionInFlight = false;
    }
  });
}

function createFacade(owner, subscriptions) {
  return Object.freeze({
    currentPrincipal: () => owner.client.auth.currentPrincipal(),
    subscribeCurrentPrincipal(listener) {
      const unsubscribe = owner.client.auth.subscribeCurrentPrincipal(listener);
      subscriptions.add(unsubscribe);
      return () => {
        if (!subscriptions.delete(unsubscribe)) return;
        unsubscribe();
      };
    },
    signUpWithPassword: (input) => enterWith(
      owner,
      () => owner.client.auth.authPasswordSignup(input),
      { requirePassword: true },
    ),
    signInWithPassword: (input) => enterWith(
      owner,
      () => owner.client.auth.authPasswordSignIn(input),
      { requirePassword: true },
    ),
    // @ref LLP 0258#d9-generated-completeness-keeps-mechanisms-and-clients-aligned
    // — recovery is policy-derived rather than an entry mechanism, while the
    // facade preserves the shipped one-time recovery projection exactly.
    consumeRecoveryCode: (input) => enterWith(
      owner,
      () => owner.client.auth.authRecoveryConsume(input),
      { requirePassword: true },
    ),
    rotateRecoveryCodes: () => serializeOwner(owner, async () => {
      requirePasswordMechanism(owner);
      const principal = owner.client.auth.currentPrincipal();
      if (principal.status !== 'authenticated') {
        throw recoveryRotateUnsettledError(principal.status);
      }
      owner.ownerTransitionInFlight = true;
      try {
        return await owner.client.auth.authRecoveryRotate();
      } finally {
        owner.ownerTransitionInFlight = false;
      }
    }),
    changePassword: (input) => serializeOwner(owner, async () => {
      requirePasswordMechanism(owner);
      const principal = owner.client.auth.currentPrincipal();
      if (principal.status !== 'authenticated') {
        throw refusal(
          'SNAPBACK_AUTH_CHANGE_PASSWORD_REQUIRES_AUTHENTICATED',
          'Password rotation requires a settled authenticated principal.',
          { principalStatus: principal.status },
          [],
          { operation: 'auth-password-change', effectCommitted: false },
        );
      }
      owner.ownerTransitionInFlight = true;
      try {
        return await owner.client.auth.authPasswordChange(input);
      } finally {
        owner.ownerTransitionInFlight = false;
      }
    }),
    signOut: () => serializeOwner(owner, async () => {
      owner.ownerTransitionInFlight = true;
      try {
        const result = await owner.client.auth.authLogout();
        owner.supervisedAdoptionCapture = null;
        owner.authoritySource = 'fresh-anonymous';
        publishReady(owner);
        return result;
      } finally {
        owner.ownerTransitionInFlight = false;
      }
    }),
  });
}

async function disposeOwner(owner) {
  if (owner.closed) return;
  owner.closed = true;
  let firstError = null;
  try { owner.currentPrincipalUnsubscribe?.(); } catch (error) { firstError ??= error; }
  try { await owner.client.closeAuth(); } catch (error) { firstError ??= error; }
  try { await owner.coordinator.close(); } catch (error) { firstError ??= error; }
  try { await owner.storage.close?.(); } catch (error) { firstError ??= error; }
  owner.bootstrapListeners.clear();
  if (firstError) throw firstError;
}

function projectionFor(entry, owner) {
  let disposed = false;
  const bootstrapSubscriptions = new Set();
  const principalSubscriptions = new Set();
  const auth = createFacade(owner, principalSubscriptions);
  const projection = Object.freeze({
    client: owner.client,
    auth,
    bootstrapState: () => owner.snapshot,
    subscribeBootstrap(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('subscribeBootstrap requires a listener function');
      }
      if (disposed) return () => {};
      owner.bootstrapListeners.add(listener);
      bootstrapSubscriptions.add(listener);
      return () => {
        bootstrapSubscriptions.delete(listener);
        owner.bootstrapListeners.delete(listener);
      };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      for (const listener of bootstrapSubscriptions) owner.bootstrapListeners.delete(listener);
      bootstrapSubscriptions.clear();
      for (const unsubscribe of principalSubscriptions) unsubscribe();
      principalSubscriptions.clear();
      let shouldClose = false;
      await serializeEntry(entry, async () => {
        entry.refCount -= 1;
        if (entry.refCount === 0) {
          entry.state = 'disposing';
          let finish;
          entry.disposePromise = new Promise((resolve) => { finish = resolve; });
          entry.finishDispose = finish;
          shouldClose = true;
        }
      });
      if (!shouldClose) return;
      try {
        await serializeOwner(owner, () => disposeOwner(owner));
      } finally {
        if (OWNER_REGISTRY.get(entry.key) === entry) OWNER_REGISTRY.delete(entry.key);
        entry.finishDispose();
      }
    },
  });
  PROJECTION_OWNERS.set(projection, owner);
  return projection;
}

async function acquireSnapbackAppClient(input, bootstrapObserver) {
  let candidate;
  try {
    candidate = preflight(input);
  } catch (error) {
    error.bootstrapState ??= failureSnapshot(error);
    try { bootstrapObserver?.(error.bootstrapState); } catch { /* observation only */ }
    throw error;
  }
  const key = ownerKey(candidate.app.identity.app, candidate.storagePartition);
  for (;;) {
    let entry = OWNER_REGISTRY.get(key);
    if (entry?.state === 'disposing') {
      await entry.disposePromise;
      continue;
    }
    let observing = false;
    if (!entry) {
      const bootstrapObservers = new Set();
      if (bootstrapObserver !== null) {
        bootstrapObservers.add(bootstrapObserver);
        observing = true;
      }
      entry = {
        key,
        state: 'constructing',
        refCount: 0,
        disposePromise: null,
        finishDispose: null,
        tail: Promise.resolve(),
        promise: null,
        owner: null,
        bootstrapObservers,
      };
      entry.promise = constructOwner(candidate, bootstrapObservers, (owner) => {
        entry.owner = owner;
      }).then((owner) => {
        entry.state = 'live';
        return owner;
      }).catch((error) => {
        if (OWNER_REGISTRY.get(key) === entry) OWNER_REGISTRY.delete(key);
        throw error;
      });
      OWNER_REGISTRY.set(key, entry);
    } else if (bootstrapObserver !== null) {
      entry.bootstrapObservers.add(bootstrapObserver);
      observing = true;
      if (entry.owner !== null) {
        try { bootstrapObserver(entry.owner.snapshot); } catch { /* observation only */ }
      }
    }
    try {
      const owner = await entry.promise;
      await serializeEntry(entry, async () => {
        if (entry.state !== 'live') return;
        assertCompatibleRebind(owner, candidate);
        entry.refCount += 1;
      });
      if (entry.state !== 'live') continue;
      return projectionFor(entry, owner);
    } finally {
      if (observing) entry.bootstrapObservers.delete(bootstrapObserver);
    }
  }
}

/** Framework-neutral owner for first-party application authentication bootstrap. */
export async function createSnapbackAppClient(input) {
  return acquireSnapbackAppClient(input, null);
}

export async function __createSnapbackAppClientWithBootstrapObserver(input, observer) {
  if (typeof observer !== 'function') {
    throw new TypeError('framework bootstrap observer must be a function');
  }
  return acquireSnapbackAppClient(input, observer);
}

// Framework integration seam. It is exported only from the package's
// app-client-internal subpath, never from the ordinary client entrypoint.
export async function __adoptSupervisedBootstrapAuthority(
  appClient,
  {
    bearer,
    binding,
    clientOptions = {},
    refreshAfterMs = Number.MAX_SAFE_INTEGER,
  },
) {
  const owner = PROJECTION_OWNERS.get(appClient);
  if (!owner) throw new TypeError('expected a live SnapbackAppClient projection');
  if (binding?.source !== 'supervised-dev' || owner.binding.source !== 'supervised-dev') {
    throw new TypeError('supervised adoption requires a supervised-source AppBinding');
  }
  // @ref LLP 0258#d5-application-authority-wins-over-ambient-development-adoption
  // — a supervisor event that ARRIVES while a composed entry is in flight is
  // dropped at arrival time, never deferred behind the entry turn and then
  // adopted; only a later supervisor event may re-admit under rule 3. The
  // serialized re-check alone cannot see the flag (entry clears it inside its
  // own turn), so the arrival-time check is the load-bearing one.
  if (owner.entryInFlight) return Object.freeze({ status: 'dropped' });
  return serializeOwner(owner, async () => {
    if (owner.entryInFlight) return Object.freeze({ status: 'dropped' });
    const carriesDevIdentityCapability = Object.hasOwn(
      clientOptions,
      'devIdentityCapability',
    );
    const devIdentityCapability = carriesDevIdentityCapability
      ? validateDevIdentityCapability(clientOptions.devIdentityCapability)
      : null;
    if (
      devIdentityCapability !== null
      && ['browser', 'expo-web'].includes(owner.platform.kind)
    ) {
      throw new TypeError(
        `raw devIdentityCapability installation is refused on ${owner.platform.kind}`,
      );
    }
    owner.ownerTransitionInFlight = true;
    try {
      let allowSameAuthorityRotation = false;
      if (owner.supervisedAdoptionCapture !== null) {
        try {
          allowSameAuthorityRotation = exactCapture(
            owner.supervisedAdoptionCapture,
            owner.client.captureAuthority(),
          );
        } catch { /* an unsettled/peer transition cannot authorize rotation */ }
      }
      const result = await owner.client.__supervisedBootstrapHandshake(bearer, {
        refreshAfterMs,
        allowSameAuthorityRotation,
      });
      if (result.status === 'conflict') {
        replaceSupervisedConflictAdvisory(
          owner,
          supervisedConflictAdvisory(owner, result.session?.authority),
        );
        publishReady(owner);
        return Object.freeze({ status: 'conflict' });
      }
      if (result.status === 'adopted') {
        owner.supervisedAdoptionCapture = result.capture;
        owner.authoritySource = 'supervised-development';
      }
      if (carriesDevIdentityCapability) {
        installDevIdentityCapability(owner.client, devIdentityCapability);
      }
      // A restored/application authority that happens to name the same
      // principal remains protected; equality does not create a process-local
      // supervised displacement record.
      replaceSupervisedConflictAdvisory(owner, null);
      publishReady(owner);
      return Object.freeze({ status: result.status });
    } finally {
      owner.ownerTransitionInFlight = false;
    }
  });
}

export function __applicationDescriptorForAppClient(appClient) {
  const owner = PROJECTION_OWNERS.get(appClient);
  if (!owner) throw new TypeError('expected a live SnapbackAppClient projection');
  return owner.app;
}

export function __createProviderValidatedExpoNativePlatform({
  authCustodyStorage,
  authCustodyGrade,
  cryptoObject,
}) {
  const platform = Object.freeze({
    kind: 'expo-native',
    authCustodyStorage,
    cryptoObject,
  });
  PROVIDER_VALIDATED_NATIVE_GRADES.set(platform, authCustodyGrade);
  return platform;
}

// Kept outside the package export map: the Expo slice will replace this test
// seam with its admitted supervised handshake path, without adding a bearer
// setter to the ordinary application client.
export function __recordSupervisedBootstrapAdoptionForTests(appClient) {
  const owner = PROJECTION_OWNERS.get(appClient);
  if (!owner) throw new TypeError('expected a live SnapbackAppClient projection');
  const principal = owner.client.auth.currentPrincipal();
  if (principal.status !== 'authenticated') {
    throw new TypeError('supervised adoption requires an authenticated principal');
  }
  owner.supervisedAdoptionCapture = owner.client.captureAuthority();
  owner.authoritySource = 'supervised-development';
  publishReady(owner);
}

export function __bootstrapHistoryForTests(appClient) {
  const owner = PROJECTION_OWNERS.get(appClient);
  if (!owner) throw new TypeError('expected a live SnapbackAppClient projection');
  return Object.freeze([...owner.bootstrapHistory]);
}

// Registry generation requires the Expo-slice conflict diagnostic to exist in
// the package closure before that slice wires its non-authoritative advisory.
export const __SUPERVISED_PRINCIPAL_CONFLICT_CODE_FOR_NEXT_SLICE =
  'SNAPBACK_AUTH_SUPERVISED_PRINCIPAL_CONFLICT';
