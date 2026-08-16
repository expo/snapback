// Package-owned backend-comparison acceptance profile.
//
// @ref LLP 0010#diagnostic-shape — named, non-vacuous checks and stable
// process outcomes are product evidence, not console prose.
// @ref LLP 0013#relationship-to-durable-sync — presence cleanup and durable-version
// separation are mandatory comparator claims.
// @ref LLP 0034#3-d2--receipts-rewritten-in-rev-2 — native push is proved by the client
// receipt that knows the transport, never inferred from a callback arriving.
// @ref LLP 0041#cli-commands — this profile is a published CLI-owned workflow.
//
// Receipt authority note (LLP 0037 §3.1 scope fence): comparator receipts are
// created, parsed, and verified only by @expo/snapback-cli. The Rust server never
// reads them, so their natural owner is this package and the versioned schema
// shipped beside this module.

import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SnapbackClient } from '@expo/snapback-client';

export const COMPARATOR_RECEIPT_SCHEMA_VERSION = 'snapback.comparator-receipt.v1';
export const COMPARATOR_PROFILE_SCHEMA_VERSION = 'snapback.comparator-profile.v1';

export const COMPARATOR_CHECKS = Object.freeze([
  Object.freeze({
    id: 'native-live-delivery',
    name: 'cross-client native live delivery',
  }),
  Object.freeze({
    id: 'atomic-declared-writes',
    name: 'atomic declared write set',
  }),
  Object.freeze({
    id: 'rejected-mutation-rollback',
    name: 'rejected mutation rollback without durable version change',
  }),
  Object.freeze({
    id: 'presence-cleanup',
    name: 'TTL and disconnect presence cleanup',
  }),
  Object.freeze({
    id: 'ephemeral-durable-separation',
    name: 'ephemeral publish does not advance durable version',
  }),
]);

const CHECK_IDS = new Set(COMPARATOR_CHECKS.map(({ id }) => id));
const REQUIRED_TARGET_CAPABILITIES = Object.freeze([
  'live_subscriptions',
  'websocket_push_transport',
  'ephemeral_collections',
]);
const RECEIPT_STATUSES = new Set(['passed', 'failed', 'unsupported', 'infrastructure-error']);
const CHECK_STATUSES = new Set(['passed', 'failed', 'infrastructure-error']);
const IDENTITY_NONCLAIM =
  'dev-asserted identity labels are behavioral witnesses, not authenticated-principal evidence';
const INFRASTRUCTURE_CODES = new Set([
  'SNAPBACK_COMPARATOR_CHECK_TIMEOUT',
  'SNAPBACK_COMPARATOR_SERVER_DEAD',
  'SNAPBACK_COMPARATOR_SETUP_FAILED',
  'SNAPBACK_COMPARATOR_CLEANUP_FAILED',
  'SNAPBACK_COMPARATOR_IDENTITY_MISMATCH',
]);
const comparatorPackageRoot = dirname(fileURLToPath(import.meta.url));

function packageExecutionIdentity(packageRoot) {
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  const files = new Set(['package.json']);
  const visit = (path) => {
    const metadata = lstatSync(path);
    assert(
      !metadata.isSymbolicLink(),
      'SNAPBACK_COMPARATOR_SETUP_FAILED',
      'executing package closure contains a symbolic link',
    );
    if (metadata.isDirectory()) {
      for (const entry of readdirSync(path).sort()) visit(join(path, entry));
    } else if (metadata.isFile()) {
      files.add(relative(packageRoot, path));
    }
  };
  for (const entry of manifest.files ?? []) visit(join(packageRoot, entry));
  const ordered = [...files].sort();
  const hash = createHash('sha256');
  for (const file of ordered) {
    const bytes = readFileSync(join(packageRoot, file));
    hash.update(`${file}\0${bytes.byteLength}\0`);
    hash.update(bytes);
  }
  return {
    name: manifest.name,
    version: manifest.version,
    algorithm: 'sha256-package-files-path-length-content.v1',
    files: ordered,
    sha256: `sha256:${hash.digest('hex')}`,
  };
}

function executingPackageIdentity() {
  const clientEntry = fileURLToPath(import.meta.resolve('@expo/snapback-client'));
  return {
    cli: packageExecutionIdentity(comparatorPackageRoot),
    client: packageExecutionIdentity(dirname(clientEntry)),
  };
}

/**
 * Bounded evidence for an executing-package identity mismatch. The identity
 * stores one aggregate digest per package, so a per-file content diff is not
 * reconstructable from the receipt; this names which package moved, both
 * aggregate digests, and any file-set difference. Equal file sets with
 * differing digests mean file contents changed between receipt production and
 * verification — historically an in-place regeneration of the packaged
 * comparator fixture from a stale committed state (d5ad77c0, 345cb070).
 */
function executorPackageMismatchDetails(receiptPackages, verifierPackages) {
  const details = {};
  for (const packageName of ['cli', 'client']) {
    const recorded = receiptPackages?.[packageName];
    const observed = verifierPackages[packageName];
    if (sameValue(recorded, observed)) continue;
    const recordedFiles = new Set(Array.isArray(recorded?.files) ? recorded.files : []);
    const observedFiles = new Set(observed.files);
    details[packageName] = {
      receipt: {
        name: recorded?.name ?? null,
        version: recorded?.version ?? null,
        sha256: recorded?.sha256 ?? null,
      },
      verifier: {
        name: observed.name,
        version: observed.version,
        sha256: observed.sha256,
      },
      filesOnlyInReceipt: [...recordedFiles]
        .filter((file) => !observedFiles.has(file)).slice(0, 16),
      filesOnlyInVerifier: [...observedFiles]
        .filter((file) => !recordedFiles.has(file)).slice(0, 16),
    };
  }
  return details;
}

function comparatorError(code, message, details = undefined) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = {
    code,
    severity: 'error',
    subsystem: 'comparator-acceptance',
    message,
    ...(details === undefined ? {} : { details }),
  };
  return error;
}

function assert(condition, code, message, details = undefined) {
  if (!condition) throw comparatorError(code, message, details);
}

function assertPlainObject(value, label) {
  assert(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    'SNAPBACK_COMPARATOR_PROFILE_INVALID',
    `${label} must be an object`,
  );
}

function assertExactKeys(value, allowed, label) {
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  assert(
    extras.length === 0,
    'SNAPBACK_COMPARATOR_PROFILE_INVALID',
    `${label} has unknown fields: ${extras.join(', ')}`,
    { extras },
  );
}

function requiredString(value, label) {
  assert(
    typeof value === 'string' && value.length > 0,
    'SNAPBACK_COMPARATOR_PROFILE_INVALID',
    `${label} must be a non-empty string`,
  );
  return value;
}

function receiptPlainObject(value, label) {
  assert(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
    `${label} must be an object`,
  );
}

function receiptExactKeys(value, allowed, label) {
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  assert(
    extras.length === 0,
    'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
    `${label} has unknown fields: ${extras.join(', ')}`,
    { extras },
  );
}

function receiptString(value, label) {
  assert(
    typeof value === 'string' && value.length > 0,
    'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
    `${label} must be a non-empty string`,
  );
  return value;
}

function functionRef(value, label) {
  const name = typeof value === 'string' ? value : value?.name;
  requiredString(name, label);
  return value;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function sameValue(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function serializable(value, fallback = null) {
  if (value === undefined) return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function optionalArgs(value, label) {
  if (value === undefined) return {};
  assertPlainObject(value, label);
  return structuredClone(value);
}

/**
 * Close and freeze the comparator authoring shape. Domain callbacks are
 * deliberately bounded: snapshot(), matchesLive(), matchesPresence(), setup(),
 * and optional extra check run() functions. Lifecycle and product operations
 * remain kit-owned.
 */
export function defineComparatorProfile(input) {
  assertPlainObject(input, 'comparator profile');
  assertExactKeys(input, new Set([
    'schemaVersion',
    'id',
    'title',
    'target',
    'refs',
    'fixtures',
    'extraChecks',
    'requiredCapabilities',
    'nonclaims',
    'setup',
  ]), 'comparator profile');
  if (input.schemaVersion !== undefined) {
    assert(
      input.schemaVersion === COMPARATOR_PROFILE_SCHEMA_VERSION,
      'SNAPBACK_COMPARATOR_PROFILE_INVALID',
      `schemaVersion must be ${COMPARATOR_PROFILE_SCHEMA_VERSION}`,
    );
  }
  const id = requiredString(input.id, 'profile.id');
  const title = requiredString(input.title ?? id, 'profile.title');

  assertPlainObject(input.target, 'profile.target');
  assertExactKeys(input.target, new Set([
    'backendDirectory',
    'projectRoot',
    'runtimeBinary',
    'environment',
  ]), 'profile.target');
  const target = {
    backendDirectory: requiredString(input.target.backendDirectory, 'profile.target.backendDirectory'),
    ...(input.target.projectRoot === undefined
      ? {}
      : { projectRoot: requiredString(input.target.projectRoot, 'profile.target.projectRoot') }),
    ...(input.target.runtimeBinary === undefined
      ? {}
      : { runtimeBinary: requiredString(input.target.runtimeBinary, 'profile.target.runtimeBinary') }),
    ...(input.target.environment === undefined
      ? {}
      : { environment: optionalArgs(input.target.environment, 'profile.target.environment') }),
  };

  assertPlainObject(input.refs, 'profile.refs');
  assertExactKeys(input.refs, new Set([
    'liveQuery',
    'liveMutation',
    'atomicMutation',
    'rejectedMutation',
    'presence',
  ]), 'profile.refs');
  const refs = {
    liveQuery: functionRef(input.refs.liveQuery, 'profile.refs.liveQuery'),
    liveMutation: functionRef(input.refs.liveMutation, 'profile.refs.liveMutation'),
    atomicMutation: functionRef(input.refs.atomicMutation, 'profile.refs.atomicMutation'),
    rejectedMutation: functionRef(input.refs.rejectedMutation, 'profile.refs.rejectedMutation'),
    presence: functionRef(input.refs.presence, 'profile.refs.presence'),
  };

  assertPlainObject(input.fixtures, 'profile.fixtures');
  assertExactKeys(input.fixtures, new Set([
    'identities',
    'live',
    'atomic',
    'rejection',
    'presence',
  ]), 'profile.fixtures');

  assertPlainObject(input.fixtures.identities, 'profile.fixtures.identities');
  assertExactKeys(
    input.fixtures.identities,
    new Set(['observerUserId', 'actorUserId']),
    'profile.fixtures.identities',
  );
  const identities = {
    observerUserId: requiredString(
      input.fixtures.identities.observerUserId,
      'profile.fixtures.identities.observerUserId',
    ),
    actorUserId: requiredString(
      input.fixtures.identities.actorUserId,
      'profile.fixtures.identities.actorUserId',
    ),
  };
  assert(
    identities.observerUserId !== identities.actorUserId,
    'SNAPBACK_COMPARATOR_PROFILE_INVALID',
    'comparator identities must be distinct',
  );

  assertPlainObject(input.fixtures.live, 'profile.fixtures.live');
  assertExactKeys(
    input.fixtures.live,
    new Set(['queryArgs', 'mutationArgs', 'matches']),
    'profile.fixtures.live',
  );
  assert(
    typeof input.fixtures.live.matches === 'function',
    'SNAPBACK_COMPARATOR_PROFILE_INVALID',
    'profile.fixtures.live.matches must be a function',
  );
  const live = {
    queryArgs: optionalArgs(input.fixtures.live.queryArgs, 'profile.fixtures.live.queryArgs'),
    mutationArgs: optionalArgs(input.fixtures.live.mutationArgs, 'profile.fixtures.live.mutationArgs'),
    matches: input.fixtures.live.matches,
  };

  assertPlainObject(input.fixtures.atomic, 'profile.fixtures.atomic');
  assertExactKeys(
    input.fixtures.atomic,
    new Set(['mutationArgs', 'declaredWrites', 'snapshot']),
    'profile.fixtures.atomic',
  );
  assert(
    Array.isArray(input.fixtures.atomic.declaredWrites)
      && input.fixtures.atomic.declaredWrites.length >= 2
      && input.fixtures.atomic.declaredWrites.every((name) => typeof name === 'string' && name.length > 0)
      && new Set(input.fixtures.atomic.declaredWrites).size === input.fixtures.atomic.declaredWrites.length,
    'SNAPBACK_COMPARATOR_PROFILE_INVALID',
    'profile.fixtures.atomic.declaredWrites must contain at least two unique names',
  );
  assert(
    typeof input.fixtures.atomic.snapshot === 'function',
    'SNAPBACK_COMPARATOR_PROFILE_INVALID',
    'profile.fixtures.atomic.snapshot must be a function',
  );
  const atomic = {
    mutationArgs: optionalArgs(input.fixtures.atomic.mutationArgs, 'profile.fixtures.atomic.mutationArgs'),
    declaredWrites: [...input.fixtures.atomic.declaredWrites],
    snapshot: input.fixtures.atomic.snapshot,
  };

  assertPlainObject(input.fixtures.rejection, 'profile.fixtures.rejection');
  assertExactKeys(
    input.fixtures.rejection,
    new Set(['mutationArgs', 'snapshot', 'diagnosticCode']),
    'profile.fixtures.rejection',
  );
  assert(
    typeof input.fixtures.rejection.snapshot === 'function',
    'SNAPBACK_COMPARATOR_PROFILE_INVALID',
    'profile.fixtures.rejection.snapshot must be a function',
  );
  const rejection = {
    mutationArgs: optionalArgs(
      input.fixtures.rejection.mutationArgs,
      'profile.fixtures.rejection.mutationArgs',
    ),
    snapshot: input.fixtures.rejection.snapshot,
    ...(input.fixtures.rejection.diagnosticCode === undefined
      ? {}
      : {
          diagnosticCode: requiredString(
            input.fixtures.rejection.diagnosticCode,
            'profile.fixtures.rejection.diagnosticCode',
          ),
        }),
  };

  assertPlainObject(input.fixtures.presence, 'profile.fixtures.presence');
  assertExactKeys(
    input.fixtures.presence,
    new Set(['scope', 'value', 'ttlMs', 'permissions', 'matches']),
    'profile.fixtures.presence',
  );
  assert(
    Number.isInteger(input.fixtures.presence.ttlMs) && input.fixtures.presence.ttlMs > 0,
    'SNAPBACK_COMPARATOR_PROFILE_INVALID',
    'profile.fixtures.presence.ttlMs must be a positive integer',
  );
  assert(
    typeof input.fixtures.presence.matches === 'function',
    'SNAPBACK_COMPARATOR_PROFILE_INVALID',
    'profile.fixtures.presence.matches must be a function',
  );
  const presence = {
    scope: optionalArgs(input.fixtures.presence.scope, 'profile.fixtures.presence.scope'),
    value: serializable(input.fixtures.presence.value),
    ttlMs: input.fixtures.presence.ttlMs,
    permissions: Array.isArray(input.fixtures.presence.permissions)
      ? [...input.fixtures.presence.permissions]
      : [],
    matches: input.fixtures.presence.matches,
  };

  const extraChecks = input.extraChecks ?? [];
  assert(
    Array.isArray(extraChecks),
    'SNAPBACK_COMPARATOR_PROFILE_INVALID',
    'profile.extraChecks must be an array',
  );
  const extraIds = new Set();
  const normalizedExtraChecks = extraChecks.map((check, index) => {
    assertPlainObject(check, `profile.extraChecks[${index}]`);
    assertExactKeys(check, new Set(['id', 'name', 'run']), `profile.extraChecks[${index}]`);
    const checkId = requiredString(check.id, `profile.extraChecks[${index}].id`);
    assert(
      !CHECK_IDS.has(checkId) && !extraIds.has(checkId),
      'SNAPBACK_COMPARATOR_PROFILE_INVALID',
      `duplicate or reserved extra check id ${checkId}`,
    );
    extraIds.add(checkId);
    assert(
      typeof check.run === 'function',
      'SNAPBACK_COMPARATOR_PROFILE_INVALID',
      `profile.extraChecks[${index}].run must be a function`,
    );
    return {
      id: checkId,
      name: requiredString(check.name, `profile.extraChecks[${index}].name`),
      run: check.run,
    };
  });

  const requiredCapabilities = [
    ...new Set([
      ...REQUIRED_TARGET_CAPABILITIES,
      ...(input.requiredCapabilities ?? []),
    ]),
  ];
  assert(
    requiredCapabilities.every((capability) => typeof capability === 'string' && capability.length > 0),
    'SNAPBACK_COMPARATOR_PROFILE_INVALID',
    'profile.requiredCapabilities must contain non-empty strings',
  );
  const nonclaims = [
    ...new Set([
      ...(input.nonclaims ?? [
        'browser rendering or framework-hook behavior',
        'hosted-target parity',
        'performance, scale, migration, backup, rollback, and cost properties',
      ]),
      IDENTITY_NONCLAIM,
    ]),
  ];
  assert(
    Array.isArray(nonclaims) && nonclaims.every((claim) => typeof claim === 'string' && claim.length > 0),
    'SNAPBACK_COMPARATOR_PROFILE_INVALID',
    'profile.nonclaims must contain non-empty strings',
  );
  assert(
    input.setup === undefined || input.setup === null || typeof input.setup === 'function',
    'SNAPBACK_COMPARATOR_PROFILE_INVALID',
    'profile.setup must be a function',
  );

  return Object.freeze({
    schemaVersion: COMPARATOR_PROFILE_SCHEMA_VERSION,
    id,
    title,
    target: Object.freeze(target),
    refs: Object.freeze(refs),
    fixtures: Object.freeze({
      identities: Object.freeze(identities),
      live: Object.freeze(live),
      atomic: Object.freeze(atomic),
      rejection: Object.freeze(rejection),
      presence: Object.freeze(presence),
    }),
    extraChecks: Object.freeze(normalizedExtraChecks.map(Object.freeze)),
    requiredCapabilities: Object.freeze(requiredCapabilities),
    nonclaims: Object.freeze([...nonclaims]),
    setup: typeof input.setup === 'function' ? input.setup : null,
  });
}

export async function loadComparatorProfile(path) {
  const resolved = resolve(path);
  const module = await import(`${pathToFileURL(resolved).href}?snapback-comparator=${Date.now()}`);
  return defineComparatorProfile(module.default ?? module.profile);
}

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolveDeferred, rejectDeferred) => {
    resolvePromise = resolveDeferred;
    rejectPromise = rejectDeferred;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

async function withDeadline(operation, timeoutMs, checkId, {
  timeoutCode = 'SNAPBACK_COMPARATOR_CHECK_TIMEOUT',
  onTimeout = null,
} = {}) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try {
        onTimeout?.();
      } finally {
        reject(comparatorError(
          timeoutCode,
          `${checkId} exceeded its ${timeoutMs}ms deadline`,
          { checkId, timeoutMs },
        ));
      }
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(operation), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function cleanupAttestation(cleanup) {
  return {
    attempted: true,
    ok: cleanup?.ok === true,
    managed: cleanup?.managed === true,
    leaderExited: cleanup?.leaderExited ?? null,
    temporaryStateRemoved: cleanup?.temporaryStateRemoved === true,
    errors: serializable(cleanup?.errors, []),
  };
}

async function closeComparatorTarget(target, timeoutMs) {
  return cleanupAttestation(await withDeadline(
    () => target.close(),
    timeoutMs,
    'target-cleanup',
    { timeoutCode: 'SNAPBACK_COMPARATOR_CLEANUP_FAILED' },
  ));
}

function durableVersion(inspect) {
  const version = inspect?.storage?.version;
  assert(
    Number.isSafeInteger(version) && version >= 0,
    'SNAPBACK_COMPARATOR_CAPABILITY_MISSING',
    'target inspect response has no durable storage.version',
  );
  return version;
}

function publicError(error) {
  return {
    code: error?.diagnostic?.code ?? error?.code ?? 'SNAPBACK_COMPARATOR_CHECK_FAILED',
    message: String(error?.diagnostic?.message ?? error?.message ?? error),
  };
}

function validateReceiptDiagnostic(value, label) {
  if (value === null) return;
  receiptPlainObject(value, label);
  receiptExactKeys(value, new Set(['code', 'message']), label);
  receiptString(value.code, `${label}.code`);
  assert(
    typeof value.message === 'string',
    'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
    `${label}.message must be a string`,
  );
}

function presenceEntries(overlay, prune) {
  const entries = overlay.currentEntries({ prune });
  assert(
    Array.isArray(entries),
    'SNAPBACK_COMPARATOR_CHECK_FAILED',
    'presence overlay currentEntries() did not return an array',
  );
  return entries;
}

async function disposeOverlay(client, overlay, ref, options) {
  try {
    overlay?.dispose?.();
  } finally {
    try {
      await client.unsubscribeEphemeral(ref, options);
    } catch {
      // The connection reaper is the authoritative backstop. A cleanup
      // failure that matters is retained by target.close(), which owns it.
    }
  }
}

function comparatorCheckPlan(profile, target, timeoutMs) {
  const {
    identities,
    live,
    atomic,
    rejection,
    presence,
  } = profile.fixtures;
  const observer = target.createClient({ role: 'observer', userId: identities.observerUserId });
  const actor = target.createClient({ role: 'actor', userId: identities.actorUserId });
  const resolvedIdentities = {
    observerUserId: observer?.principalId,
    actorUserId: actor?.principalId,
  };
  const identitySources = {
    observer: observer?.principalSource,
    actor: actor?.principalSource,
  };
  for (const [role, principalId] of Object.entries(resolvedIdentities)) {
    assert(
      typeof principalId === 'string' && principalId.length > 0,
      'SNAPBACK_COMPARATOR_IDENTITY_MISMATCH',
      `${role} target client did not expose its resolved identity`,
    );
  }
  assert(
    Object.values(identitySources).every((source) => (
      ['sessions-authenticated', 'dev-asserted', 'fixture-asserted'].includes(source)
    )),
    'SNAPBACK_COMPARATOR_IDENTITY_MISMATCH',
    'target clients did not classify the authority source of their identities',
    { identitySources },
  );
  assert(
    resolvedIdentities.observerUserId !== resolvedIdentities.actorUserId,
    'SNAPBACK_COMPARATOR_IDENTITY_MISMATCH',
    'observer and actor target clients resolved to the same identity',
  );
  const connection = (purpose) => `comparator_${profile.id}_${purpose}_${process.pid}`;
  const check = (definition, run) => ({ ...definition, run: () => withDeadline(run, timeoutMs, definition.id) });

  return [
    check(COMPARATOR_CHECKS[0], async () => {
      target.assertAlive?.();
      const update = deferred();
      const establishedReceipt = deferred();
      const connectionId = connection('live_observer');
      let handle;
      try {
        handle = await observer.liveQuery(profile.refs.liveQuery, {
          connectionId,
          args: live.queryArgs,
          userId: resolvedIdentities.observerUserId,
          transport: 'stream',
          fallbackToPoll: false,
          onUpdate(rows, detail) {
            try {
              if (live.matches(rows, detail) === true) update.resolve({ rows, detail });
            } catch (error) {
              update.reject(error);
            }
          },
          onSubscriptionEvent(receipt) {
            if (receipt.event === 'established') establishedReceipt.resolve(receipt);
          },
        });
        assert(
          live.matches(handle.rows, { kind: 'snapshot', version: handle.version }) !== true,
          'SNAPBACK_COMPARATOR_LIVE_WITNESS_PREEXISTING',
          'the live-delivery witness already existed in the initial snapshot',
        );
        await actor.mutate(profile.refs.liveMutation, {
          args: live.mutationArgs,
          userId: resolvedIdentities.actorUserId,
        });
        const [observed, established] = await Promise.all([
          update.promise,
          establishedReceipt.promise,
        ]);
        assert(
          established?.transport === 'push',
          'SNAPBACK_COMPARATOR_POLLING_AS_PUSH',
          'live delivery was not attributed to the native push transport',
          { transport: established?.transport ?? null },
        );
        assert(
          live.matches(observed.rows, observed.detail) === true,
          'SNAPBACK_COMPARATOR_LIVE_DELIVERY_FAILED',
          'the observer never received the actor mutation',
        );
        return {
          observerIdentity: resolvedIdentities.observerUserId,
          actorIdentity: resolvedIdentities.actorUserId,
          identitySources,
          transport: established.transport,
          subscriptionId: established.subscriptionId,
          deliveredVersion: observed.detail?.version ?? handle.version ?? null,
        };
      } finally {
        handle?.dispose?.();
        try { await observer.disconnect(connectionId); } catch { /* target close owns residuals */ }
      }
    }),

    check(COMPARATOR_CHECKS[1], async () => {
      target.assertAlive?.();
      const beforeVersion = durableVersion(await actor.inspect());
      const before = await atomic.snapshot(actor);
      assert(
        before !== null && typeof before === 'object' && !Array.isArray(before),
        'SNAPBACK_COMPARATOR_ATOMIC_WITNESS_INVALID',
        'atomic snapshot before mutation must be an object',
      );
      assert(
        atomic.declaredWrites.every((name) => Object.hasOwn(before, name)),
        'SNAPBACK_COMPARATOR_ATOMIC_WITNESS_INVALID',
        'atomic snapshot omitted a declared write',
        { declaredWrites: atomic.declaredWrites, witnessed: Object.keys(before) },
      );
      await actor.mutate(profile.refs.atomicMutation, {
        args: atomic.mutationArgs,
        userId: resolvedIdentities.actorUserId,
      });
      const after = await atomic.snapshot(actor);
      assert(
        after !== null && typeof after === 'object' && !Array.isArray(after),
        'SNAPBACK_COMPARATOR_ATOMIC_WITNESS_INVALID',
        'atomic snapshot after mutation must be an object',
      );
      const changed = atomic.declaredWrites.filter((name) => !sameValue(before[name], after[name]));
      assert(
        changed.length === atomic.declaredWrites.length,
        'SNAPBACK_COMPARATOR_ATOMIC_WRITE_SET_FAILED',
        'the mutation did not visibly change every declared write witness',
        { declaredWrites: atomic.declaredWrites, changed },
      );
      const afterVersion = durableVersion(await actor.inspect());
      assert(
        afterVersion === beforeVersion + 1,
        'SNAPBACK_COMPARATOR_ATOMIC_WRITE_SET_FAILED',
        'the declared-write mutation was not one durable commit',
        { beforeVersion, afterVersion },
      );
      return {
        declaredWrites: atomic.declaredWrites,
        changed,
        beforeVersion,
        afterVersion,
      };
    }),

    check(COMPARATOR_CHECKS[2], async () => {
      target.assertAlive?.();
      const beforeVersion = durableVersion(await actor.inspect());
      const before = await rejection.snapshot(actor);
      let rejectionError = null;
      try {
        await actor.mutate(profile.refs.rejectedMutation, {
          args: rejection.mutationArgs,
          userId: resolvedIdentities.actorUserId,
        });
      } catch (error) {
        rejectionError = error;
      }
      assert(
        rejectionError !== null,
        'SNAPBACK_COMPARATOR_REJECTION_MISSING',
        'the configured rejected mutation succeeded',
      );
      if (rejection.diagnosticCode) {
        assert(
          rejectionError?.diagnostic?.code === rejection.diagnosticCode,
          'SNAPBACK_COMPARATOR_REJECTION_DIAGNOSTIC_MISMATCH',
          'the rejected mutation returned the wrong diagnostic code',
          {
            expected: rejection.diagnosticCode,
            actual: rejectionError?.diagnostic?.code ?? null,
          },
        );
      }
      const after = await rejection.snapshot(actor);
      const afterVersion = durableVersion(await actor.inspect());
      assert(
        sameValue(before, after),
        'SNAPBACK_COMPARATOR_REJECTION_ROLLBACK_FAILED',
        'visible durable state changed after the rejected mutation',
      );
      assert(
        afterVersion === beforeVersion,
        'SNAPBACK_COMPARATOR_REJECTION_VERSION_ADVANCED',
        'the rejected mutation advanced the durable version',
        { beforeVersion, afterVersion },
      );
      return {
        diagnosticCode: rejectionError?.diagnostic?.code ?? null,
        beforeVersion,
        afterVersion,
      };
    }),

    check(COMPARATOR_CHECKS[3], async () => {
      target.assertAlive?.();
      const observerConnection = connection('presence_observer');
      const disconnectPublisher = connection('presence_disconnect');
      const ttlPublisher = connection('presence_ttl');
      const freshConnection = connection('presence_fresh');
      const subscriptionOptions = {
        connectionId: observerConnection,
        scope: presence.scope,
        userId: resolvedIdentities.observerUserId,
        permissions: presence.permissions,
      };
      let overlay;
      let fresh;
      try {
        overlay = await observer.subscribeEphemeral(profile.refs.presence, subscriptionOptions);
        await actor.publishEphemeral(profile.refs.presence, {
          connectionId: disconnectPublisher,
          scope: presence.scope,
          value: presence.value,
          userId: resolvedIdentities.actorUserId,
          permissions: presence.permissions,
        });
        await overlay.drain();
        assert(
          presenceEntries(overlay, false).some((entry) => presence.matches(entry, 'disconnect')),
          'SNAPBACK_COMPARATOR_PRESENCE_DISCONNECT_FAILED',
          'disconnect witness was absent before disconnect',
        );
        await actor.disconnect(disconnectPublisher);
        await overlay.drain();
        assert(
          !presenceEntries(overlay, false).some((entry) => presence.matches(entry, 'disconnect')),
          'SNAPBACK_COMPARATOR_PRESENCE_DISCONNECT_FAILED',
          'connection-owned presence survived disconnect',
        );

        await actor.publishEphemeral(profile.refs.presence, {
          connectionId: ttlPublisher,
          scope: presence.scope,
          value: presence.value,
          ttlMs: presence.ttlMs,
          userId: resolvedIdentities.actorUserId,
          permissions: presence.permissions,
        });
        await overlay.drain();
        assert(
          presenceEntries(overlay, false).some((entry) => presence.matches(entry, 'ttl')),
          'SNAPBACK_COMPARATOR_PRESENCE_TTL_FAILED',
          'TTL witness was absent before expiry',
        );
        await new Promise((resolveWait) => setTimeout(resolveWait, presence.ttlMs + 25));
        fresh = await observer.subscribeEphemeral(profile.refs.presence, {
          ...subscriptionOptions,
          connectionId: freshConnection,
        });
        assert(
          !presenceEntries(fresh, false).some((entry) => presence.matches(entry, 'ttl')),
          'SNAPBACK_COMPARATOR_PRESENCE_TTL_FAILED',
          'fresh server snapshot retained expired presence',
        );
        await overlay.drain();
        assert(
          !presenceEntries(overlay, false).some((entry) => presence.matches(entry, 'ttl')),
          'SNAPBACK_COMPARATOR_PRESENCE_TTL_FAILED',
          'existing observer retained expired presence after server sweep',
        );
        return { disconnectRemoved: true, ttlRemoved: true, ttlMs: presence.ttlMs };
      } finally {
        await disposeOverlay(observer, fresh, profile.refs.presence, {
          ...subscriptionOptions,
          connectionId: freshConnection,
        });
        await disposeOverlay(observer, overlay, profile.refs.presence, subscriptionOptions);
        for (const connectionId of [observerConnection, freshConnection]) {
          try { await observer.disconnect(connectionId); } catch { /* target close owns residuals */ }
        }
        try { await actor.disconnect(ttlPublisher); } catch { /* target close owns residuals */ }
      }
    }),

    check(COMPARATOR_CHECKS[4], async () => {
      target.assertAlive?.();
      const observerConnection = connection('ephemeral_observer');
      const publisherConnection = connection('ephemeral_publisher');
      const subscriptionOptions = {
        connectionId: observerConnection,
        scope: presence.scope,
        userId: resolvedIdentities.observerUserId,
        permissions: presence.permissions,
      };
      let overlay;
      try {
        overlay = await observer.subscribeEphemeral(profile.refs.presence, subscriptionOptions);
        const beforeVersion = durableVersion(await actor.inspect());
        await actor.publishEphemeral(profile.refs.presence, {
          connectionId: publisherConnection,
          scope: presence.scope,
          value: presence.value,
          userId: resolvedIdentities.actorUserId,
          permissions: presence.permissions,
        });
        await overlay.drain();
        assert(
          presenceEntries(overlay, false).some((entry) => presence.matches(entry, 'separation')),
          'SNAPBACK_COMPARATOR_EPHEMERAL_DELIVERY_FAILED',
          'ephemeral publish was not observable',
        );
        const afterVersion = durableVersion(await actor.inspect());
        assert(
          afterVersion === beforeVersion,
          'SNAPBACK_COMPARATOR_EPHEMERAL_VERSION_ADVANCED',
          'ephemeral publish advanced the durable storage version',
          { beforeVersion, afterVersion },
        );
        return { beforeVersion, afterVersion };
      } finally {
        await disposeOverlay(observer, overlay, profile.refs.presence, subscriptionOptions);
        try { await observer.disconnect(observerConnection); } catch { /* target close owns residuals */ }
        try { await actor.disconnect(publisherConnection); } catch { /* target close owns residuals */ }
      }
    }),

    ...profile.extraChecks.map((extra) => check(extra, async () => {
      target.assertAlive?.();
      return extra.run({
        observer,
        actor,
        observerUserId: resolvedIdentities.observerUserId,
        actorUserId: resolvedIdentities.actorUserId,
        observerIdentitySource: identitySources.observer,
        actorIdentitySource: identitySources.actor,
        refs: profile.refs,
      });
    })),
  ];
}

function expectedCheckDefinitions(profile) {
  return [
    ...COMPARATOR_CHECKS,
    ...profile.extraChecks.map(({ id, name }) => ({ id, name })),
  ];
}

function capabilityGaps(profile, target) {
  const reported = new Set(target.capabilityGaps ?? []);
  const available = target.capabilities ? new Set(target.capabilities) : null;
  return profile.requiredCapabilities
    .filter((id) => reported.has(id) || (available !== null && !available.has(id)))
    .map((id) => ({
      id,
      blocking: true,
      source: reported.has(id) ? 'target-gap' : 'target-capability-manifest',
    }));
}

function baseReceipt(profile, startedAtMs) {
  return {
    schemaVersion: COMPARATOR_RECEIPT_SCHEMA_VERSION,
    profileId: profile.id,
    title: profile.title,
    status: 'infrastructure-error',
    exitCode: 2,
    startedAtMs,
    finishedAtMs: startedAtMs,
    durationMs: 0,
    executorPackages: executingPackageIdentity(),
    identity: {
      target: null,
      artifact: null,
      binary: null,
    },
    expectedChecks: expectedCheckDefinitions(profile),
    checks: [],
    capabilityGaps: [],
    cleanup: {
      attempted: false,
      ok: false,
      managed: false,
      leaderExited: null,
      temporaryStateRemoved: false,
      errors: [],
    },
    nonclaims: [...profile.nonclaims],
    diagnostic: null,
  };
}

function unavailableReceiptIdentity(profile) {
  let artifact = null;
  try {
    artifact = JSON.parse(readFileSync(
      join(resolve(profile.target.backendDirectory), 'generated', 'artifacts.json'),
      'utf8',
    ));
  } catch {
    // The unavailable discriminant is the honest evidence when generation or
    // target startup failed before an artifact could be identified.
  }
  return {
    target: {
      available: false,
      kind: 'local-isolated',
      profileId: 'local-dev-sqlite-ibex',
      serverUrl: null,
      databaseMode: 'isolated-file',
      managed: false,
    },
    artifact: {
      available: artifact !== null,
      appId: artifact?.appId ?? null,
      bundleHash: artifact?.bundleHash ?? null,
      inputsHash: artifact?.inputsHash ?? null,
      schemaHash: artifact?.schemaHash ?? null,
    },
    binary: {
      available: false,
      path: profile.target.runtimeBinary ? resolve(profile.target.runtimeBinary) : null,
      sha256: null,
      crateVersion: null,
      gitCommit: null,
      gitDirty: null,
      buildProfile: null,
      startupNonce: null,
    },
  };
}

function concludeReceipt(receipt, infrastructureFailure) {
  const expectedIds = receipt.expectedChecks.map(({ id }) => id);
  const executedIds = receipt.checks.map(({ id }) => id);
  const nonvacuous = receipt.checks.length > 0
    && expectedIds.length === executedIds.length
    && expectedIds.every((id, index) => executedIds[index] === id);
  if (!nonvacuous && infrastructureFailure === null) {
    receipt.diagnostic = publicError(comparatorError(
      'SNAPBACK_COMPARATOR_CHECK_SHORTFALL',
      `ran ${receipt.checks.length}/${receipt.expectedChecks.length} expected checks`,
      { expectedIds, executedIds },
    ));
  }
  if (receipt.identity.target === null) {
    receipt.identity = unavailableReceiptIdentity(receipt.__profile);
  }
  if (infrastructureFailure !== null) {
    receipt.status = 'infrastructure-error';
    receipt.exitCode = 2;
    receipt.diagnostic = publicError(infrastructureFailure);
  } else if (receipt.capabilityGaps.some(({ blocking }) => blocking)) {
    receipt.status = 'unsupported';
    receipt.exitCode = 1;
    receipt.diagnostic = {
      code: 'SNAPBACK_COMPARATOR_CAPABILITY_GAP',
      message: `required comparator capabilities are unavailable: ${
        receipt.capabilityGaps.filter(({ blocking }) => blocking).map(({ id }) => id).join(', ')
      }`,
    };
  } else if (!nonvacuous || receipt.checks.some(({ status }) => status !== 'passed')) {
    receipt.status = 'failed';
    receipt.exitCode = 1;
  } else {
    receipt.status = 'passed';
    receipt.exitCode = 0;
  }
  receipt.finishedAtMs = Date.now();
  receipt.durationMs = receipt.finishedAtMs - receipt.startedAtMs;
  return receipt;
}

/**
 * Run the published five-property comparator profile.
 *
 * startTarget is an explicit dependency seam for hosted adapters and fixture
 * tests. The default starts one isolated local Snapback target with runDev.
 */
export async function runComparatorAcceptance(input, {
  startTarget = startLocalComparatorTarget,
  timeoutMs = 15_000,
  receiptFile = null,
} = {}) {
  const profile = defineComparatorProfile(input);
  assert(
    Number.isInteger(timeoutMs) && timeoutMs > 0,
    'SNAPBACK_COMPARATOR_PROFILE_INVALID',
    'timeoutMs must be a positive integer',
  );
  const receipt = baseReceipt(profile, Date.now());
  Object.defineProperty(receipt, '__profile', {
    value: profile,
    enumerable: false,
  });
  let target = null;
  let infrastructureFailure = null;
  const startupAbort = new AbortController();
  const startupPromise = Promise.resolve().then(() => startTarget(profile.target, {
    profile,
    timeoutMs,
    signal: startupAbort.signal,
  }));
  try {
    try {
      target = await withDeadline(
        () => startupPromise,
        timeoutMs,
        'target-startup',
        { onTimeout: () => startupAbort.abort() },
      );
    } catch (error) {
      if (error?.code === 'SNAPBACK_COMPARATOR_CHECK_TIMEOUT') {
        // A third-party adapter may ignore the abort signal and resolve after
        // the receipt deadline. Claim and close that late target instead of
        // orphaning its process or temporary database.
        void startupPromise.then(async (lateTarget) => {
          if (lateTarget?.close) {
            try {
              await closeComparatorTarget(lateTarget, timeoutMs);
            } catch {
              // The bounded primary receipt already records the startup
              // timeout. A late adapter cleanup cannot mutate it after return.
            }
          }
        }).catch(() => {});
      }
      throw error;
    }
    assertPlainObject(target, 'comparator target');
    assert(
      typeof target.createClient === 'function' && typeof target.close === 'function',
      'SNAPBACK_COMPARATOR_SETUP_FAILED',
      'comparator target must provide createClient() and close()',
    );
    receipt.identity = serializable(target.identity);
    assertReceiptIdentity(receipt.identity);
    receipt.capabilityGaps = capabilityGaps(profile, target);
    if (receipt.capabilityGaps.length === 0) {
      if (profile.setup) {
        await withDeadline(() => profile.setup({
          observer: target.createClient({
            role: 'observer',
            userId: profile.fixtures.identities.observerUserId,
          }),
          actor: target.createClient({
            role: 'actor',
            userId: profile.fixtures.identities.actorUserId,
          }),
        }), timeoutMs, 'profile-setup');
      }
      const plan = comparatorCheckPlan(profile, target, timeoutMs);
      for (const definition of plan) {
        const startedAtMs = Date.now();
        try {
          const details = await definition.run();
          const finishedAtMs = Date.now();
          receipt.checks.push({
            id: definition.id,
            name: definition.name,
            status: 'passed',
            startedAtMs,
            finishedAtMs,
            durationMs: finishedAtMs - startedAtMs,
            details: serializable(details),
            diagnostic: null,
          });
        } catch (error) {
          const finishedAtMs = Date.now();
          receipt.checks.push({
            id: definition.id,
            name: definition.name,
            status: INFRASTRUCTURE_CODES.has(error?.diagnostic?.code)
              ? 'infrastructure-error'
              : 'failed',
            startedAtMs,
            finishedAtMs,
            durationMs: finishedAtMs - startedAtMs,
            details: null,
            diagnostic: publicError(error),
          });
          if (INFRASTRUCTURE_CODES.has(error?.diagnostic?.code)) {
            infrastructureFailure = error;
            break;
          }
        }
      }
    }
  } catch (error) {
    infrastructureFailure = INFRASTRUCTURE_CODES.has(error?.diagnostic?.code)
      ? error
      : comparatorError(
          'SNAPBACK_COMPARATOR_SETUP_FAILED',
          String(error?.message ?? error),
          { cause: publicError(error) },
        );
  } finally {
    if (target !== null) {
      receipt.cleanup.attempted = true;
      try {
        receipt.cleanup = await closeComparatorTarget(target, timeoutMs);
        if (!receipt.cleanup.ok) {
          infrastructureFailure = comparatorError(
            'SNAPBACK_COMPARATOR_CLEANUP_FAILED',
            'target cleanup did not attest success',
            receipt.cleanup,
          );
        }
      } catch (error) {
        receipt.cleanup.errors = [publicError(error)];
        infrastructureFailure = comparatorError(
          'SNAPBACK_COMPARATOR_CLEANUP_FAILED',
          String(error?.message ?? error),
        );
      }
    }
  }
  if (!receipt.cleanup.attempted && target === null) {
    receipt.cleanup = {
      attempted: false,
      ok: true,
      managed: false,
      leaderExited: null,
      temporaryStateRemoved: true,
      errors: [],
    };
  }
  concludeReceipt(receipt, infrastructureFailure);
  validateComparatorReceipt(receipt);
  if (receiptFile !== null) writeComparatorReceipt(receiptFile, receipt);
  return receipt;
}

function sha256File(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

async function startLocalComparatorTarget(target, { profile, timeoutMs, signal = null }) {
  const backendDirectory = resolve(target.backendDirectory);
  const projectRoot = resolve(target.projectRoot ?? dirname(backendDirectory));
  const generatedDirectory = join(backendDirectory, 'generated');
  const artifactsPath = join(generatedDirectory, 'artifacts.json');
  const stateRoot = mkdtempSync(join(tmpdir(), 'snapback-comparator-'));
  const restoreLock = `${stateRoot}.snapback.restore.lock`;
  const database = join(stateRoot, 'comparator.sqlite3');
  const readyFile = join(stateRoot, 'comparator.ready.json');
  let dev = null;
  try {
    signal?.throwIfAborted();
    const cli = await import('./index.mjs');
    dev = await cli.runDev({
      backendDirectory,
      projectRoot,
      database,
      readyFile,
      watch: false,
      // A sessions-mode app must settle schema and functions atomically at
      // process start. The ordinary dev hot-load path remains available after
      // startup, but cannot establish that initial settled authority mode.
      bootstrapGeneratedAtStart: true,
      ...(target.runtimeBinary ? { runtimeBinary: resolve(target.runtimeBinary) } : {}),
      ...(target.environment ? { env: { ...process.env, ...target.environment } } : {}),
      serverStdio: ['ignore', 'ignore', 'ignore'],
    });
    signal?.throwIfAborted();
    const descriptor = cli.readReadyDescriptor(readyFile);
    const adminToken = cli.managedAdminToken(descriptor, database);
    const devIdentityCapability = cli.managedDevIdentityCapability(descriptor, {
      readyFile,
      database,
    });
    // Public inspection carries deployment/capability identity. Attaching the
    // admin token here would request the separate bounded secret-read
    // projection, which the comparator neither needs nor has authority to mint.
    const probe = new SnapbackClient(dev.serverUrl);
    const [health, inspectResponse] = await Promise.all([
      probe.health(),
      fetch(`${dev.serverUrl}/inspect`, {
        headers: { 'x-snapback-auth-client-protocol': '1' },
      }),
    ]);
    const inspect = await inspectResponse.json();
    assert(
      inspectResponse.ok,
      'SNAPBACK_COMPARATOR_SETUP_FAILED',
      inspect?.diagnostic?.message ?? 'public target inspection failed',
      { status: inspectResponse.status, diagnostic: inspect?.diagnostic ?? null },
    );
    const artifact = JSON.parse(readFileSync(artifactsPath, 'utf8'));
    assert(
      inspect?.functions?.appId === artifact.appId
        && inspect?.functions?.bundleHash === artifact.bundleHash,
      'SNAPBACK_COMPARATOR_IDENTITY_MISMATCH',
      'loaded target does not match generated artifact identity',
      {
        expected: { appId: artifact.appId, bundleHash: artifact.bundleHash },
        actual: {
          appId: inspect?.functions?.appId ?? null,
          bundleHash: inspect?.functions?.bundleHash ?? null,
        },
      },
    );
    const binaryPath = resolve(dev.runtime.binary);
    const targetIdentity = {
      target: {
        available: true,
        kind: 'local-isolated',
        profileId: 'local-dev-sqlite-ibex',
        serverUrl: dev.serverUrl,
        databaseMode: 'isolated-file',
        managed: dev.managed === true,
      },
      artifact: {
        available: true,
        appId: artifact.appId,
        bundleHash: artifact.bundleHash,
        inputsHash: artifact.inputsHash,
        schemaHash: artifact.schemaHash,
      },
      binary: {
        available: true,
        path: binaryPath,
        sha256: sha256File(binaryPath),
        crateVersion: health?.binary?.crateVersion ?? dev.runtimeRecovery?.actualStamp?.crateVersion ?? null,
        gitCommit: health?.binary?.gitCommit ?? dev.runtimeRecovery?.actualStamp?.gitCommit ?? null,
        gitDirty: health?.binary?.gitDirty ?? dev.runtimeRecovery?.actualStamp?.gitDirty ?? null,
        buildProfile: health?.binary?.buildProfile ?? dev.runtimeRecovery?.actualStamp?.buildProfile ?? null,
        startupNonce: health?.binary?.startupNonce ?? descriptor.startupNonce ?? null,
      },
    };
    const capabilityGaps = [
      ...(inspect?.capabilityGaps ?? []),
      ...(inspect?.capabilityManifest?.capabilityGaps ?? []),
    ];
    const capabilities = new Set([
      'live_subscriptions',
      ...(artifact.ephemeralCollections?.length > 0 ? ['ephemeral_collections'] : []),
      ...(
        capabilityGaps.includes('websocket_push_transport')
          ? []
          : ['websocket_push_transport']
      ),
      ...(
        inspect?.capabilityManifest?.targetCapabilities?.filter((entry) => entry.available)
          .map((entry) => entry.id) ?? []
      ),
    ]);
    const protocolHeaders = {
      'content-type': 'application/json',
      'x-snapback-auth-client-protocol': '1',
      'x-snapback-auth-invalidation-protocol': '1',
      'x-snapback-authority-descriptor-protocol': '1',
      'x-snapback-authorized-lease-protocol': '1',
    };
    // @ref LLP 0058#bootstrap-handshake — select the active auth transport
    // from the process-scoped handshake, never from generated capability
    // guesses. Dev uses body-carried local impersonation; sessions uses the
    // provider and bearer custody below.
    const authSessionResponse = await fetch(`${dev.serverUrl}/auth/session`, {
      headers: protocolHeaders,
    });
    const authSession = await authSessionResponse.json();
    assert(
      authSessionResponse.ok
        && ['dev', 'sessions'].includes(authSession?.activeMode)
        && authSession?.modeState === 'settled'
        && authSession?.appDataAvailability === 'available',
      'SNAPBACK_COMPARATOR_SETUP_FAILED',
      authSession?.diagnostic?.message ?? 'managed target auth mode is not settled and available',
    );
    assert(
      health?.binary?.startupNonce === descriptor.startupNonce,
      'SNAPBACK_COMPARATOR_IDENTITY_MISMATCH',
      'managed target health did not match the ready-file startup nonce',
    );
    const mintSessionClient = async (role, identityLabel) => {
      const expectedImpersonationFile = `${readyFile}.impersonation`;
      assert(
        typeof descriptor.impersonationCapabilityFile === 'string'
          && realpathSync(descriptor.impersonationCapabilityFile)
            === realpathSync(expectedImpersonationFile),
        'SNAPBACK_COMPARATOR_SETUP_FAILED',
        'managed target did not name its mechanical impersonation-capability sibling',
      );
      const impersonationCapability = readFileSync(expectedImpersonationFile, 'utf8').trim();
      assert(
        impersonationCapability.length > 0,
        'SNAPBACK_COMPARATOR_SETUP_FAILED',
        'managed target impersonation capability is empty',
      );
      const emailLabel = `${profile.id}-${role}-${identityLabel}`
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/gu, '-')
        .slice(0, 80);
      const requestedResponse = await fetch(`${dev.serverUrl}/auth/request-code`, {
        method: 'POST',
        headers: protocolHeaders,
        body: JSON.stringify({ email: `${emailLabel}@comparator.snapback.test` }),
      });
      const requested = await requestedResponse.json();
      assert(
        requestedResponse.ok && typeof requested.challengeId === 'string',
        'SNAPBACK_COMPARATOR_SETUP_FAILED',
        requested?.diagnostic?.message ?? `could not request ${role} comparator session`,
      );
      const mailboxResponse = await fetch(
        `${dev.serverUrl}/_snapback/api/auth/mailbox?challengeId=${
          encodeURIComponent(requested.challengeId)
        }`,
        {
          headers: {
            'x-snapback-admin-token': adminToken,
            'x-snapback-impersonation-capability': impersonationCapability,
          },
        },
      );
      const mailbox = await mailboxResponse.json();
      assert(
        mailboxResponse.ok && typeof mailbox.code === 'string',
        'SNAPBACK_COMPARATOR_SETUP_FAILED',
        mailbox?.diagnostic?.message ?? `could not read ${role} comparator mailbox`,
      );
      const exchangeResponse = await fetch(`${dev.serverUrl}/auth/exchange`, {
        method: 'POST',
        headers: protocolHeaders,
        body: JSON.stringify({
          challengeId: requested.challengeId,
          code: mailbox.code,
        }),
      });
      const credential = await exchangeResponse.json();
      assert(
        exchangeResponse.ok
          && typeof credential.token === 'string'
          && typeof credential.session?.userId === 'string'
          && credential.session.userId.length > 0,
        'SNAPBACK_COMPARATOR_SETUP_FAILED',
        credential?.diagnostic?.message ?? `could not exchange ${role} comparator session`,
      );
      const authenticated = new SnapbackClient(dev.serverUrl, {
        adminToken,
        bearerToken: credential.token,
        authClientProtocol: 1,
        authInvalidationProtocol: 1,
        authorityDescriptorProtocol: 1,
        authorizedLeaseProtocol: 1,
        clientStoreId: `comparator-${profile.id}-${role}`,
      });
      const withoutAssertedUser = (options = {}) => {
        const { userId: _ignored, ...rest } = options;
        return rest;
      };
      return {
        // The configured fixture identity is only a stable minting alias in
        // sessions mode. Checks and receipts must name the authority that the
        // server actually authenticated.
        principalId: credential.session.userId,
        principalSource: 'sessions-authenticated',
        query: (ref, options) => authenticated.query(ref, withoutAssertedUser(options)),
        mutate: (ref, options) => authenticated.mutate(ref, withoutAssertedUser(options)),
        liveQuery: (ref, options) => authenticated.liveQuery(ref, withoutAssertedUser(options)),
        subscribeEphemeral: (ref, options) => (
          authenticated.subscribeEphemeral(ref, withoutAssertedUser(options))
        ),
        publishEphemeral: (ref, options) => (
          authenticated.publishEphemeral(ref, withoutAssertedUser(options))
        ),
        unsubscribeEphemeral: (ref, options) => (
          authenticated.unsubscribeEphemeral(ref, withoutAssertedUser(options))
        ),
        disconnect: (connectionId) => authenticated.disconnect(connectionId),
        async inspect() {
          const response = await fetch(`${dev.serverUrl}/inspect`, {
            headers: { 'x-snapback-auth-client-protocol': '1' },
          });
          const body = await response.json();
          assert(
            response.ok,
            'SNAPBACK_COMPARATOR_CHECK_FAILED',
            body?.diagnostic?.message ?? 'public target inspection failed',
          );
          return body;
        },
      };
    };
    const createDevClient = (identityLabel) => {
      const client = new SnapbackClient(dev.serverUrl, {
        adminToken,
        devIdentityCapability,
      });
      const withAssertedUser = (options = {}) => ({ ...options, userId: identityLabel });
      return {
        principalId: identityLabel,
        principalSource: 'dev-asserted',
        query: (ref, options) => client.query(ref, withAssertedUser(options)),
        mutate: (ref, options) => client.mutate(ref, withAssertedUser(options)),
        liveQuery: (ref, options) => client.liveQuery(ref, withAssertedUser(options)),
        subscribeEphemeral: (ref, options) => (
          client.subscribeEphemeral(ref, withAssertedUser(options))
        ),
        publishEphemeral: (ref, options) => (
          client.publishEphemeral(ref, withAssertedUser(options))
        ),
        unsubscribeEphemeral: (ref, options) => (
          client.unsubscribeEphemeral(ref, withAssertedUser(options))
        ),
        disconnect: (connectionId) => client.disconnect(connectionId),
        inspect: () => client.inspect(),
      };
    };
    const roleClients = authSession.activeMode === 'sessions'
      ? new Map([
          ['observer', await mintSessionClient(
            'observer',
            profile.fixtures.identities.observerUserId,
          )],
          ['actor', await mintSessionClient('actor', profile.fixtures.identities.actorUserId)],
        ])
      : new Map([
          ['observer', createDevClient(profile.fixtures.identities.observerUserId)],
          ['actor', createDevClient(profile.fixtures.identities.actorUserId)],
        ]);
    return {
      identity: targetIdentity,
      capabilities: [...capabilities],
      capabilityGaps,
      createClient({ role }) {
        const client = roleClients.get(role);
        assert(
          client,
          'SNAPBACK_COMPARATOR_SETUP_FAILED',
          `unknown comparator client role ${role}`,
        );
        return client;
      },
      assertAlive() {
        if (dev.child?.exitCode !== null) {
          throw comparatorError(
            'SNAPBACK_COMPARATOR_SERVER_DEAD',
            'managed comparator server exited before the run completed',
            { exitCode: dev.child?.exitCode, signal: dev.child?.signalCode ?? null },
          );
        }
      },
      async close() {
        const errors = [];
        await dev.close?.();
        let leaderExited = dev.child === null || dev.child.exitCode !== null;
        if (!leaderExited && dev.child) {
          try {
            await Promise.race([
              once(dev.child, 'close'),
              new Promise((_, reject) => {
                const timer = setTimeout(
                  () => reject(comparatorError(
                    'SNAPBACK_COMPARATOR_CLEANUP_FAILED',
                    `server leader did not exit within ${timeoutMs}ms`,
                  )),
                  timeoutMs,
                );
                timer.unref?.();
              }),
            ]);
            leaderExited = true;
          } catch (error) {
            errors.push(publicError(error));
          }
        }
        try {
          rmSync(stateRoot, { recursive: true, force: true });
          rmSync(restoreLock, { force: true });
        } catch (error) {
          errors.push(publicError(error));
        }
        const temporaryStateRemoved = !existsSync(stateRoot) && !existsSync(restoreLock);
        return {
          ok: errors.length === 0 && leaderExited && temporaryStateRemoved,
          managed: dev.managed === true,
          leaderExited,
          temporaryStateRemoved,
          errors,
        };
      },
    };
  } catch (error) {
    try { await dev?.close?.(); } catch { /* retain original setup error */ }
    try { rmSync(stateRoot, { recursive: true, force: true }); } catch { /* retain original */ }
    try { rmSync(restoreLock, { force: true }); } catch { /* retain original */ }
    throw error;
  }
}

function assertReceiptIdentity(identity) {
  receiptPlainObject(identity, 'receipt.identity');
  receiptExactKeys(identity, new Set(['target', 'artifact', 'binary']), 'receipt.identity');
  receiptPlainObject(identity.target, 'receipt.identity.target');
  receiptPlainObject(identity.artifact, 'receipt.identity.artifact');
  receiptPlainObject(identity.binary, 'receipt.identity.binary');
  receiptExactKeys(
    identity.target,
    new Set(['available', 'kind', 'profileId', 'serverUrl', 'databaseMode', 'managed']),
    'receipt.identity.target',
  );
  receiptExactKeys(
    identity.artifact,
    new Set(['available', 'appId', 'bundleHash', 'inputsHash', 'schemaHash']),
    'receipt.identity.artifact',
  );
  receiptExactKeys(
    identity.binary,
    new Set([
      'available',
      'path',
      'sha256',
      'crateVersion',
      'gitCommit',
      'gitDirty',
      'buildProfile',
      'startupNonce',
    ]),
    'receipt.identity.binary',
  );
  for (const section of [identity.target, identity.artifact, identity.binary]) {
    assert(
      typeof section.available === 'boolean',
      'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
      'identity availability discriminants must be boolean',
    );
  }
  for (const [value, label] of [
    [identity.target.kind, 'identity.target.kind'],
    [identity.target.profileId, 'identity.target.profileId'],
  ]) {
    receiptString(value, label);
  }
  assert(
    typeof identity.target.managed === 'boolean',
    'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
    'identity.target.managed must be boolean',
  );
  assert(
    typeof identity.target.databaseMode === 'string'
      && identity.target.databaseMode.length > 0
      && (
        identity.target.available
          ? typeof identity.target.serverUrl === 'string' && identity.target.serverUrl.length > 0
          : identity.target.serverUrl === null
      ),
    'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
    'identity.target availability and locator fields are inconsistent',
  );
  for (const [section, fields, label] of [
    [identity.artifact, ['appId', 'bundleHash', 'inputsHash', 'schemaHash'], 'artifact'],
    [identity.binary, ['path', 'sha256', 'crateVersion', 'gitCommit', 'buildProfile'], 'binary'],
  ]) {
    for (const field of fields) {
      if (section.available) receiptString(section[field], `identity.${label}.${field}`);
      else assert(
        section[field] === null || (field === 'path' && typeof section[field] === 'string'),
        'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
        `unavailable identity.${label}.${field} must be null`,
      );
    }
  }
  assert(
    identity.binary.available
      ? typeof identity.binary.gitDirty === 'boolean'
      : identity.binary.gitDirty === null,
    'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
    'identity.binary.gitDirty does not match its availability',
  );
}

/**
 * Closed receipt validator used both at write time and by later aggregators.
 */
export function validateComparatorReceipt(receipt, {
  nowMs = Date.now(),
  maxAgeMs = null,
  expectedIdentity = null,
} = {}) {
  receiptPlainObject(receipt, 'comparator receipt');
  receiptExactKeys(receipt, new Set([
    'schemaVersion',
    'profileId',
    'title',
    'status',
    'exitCode',
    'startedAtMs',
    'finishedAtMs',
    'durationMs',
    'executorPackages',
    'identity',
    'expectedChecks',
    'checks',
    'capabilityGaps',
    'cleanup',
    'nonclaims',
    'diagnostic',
  ]), 'comparator receipt');
  assert(
    receipt.schemaVersion === COMPARATOR_RECEIPT_SCHEMA_VERSION,
    'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
    `receipt schemaVersion must be ${COMPARATOR_RECEIPT_SCHEMA_VERSION}`,
  );
  receiptString(receipt.profileId, 'receipt.profileId');
  receiptString(receipt.title, 'receipt.title');
  assert(
    RECEIPT_STATUSES.has(receipt.status),
    'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
    `invalid receipt status ${receipt.status}`,
  );
  const expectedExit = receipt.status === 'passed' ? 0
    : receipt.status === 'infrastructure-error' ? 2 : 1;
  assert(
    receipt.exitCode === expectedExit,
    'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
    `receipt exitCode ${receipt.exitCode} does not match status ${receipt.status}`,
  );
  for (const field of ['startedAtMs', 'finishedAtMs', 'durationMs']) {
    assert(
      Number.isSafeInteger(receipt[field]) && receipt[field] >= 0,
      'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
      `receipt.${field} must be a non-negative safe integer`,
    );
  }
  assert(
    receipt.finishedAtMs >= receipt.startedAtMs
      && receipt.durationMs === receipt.finishedAtMs - receipt.startedAtMs,
    'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
    'receipt timing fields are inconsistent',
  );
  receiptPlainObject(receipt.executorPackages, 'receipt.executorPackages');
  receiptExactKeys(
    receipt.executorPackages,
    new Set(['cli', 'client']),
    'receipt.executorPackages',
  );
  for (const packageName of ['cli', 'client']) {
    const identity = receipt.executorPackages[packageName];
    receiptPlainObject(identity, `receipt.executorPackages.${packageName}`);
    receiptExactKeys(
      identity,
      new Set(['name', 'version', 'algorithm', 'files', 'sha256']),
      `receipt.executorPackages.${packageName}`,
    );
    receiptString(identity.name, `receipt.executorPackages.${packageName}.name`);
    receiptString(identity.version, `receipt.executorPackages.${packageName}.version`);
    assert(
      identity.algorithm === 'sha256-package-files-path-length-content.v1'
        && /^sha256:[0-9a-f]{64}$/u.test(identity.sha256)
        && Array.isArray(identity.files)
        && identity.files.length > 0
        && identity.files.every(
          (file, index, files) => (
            typeof file === 'string'
            && file.length > 0
            && !file.startsWith('/')
            && !file.includes('..')
            && (index === 0 || files[index - 1] < file)
          ),
        ),
      'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
      `receipt.executorPackages.${packageName} is not a closed package identity`,
    );
  }
  const verifierPackages = executingPackageIdentity();
  assert(
    sameValue(receipt.executorPackages, verifierPackages),
    'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
    'comparator receipt executing-package identity does not match the verifier package graph',
    executorPackageMismatchDetails(receipt.executorPackages, verifierPackages),
  );
  assertReceiptIdentity(receipt.identity);
  assert(
    Array.isArray(receipt.expectedChecks) && receipt.expectedChecks.length >= COMPARATOR_CHECKS.length,
    'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
    'receipt expectedChecks is empty or incomplete',
  );
  assert(
    Array.isArray(receipt.checks),
    'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
    'receipt checks must be an array',
  );
  const expectedIds = receipt.expectedChecks.map((check) => {
    receiptPlainObject(check, 'expected check');
    receiptExactKeys(check, new Set(['id', 'name']), 'expected check');
    receiptString(check.name, 'expected check name');
    return receiptString(check.id, 'expected check id');
  });
  assert(
    new Set(expectedIds).size === expectedIds.length
      && COMPARATOR_CHECKS.every(({ id }) => expectedIds.includes(id)),
    'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
    'receipt expectedChecks omits or duplicates mandatory comparator checks',
  );
  const checkIds = receipt.checks.map((check) => {
    receiptPlainObject(check, 'check result');
    receiptExactKeys(check, new Set([
      'id',
      'name',
      'status',
      'startedAtMs',
      'finishedAtMs',
      'durationMs',
      'details',
      'diagnostic',
    ]), 'check result');
    assert(
      CHECK_STATUSES.has(check.status),
      'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
      `invalid check status ${check.status}`,
    );
    receiptString(check.name, `check ${check.id ?? '<unknown>'} name`);
    validateReceiptDiagnostic(check.diagnostic, `check ${check.id ?? '<unknown>'}.diagnostic`);
    assert(
      (check.status === 'passed' && check.diagnostic === null)
        || (check.status !== 'passed' && check.diagnostic !== null),
      'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
      `check ${check.id} status and diagnostic contradict each other`,
    );
    assert(
      Number.isSafeInteger(check.startedAtMs)
        && Number.isSafeInteger(check.finishedAtMs)
        && check.finishedAtMs >= check.startedAtMs
        && check.durationMs === check.finishedAtMs - check.startedAtMs,
      'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
      `check ${check.id} timing fields are inconsistent`,
    );
    return receiptString(check.id, 'check id');
  });
  assert(
    new Set(checkIds).size === checkIds.length
      && checkIds.every((id, index) => id === expectedIds[index]),
    'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
    'receipt checks are duplicated, reordered, or not declared',
  );
  assert(
    Array.isArray(receipt.capabilityGaps),
    'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
    'receipt capabilityGaps must be an array',
  );
  for (const gap of receipt.capabilityGaps) {
    receiptPlainObject(gap, 'capability gap');
    receiptExactKeys(gap, new Set(['id', 'blocking', 'source']), 'capability gap');
    receiptString(gap.id, 'capability gap id');
    assert(
      typeof gap.blocking === 'boolean'
        && ['target-gap', 'target-capability-manifest'].includes(gap.source),
      'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
      `capability gap ${gap.id} is malformed`,
    );
  }
  receiptPlainObject(receipt.cleanup, 'receipt.cleanup');
  receiptExactKeys(receipt.cleanup, new Set([
    'attempted',
    'ok',
    'managed',
    'leaderExited',
    'temporaryStateRemoved',
    'errors',
  ]), 'receipt.cleanup');
  assert(
    typeof receipt.cleanup.attempted === 'boolean'
      && typeof receipt.cleanup.ok === 'boolean'
      && typeof receipt.cleanup.managed === 'boolean'
      && (receipt.cleanup.leaderExited === null || typeof receipt.cleanup.leaderExited === 'boolean')
      && typeof receipt.cleanup.temporaryStateRemoved === 'boolean'
      && Array.isArray(receipt.cleanup.errors),
    'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
    'receipt cleanup attestation is malformed',
  );
  validateReceiptDiagnostic(receipt.diagnostic, 'receipt.diagnostic');
  const fullCheckRun = checkIds.length === expectedIds.length;
  const blockingGaps = receipt.capabilityGaps.filter(({ blocking }) => blocking);
  const successfulCleanup = receipt.cleanup.ok && receipt.cleanup.attempted;
  if (receipt.status === 'passed') {
    assert(
      fullCheckRun
        && receipt.checks.every(({ status }) => status === 'passed')
        && blockingGaps.length === 0
        && receipt.diagnostic === null
        && successfulCleanup,
      'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
      'passing receipt is vacuous, contradictory, or lacks successful cleanup attestation',
    );
  } else if (receipt.status === 'failed') {
    assert(
      fullCheckRun
        && receipt.checks.some(({ status }) => status === 'failed')
        && receipt.checks.every(({ status }) => status !== 'infrastructure-error')
        && blockingGaps.length === 0
        && successfulCleanup,
      'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
      'failed receipt must contain a complete product-check failure without capability or infrastructure gaps',
    );
  } else if (receipt.status === 'unsupported') {
    assert(
      receipt.checks.length === 0
        && blockingGaps.length > 0
        && receipt.diagnostic?.code === 'SNAPBACK_COMPARATOR_CAPABILITY_GAP'
        && successfulCleanup,
      'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
      'unsupported receipt must identify a blocking capability gap before checks run',
    );
  } else {
    assert(
      receipt.diagnostic !== null
        && INFRASTRUCTURE_CODES.has(receipt.diagnostic.code)
        && blockingGaps.length === 0,
      'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
      'infrastructure-error receipt must carry a known infrastructure diagnostic',
    );
  }
  assert(
    Array.isArray(receipt.nonclaims)
      && receipt.nonclaims.length > 0
      && receipt.nonclaims.every((claim) => typeof claim === 'string' && claim.length > 0),
    'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
    'receipt nonclaims must be a non-empty string array',
  );
  if (maxAgeMs !== null) {
    assert(
      Number.isSafeInteger(maxAgeMs) && maxAgeMs >= 0,
      'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
      'maxAgeMs must be a non-negative safe integer',
    );
    assert(
      receipt.finishedAtMs <= nowMs + 1_000
        && nowMs - receipt.finishedAtMs <= maxAgeMs,
      'SNAPBACK_COMPARATOR_RECEIPT_STALE',
      'comparator receipt is stale or dated in the future',
      { nowMs, finishedAtMs: receipt.finishedAtMs, maxAgeMs },
    );
  }
  if (expectedIdentity !== null) {
    assert(
      sameValue(receipt.identity, expectedIdentity),
      'SNAPBACK_COMPARATOR_IDENTITY_MISMATCH',
      'comparator receipt identity does not match the expected target/artifact/binary',
    );
  }
  return receipt;
}

export function writeComparatorReceipt(path, receipt) {
  validateComparatorReceipt(receipt);
  const resolved = resolve(path);
  mkdirSync(dirname(resolved), { recursive: true });
  const temporary = `${resolved}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`);
  renameSync(temporary, resolved);
  return resolved;
}

export function readComparatorReceipt(path, options = {}) {
  const resolved = resolve(path);
  assert(
    existsSync(resolved) && statSync(resolved).isFile(),
    'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
    `receipt file does not exist: ${resolved}`,
  );
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw comparatorError(
      'SNAPBACK_COMPARATOR_RECEIPT_INVALID',
      `receipt is not JSON: ${error.message}`,
      { path: resolved },
    );
  }
  return validateComparatorReceipt(parsed, options);
}

export const __comparatorTest = Object.freeze({
  concludeReceipt,
  expectedCheckDefinitions,
  sameValue,
});
