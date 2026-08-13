import { canonicalizeClientValueV1 } from './canonical-client-value.mjs';
import { compileResultContractValidator } from '@expo/snapback-contract/result-contract-validator';
import { validateScopeId } from '@expo/snapback-contract/auth-invalidation';
import {
  argsHash,
  queryArtifactHash,
  rowsMatchDigest,
  sha256 as sha256PureJs,
} from './rqs.mjs';
import { isConnectivityFailureError } from './outbox-shared.mjs';

// @ref LLP 0114#prepared-binding-and-provider-ownership — asynchronous
// deployment admission is completed before a synchronous React provider may
// be constructed.

const PREPARED_REACT_BINDING = Symbol('snapback.prepared-react-binding.v1');
const PREPARED_REACT_QUERY_GROUP = Symbol('snapback.prepared-react-query-group.v1');
const REACT_BINDING_MISMATCH_CONTEXT = Symbol('snapback.react-binding-mismatch-context.v1');
const preparedReactQueryGroupOwners = new WeakMap();
// Mounted-provider HMR generation handoff (development only). The frozen
// prepared binding stays the boot-time record; a successful handoff publishes
// a complete replacement admission view in a side table, and every admission
// read resolves through it. See handoffPreparedReactBindingGeneration below.
// @ref LLP 0114#mounted-provider-hmr-generation-handoff-dated-amendment-2026-08-05
const preparedReactBindingInternals = new WeakMap();
const preparedReactBindingGenerationOverlays = new WeakMap();
const preparedReactBindingGenerationHandoffs = new WeakMap();

function functionAdmissionForBinding(binding) {
  return preparedReactBindingGenerationOverlays.get(binding) ?? binding;
}
const REGISTERED_BUNDLE_CAPABILITY = 'registered_bundle_boot_v1';
const MIXED_BUNDLE_CAPABILITY = 'mixed_bundle_boot_v2';
const LOCAL_DEVELOPMENT_PROFILE = 'local-dev-sqlite-ibex';
const DEFAULT_DEVELOPMENT_SYNC_TIMEOUT_MS = 10_000;
const DEFAULT_DEVELOPMENT_SYNC_POLL_INTERVAL_MS = 250;
const MAX_DEVELOPMENT_SYNC_TIMEOUT_MS = 60_000;
const MAX_DEVELOPMENT_SYNC_POLL_INTERVAL_MS = 5_000;
const utf8 = new TextEncoder();

function diagnosticError(code, message, details = {}) {
  const diagnostic = Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code,
    severity: 'error',
    message,
    details: Object.freeze({ ...details }),
  });
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = diagnostic;
  return error;
}

// @ref LLP 0114#offline-binding-receipt-dated-amendment-2026-08-01 — receipt
// fallback gets the original transport-provenance failure first. Only after
// no receipt can admit the binding do we add application phase and origin
// context for the caller, without masking any server-answered refusal.
function bindingOriginUnreachableError(client, cause) {
  if (cause?.fetchDispatchFailed !== true || typeof client?.baseUrl !== 'string') {
    return cause;
  }
  const attemptedOrigin = client.baseUrl;
  const error = diagnosticError(
    'SNAPBACK_REACT_BINDING_ORIGIN_UNREACHABLE',
    `application binding preparation could not reach ${attemptedOrigin}`,
    {
      phase: 'application-binding-preparation',
      origin: attemptedOrigin,
      attemptedOrigin,
    },
  );
  Object.defineProperty(error, 'cause', { value: cause });
  return error;
}

// 0137 A1-Expo f1: React Native/Hermes ships no WebCrypto, and these binding
// digests were the first thing the documented Expo path hit ("Cannot read
// property 'subtle' of undefined" before any session existed). They are
// deterministic integrity metadata — not key custody — so when
// `crypto.subtle` is absent the parity-tested pure-JS SHA-256 from rqs.mjs
// (byte-compatible with src/rqs.rs) computes the same bytes and the packaged
// client boots with zero consumer polyfills.
async function sha256Hex(bytes) {
  const subtle = globalThis.crypto?.subtle;
  const digest = subtle?.digest
    ? new Uint8Array(await subtle.digest('SHA-256', bytes))
    : sha256PureJs(bytes);
  return `sha256:${[...digest]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

async function sha256Canonical(value) {
  return sha256Hex(utf8.encode(canonicalizeClientValueV1(value)));
}

// @ref LLP 0114#offline-binding-receipt-dated-amendment-2026-08-01 —
// Generated artifacts are validated deployment metadata, not user-authored
// query arguments. Keep the same getter-free canonical JSON implementation,
// but do not impose CanonicalClientValueV1's 4,096-node store-key budget on a
// complete function catalog. The separate artifact profile remains finite.
async function sha256GeneratedManifest(value) {
  return sha256Hex(utf8.encode(canonicalizeClientValueV1(value, {
    limits: {
      maxDepth: 64,
      maxNodes: 65_536,
      maxObjectFields: 1_024,
      maxArrayEntries: 4_096,
      maxStringUtf8Bytes: 4 * 1024 * 1024,
      maxKeyUtf8Bytes: 16 * 1024 * 1024,
    },
  })));
}

async function sha256Text(value) {
  return sha256Hex(utf8.encode(value));
}

async function resultContractHash(value) {
  const canonicalJson = (input) => JSON.stringify(input, (_key, child) => (
    child && typeof child === 'object' && !Array.isArray(child)
      ? Object.fromEntries(Object.keys(child).sort().map((key) => [key, child[key]]))
      : child
  ));
  return sha256Hex(utf8.encode(
    `snapback:function-result:v1\n${canonicalJson(value)}`,
  ));
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function mixedChildLiveness(nodePlan, reference, route) {
  const capability = nodePlan?.capability;
  const liveness = capability?.live;
  const livenessKeys = Object.keys(liveness ?? {}).sort();
  const none = liveness?.kind === 'none'
    && livenessKeys.length === 1
    && livenessKeys[0] === 'kind';
  const admitted = liveness?.kind === 'admitted'
    && liveness?.delivery === 'live_replace'
    && liveness?.pageDomain === 'whole-result'
    && livenessKeys.join(',') === 'delivery,kind,pageDomain';
  if (
    Object.keys(capability ?? {}).sort().join(',')
      !== 'exportKind,live,requiredCapabilityIds,retention'
    || capability.exportKind !== reference?.kind
    || (reference?.kind === 'Query' && !none)
    || (reference?.kind === 'LiveQuery' && !admitted)
  ) {
    throw diagnosticError(
      'SNAPBACK_REACT_MANIFEST_INVALID',
      'mixed query group lacks a consistent explicit child liveness binding',
      { route, function: reference?.name ?? null },
    );
  }
  return deepFreeze(structuredClone(liveness));
}

function publicReference(
  definition,
  fallbackAppId,
  fallbackSchemaVersion,
  expectedGeneration = null,
) {
  const reference = {
    artifactKind: 'functionReference',
    schemaVersion: definition?.schemaVersion ?? fallbackSchemaVersion,
    appId: definition?.appId ?? fallbackAppId,
    id: definition?.id,
    name: definition?.name ?? definition?.exportedName,
    kind: definition?.kind,
    ...(definition?.authRequirement === undefined ? {} : {
      authRequirement: definition.authRequirement,
    }),
    implementationHash: definition?.implementationHash,
    argsContractHash: definition?.argsContractHash,
    ...(definition?.argsContract === undefined ? {} : {
      argsContract: structuredClone(definition.argsContract),
    }),
    ...(definition?.argumentSchema === undefined ? {} : {
      argumentSchema: structuredClone(definition.argumentSchema),
    }),
    resultContractHash: definition?.resultContractHash,
    ...(definition?.authoredSourceHash === undefined ? {} : {
      authoredSourceHash: definition.authoredSourceHash,
    }),
    ...(expectedGeneration === null ? {} : { expectedGeneration }),
  };
  for (const field of Object.keys(reference).filter((field) => (
    field !== 'expectedGeneration'
    && field !== 'argsContract'
    && field !== 'argumentSchema'
  ))) {
    if (typeof reference[field] !== 'string' || reference[field].length === 0) {
      throw diagnosticError(
        'SNAPBACK_REACT_MANIFEST_INVALID',
        `generated function ${reference.name ?? '<unknown>'} is missing ${field}`,
        { field, function: reference.name ?? null },
      );
    }
  }
  return Object.freeze(reference);
}

function normalizedManifest(input) {
  // @ref LLP 0179#appbinding-seam — AppDescriptor is now the stable client
  // input. Preserve the older manifest carrier, but project descriptor
  // references into this owner's existing admission machinery rather than
  // asking the Expo package to recreate a React binding implementation.
  if (input?.format === 'snapback.app.v1') {
    // @ref LLP 0179#portable-descriptor-document-and-typed-binding — the
    // generated module may hydrate portable references with non-enumerable
    // runtime conveniences. Admission owns a frozen portable projection, so
    // manifest hashing and later descriptor checks never mistake those
    // conveniences for CanonicalClientValueV1 query arguments.
    const descriptor = deepFreeze(structuredClone(input));
    const identity = descriptor.identity;
    const api = descriptor.api;
    const definitions = [
      ...Object.values(api?.queries ?? {}),
      ...Object.values(api?.mutations ?? {}),
    ];
    if (
      !identity
      || typeof identity.app !== 'string'
      || typeof identity.schema !== 'string'
      || typeof identity.functions !== 'string'
      || typeof identity.descriptor !== 'string'
      || !api
      || !descriptor.commands
      || !descriptor.capabilities
      || !Array.isArray(descriptor.capabilities.required)
      || definitions.some((reference) => (
        !reference
        || reference.artifactKind !== 'functionReference'
        || reference.appId !== identity.app
        || !['Query', 'LiveQuery', 'Mutation'].includes(reference.kind)
        || reference.expectedGeneration?.appId !== identity.app
        || reference.expectedGeneration?.schemaHash !== identity.schema
        || reference.expectedGeneration?.bundleHash !== identity.functions
      ))
    ) {
      throw diagnosticError(
        'SNAPBACK_REACT_MANIFEST_INVALID',
        'prepareReactBinding requires a complete snapback.app.v1 descriptor',
      );
    }
    const names = new Set();
    const ids = new Set();
    for (const reference of definitions) {
      if (names.has(reference.name) || ids.has(reference.id)) {
        throw diagnosticError(
          'SNAPBACK_REACT_MANIFEST_INVALID',
          'AppDescriptor repeats a function name or id',
          { functionId: reference.id, function: reference.name },
        );
      }
      names.add(reference.name);
      ids.add(reference.id);
    }
    const first = definitions[0] ?? null;
    return Object.freeze({
      descriptorMode: true,
      descriptor,
      functions: Object.freeze({
        artifactKind: 'functionManifest',
        schemaVersion: first?.schemaVersion ?? null,
        appId: identity.app,
        bundleHash: identity.functions,
        inputsHash: first?.expectedGeneration?.inputsHash ?? null,
        functions: Object.freeze(definitions),
      }),
      schema: null,
      capabilityManifest: null,
      routes: null,
    });
  }
  const functions = input?.artifactKind === 'functionManifest'
    ? input
    : input?.functions;
  if (
    !functions
    || functions.artifactKind !== 'functionManifest'
    || typeof functions.appId !== 'string'
    || typeof functions.bundleHash !== 'string'
    || !Array.isArray(functions.functions)
  ) {
    throw diagnosticError(
      'SNAPBACK_REACT_MANIFEST_INVALID',
      'prepareReactBinding requires a complete generated function manifest',
    );
  }
  return Object.freeze({
    descriptorMode: false,
    descriptor: null,
    functions,
    schema: input?.artifactKind === 'functionManifest'
      ? null
      : input?.schema ?? null,
    capabilityManifest: input?.artifactKind === 'functionManifest'
      ? null
      : input?.capabilityManifest ?? null,
    routes: input?.artifactKind === 'functionManifest'
      ? null
      : input?.routes ?? null,
  });
}

function exactDeploymentFunction(definition) {
  return [
    definition.id,
    definition.kind,
    definition.implementationHash,
    definition.argsContractHash,
    definition.resultContractHash,
  ].join('\u0000');
}

function queryGroupEntryName(functionName, occurrences, usedNames) {
  let count = (occurrences.get(functionName) ?? 0) + 1;
  let candidate = count === 1 ? functionName : `${functionName}${count}`;
  while (usedNames.has(candidate)) {
    count += 1;
    candidate = `${functionName}${count}`;
  }
  occurrences.set(functionName, count);
  usedNames.add(candidate);
  return candidate;
}

function routeParams(route) {
  if (route === '/') return [];
  return route.slice(1).split('/')
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1));
}

function groupPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function materializeGroupArgs(mapping, params) {
  const materialize = (value) => {
    if (
      groupPlainObject(value)
      && Object.keys(value).length === 1
      && typeof value.$param === 'string'
    ) {
      return params[value.$param];
    }
    if (groupPlainObject(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([name, entry]) => [name, materialize(entry)]),
      );
    }
    // Array interiors are literal-only under params-v1.
    return structuredClone(value);
  };
  const output = materialize(mapping ?? {});
  return deepFreeze(output);
}

function groupResponseArgsMatch(mapping, params, actual) {
  const matches = (template, decoded) => {
    if (
      groupPlainObject(template)
      && Object.keys(template).length === 1
      && typeof template.$param === 'string'
    ) {
      const raw = params[template.$param];
      return typeof decoded === 'string' && decoded === raw;
    }
    if (groupPlainObject(template)) {
      if (!groupPlainObject(decoded)) return false;
      const expectedKeys = Object.keys(template).sort();
      const actualKeys = Object.keys(decoded).sort();
      return expectedKeys.length === actualKeys.length
        && expectedKeys.every((key, index) => (
          key === actualKeys[index] && matches(template[key], decoded[key])
        ));
    }
    // Array interiors are literal-only and compare as one canonical value.
    return canonicalizeClientValueV1(template) === canonicalizeClientValueV1(decoded);
  };
  return matches(mapping ?? {}, actual);
}

// --- Offline binding receipt (cold-boot preparation without a server) -------
//
// Online preparation proves generated === deployed against the live
// inspection. The receipt records THAT conclusion, digest-bound to the exact
// generated manifest it admitted, so a genuinely cold process with the
// backend unreachable can re-run the same admission against the persisted
// identity instead of the wire — the missing half of the LLP 0129 Phase 0
// offline cold boot (the tab-goes-offline shape already worked; the
// process-cold shape died in Promise.all([inspect, session]) with `fetch
// failed` before a provider existed). Adoption is fail-closed: only a
// transport-provenance connectivity failure falls back (a server-ANSWERED
// refusal stays loud), and only for a byte-identical generated manifest.
const BINDING_RECEIPT_FORMAT_VERSION = 1;

function persistedReceiptMismatch(message, generated, receipt, details = {}) {
  const error = diagnosticError(
    'SNAPBACK_REACT_BINDING_MISMATCH',
    message,
    {
      expectedAppId: generated.functions.appId,
      actualAppId: receipt?.appId ?? null,
      expectedBundleHash: generated.functions.bundleHash,
      actualBundleHash: receipt?.deployment?.bundleHash ?? null,
      ...details,
    },
  );
  Object.defineProperty(error, REACT_BINDING_MISMATCH_CONTEXT, {
    value: Object.freeze({
      source: 'persisted-receipt',
      localDevelopment: false,
    }),
  });
  return error;
}

function descriptorAdmissionFromReceipt(receipt, generated) {
  const admission = receipt.descriptorAdmission;
  if (
    !admission
    || typeof admission !== 'object'
    || admission.descriptorIdentity !== generated.descriptor.identity.descriptor
    || !Array.isArray(admission.functions)
    || !Array.isArray(admission.ephemeralCollections)
  ) {
    throw persistedReceiptMismatch(
      'persisted binding receipt does not carry the admitted AppDescriptor deployment view',
      generated,
      receipt,
      {
        expectedDescriptorIdentity: generated.descriptor.identity.descriptor,
        actualDescriptorIdentity: admission?.descriptorIdentity ?? null,
      },
    );
  }
  const functionsById = new Map();
  for (const fact of admission.functions) {
    if (
      !fact
      || typeof fact !== 'object'
      || typeof fact.id !== 'string'
      || typeof fact.queryArtifact !== 'string'
      || typeof fact.authorityIndependent !== 'boolean'
      || functionsById.has(fact.id)
    ) {
      throw persistedReceiptMismatch(
        'persisted binding receipt carries invalid AppDescriptor function admission facts',
        generated,
        receipt,
      );
    }
    functionsById.set(fact.id, Object.freeze({
      queryArtifact: fact.queryArtifact,
      authorityIndependent: fact.authorityIndependent,
    }));
  }
  const expectedFunctionIds = generated.functions.functions.map((definition) => definition.id);
  if (
    functionsById.size !== expectedFunctionIds.length
    || expectedFunctionIds.some((id) => !functionsById.has(id))
  ) {
    throw persistedReceiptMismatch(
      'persisted binding receipt carries a different AppDescriptor function generation',
      generated,
      receipt,
      {
        expectedFunctionIds: expectedFunctionIds.slice().sort(),
        actualFunctionIds: [...functionsById.keys()].sort(),
      },
    );
  }
  return Object.freeze({
    functionsById,
    ephemeralCollections: deepFreeze(structuredClone(admission.ephemeralCollections)),
  });
}

async function adoptPersistedBindingReceipt(client, generated, cause) {
  if (!isConnectivityFailureError(cause)) return null;
  const store = client.rqsStore;
  if (typeof store?.loadReactBindingReceipt !== 'function') return null;
  let receipt = null;
  try {
    receipt = await store.loadReactBindingReceipt();
  } catch {
    return null; // availability-only: fall through to the connectivity error
  }
  if (
    !receipt
    || typeof receipt !== 'object'
    || receipt.formatVersion !== BINDING_RECEIPT_FORMAT_VERSION
    || typeof receipt.generatedManifestDigest !== 'string'
    || !receipt.deployment
    || typeof receipt.deployment !== 'object'
  ) return null;
  if (receipt.appId !== generated.functions.appId) return null;
  if (receipt.generatedManifestDigest !== await sha256GeneratedManifest(generated)) {
    throw persistedReceiptMismatch(
      'generated artifacts do not match the persisted binding receipt',
      generated,
      receipt,
      generated.descriptorMode ? {
        expectedSchemaHash: generated.descriptor.identity.schema,
        actualSchemaHash: receipt.deployment.schemaHash ?? null,
        expectedDescriptorIdentity: generated.descriptor.identity.descriptor,
        actualDescriptorIdentity: receipt.descriptorAdmission?.descriptorIdentity ?? null,
      } : {},
    );
  }
  const descriptorAdmission = generated.descriptorMode
    ? descriptorAdmissionFromReceipt(receipt, generated)
    : null;
  // The digest equality above proves the presented generated manifest is
  // byte-identical to the one online admission proved. In legacy manifest
  // mode the deployed view IS that generated manifest. Descriptor mode keeps
  // its portable document environment-independent, so the same receipt also
  // carries the compact server-only facts from the admitted deployment view;
  // every per-item admission check below still re-runs in this owner.
  // @ref LLP 0179#appbinding-seam — descriptor cold boot reaches LLP 0114's
  // existing receipt/admission owner; it does not create a surface cache or
  // a second binding format.
  const inspection = {
    targetProfileId: receipt.deployment.targetProfileId,
    target: receipt.deployment.target,
    functions: generated.functions,
    schema: descriptorAdmission !== null
      ? {
        schemaHash: receipt.deployment.schemaHash,
        ephemeralCollections: descriptorAdmission.ephemeralCollections,
      }
      : generated.schema === null
      ? (receipt.deployment.schemaHash == null
        ? null
        : { schemaHash: receipt.deployment.schemaHash })
      : {
        schemaHash: receipt.deployment.schemaHash,
        ephemeralCollections: generated.schema.ephemeralCollections,
      },
    routeManifestHash: receipt.routeManifestHash,
    capabilityManifest: null,
  };
  return {
    inspection,
    session: receipt.authMode == null ? null : { activeMode: receipt.authMode },
    receiptFacts: {
      deployment: receipt.deployment,
      capabilityDigest: receipt.capabilityDigest ?? null,
      registeredBundleAvailable: receipt.registeredBundleAvailable === true,
      mixedBundleAvailable: receipt.mixedBundleAvailable === true,
      descriptorFunctionFacts: descriptorAdmission?.functionsById ?? null,
    },
  };
}

function warnBindingReceiptNotPersisted(details) {
  try {
    globalThis.console?.warn?.(
      'SNAPBACK_REACT_BINDING_RECEIPT_NOT_PERSISTED: react binding receipt was not persisted; the next offline cold boot cannot adopt it',
      details,
    );
  } catch {
    // A missing or throwing console must not fail availability-only preparation.
  }
}

function persistBindingReceipt(client, receipt) {
  const store = client.rqsStore;
  if (typeof store?.commitReactBindingReceipt !== 'function') return;
  // Availability-only: a store that cannot persist the receipt never fails
  // or blocks online preparation, but a terminal refusal is observable.
  let commit;
  try {
    commit = store.commitReactBindingReceipt(receipt);
  } catch (error) {
    warnBindingReceiptNotPersisted({ error });
    return;
  }
  void Promise.resolve(commit)
    .then((result) => {
      if (result === false) warnBindingReceiptNotPersisted({ result });
    })
    .catch((error) => {
      warnBindingReceiptNotPersisted({ error });
    });
}

function boundedMilliseconds(value, fallback, field, maximum) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${field} must be an integer from 0 through ${maximum}`);
  }
  return value;
}

function normalizedDevelopmentSyncOptions(value) {
  if (value === false) return null;
  if (value !== undefined && (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
  )) {
    throw new TypeError('developmentSync must be false or an options object');
  }
  const onStateChange = value?.onStateChange;
  if (onStateChange !== undefined && typeof onStateChange !== 'function') {
    throw new TypeError('developmentSync.onStateChange must be a function');
  }
  return Object.freeze({
    timeoutMs: boundedMilliseconds(
      value?.timeoutMs,
      DEFAULT_DEVELOPMENT_SYNC_TIMEOUT_MS,
      'developmentSync.timeoutMs',
      MAX_DEVELOPMENT_SYNC_TIMEOUT_MS,
    ),
    pollIntervalMs: boundedMilliseconds(
      value?.pollIntervalMs,
      DEFAULT_DEVELOPMENT_SYNC_POLL_INTERVAL_MS,
      'developmentSync.pollIntervalMs',
      MAX_DEVELOPMENT_SYNC_POLL_INTERVAL_MS,
    ),
    onStateChange: onStateChange ?? null,
  });
}

function publishDevelopmentSyncState(options, state) {
  try {
    options.onStateChange?.(Object.freeze(state));
  } catch {
    // Observational UI state cannot own admission or retry lifecycle.
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const DEVELOPMENT_SYNC_DEADLINE = Symbol('snapback.development-sync-deadline');

async function beforeDevelopmentSyncDeadline(promise, milliseconds) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(DEVELOPMENT_SYNC_DEADLINE), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function developmentSyncTimeoutError(lastError, { timeoutMs, attempts }) {
  const actions = Object.freeze([
    'Wait for Snapback code generation and the local backend reload to finish.',
    'Restart the local Snapback backend if it does not load the generated artifacts.',
    'Reload the app after the backend reports ready.',
  ]);
  const diagnostic = Object.freeze({
    ...(lastError?.diagnostic ?? {}),
    code: 'SNAPBACK_REACT_BINDING_MISMATCH',
    message: lastError?.diagnostic?.message
      ?? 'generated manifest does not match the connected deployment',
    details: Object.freeze({
      ...(lastError?.diagnostic?.details ?? {}),
      developmentSynchronization: Object.freeze({
        status: 'timed-out',
        timeoutMs,
        attempts,
        actions,
      }),
    }),
  });
  const error = new Error(
    'Client and local backend are still out of sync. Restart the local backend, then reload the app.',
  );
  error.code = diagnostic.code;
  error.diagnostic = diagnostic;
  return Object.freeze({ error, diagnostic, actions });
}

async function prepareReactBindingOnce(
  client,
  options = {},
  { allowPersistedReceipt = true } = {},
) {
  if (!client || typeof client.inspect !== 'function' || typeof client.liveQuery !== 'function') {
    throw new TypeError('prepareReactBinding requires a SnapbackClient');
  }
  const generated = normalizedManifest(options.generatedManifest);
  let inspection;
  let session;
  let source = 'deployment';
  let receiptFacts = null;
  try {
    [inspection, session] = await Promise.all([
      client.inspect(),
      typeof client.authSession === 'function'
        ? client.authSession()
        : Promise.resolve(null),
    ]);
  } catch (error) {
    if (!allowPersistedReceipt) throw error;
    const adopted = await adoptPersistedBindingReceipt(client, generated, error);
    if (!adopted) throw error;
    ({ inspection, session, receiptFacts } = adopted);
    source = 'persisted-receipt';
  }
  const deployed = inspection?.functions;
  const bindingMismatch = (message, details = {}) => {
    const targetProfileId = inspection?.targetProfileId ?? null;
    const authMode = session?.activeMode ?? null;
    const error = diagnosticError(
      'SNAPBACK_REACT_BINDING_MISMATCH',
      message,
      { ...details, targetProfileId, authMode },
    );
    Object.defineProperty(error, REACT_BINDING_MISMATCH_CONTEXT, {
      value: Object.freeze({
        source,
        localDevelopment: source === 'deployment'
          && targetProfileId === LOCAL_DEVELOPMENT_PROFILE
          && authMode === 'dev',
      }),
    });
    return error;
  };
  if (
    deployed?.appId !== generated.functions.appId
    || deployed?.bundleHash !== generated.functions.bundleHash
  ) {
    throw bindingMismatch(
      'generated manifest does not match the connected deployment',
      {
        expectedAppId: generated.functions.appId,
        actualAppId: deployed?.appId ?? null,
        expectedBundleHash: generated.functions.bundleHash,
        actualBundleHash: deployed?.bundleHash ?? null,
      },
    );
  }
  if (
    generated.descriptorMode
    && inspection.schema?.schemaHash !== generated.descriptor.identity.schema
  ) {
    throw bindingMismatch(
      'AppDescriptor schema identity does not match the connected deployment',
      {
        expectedSchemaHash: generated.descriptor.identity.schema,
        actualSchemaHash: inspection.schema?.schemaHash ?? null,
      },
    );
  }
  const deployedFunctions = new Map(
    (deployed.functions ?? []).map((definition) => [definition.id, definition]),
  );
  const references = Object.create(null);
  const referencesById = new Map();
  const resultContractsById = new Map();
  const queryArtifactsById = new Map();
  const authorityIndependentById = new Map();
  // Generated references (function, query-group, and ephemeral collection)
  // belong to the public generated-artifact grammar (`snapback.v0` today),
  // while the admitted manifests may use the sessions carrier grammar
  // (`snapback.v1`). The capability manifest carries the former and keeps
  // every prepared reference byte-identical to api.mjs — admission compares
  // references canonically and fail-closed, so a carrier-grammar stamp here
  // would reject every generated `api.ephemeral.*` reference (0137 A2 f2).
  const referenceSchemaVersion = generated.capabilityManifest?.schemaVersion
    ?? generated.functions.schemaVersion
    ?? deployed.schemaVersion;
  const expectedGeneration = generated.schema?.schemaHash
    && generated.functions.inputsHash
    ? Object.freeze({
        schemaVersion: generated.functions.schemaVersion,
        appId: generated.functions.appId,
        schemaHash: generated.schema.schemaHash,
        bundleHash: generated.functions.bundleHash,
        inputsHash: generated.functions.inputsHash,
      })
    : null;
  for (const definition of generated.functions.functions) {
    const reference = publicReference(
      definition,
      generated.functions.appId,
      referenceSchemaVersion,
      generated.descriptorMode
        ? definition.expectedGeneration ?? null
        : expectedGeneration,
    );
    const actual = deployedFunctions.get(reference.id);
    if (
      !actual
      || exactDeploymentFunction(actual) !== exactDeploymentFunction(reference)
      || (reference.authRequirement !== undefined
        && actual.authRequirement !== reference.authRequirement)
      || (!generated.descriptorMode
        && (actual.authorityIndependent === true)
          !== (definition.authorityIndependent === true))
    ) {
      throw bindingMismatch(
        `generated reference ${reference.name} does not match the connected deployment`,
        { functionId: reference.id },
      );
    }
    if (Object.prototype.hasOwnProperty.call(references, reference.name)) {
      throw diagnosticError(
        'SNAPBACK_REACT_MANIFEST_INVALID',
        `generated manifest repeats function name ${reference.name}`,
      );
    }
    references[reference.name] = reference;
    referencesById.set(reference.id, reference);
    const descriptorReceiptFact = receiptFacts?.descriptorFunctionFacts?.get(reference.id)
      ?? null;
    queryArtifactsById.set(
      reference.id,
      descriptorReceiptFact?.queryArtifact
        ?? queryArtifactHash(generated.descriptorMode ? actual : definition),
    );
    authorityIndependentById.set(
      reference.id,
      descriptorReceiptFact?.authorityIndependent
        ?? (generated.descriptorMode ? actual : definition).authorityIndependent === true,
    );
    const descriptor = deepFreeze(
      structuredClone(definition.resultContract ?? { kind: 'unknown' }),
    );
    let validator;
    try {
      validator = compileResultContractValidator(descriptor);
    } catch (error) {
      throw diagnosticError(
        'SNAPBACK_REACT_OPTIMISTIC_INSTALL_FAILED',
        `generated result contract for ${reference.name} is not admissible`,
        { functionId: reference.id, cause: error?.code ?? String(error) },
      );
    }
    if (
      canonicalizeClientValueV1(actual.resultContract ?? { kind: 'unknown' })
        !== canonicalizeClientValueV1(descriptor)
      || await resultContractHash(descriptor) !== reference.resultContractHash
    ) {
      throw bindingMismatch(
        `generated result contract for ${reference.name} does not match its deployment and hash`,
        { functionId: reference.id },
      );
    }
    resultContractsById.set(reference.id, Object.freeze({
      hash: reference.resultContractHash,
      descriptor,
      validator,
    }));
  }
  const ephemeralReferences = Object.create(null);
  const ephemeralDefinitionsById = new Map();
  if (generated.descriptorMode) {
    const deployedCollections = new Map(
      (inspection.schema?.ephemeralCollections ?? []).map((definition) => [
        definition.name,
        definition,
      ]),
    );
    for (const [name, carried] of Object.entries(generated.descriptor.api.ephemeral ?? {})) {
      const deployedDefinition = deployedCollections.get(name);
      // Pre-D3 descriptors did not carry the authored withdrawal deadline.
      // Preserve one-release binding compatibility while ensuring the public
      // reference always has the same bounded default codegen now emits.
      const carriedWithdrawalVisibilityDeadlineMs = carried
        ? carried.withdrawalVisibilityDeadlineMs
          ?? Math.min(Math.floor(carried.defaultTtlMs / 2), 10_000)
        : null;
      const deployedWithdrawalVisibilityDeadlineMs = deployedDefinition
        ? deployedDefinition.withdrawalVisibilityDeadlineMs
          ?? Math.min(Math.floor(deployedDefinition.defaultTtlMs / 2), 10_000)
        : null;
      const expectedSubset = carried && typeof carried === 'object'
        ? {
            name: carried.name,
            scopeFields: carried.scopeFields,
            scopeContract: carried.scopeContract,
            valueContract: carried.valueContract,
            keyMode: carried.keyMode,
            routingFields: carried.routingFields,
            defaultTtlMs: carried.defaultTtlMs,
            maxTtlMs: carried.maxTtlMs,
            withdrawalVisibilityDeadlineMs: carriedWithdrawalVisibilityDeadlineMs,
            maxValueBytes: carried.maxValueBytes,
            sustainedHz: carried.publishRate?.sustainedHz,
            burst: carried.publishRate?.burst,
          }
        : null;
      const deployedSubset = deployedDefinition
        ? {
            ...Object.fromEntries(Object.keys(expectedSubset ?? {}).map((key) => [
              key,
              deployedDefinition[key],
            ])),
            withdrawalVisibilityDeadlineMs: deployedWithdrawalVisibilityDeadlineMs,
          }
        : null;
      if (
        !carried
        || carried.artifactKind !== 'ephemeralCollectionReference'
        || carried.appId !== generated.functions.appId
        || carried.name !== name
        || !deployedDefinition
        || canonicalizeClientValueV1(deployedSubset)
          !== canonicalizeClientValueV1(expectedSubset)
      ) {
        throw bindingMismatch(
          `AppDescriptor ephemeral collection ${name} does not match the connected deployment`,
          { collection: name },
        );
      }
      const reference = deepFreeze({
        ...structuredClone(carried),
        withdrawalVisibilityDeadlineMs: carriedWithdrawalVisibilityDeadlineMs,
      });
      let scopeValidator;
      let valueValidator;
      try {
        scopeValidator = compileResultContractValidator({
          kind: 'value',
          value: reference.scopeContract,
        });
        valueValidator = compileResultContractValidator({
          kind: 'value',
          value: reference.valueContract,
        });
      } catch (error) {
        throw diagnosticError(
          'SNAPBACK_REACT_MANIFEST_INVALID',
          `AppDescriptor ephemeral collection ${name} has an invalid scope or value contract`,
          { collection: name, cause: error?.code ?? String(error) },
        );
      }
      ephemeralReferences[name] = reference;
      ephemeralDefinitionsById.set(reference.id, Object.freeze({
        reference,
        definition: deepFreeze(structuredClone(deployedDefinition)),
        staticPolicyDigest: await sha256Canonical(deployedDefinition),
        scopeValidator,
        valueValidator,
      }));
    }
    if (deployedCollections.size !== Object.keys(ephemeralReferences).length) {
      throw bindingMismatch(
        'AppDescriptor ephemeral collection set does not match the connected deployment',
        {
          expectedCollections: Object.keys(ephemeralReferences).sort(),
          actualCollections: [...deployedCollections.keys()].sort(),
        },
      );
    }
  } else if (generated.schema !== null) {
    if (
      generated.schema?.artifactKind !== 'schemaManifest'
      || generated.schema.appId !== generated.functions.appId
      || generated.schema.schemaHash !== inspection.schema?.schemaHash
      || !Array.isArray(generated.schema.ephemeralCollections)
    ) {
      throw bindingMismatch(
        'generated schema manifest does not match the connected deployment',
        {
          expectedSchemaHash: generated.schema?.schemaHash ?? null,
          actualSchemaHash: inspection.schema?.schemaHash ?? null,
        },
      );
    }
    const deployedCollections = new Map(
      (inspection.schema?.ephemeralCollections ?? []).map((definition) => [
        definition.name,
        definition,
      ]),
    );
    for (const definition of generated.schema.ephemeralCollections) {
      const deployedDefinition = deployedCollections.get(definition.name);
      if (
        !deployedDefinition
        || canonicalizeClientValueV1(deployedDefinition)
          !== canonicalizeClientValueV1(definition)
      ) {
        throw bindingMismatch(
          `generated ephemeral collection ${definition.name} does not match the connected deployment`,
          { collection: definition.name },
        );
      }
      const reference = Object.freeze({
        artifactKind: 'ephemeralCollectionReference',
        // Reference grammar, not the schema manifest's carrier grammar — see
        // referenceSchemaVersion above: api.ephemeral.* must admit unchanged.
        schemaVersion: referenceSchemaVersion,
        appId: generated.schema.appId,
        id: `${generated.schema.appId}:ephemeral:${definition.name}`,
        name: definition.name,
        keyMode: definition.keyMode,
        scopeFields: Object.freeze([...definition.scopeFields]),
        scopeContract: deepFreeze(structuredClone(definition.scopeContract)),
        valueContract: deepFreeze(structuredClone(definition.valueContract)),
        routingFields: Object.freeze([...definition.routingFields]),
        defaultTtlMs: definition.defaultTtlMs,
        maxTtlMs: definition.maxTtlMs,
        withdrawalVisibilityDeadlineMs: definition.withdrawalVisibilityDeadlineMs
          ?? Math.min(Math.floor(definition.defaultTtlMs / 2), 10_000),
        maxValueBytes: definition.maxValueBytes,
        publishRate: Object.freeze({
          sustainedHz: definition.sustainedHz,
          burst: definition.burst,
        }),
        deliveryMode: 'latest',
      });
      let scopeValidator;
      let valueValidator;
      try {
        scopeValidator = compileResultContractValidator({
          kind: 'value',
          value: definition.scopeContract,
        });
        valueValidator = compileResultContractValidator({
          kind: 'value',
          value: definition.valueContract,
        });
      } catch (error) {
        throw diagnosticError(
          'SNAPBACK_REACT_MANIFEST_INVALID',
          `generated ephemeral collection ${definition.name} has an invalid scope or value contract`,
          { collection: definition.name, cause: error?.code ?? String(error) },
        );
      }
      ephemeralReferences[definition.name] = reference;
      ephemeralDefinitionsById.set(reference.id, Object.freeze({
        reference,
        definition: deepFreeze(structuredClone(definition)),
        staticPolicyDigest: await sha256Canonical(definition),
        scopeValidator,
        valueValidator,
      }));
    }
  }
  const queryGroups = Object.create(null);
  const queryGroupsById = new Map();
  let routeManifestHash = generated.descriptorMode
    ? `descriptor:${generated.descriptor.identity.descriptor}`
    : 'absent';
  if (generated.descriptorMode) {
    for (const [route, carried] of Object.entries(
      generated.descriptor.api.queryGroups ?? {},
    )) {
      if (
        !carried
        || carried.artifactKind !== 'queryGroupReference'
        || carried.appId !== generated.functions.appId
        || carried.route !== route
        || ![1, 2].includes(carried.formatVersion)
        || !Array.isArray(carried.queries)
        || carried.queries.length < 1
        || carried.queries.length > 32
      ) {
        throw diagnosticError(
          'SNAPBACK_REACT_MANIFEST_INVALID',
          'AppDescriptor contains an invalid query-group reference',
          { route },
        );
      }
      for (const query of carried.queries) {
        const admitted = referencesById.get(query?.ref?.id);
        if (
          !admitted
          || exactDeploymentFunction(admitted) !== exactDeploymentFunction(query.ref)
          || (carried.formatVersion === 1 && admitted.kind !== 'LiveQuery')
          || (carried.formatVersion === 2
            && !['Query', 'LiveQuery'].includes(admitted.kind))
        ) {
          throw diagnosticError(
            'SNAPBACK_REACT_MANIFEST_INVALID',
            'AppDescriptor query group contains an unadmitted child reference',
            { route, functionId: query?.ref?.id ?? null },
          );
        }
      }
      const reference = deepFreeze(structuredClone(carried));
      queryGroups[route] = reference;
      queryGroupsById.set(reference.id, reference);
    }
  } else if (generated.routes !== null) {
    if (
      generated.routes?.formatVersion !== 1
      || generated.routes.app !== generated.functions.appId
      || !Array.isArray(generated.routes.routes)
    ) {
      throw diagnosticError(
        'SNAPBACK_REACT_MANIFEST_INVALID',
        'generated routes manifest does not match the prepared app',
      );
    }
    routeManifestHash = await sha256Canonical(generated.routes);
    if (inspection.routeManifestHash !== routeManifestHash) {
      throw bindingMismatch(
        'generated routes manifest does not match the served route identity',
        {
          expectedRouteManifestHash: routeManifestHash,
          actualRouteManifestHash: inspection.routeManifestHash ?? null,
        },
      );
    }
    for (const routeEntry of generated.routes.routes) {
      if (
        typeof routeEntry?.route !== 'string'
        || !Array.isArray(routeEntry.queries)
        || routeEntry.queries.length < 1
        || routeEntry.queries.length > 32
      ) {
        throw diagnosticError(
          'SNAPBACK_REACT_MANIFEST_INVALID',
          'generated routes manifest contains an invalid query group',
          { route: routeEntry?.route ?? null },
        );
      }
      const mixed = routeEntry.mixedGroupEligible === true;
      if (routeEntry.registerGroupEligible !== true && !mixed) continue;
      const occurrences = new Map();
      const usedNames = new Set();
      const queries = [];
      for (const query of routeEntry.queries) {
        const reference = references[query?.function];
        if (
          !reference
          || (mixed
            ? reference.kind !== 'LiveQuery' && reference.kind !== 'Query'
            : reference.kind !== 'LiveQuery')
        ) {
          throw diagnosticError(
            'SNAPBACK_REACT_MANIFEST_INVALID',
            'generated query group names a function outside its admitted export kinds',
            { route: routeEntry.route, function: query?.function ?? null },
          );
        }
        queries.push(Object.freeze({
          name: queryGroupEntryName(reference.name, occurrences, usedNames),
          ref: reference,
          args: deepFreeze(structuredClone(query.args ?? {})),
          ...(mixed ? {
            nodePlan: deepFreeze(structuredClone(
              routeEntry.mixedProfile?.normalizedCompositePlan?.nodes?.[queries.length]?.nodePlan,
            )),
            nodePlanHash: routeEntry.mixedProfile
              ?.normalizedCompositePlan?.nodes?.[queries.length]?.nodePlanHash,
            liveness: mixedChildLiveness(
              routeEntry.mixedProfile?.normalizedCompositePlan?.nodes?.[queries.length]?.nodePlan,
              reference,
              routeEntry.route,
            ),
          } : {}),
        }));
      }
      const definition = {
        route: routeEntry.route,
        queries: routeEntry.queries,
        ...(routeEntry.persist === false ? { persist: false } : {}),
      };
      const mixedDefinition = mixed
        ? { ...definition, planHash: routeEntry.mixedProfile?.planHash }
        : definition;
      const reference = Object.freeze({
        artifactKind: 'queryGroupReference',
        formatVersion: mixed ? 2 : 1,
        schemaVersion: referenceSchemaVersion,
        appId: generated.functions.appId,
        id: mixed
          ? `${generated.functions.appId}:query-group-v2:${routeEntry.route}`
          : `${generated.functions.appId}:query-group:${routeEntry.route}`,
        route: routeEntry.route,
        definitionHash: await sha256Text(
          `snapback:query-group-reference:v${mixed ? 2 : 1}\n${canonicalizeClientValueV1(mixedDefinition)}`,
        ),
        queries: Object.freeze(queries),
        ...(mixed ? {
          profile: 'mixed-route.v2',
          planHash: routeEntry.mixedProfile?.planHash,
        } : {}),
        ...(routeEntry.persist === false ? { persist: false } : {}),
      });
      queryGroups[routeEntry.route] = reference;
      queryGroupsById.set(reference.id, reference);
    }
  }
  const assetIntents = Object.create(null);
  const assetIntentsById = new Map();
  if (generated.descriptorMode) {
    for (const [name, carried] of Object.entries(generated.descriptor.api.assets ?? {})) {
      if (
        !carried
        || carried.artifactKind !== 'assetUploadReference'
        || carried.appId !== generated.functions.appId
        || carried.name !== name
        || typeof carried.id !== 'string'
      ) {
        throw diagnosticError('SNAPBACK_REACT_MANIFEST_INVALID', 'AppDescriptor contains an invalid asset intent', { asset: name });
      }
      const reference = deepFreeze(structuredClone(carried));
      assetIntents[name] = reference;
      assetIntentsById.set(reference.id, reference);
    }
  }
  const commands = Object.create(null);
  const commandsByCanonical = new Map();
  if (generated.descriptorMode) {
    for (const [name, carried] of Object.entries(generated.descriptor.commands ?? {})) {
      const mutation = referencesById.get(carried?.mutation?.id);
      const intent = carried?.asset === null
        ? null
        : assetIntentsById.get(carried?.asset?.intent?.id);
      if (
        !carried
        || carried.kind !== 'asset-bearing-command.v1'
        || !mutation
        || mutation.kind !== 'Mutation'
        || !Array.isArray(carried.passthroughArgs)
        || !(carried.asset === null || intent)
      ) {
        throw diagnosticError(
          'SNAPBACK_REACT_MANIFEST_INVALID',
          'AppDescriptor contains an invalid asset-bearing command',
          { command: name },
        );
      }
      const command = structuredClone(carried);
      command.mutation = mutation;
      if (command.asset) command.asset.intent = intent;
      const admitted = deepFreeze(command);
      const key = canonicalizeClientValueV1(admitted);
      commands[name] = admitted;
      commandsByCanonical.set(key, admitted);
    }
  }
  const surfaces = Object.create(null);
  const surfacesById = new Map();
  if (generated.descriptorMode) {
    for (const [name, carried] of Object.entries(generated.descriptor.surfaces ?? {})) {
      if (
        !carried
        || carried.artifactKind !== 'surfaceDescriptor'
        || carried.appId !== generated.functions.appId
        || carried.name !== name
        || typeof carried.id !== 'string'
        || !carried.params
        || !carried.reads
        || !carried.mutations
        || !carried.presence
        || !carried.commands
      ) {
        throw diagnosticError(
          'SNAPBACK_REACT_MANIFEST_INVALID',
          'AppDescriptor contains an invalid generated surface',
          { surface: name },
        );
      }
      const surface = structuredClone(carried);
      for (const [namespace, members] of [
        ['reads', surface.reads],
        ['mutations', surface.mutations],
      ]) {
        for (const [memberName, member] of Object.entries(members)) {
          const admitted = referencesById.get(member?.reference?.id);
          const expectedKind = namespace === 'reads' ? ['Query', 'LiveQuery'] : ['Mutation'];
          if (
            member?.artifactKind !== 'surfaceMemberBinding'
            || !admitted
            || !expectedKind.includes(admitted.kind)
            || exactDeploymentFunction(admitted) !== exactDeploymentFunction(member.reference)
          ) {
            throw diagnosticError(
              'SNAPBACK_REACT_MANIFEST_INVALID',
              'generated surface contains an unadmitted function child',
              { surface: name, member: memberName },
            );
          }
          member.reference = admitted;
        }
      }
      for (const [memberName, member] of Object.entries(surface.presence)) {
        const admitted = ephemeralDefinitionsById.get(member?.reference?.id)?.reference;
        const memberReference = member?.reference
          ? {
              ...member.reference,
              withdrawalVisibilityDeadlineMs:
                member.reference.withdrawalVisibilityDeadlineMs
                ?? Math.min(Math.floor(member.reference.defaultTtlMs / 2), 10_000),
            }
          : null;
        if (
          member?.artifactKind !== 'surfaceMemberBinding'
          || !admitted
          || canonicalizeClientValueV1(admitted) !== canonicalizeClientValueV1(memberReference)
        ) {
          throw diagnosticError(
            'SNAPBACK_REACT_MANIFEST_INVALID',
            'generated surface contains an unadmitted presence child',
            { surface: name, member: memberName },
          );
        }
        member.reference = admitted;
      }
      for (const [memberName, member] of Object.entries(surface.assets ?? {})) {
        const admitted = assetIntentsById.get(member?.reference?.id);
        if (
          member?.artifactKind !== 'surfaceMemberBinding'
          || !admitted
          || canonicalizeClientValueV1(admitted) !== canonicalizeClientValueV1(member.reference)
        ) {
          throw diagnosticError(
            'SNAPBACK_REACT_MANIFEST_INVALID',
            'generated surface contains an unadmitted asset child',
            { surface: name, member: memberName },
          );
        }
        member.reference = admitted;
      }
      for (const [memberName, member] of Object.entries(surface.commands ?? {})) {
        const candidate = structuredClone(member?.reference);
        if (candidate?.mutation?.id) {
          candidate.mutation = referencesById.get(candidate.mutation.id) ?? candidate.mutation;
        }
        if (candidate?.asset?.intent?.id) {
          candidate.asset.intent = assetIntentsById.get(candidate.asset.intent.id)
            ?? candidate.asset.intent;
        }
        const admitted = commandsByCanonical.get(canonicalizeClientValueV1(candidate));
        if (member?.artifactKind !== 'surfaceMemberBinding' || !admitted) {
          throw diagnosticError(
            'SNAPBACK_REACT_MANIFEST_INVALID',
            'generated surface contains an unadmitted command child',
            { surface: name, member: memberName },
          );
        }
        member.reference = admitted;
      }
      const admittedSurface = deepFreeze(surface);
      if (surfacesById.has(admittedSurface.id)) {
        throw diagnosticError('SNAPBACK_REACT_MANIFEST_INVALID', 'AppDescriptor repeats a surface id', { surface: name });
      }
      surfaces[name] = admittedSurface;
      surfacesById.set(admittedSurface.id, admittedSurface);
    }
  }
  Object.freeze(references);
  Object.freeze(ephemeralReferences);
  Object.freeze(queryGroups);
  Object.freeze(assetIntents);
  Object.freeze(commands);
  Object.freeze(surfaces);
  const functionCatalogDigest = await sha256Canonical(Object.values(references));
  // On the receipt path the live capability manifest is not available; the
  // receipt carries the digest and availability fact the online admission
  // computed from it.
  const capabilityDigest = receiptFacts
    ? receiptFacts.capabilityDigest
    : await sha256Canonical(inspection.capabilityManifest);
  const registeredBundleAvailable = receiptFacts
    ? receiptFacts.registeredBundleAvailable
    : Array.isArray(
      inspection.capabilityManifest?.supportedCapabilities,
    ) && inspection.capabilityManifest.supportedCapabilities.includes(
      REGISTERED_BUNDLE_CAPABILITY,
    );
  const mixedBundleAvailable = receiptFacts
    ? receiptFacts.mixedBundleAvailable
    : Array.isArray(
      inspection.capabilityManifest?.supportedCapabilities,
    ) && inspection.capabilityManifest.supportedCapabilities.includes(
      MIXED_BUNDLE_CAPABILITY,
    );
  if (generated.capabilityManifest) {
    const declaredProfile = generated.capabilityManifest.targetProfileId;
    if (declaredProfile && declaredProfile !== inspection.targetProfileId) {
      throw bindingMismatch(
        'generated capability profile does not match the connected deployment',
        { expectedProfile: declaredProfile, actualProfile: inspection.targetProfileId ?? null },
      );
    }
  }
  // The receipt persists the online deployment identity verbatim (the
  // generated manifest may not carry inputsHash, which only the live
  // inspection knows).
  const deploymentIdentity = Object.freeze(receiptFacts
    ? { ...receiptFacts.deployment }
    : {
      targetProfileId: inspection.targetProfileId,
      target: inspection.target,
      schemaHash: inspection.schema?.schemaHash ?? null,
      bundleHash: deployed.bundleHash,
      inputsHash: deployed.inputsHash ?? null,
    });
  if (source === 'deployment') {
    persistBindingReceipt(client, {
      formatVersion: BINDING_RECEIPT_FORMAT_VERSION,
      appId: generated.functions.appId,
      generatedManifestDigest: await sha256GeneratedManifest(generated),
      deployment: { ...deploymentIdentity },
      routeManifestHash,
      authMode: session?.activeMode ?? null,
      registeredBundleAvailable,
      mixedBundleAvailable,
      capabilityDigest,
      ...(generated.descriptorMode ? {
        // AppDescriptor deliberately omits the server function interiors.
        // Persist only the admitted facts this binding owner needs to
        // reconstruct its existing RQS/presence admission on a cold boot;
        // the byte-identical descriptor is supplied again by the app.
        descriptorAdmission: {
          descriptorIdentity: generated.descriptor.identity.descriptor,
          functions: generated.functions.functions.map((definition) => {
            const actual = deployedFunctions.get(definition.id);
            return {
              id: definition.id,
              queryArtifact: queryArtifactHash(actual),
              authorityIndependent: actual.authorityIndependent === true,
            };
          }),
          ephemeralCollections: structuredClone(
            inspection.schema?.ephemeralCollections ?? [],
          ),
        },
      } : {}),
      savedAt: Date.now(),
    });
  }
  const binding = {
    appId: generated.functions.appId,
    profile: inspection.targetProfileId,
    deploymentIdentity,
    // Preparation provenance (refuse-with-clarity): 'deployment' when the
    // live inspection admitted the manifest; 'persisted-receipt' when a
    // connectivity failure fell back to the digest-bound offline receipt.
    source,
    authMode: session?.activeMode ?? null,
    routeManifestHash,
    registeredBundleAvailable,
    mixedBundleAvailable,
    functionCatalogDigest,
    capabilityDigest,
    references,
    ephemeral: ephemeralReferences,
    groups: queryGroups,
    assetIntents,
    commands,
    surfaces,
    prepareQueryGroup(reference, params, groupOptions) {
      return prepareReactQueryGroupForBinding(binding, reference, params, groupOptions);
    },
  };
  Object.defineProperties(binding, {
    [PREPARED_REACT_BINDING]: { value: true },
    client: { value: client },
    referencesById: { value: referencesById },
    resultContractsById: { value: resultContractsById },
    queryArtifactsById: { value: queryArtifactsById },
    authorityIndependentById: { value: authorityIndependentById },
    ephemeralDefinitionsById: { value: ephemeralDefinitionsById },
    queryGroupsById: { value: queryGroupsById },
    surfacesById: { value: surfacesById },
    assetIntentsById: { value: assetIntentsById },
    commandsByCanonical: { value: commandsByCanonical },
    routesManifest: { value: generated.routes },
  });
  // Channel A has concrete, schema-decoded route arguments while the raw
  // routes manifest contains `$param` templates. Once generated references
  // are admitted, re-project that boot through the same preload producer so
  // qmk1 routes carry generated identity instead of the legacy alias fallback.
  // @ref LLP 0166#registration-sources-mapped-to-shipped-machinery
  if (
    generated.routes !== null
    && typeof client.__replacePreloadManifestInForce === 'function'
  ) {
    const result = await client.__replacePreloadManifestInForce(
      generated.routes,
      client.__inlinePreloadBootPayload,
      { functionReferences: references },
    );
    client.__preloadRegistrationPromise = Promise.resolve(result);
    if (result?.refused) {
      throw diagnosticError(
        result.refused.code,
        'routes-manifest preload registration refused',
        { route: client.__inlinePreloadBootPayload?.route ?? null },
      );
    }
  }
  preparedReactBindingInternals.set(binding, Object.freeze({ referenceSchemaVersion }));
  return Object.freeze(binding);
}

// @ref LLP 0114#local-development-binding-synchronization-dated-amendment-2026-08-03
// — only a live-inspected local-dev/dev mismatch enters this bounded loop;
// every retry re-runs complete admission with receipt fallback disabled.
export async function prepareReactBindingForClient(client, options = {}) {
  const developmentSync = normalizedDevelopmentSyncOptions(options.developmentSync);
  let attempts = 1;
  let firstMismatchAt = null;
  let lastMismatch = null;
  for (;;) {
    try {
      const binding = firstMismatchAt === null
        ? await prepareReactBindingOnce(client, options)
        : await beforeDevelopmentSyncDeadline(
            prepareReactBindingOnce(client, options, { allowPersistedReceipt: false }),
            Math.max(0, developmentSync.timeoutMs - (Date.now() - firstMismatchAt)),
          );
      if (binding === DEVELOPMENT_SYNC_DEADLINE) {
        const timeout = developmentSyncTimeoutError(lastMismatch, {
          timeoutMs: developmentSync.timeoutMs,
          attempts,
        });
        publishDevelopmentSyncState(developmentSync, {
          status: 'timed-out',
          message: 'Client and local backend are still out of sync.',
          attempt: attempts,
          elapsedMs: developmentSync.timeoutMs,
          diagnostic: timeout.diagnostic,
          actions: timeout.actions,
        });
        throw timeout.error;
      }
      if (firstMismatchAt !== null) {
        publishDevelopmentSyncState(developmentSync, {
          status: 'ready',
          message: 'Local backend updated.',
          attempt: attempts,
          elapsedMs: Math.max(0, Date.now() - firstMismatchAt),
          diagnostic: null,
        });
      }
      return binding;
    } catch (error) {
      if (developmentSync === null) throw bindingOriginUnreachableError(client, error);
      const context = error?.[REACT_BINDING_MISMATCH_CONTEXT];
      if (firstMismatchAt === null) {
        if (context?.localDevelopment !== true) {
          throw bindingOriginUnreachableError(client, error);
        }
        firstMismatchAt = Date.now();
      } else if (
        context?.localDevelopment !== true
        && !isConnectivityFailureError(error)
      ) {
        throw error;
      }
      if (context?.localDevelopment === true) lastMismatch = error;
      const elapsedMs = Math.max(0, Date.now() - firstMismatchAt);
      const remainingMs = developmentSync.timeoutMs - elapsedMs;
      if (remainingMs <= 0) {
        const timeout = developmentSyncTimeoutError(lastMismatch, {
          timeoutMs: developmentSync.timeoutMs,
          attempts,
        });
        publishDevelopmentSyncState(developmentSync, {
          status: 'timed-out',
          message: 'Client and local backend are still out of sync.',
          attempt: attempts,
          elapsedMs,
          diagnostic: timeout.diagnostic,
          actions: timeout.actions,
        });
        throw timeout.error;
      }
      publishDevelopmentSyncState(developmentSync, {
        status: 'waiting',
        message: 'Updating local backend…',
        attempt: attempts,
        elapsedMs,
        diagnostic: lastMismatch.diagnostic,
      });
      await sleep(Math.min(developmentSync.pollIntervalMs, remainingMs));
      attempts += 1;
    }
  }
}

export function assertPreparedReactBinding(binding) {
  if (binding?.[PREPARED_REACT_BINDING] === true) return binding;
  throw diagnosticError(
    'SNAPBACK_REACT_BINDING_REQUIRED',
    'SnapbackProvider requires the result of client.prepareReactBinding()',
  );
}

export function preparedReactBindingClient(binding) {
  return assertPreparedReactBinding(binding).client;
}

export function admittedReactQueryGroup(binding, reference) {
  const prepared = assertPreparedReactBinding(binding);
  const expected = prepared.queryGroupsById.get(reference?.id);
  if (
    !reference
    || reference.artifactKind !== 'queryGroupReference'
    || !expected
    || canonicalizeClientValueV1(expected) !== canonicalizeClientValueV1(reference)
  ) {
    throw diagnosticError(
      'SNAPBACK_REACT_GROUP_REFERENCE_INVALID',
      'React query-group preparation requires a complete generated group reference',
      { groupId: reference?.id ?? null },
    );
  }
  return expected;
}

export function admittedReactSurface(binding, reference) {
  const prepared = assertPreparedReactBinding(binding);
  const expected = prepared.surfacesById.get(reference?.id);
  let normalized = null;
  if (reference && expected) {
    normalized = structuredClone(reference);
    for (const namespace of ['reads', 'mutations', 'presence']) {
      for (const [name, member] of Object.entries(normalized[namespace] ?? {})) {
        const expectedMember = expected[namespace]?.[name];
        if (!expectedMember) continue;
        if (namespace === 'presence') {
          const memberReference = member?.reference
            ? {
                ...member.reference,
                withdrawalVisibilityDeadlineMs:
                  member.reference.withdrawalVisibilityDeadlineMs
                  ?? Math.min(Math.floor(member.reference.defaultTtlMs / 2), 10_000),
              }
            : null;
          if (canonicalizeClientValueV1(memberReference) !== canonicalizeClientValueV1(expectedMember.reference)) continue;
        } else if (exactDeploymentFunction(member.reference) !== exactDeploymentFunction(expectedMember.reference)) {
          continue;
        }
        member.reference = expectedMember.reference;
      }
    }
    for (const [name, member] of Object.entries(normalized.assets ?? {})) {
      const expectedMember = expected.assets?.[name];
      if (
        expectedMember
        && canonicalizeClientValueV1(member.reference) === canonicalizeClientValueV1(expectedMember.reference)
      ) member.reference = expectedMember.reference;
    }
    for (const [name, member] of Object.entries(normalized.commands ?? {})) {
      const expectedMember = expected.commands?.[name];
      if (!expectedMember) continue;
      try {
        if (admittedReactCommand(prepared, member.reference) === expectedMember.reference) {
          member.reference = expectedMember.reference;
        }
      } catch { /* final whole-surface comparison reports the refusal */ }
    }
  }
  if (
    !reference
    || reference.artifactKind !== 'surfaceDescriptor'
    || !expected
    || canonicalizeClientValueV1(expected) !== canonicalizeClientValueV1(normalized)
  ) {
    throw diagnosticError(
      'SNAPBACK_REACT_SURFACE_INVALID',
      'surface projection requires a complete generated surface admitted by this binding',
      { surfaceId: reference?.id ?? null },
    );
  }
  return expected;
}

export function admittedReactCommand(binding, reference) {
  const prepared = assertPreparedReactBinding(binding);
  const normalized = structuredClone(reference);
  if (normalized?.mutation?.id) {
    normalized.mutation = prepared.referencesById.get(normalized.mutation.id) ?? normalized.mutation;
  }
  if (normalized?.asset?.intent?.id) {
    normalized.asset.intent = prepared.assetIntentsById.get(normalized.asset.intent.id)
      ?? normalized.asset.intent;
  }
  const expected = prepared.commandsByCanonical.get(canonicalizeClientValueV1(normalized));
  if (!expected) {
    throw diagnosticError(
      'SNAPBACK_REACT_COMMAND_INVALID',
      'command projection requires a complete generated command admitted by this binding',
      { mutationId: reference?.mutation?.id ?? null },
    );
  }
  return expected;
}

export function isPreparedReactQueryGroup(value) {
  return value?.[PREPARED_REACT_QUERY_GROUP] === true;
}

async function releasePreparedQueryGroupOwner(owner, { transferred = false } = {}) {
  if (!owner) return;
  if (owner.status === 'disposed') return owner.cleanup;
  if (owner.status === 'transferred' && !transferred) return;
  owner.status = 'disposed';
  if (owner.expiryTimer !== null) {
    clearTimeout(owner.expiryTimer);
    owner.expiryTimer = null;
  }
  owner.cleanup ??= owner.connectionId === null
    ? Promise.resolve()
    : Promise.resolve(owner.binding.client.releaseConnection?.(owner.connectionId, {
        attachDeadline: owner.attachDeadline,
      })).catch(() => {});
  return owner.cleanup;
}

export function consumePreparedReactQueryGroup(binding, value) {
  const prepared = assertPreparedReactBinding(binding);
  if (!isPreparedReactQueryGroup(value)) {
    throw diagnosticError(
      'SNAPBACK_REACT_GROUP_REFERENCE_INVALID',
      'provider construction requires a prepared query-group capability',
    );
  }
  const owner = preparedReactQueryGroupOwners.get(value);
  if (!owner || owner.binding !== prepared) {
    throw diagnosticError(
      'SNAPBACK_REACT_GROUP_OWNER_MISMATCH',
      'prepared query group belongs to another binding',
      { groupId: value.reference?.id ?? null },
    );
  }
  if (owner.status !== 'available') {
    throw diagnosticError(
      'SNAPBACK_REACT_GROUP_ALREADY_CONSUMED',
      'prepared query group has already been transferred or disposed',
      { groupId: value.reference?.id ?? null, state: owner.status },
    );
  }
  if (
    typeof prepared.client.isAuthorityCaptureCurrent === 'function'
    && !prepared.client.isAuthorityCaptureCurrent(owner.authorityCapture)
  ) {
    void releasePreparedQueryGroupOwner(owner);
    throw diagnosticError(
      'SNAPBACK_REACT_GROUP_AUTHORITY_STALE',
      'prepared query group authority changed before provider adoption',
      { groupId: value.reference?.id ?? null },
    );
  }
  owner.status = 'transferred';
  if (owner.expiryTimer !== null) {
    clearTimeout(owner.expiryTimer);
    owner.expiryTimer = null;
  }
  if (
    value.source === 'registered-bundle'
    && Number.isSafeInteger(owner.attachDeadline)
    && Date.now() >= owner.attachDeadline
  ) {
    void releasePreparedQueryGroupOwner(owner, { transferred: true });
    const recovered = {
      ...value,
      source: 'live-recovery',
      reason: 'attach-deadline-expired',
      connectionId: null,
      boot: null,
      entries: Object.freeze(owner.entries.map((entry) => Object.freeze({
        ...entry,
        registeredSubscription: null,
      }))),
    };
    Object.defineProperty(recovered, PREPARED_REACT_QUERY_GROUP, { value: true });
    preparedReactQueryGroupOwners.set(recovered, owner);
    Object.defineProperty(recovered, 'devUserId', {
      value: owner.devUserId,
      enumerable: false,
    });
    return Object.freeze(recovered);
  }
  const transferred = {
    ...value,
    connectionId: owner.connectionId,
    boot: owner.boot,
    entries: owner.entries,
  };
  Object.defineProperty(transferred, PREPARED_REACT_QUERY_GROUP, { value: true });
  preparedReactQueryGroupOwners.set(transferred, owner);
  Object.defineProperty(transferred, 'devUserId', {
    value: owner.devUserId,
    enumerable: false,
  });
  return Object.freeze(transferred);
}

export function abandonConsumedReactQueryGroup(value) {
  return releasePreparedQueryGroupOwner(
    preparedReactQueryGroupOwners.get(value),
    { transferred: true },
  );
}

// @ref LLP 0090#d12-snapshot-bundle-fetch — register mode creates every
// closed child subscription at the same commit cut; React adopts those exact
// registrations rather than racing a manual prime against later live work.
// @ref LLP 0114#bundle-primed-generated-query-groups — bundle acquisition is
// pre-mount and group-scoped; hooks never arm registrations in an effect.
// @ref LLP 0112#preparation-and-admission — generated identity, exact route
// parameters, capability admission, and one-shot ownership are all settled
// before React can receive the group.
export async function prepareReactQueryGroupForBinding(
  binding,
  reference,
  params = {},
  { fallbackToLive = false, userId } = {},
) {
  const prepared = assertPreparedReactBinding(binding);
  // One consistent admission view for the whole preparation, even if a
  // development generation handoff swaps the overlay mid-flight.
  const functionAdmission = functionAdmissionForBinding(prepared);
  const admitted = admittedReactQueryGroup(prepared, reference);
  const mixed = admitted.formatVersion === 2 && admitted.profile === 'mixed-route.v2';
  const nonLive = admitted.queries.find((query) => query.ref.kind !== 'LiveQuery');
  if (nonLive && !mixed) {
    throw diagnosticError(
      'SNAPBACK_REACT_GROUP_REFERENCE_INVALID',
      'React query groups contain live-query references only',
      { groupId: admitted.id, functionId: nonLive.ref.id, kind: nonLive.ref.kind },
    );
  }
  canonicalizeClientValueV1(params);
  const expectedParams = routeParams(admitted.route).sort();
  const actualParams = Object.keys(params).sort();
  if (
    expectedParams.length !== actualParams.length
    || expectedParams.some((name, index) => name !== actualParams[index])
  ) {
    throw diagnosticError(
      'SNAPBACK_REACT_GROUP_PARAMS_INVALID',
      'query-group params must exactly cover the generated route parameters',
      { expected: expectedParams, actual: actualParams },
    );
  }
  if (
    userId !== undefined
    && (prepared.profile !== 'local-dev-sqlite-ibex' || prepared.authMode !== 'dev')
  ) {
    throw diagnosticError(
      'SNAPBACK_REACT_GROUP_DEV_IDENTITY_FORBIDDEN',
      'query-group userId is admitted only by the settled local dev auth profile',
      { targetProfileId: prepared.profile, authMode: prepared.authMode },
    );
  }
  const authorityCapture = prepared.client.captureAuthority?.() ?? null;
  const entries = admitted.queries.map((query) => Object.freeze({
    name: query.name,
    ref: query.ref,
    args: materializeGroupArgs(query.args, params),
    argsTemplate: query.args,
    ...(mixed ? {
      nodePlan: query.nodePlan,
      nodePlanHash: query.nodePlanHash,
      liveness: query.liveness,
    } : {}),
    registeredSubscription: null,
    readOnlySnapshot: null,
  }));
  const canonicalChildren = new Set();
  for (const entry of entries) {
    const identity = `${entry.ref.id}\u0000${canonicalizeClientValueV1(entry.args)}`;
    if (canonicalChildren.has(identity)) {
      throw diagnosticError(
        'SNAPBACK_REACT_GROUP_DUPLICATE_CHILD',
        'registered query groups cannot repeat an identical function and canonical args',
        { groupId: admitted.id, child: entry.name },
      );
    }
    canonicalChildren.add(identity);
  }
  const makePrepared = ({
    source,
    reason = null,
    boot = null,
    connectionId = null,
    attachDeadline = null,
    resolvedEntries = entries,
  }) => {
    const owner = {
      binding: prepared,
      status: 'available',
      connectionId,
      attachDeadline,
      boot,
      authorityCapture,
      devUserId: userId ?? null,
      entries: Object.freeze(resolvedEntries),
      cleanup: null,
      expiryTimer: null,
    };
    if (connectionId !== null && Number.isSafeInteger(attachDeadline)) {
      owner.expiryTimer = setTimeout(() => {
        if (owner.status === 'available') void releasePreparedQueryGroupOwner(owner);
      }, Math.max(0, attachDeadline - Date.now()));
      owner.expiryTimer.unref?.();
    }
    const result = {
      artifactKind: 'preparedReactQueryGroup',
      source,
      ...(reason === null ? {} : { reason }),
      reference: admitted,
      params: deepFreeze(structuredClone(params)),
      boot,
      entries: Object.freeze(resolvedEntries.map((entry) => Object.freeze({
        name: entry.name,
        ref: entry.ref,
        args: entry.args,
      }))),
    };
    Object.defineProperty(result, PREPARED_REACT_QUERY_GROUP, { value: true });
    preparedReactQueryGroupOwners.set(result, owner);
    Object.defineProperty(result, 'dispose', {
      value: () => releasePreparedQueryGroupOwner(owner),
      enumerable: false,
    });
    Object.defineProperty(result, 'devUserId', {
      value: userId ?? null,
      enumerable: false,
    });
    return Object.freeze(result);
  };
  const requiredBundleCapability = mixed
    ? MIXED_BUNDLE_CAPABILITY
    : REGISTERED_BUNDLE_CAPABILITY;
  const bundleAvailable = mixed
    ? prepared.mixedBundleAvailable
    : prepared.registeredBundleAvailable;
  if (!bundleAvailable) {
    if (fallbackToLive && !mixed) {
      return makePrepared({
        source: 'live-fallback',
        reason: `${requiredBundleCapability}-unavailable`,
      });
    }
    throw diagnosticError(
      'SNAPBACK_REACT_GROUP_REGISTER_UNAVAILABLE',
      `target does not advertise ${requiredBundleCapability}`,
      { capability: requiredBundleCapability },
    );
  }
  if (
    prepared.authMode === 'sessions'
    && prepared.client.authProtocols?.authInvalidation !== 1
  ) {
    throw diagnosticError(
      'SNAPBACK_REACT_GROUP_AUTH_INVALIDATION_REQUIRED',
      'sessions-mode registered groups require authInvalidationProtocol 1',
      { groupId: admitted.id },
    );
  }
  const authorizationNamespaces = prepared.authMode === 'sessions'
    && prepared.client.authProtocols?.authInvalidation === 1
    ? entries.map((entry) => (
        (mixed && entry.liveness.kind === 'none')
          || functionAdmission.authorityIndependentById.get(entry.ref.id) === true
          ? null
          : prepared.client.allocateLiveQueryNamespace(entry.ref, entry.args)
      ))
    : [];
  let bundle;
  bundle = await prepared.client.fetchBundle({
    route: admitted.route,
    params,
    mode: 'register',
    authorityCapture,
    authorizationNamespaces,
    authInvalidationProtocol: prepared.authMode === 'sessions' ? 1 : null,
    __preloadFunctionReferences: Object.fromEntries(
      entries.map((entry) => [entry.ref.name, entry.ref]),
    ),
    __preloadPersist: admitted.persist !== false,
    __preloadRoutesManifest: prepared.routesManifest,
    ...(mixed ? {
      formatVersion: 2,
      profile: 'mixed-route.v2',
      planHash: admitted.planHash,
    } : {}),
    ...(userId === undefined ? {} : { userId }),
  });
  const bundleKeys = Object.keys(bundle ?? {}).sort();
  const connectionKeys = Object.keys(bundle?.connection ?? {}).sort();
  const allowedBundleKeys = [
    ...(mixed ? ['aggregate', 'formatVersion'] : []),
    'commitVersion',
    'connection',
    'entries',
    'generation',
    ...(mixed ? ['planHash', 'profile'] : []),
    'versionStream',
  ].sort();
  const allowedConnectionKeys = [
    'attachDeadline',
    'authorizationInvalidation',
    'connectionId',
    'grant',
  ];
  if (
    bundleKeys.length !== allowedBundleKeys.length
    || bundleKeys.some((key, index) => key !== allowedBundleKeys[index])
    || (mixed && (
      bundle.formatVersion !== 2
      || bundle.profile !== 'mixed-route.v2'
      || bundle.planHash !== admitted.planHash
      || bundle.aggregate?.kind !== 'mixed'
      || bundle.aggregate?.weakest !== 'read-only'
      || bundle.aggregate?.liveChildren
        !== entries.filter((entry) => entry.liveness.kind === 'admitted').length
      || bundle.aggregate?.readOnlyChildren
        !== entries.filter((entry) => entry.liveness.kind === 'none').length
      || Object.keys(bundle.aggregate ?? {}).sort().join(',')
        !== 'kind,liveChildren,readOnlyChildren,weakest'
    ))
    || !Number.isSafeInteger(bundle?.commitVersion)
    || bundle.commitVersion < 0
    || typeof bundle.generation !== 'string'
    || bundle.generation.length === 0
    || typeof bundle.versionStream !== 'string'
    || bundle.versionStream.length === 0
    || typeof bundle.connection?.connectionId !== 'string'
    || bundle.connection.connectionId.length === 0
    || typeof bundle.connection.grant !== 'string'
    || bundle.connection.grant.length === 0
    || !Number.isSafeInteger(bundle.connection.attachDeadline)
    || bundle.connection.attachDeadline < 0
    || connectionKeys.some((key) => !allowedConnectionKeys.includes(key))
    || !['attachDeadline', 'connectionId', 'grant'].every((key) => (
      Object.prototype.hasOwnProperty.call(bundle.connection, key)
    ))
    || !Array.isArray(bundle.entries)
    || bundle.entries.length !== entries.length
  ) {
    if (typeof bundle?.connection?.connectionId === 'string') {
      await prepared.client.releaseConnection?.(bundle.connection.connectionId, {
        attachDeadline: bundle.connection.attachDeadline,
      }).catch(() => {});
    }
    throw diagnosticError(
      'SNAPBACK_REACT_GROUP_BUNDLE_INVALID',
      'register-mode query-group bundle is incomplete',
      { groupId: admitted.id },
    );
  }
  let resolvedEntries;
  try {
    const subscriptionIds = new Set();
    let sawAuthorization = false;
    resolvedEntries = entries.map((entry, index) => {
      const response = bundle.entries[index];
      // @ref LLP 0157#d2--plan-identity — the hash-bound capability fact is
      // the sole classifier. The generated reference kind was cross-checked
      // during binding admission but is never consulted as the liveness
      // oracle at bundle consumption.
      const childLive = mixed
        ? entry.liveness.kind === 'admitted'
        : true;
      const responseKeys = Object.keys(response ?? {}).sort();
      const allowedKeys = [
        'args',
        'authorization',
        ...(mixed ? ['delivery'] : []),
        'function',
        'resume',
        'rows',
        'subscriptionId',
      ];
      if (
        !response
        || response.function !== entry.ref.name
        || !Object.prototype.hasOwnProperty.call(response, 'args')
        || !groupResponseArgsMatch(entry.argsTemplate, params, response.args)
        || !Array.isArray(response.rows)
        || !Object.prototype.hasOwnProperty.call(response, 'resume')
        || responseKeys.some((key) => !allowedKeys.includes(key))
        || (childLive && (
          typeof response.subscriptionId !== 'string'
          || response.subscriptionId.length === 0
          || subscriptionIds.has(response.subscriptionId)
        ))
        || (!childLive && Object.prototype.hasOwnProperty.call(response, 'subscriptionId'))
        || (mixed && (
          response.delivery?.kind !== (childLive ? 'registered-live' : 'read-only')
          || response.delivery?.nodePlanHash !== entry.nodePlanHash
          || Object.keys(response.delivery ?? {}).sort().join(',') !== 'kind,nodePlanHash'
        ))
      ) {
        throw diagnosticError(
          'SNAPBACK_REACT_GROUP_BUNDLE_INVALID',
          'register-mode query-group bundle does not exactly match manifest order',
          {
            groupId: admitted.id,
            child: entry.name,
            index,
            expectedFunction: entry.ref.name,
            actualFunction: response?.function ?? null,
            argsMatch: groupResponseArgsMatch(entry.argsTemplate, params, response?.args),
            responseKeys,
            expectedNodePlanHash: mixed ? entry.nodePlanHash : null,
            actualDelivery: response?.delivery ?? null,
          },
        );
      }
      if (childLive) subscriptionIds.add(response.subscriptionId);
      let resume = null;
      if (response.resume !== null) {
        const resumeKeys = Object.keys(response.resume ?? {}).sort();
        const metaKeys = Object.keys(response.resume?.meta ?? {}).sort();
        const expectedMetaKeys = [
          'app',
          'argsHash',
          'contentDigest',
          'generation',
          'queryArtifact',
          'version',
          'versionStream',
        ];
        if (
          !response.resume
          || typeof response.resume !== 'object'
          || resumeKeys.length !== 2
          || resumeKeys[0] !== 'meta'
          || resumeKeys[1] !== 'token'
          || typeof response.resume.token !== 'string'
          || response.resume.token.length === 0
          || response.resume.token.length > 1_024
          || !response.resume.token.startsWith('sbrt1.')
          || !response.resume.meta
          || typeof response.resume.meta !== 'object'
          || Array.isArray(response.resume.meta)
          || metaKeys.length !== expectedMetaKeys.length
          || metaKeys.some((key, index) => key !== expectedMetaKeys[index])
          || !Number.isSafeInteger(response.resume.meta.version)
          || response.resume.meta.version < 0
          || expectedMetaKeys
            .filter((key) => key !== 'version')
            .some((key) => (
              typeof response.resume.meta[key] !== 'string'
              || response.resume.meta[key].length === 0
            ))
          || response.resume.meta.version !== bundle.commitVersion
          || response.resume.meta.app !== prepared.appId
          || response.resume.meta.generation !== bundle.generation
          || response.resume.meta.versionStream !== bundle.versionStream
          || response.resume.meta.queryArtifact
            !== functionAdmission.queryArtifactsById.get(entry.ref.id)
          || response.resume.meta.argsHash !== argsHash(response.args)
          || !rowsMatchDigest(response.rows, response.resume.meta.contentDigest)
        ) {
          throw diagnosticError(
            'SNAPBACK_REACT_GROUP_BUNDLE_INVALID',
            'register-mode query-group bundle carries an invalid resume value',
            { groupId: admitted.id, child: entry.name },
          );
        }
        canonicalizeClientValueV1(response.resume);
        resume = deepFreeze(structuredClone(response.resume));
      }
      let authorization = null;
      const expectsAuthorization = childLive && prepared.authMode === 'sessions'
        && functionAdmission.authorityIndependentById.get(entry.ref.id) !== true;
      const carriesAuthorization = Object.prototype.hasOwnProperty.call(
        response,
        'authorization',
      );
      if (carriesAuthorization !== expectsAuthorization) {
        throw diagnosticError(
          'SNAPBACK_REACT_GROUP_BUNDLE_INVALID',
          expectsAuthorization
            ? 'auth-scoped registered child lacks the closed authorization projection'
            : 'authority-independent registered child unexpectedly carries an authorization projection',
          { groupId: admitted.id, child: entry.name },
        );
      }
      if (carriesAuthorization) {
        const keys = Object.keys(response.authorization ?? {}).sort();
        if (
          keys.length !== 2
          || keys[0] !== 'invalidation'
          || keys[1] !== 'scope'
          || !response.authorization.scope
          || typeof response.authorization.scope !== 'object'
          || response.authorization.invalidation === undefined
        ) {
          throw diagnosticError(
            'SNAPBACK_REACT_GROUP_BUNDLE_INVALID',
            'auth-scoped registered child lacks the closed authorization projection',
            { groupId: admitted.id, child: entry.name },
          );
        }
        let normalizedScope;
        try {
          normalizedScope = validateScopeId(
            response.authorization.scope,
            `bundle.entries[${index}].authorization.scope`,
          );
        } catch {
          throw diagnosticError(
            'SNAPBACK_REACT_GROUP_BUNDLE_INVALID',
            'auth-scoped registered child carries an invalid scope',
            { groupId: admitted.id, child: entry.name },
          );
        }
        const expectedNamespace = authorizationNamespaces[index] ?? null;
        if (
          normalizedScope.kind !== 'subscription'
          || normalizedScope.subscriptionId !== response.subscriptionId
          || expectedNamespace === null
          || canonicalizeClientValueV1(normalizedScope.namespace)
            !== canonicalizeClientValueV1(expectedNamespace)
        ) {
          throw diagnosticError(
            'SNAPBACK_REACT_GROUP_BUNDLE_INVALID',
            'auth-scoped registered child crossed its positional namespace',
            { groupId: admitted.id, child: entry.name },
          );
        }
        canonicalizeClientValueV1(response.authorization.invalidation);
        authorization = deepFreeze(structuredClone(response.authorization));
        sawAuthorization = true;
      }
      const contract = functionAdmission.resultContractsById.get(entry.ref.id);
      const verdict = contract?.validator.validate(response.rows);
      if (!verdict?.ok) {
        throw diagnosticError(
          'SNAPBACK_REACT_GROUP_BUNDLE_INVALID',
          'registered child rows fail the generated result contract',
          {
            groupId: admitted.id,
            child: entry.name,
            path: verdict?.path ?? null,
          },
        );
      }
      const acceptedRows = deepFreeze(structuredClone(verdict.value));
      return Object.freeze({
        name: entry.name,
        ref: entry.ref,
        args: deepFreeze(structuredClone(response.args)),
        ...(mixed ? {
          bootDelivery: childLive ? 'registered-live' : 'read-only',
        } : {}),
        registeredSubscription: childLive
          ? Object.freeze({
              subscriptionId: response.subscriptionId,
              rows: acceptedRows,
              version: bundle.commitVersion,
              resume,
              authorization,
              authorizationNamespace: authorizationNamespaces[index] ?? null,
              attachDeadline: bundle.connection.attachDeadline,
            })
          : null,
        readOnlySnapshot: childLive
          ? null
          : Object.freeze({
              rows: acceptedRows,
              version: bundle.commitVersion,
              resume,
              delivery: 'read-only',
            }),
      });
    });
    if (
      sawAuthorization
      && (
        !bundle.connection.authorizationInvalidation
        || typeof bundle.connection.authorizationInvalidation !== 'object'
      )
    ) {
      throw diagnosticError(
        'SNAPBACK_REACT_GROUP_BUNDLE_INVALID',
        'auth-scoped registered bundle lacks its connection authorization projection',
        { groupId: admitted.id },
      );
    }
    if (
      typeof prepared.client.isAuthorityCaptureCurrent === 'function'
      && !prepared.client.isAuthorityCaptureCurrent(authorityCapture)
    ) {
      throw diagnosticError(
        'SNAPBACK_REACT_GROUP_AUTHORITY_STALE',
        'query-group authority changed before bundle publication',
        { groupId: admitted.id },
      );
    }
  } catch (error) {
    await prepared.client.releaseConnection?.(bundle.connection.connectionId, {
      attachDeadline: bundle.connection.attachDeadline,
    }).catch(() => {});
    throw error;
  }
  return makePrepared({
    source: 'registered-bundle',
    connectionId: bundle.connection.connectionId,
    attachDeadline: bundle.connection.attachDeadline,
    boot: Object.freeze({
      source: 'registered-bundle',
      commitVersion: bundle.commitVersion,
      generation: bundle.generation,
      versionStream: bundle.versionStream,
      attachDeadline: bundle.connection.attachDeadline,
      ...(mixed ? {
        profile: 'mixed-route.v2',
        weakest: 'read-only',
        liveChildren: bundle.aggregate.liveChildren,
        readOnlyChildren: bundle.aggregate.readOnlyChildren,
      } : {}),
    }),
    resolvedEntries,
  });
}

export function admittedReactReference(binding, reference, expectedKind) {
  const prepared = assertPreparedReactBinding(binding);
  if (!reference || typeof reference !== 'object') {
    throw diagnosticError(
      'SNAPBACK_REACT_REFERENCE_INVALID',
      'React hooks require a generated function reference',
    );
  }
  const admitted = functionAdmissionForBinding(prepared).referencesById.get(reference.id);
  const complete = admitted && exactDeploymentFunction(admitted) === exactDeploymentFunction(reference);
  if (!complete || admitted.appId !== prepared.appId) {
    throw diagnosticError(
      'SNAPBACK_REACT_REFERENCE_INVALID',
      'generated function reference was not admitted by this prepared binding',
      { functionId: reference.id ?? null },
    );
  }
  const expected = Array.isArray(expectedKind) ? expectedKind : [expectedKind];
  if (!expected.includes(admitted.kind)) {
    throw diagnosticError(
      'SNAPBACK_REACT_REFERENCE_INVALID',
      `expected ${expected.join('/')} reference, received ${admitted.kind}`,
      { functionId: admitted.id, kind: admitted.kind },
    );
  }
  return admitted;
}

export function preparedReactResultContract(binding, reference) {
  const admitted = admittedReactReference(binding, reference, reference?.kind);
  return functionAdmissionForBinding(assertPreparedReactBinding(binding))
    .resultContractsById.get(admitted.id) ?? null;
}

export function admittedReactEphemeralDefinition(binding, reference) {
  const prepared = assertPreparedReactBinding(binding);
  const expected = prepared.ephemeralDefinitionsById.get(reference?.id);
  if (
    !reference
    || reference.artifactKind !== 'ephemeralCollectionReference'
    || !expected
    || canonicalizeClientValueV1(expected.reference)
      !== canonicalizeClientValueV1(reference)
  ) {
    throw diagnosticError(
      'SNAPBACK_REACT_REFERENCE_INVALID',
      'React presence requires a complete generated ephemeral collection reference admitted by this binding',
      { collectionId: reference?.id ?? null },
    );
  }
  if (expected.reference.keyMode !== 'Connection') {
    throw diagnosticError(
      'SNAPBACK_REACT_PRESENCE_KEY_MODE_UNSUPPORTED',
      'React presence v1 supports connection-owned ephemeral collections only',
      { collectionId: expected.reference.id, keyMode: expected.reference.keyMode },
    );
  }
  return expected;
}

// --- Mounted-provider HMR generation handoff (development only) -------------
//
// Metro/Vite HMR can hot-replace the generated api module while the mounted
// provider keeps a prepared binding admitted from the previous codegen
// generation. Hooks then present a valid new-generation reference to
// old-generation admission state, and the strict refusal above becomes an
// uncaught render error. The machinery below lets the React arm classify that
// exact split (same app, complete reference, a different `expectedGeneration`
// than the currently admitted deployment identity) and re-run complete
// per-function admission against the LIVE deployment, publishing the new
// generation's admission view in one synchronous swap. Admission strictness
// is unchanged: a reference still admits only by exact identity match against
// deployment-proved facts, and the caller (the React provider) arms this path
// only on a positive development/HMR signal.
// @ref LLP 0114#mounted-provider-hmr-generation-handoff-dated-amendment-2026-08-05

const GENERATION_FIELDS = Object.freeze([
  'schemaVersion',
  'appId',
  'schemaHash',
  'bundleHash',
  'inputsHash',
]);
const REFERENCE_IDENTITY_FIELDS = Object.freeze([
  'id',
  'name',
  'kind',
  'implementationHash',
  'argsContractHash',
  'resultContractHash',
]);

export function activeReactBindingDeploymentIdentity(binding) {
  const prepared = assertPreparedReactBinding(binding);
  return preparedReactBindingGenerationOverlays.get(prepared)?.deploymentIdentity
    ?? prepared.deploymentIdentity;
}

function completeGeneration(value, appId) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && !GENERATION_FIELDS.some((field) => (
      typeof value[field] !== 'string' || value[field].length === 0
    ))
    && value.appId === appId;
}

/**
 * Positively identify a regenerated-same-app reference: complete function
 * reference, same appId, and a complete `expectedGeneration` naming a
 * DIFFERENT generation than the currently admitted deployment identity.
 * Anything else (foreign appId, missing generation stamp, same-generation
 * corruption) returns null so the strict refusal stands.
 */
export function classifyRegeneratedReactReference(binding, reference) {
  if (binding?.[PREPARED_REACT_BINDING] !== true) return null;
  if (
    !reference
    || typeof reference !== 'object'
    || reference.artifactKind !== 'functionReference'
    || reference.appId !== binding.appId
    || REFERENCE_IDENTITY_FIELDS.some((field) => (
      typeof reference[field] !== 'string' || reference[field].length === 0
    ))
  ) return null;
  const generation = reference.expectedGeneration;
  if (!completeGeneration(generation, binding.appId)) return null;
  const current = activeReactBindingDeploymentIdentity(binding);
  const differs = generation.bundleHash !== current.bundleHash
    || (current.schemaHash !== null && generation.schemaHash !== current.schemaHash)
    || (current.inputsHash !== null && generation.inputsHash !== current.inputsHash);
  if (!differs) return null;
  return Object.freeze({
    schemaVersion: generation.schemaVersion,
    appId: generation.appId,
    schemaHash: generation.schemaHash,
    bundleHash: generation.bundleHash,
    inputsHash: generation.inputsHash,
  });
}

/**
 * Re-admit a mounted prepared binding against the live deployment for a
 * regenerated generation (development HMR only — the caller owns the positive
 * development signal). Resolves `{ ok: true, generation }` once the complete
 * new-generation admission view is published, or `{ ok: false, reason }` when
 * the deployment never reached the target inside the budget or the change is
 * not atomically re-provable (routes/ephemeral/group shape changed), in which
 * case the caller must fall back to a controlled full reload. Never rejects
 * for expected outcomes. Single-flight per binding and target generation.
 */
export function handoffPreparedReactBindingGeneration(binding, targetGeneration, options = {}) {
  const prepared = assertPreparedReactBinding(binding);
  if (!completeGeneration(targetGeneration ?? null, prepared.appId)) {
    throw new TypeError(
      'handoffPreparedReactBindingGeneration requires the complete expectedGeneration of a regenerated reference for the same app',
    );
  }
  const budget = {
    timeoutMs: boundedMilliseconds(
      options.timeoutMs,
      DEFAULT_DEVELOPMENT_SYNC_TIMEOUT_MS,
      'timeoutMs',
      MAX_DEVELOPMENT_SYNC_TIMEOUT_MS,
    ),
    pollIntervalMs: boundedMilliseconds(
      options.pollIntervalMs,
      DEFAULT_DEVELOPMENT_SYNC_POLL_INTERVAL_MS,
      'pollIntervalMs',
      MAX_DEVELOPMENT_SYNC_POLL_INTERVAL_MS,
    ),
  };
  const target = Object.freeze({
    schemaVersion: targetGeneration.schemaVersion,
    appId: targetGeneration.appId,
    schemaHash: targetGeneration.schemaHash,
    bundleHash: targetGeneration.bundleHash,
    inputsHash: targetGeneration.inputsHash,
  });
  const active = activeReactBindingDeploymentIdentity(prepared);
  if (
    active.bundleHash === target.bundleHash
    && active.schemaHash === target.schemaHash
    && active.inputsHash === target.inputsHash
  ) {
    return Promise.resolve({ ok: true, generation: active });
  }
  const key = canonicalizeClientValueV1(target);
  const existing = preparedReactBindingGenerationHandoffs.get(prepared);
  if (existing?.key === key) return existing.promise;
  const entry = { key, promise: null };
  // The admission compiler and RQS digest helpers are needed only after a
  // positive development/HMR signal. Keep that failure-only path outside the
  // production React entry closure, matching react-runtime.mjs.
  entry.promise = import('./react-binding-hmr.mjs')
    .then(({ runPreparedReactBindingGenerationHandoff }) => (
      runPreparedReactBindingGenerationHandoff({
        binding: prepared,
        target,
        budget,
        referenceSchemaVersion:
          preparedReactBindingInternals.get(prepared)?.referenceSchemaVersion ?? null,
        publishOverlay(overlay) {
          // Atomic swap: the runtime verified the complete generation off to
          // the side; this one synchronous write publishes it.
          preparedReactBindingGenerationOverlays.set(prepared, overlay);
        },
      })
    ))
    .finally(() => {
      if (preparedReactBindingGenerationHandoffs.get(prepared) === entry) {
        preparedReactBindingGenerationHandoffs.delete(prepared);
      }
    });
  preparedReactBindingGenerationHandoffs.set(prepared, entry);
  return entry.promise;
}
