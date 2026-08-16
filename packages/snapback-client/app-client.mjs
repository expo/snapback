import {
  AuthCoordinator,
  SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract/auth-coordinator';
import {
  createIndexedDbAuthCustodyStorage,
} from '@expo/snapback-contract/auth-custody-indexeddb';

import { snapbackDiagnosticError } from './diagnostic-error.mjs';
import { SnapbackClient } from './index.mjs';

export const DEFAULT_AUTH_STORAGE_PARTITION = 'default';

const OWNER_REGISTRY = new Map();
const PROJECTION_OWNERS = new WeakMap();
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
};

const starting = (owner, stage) => emitSnapshot(owner, { status: 'starting', stage });

const canonicalOrigin = (value) => {
  if (!nonEmptyString(value)) return null;
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
    return parsed;
  } catch {
    return null;
  }
};

const isLoopbackHost = (hostname) => hostname === 'localhost'
  || hostname === '[::1]'
  || hostname === '::1'
  || /^127(?:\.[0-9]{1,3}){3}$/u.test(hostname);

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

function validateBinding(binding, app, policy) {
  if (
    !exactKeys(binding, BINDING_KEYS)
    || binding.format !== 'snapback.app-binding.v1'
    || !['supervised-dev', 'release'].includes(binding.source)
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
  const origin = canonicalOrigin(binding.target.origin);
  const supervised = binding.source === 'supervised-dev';
  const supervisedProvenance = exactKeys(
    binding.provenance,
    ['expiresAt', 'issuedAt', 'supervisorGeneration'],
  )
    && nonEmptyString(binding.provenance.supervisorGeneration)
    && Number.isFinite(Date.parse(binding.provenance.issuedAt))
    && Number.isFinite(Date.parse(binding.provenance.expiresAt))
    && Date.parse(binding.provenance.expiresAt) > Date.parse(binding.provenance.issuedAt);
  const releaseProvenance = exactKeys(
    binding.provenance,
    ['buildReceipt', 'environment', 'releaseChannel'],
  ) && Object.values(binding.provenance).every(nonEmptyString);
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
  const validRoute = origin !== null && (supervised
    ? ['loopback', 'port-forward'].includes(binding.target.routing)
      && ['http:', 'https:'].includes(origin.protocol)
      && (isLoopbackHost(origin.hostname)
        || (binding.target.routing === 'port-forward' && origin.hostname === '10.0.2.2'))
    : binding.target.routing === 'https' && origin.protocol === 'https:');
  if (
    !validRoute
    || (supervised ? !supervisedProvenance || !supervisedIntegrity : !releaseProvenance || !releaseIntegrity)
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
    'cryptoObject',
    'databaseName',
    'indexedDB',
    'kind',
    'lockManager',
  ]);
  if (
    !isRecord(normalized)
    || !nonEmptyString(normalized.kind)
    || Object.keys(normalized).some((key) => !allowedKeys.has(key))
  ) {
    throw refusal(
      'SNAPBACK_AUTH_BOOTSTRAP_PLATFORM_UNSUPPORTED',
      'Application authentication bootstrap requires an admitted platform kind.',
      {},
    );
  }
  if (!['browser', 'expo-web', 'memory'].includes(normalized.kind)) {
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
  const expectedInputKeys = Object.hasOwn(input, 'storagePartition')
    ? ['app', 'binding', 'platform', 'storagePartition']
    : ['app', 'binding', 'platform'];
  if (!exactKeys(input, expectedInputKeys)) {
    throw refusal(
      'SNAPBACK_AUTH_BOOTSTRAP_INPUT_INVALID',
      'createSnapbackAppClient accepts only app, binding, platform, and optional storagePartition.',
      { actualKeys: Object.keys(input).sort() },
    );
  }
  const { app, binding } = input;
  const policy = validateAppPolicy(app);
  validateBinding(binding, app, policy);
  const platform = normalizePlatform(input.platform);
  const storagePartition = validateStoragePartition(
    input.storagePartition ?? DEFAULT_AUTH_STORAGE_PARTITION,
  );
  if (policy.custody === 'durable-required') {
    const indexedDB = platform.indexedDB ?? globalThis.indexedDB;
    if (!['browser', 'expo-web'].includes(platform.kind) || !indexedDB?.open) {
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
  return Object.freeze({ app, binding, platform, policy, storagePartition });
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

const safeCauseCode = (error) => error?.diagnostic?.code
  ?? error?.code
  ?? 'SNAPBACK_AUTH_BOOTSTRAP_FAILED';

function failureSnapshot(error) {
  const causeCode = safeCauseCode(error);
  const status = causeCode === 'SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE'
    || causeCode === 'SNAPBACK_AUTH_BOOTSTRAP_PLATFORM_UNSUPPORTED'
    ? 'unsupported'
    : causeCode.includes('AUTH_MODE')
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

async function constructOwner(preflighted) {
  const owner = {
    app: preflighted.app,
    binding: preflighted.binding,
    platform: preflighted.platform,
    storagePartition: preflighted.storagePartition,
    policy: preflighted.policy,
    policyIdentity: policyIdentity(preflighted.policy),
    generationIdentity: generationIdentity(preflighted),
    conflictIdentity: conflictIdentity(preflighted.binding),
    retiredGenerations: new Set(),
    bootstrapListeners: new Set(),
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
  try {
    starting(owner, 'custody');
    const custody = await resolveCustody(preflighted);
    owner.storage = custody.storage;
    owner.custodyFacts = custody.facts;

    starting(owner, 'authority');
    owner.coordinator = new AuthCoordinator({
      appId: preflighted.app.identity.app,
      storagePartition: preflighted.storagePartition,
      storage: owner.storage,
      broadcastChannelFactory: null,
      hintStorage: null,
    });

    starting(owner, 'client');
    owner.client = new SnapbackClient(preflighted.binding.target.origin, {
      authCoordinator: owner.coordinator,
      authClientProtocol: 1,
      authorityDescriptorProtocol: 1,
    });
    const restoredCapture = await owner.coordinator.synchronize();
    await owner.client.auth.authSession({ force: true });
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
    owner.snapshot = failureSnapshot(error);
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
  const nextGeneration = generationIdentity(candidate);
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
  const currentIssuedAt = owner.binding.source === 'supervised-dev'
    ? Date.parse(owner.binding.provenance.issuedAt)
    : Number.NaN;
  const nextIssuedAt = candidate.binding.source === 'supervised-dev'
    ? Date.parse(candidate.binding.provenance.issuedAt)
    : Number.NaN;
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

async function enterWith(owner, operation) {
  return serializeOwner(owner, async () => {
    requirePasswordMechanism(owner);
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
        await owner.client.auth.authLogout();
        signedOut = true;
        owner.supervisedAdoptionCapture = null;
        owner.authoritySource = 'fresh-anonymous';
        publishReady(owner);
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
    ),
    signInWithPassword: (input) => enterWith(
      owner,
      () => owner.client.auth.authPasswordSignIn(input),
    ),
    changePassword: (input) => serializeOwner(owner, async () => {
      requirePasswordMechanism(owner);
      const principal = owner.client.auth.currentPrincipal();
      if (['loading', 'refreshing', 'blocked'].includes(principal.status)) {
        throw unsettledEntryError(principal.status);
      }
      if (principal.status !== 'authenticated') {
        throw refusal(
          'SNAPBACK_AUTH_CHANGE_PASSWORD_REQUIRES_AUTHENTICATED',
          'Changing a password requires the settled authenticated principal.',
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

/** Framework-neutral owner for first-party application authentication bootstrap. */
export async function createSnapbackAppClient(input) {
  let candidate;
  try {
    candidate = preflight(input);
  } catch (error) {
    error.bootstrapState ??= failureSnapshot(error);
    throw error;
  }
  const key = ownerKey(candidate.app.identity.app, candidate.storagePartition);
  for (;;) {
    let entry = OWNER_REGISTRY.get(key);
    if (entry?.state === 'disposing') {
      await entry.disposePromise;
      continue;
    }
    if (!entry) {
      entry = {
        key,
        state: 'constructing',
        refCount: 0,
        disposePromise: null,
        finishDispose: null,
        tail: Promise.resolve(),
        promise: null,
      };
      entry.promise = constructOwner(candidate).then((owner) => {
        entry.state = 'live';
        return owner;
      }).catch((error) => {
        if (OWNER_REGISTRY.get(key) === entry) OWNER_REGISTRY.delete(key);
        throw error;
      });
      OWNER_REGISTRY.set(key, entry);
    }
    const owner = await entry.promise;
    await serializeEntry(entry, async () => {
      if (entry.state !== 'live') return;
      assertCompatibleRebind(owner, candidate);
      entry.refCount += 1;
    });
    if (entry.state !== 'live') continue;
    return projectionFor(entry, owner);
  }
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
