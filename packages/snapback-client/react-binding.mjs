import { canonicalizeClientValueV1 } from './canonical-client-value.mjs';
import { compileResultContractValidator } from '@snapback/contract/result-contract-validator';
import { validateScopeId } from '@snapback/contract/auth-invalidation';
import {
  argsHash,
  queryArtifactHash,
  rowsMatchDigest,
} from './rqs.mjs';

// @ref LLP 0102#prepared-binding-and-provider-ownership — asynchronous
// deployment admission is completed before a synchronous React provider may
// be constructed.

const PREPARED_REACT_BINDING = Symbol('snapback.prepared-react-binding.v1');
const PREPARED_REACT_QUERY_GROUP = Symbol('snapback.prepared-react-query-group.v1');
const preparedReactQueryGroupOwners = new WeakMap();
const REGISTERED_BUNDLE_CAPABILITY = 'registered_bundle_boot_v1';
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

async function sha256Canonical(value) {
  const bytes = utf8.encode(canonicalizeClientValueV1(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

async function sha256Text(value) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', utf8.encode(value));
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

async function resultContractHash(value) {
  const canonicalJson = (input) => JSON.stringify(input, (_key, child) => (
    child && typeof child === 'object' && !Array.isArray(child)
      ? Object.fromEntries(Object.keys(child).sort().map((key) => [key, child[key]]))
      : child
  ));
  const bytes = utf8.encode(
    `snapback:function-result:v1\n${canonicalJson(value)}`,
  );
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function publicReference(definition, fallbackAppId, fallbackSchemaVersion) {
  const reference = {
    artifactKind: 'functionReference',
    schemaVersion: definition?.schemaVersion ?? fallbackSchemaVersion,
    appId: definition?.appId ?? fallbackAppId,
    id: definition?.id,
    name: definition?.name ?? definition?.exportedName,
    kind: definition?.kind,
    implementationHash: definition?.implementationHash,
    argsContractHash: definition?.argsContractHash,
    resultContractHash: definition?.resultContractHash,
  };
  for (const field of Object.keys(reference)) {
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

function materializeGroupArgs(mapping, params) {
  const output = {};
  for (const [name, value] of Object.entries(mapping ?? {})) {
    if (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && Object.keys(value).length === 1
      && typeof value.$param === 'string'
    ) {
      output[name] = params[value.$param];
    } else {
      output[name] = structuredClone(value);
    }
  }
  return deepFreeze(output);
}

function groupResponseArgsMatch(mapping, params, actual) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
  const expectedKeys = Object.keys(mapping ?? {}).sort();
  const actualKeys = Object.keys(actual).sort();
  if (
    expectedKeys.length !== actualKeys.length
    || expectedKeys.some((key, index) => key !== actualKeys[index])
  ) return false;
  return expectedKeys.every((name) => {
    const template = mapping[name];
    if (
      template
      && typeof template === 'object'
      && !Array.isArray(template)
      && Object.keys(template).length === 1
      && typeof template.$param === 'string'
    ) {
      const raw = params[template.$param];
      const decoded = actual[name];
      return typeof decoded === 'string' && decoded === raw;
    }
    return canonicalizeClientValueV1(template)
      === canonicalizeClientValueV1(actual[name]);
  });
}

export async function prepareReactBindingForClient(client, options = {}) {
  if (!client || typeof client.inspect !== 'function' || typeof client.liveQuery !== 'function') {
    throw new TypeError('prepareReactBinding requires a SnapbackClient');
  }
  const generated = normalizedManifest(options.generatedManifest);
  const [inspection, session] = await Promise.all([
    client.inspect(),
    typeof client.authSession === 'function'
      ? client.authSession()
      : Promise.resolve(null),
  ]);
  const deployed = inspection?.functions;
  if (
    deployed?.appId !== generated.functions.appId
    || deployed?.bundleHash !== generated.functions.bundleHash
  ) {
    throw diagnosticError(
      'SNAPBACK_REACT_BINDING_MISMATCH',
      'generated manifest does not match the connected deployment',
      {
        expectedAppId: generated.functions.appId,
        actualAppId: deployed?.appId ?? null,
        expectedBundleHash: generated.functions.bundleHash,
        actualBundleHash: deployed?.bundleHash ?? null,
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
  // Generated function references belong to the public generated-artifact
  // grammar (`snapback.v0` today), while the admitted function manifest may
  // use the sessions carrier grammar (`snapback.v1`). The capability manifest
  // carries the former and keeps prepared refs byte-identical to api.mjs.
  const referenceSchemaVersion = generated.capabilityManifest?.schemaVersion
    ?? generated.functions.schemaVersion;
  for (const definition of generated.functions.functions) {
    const reference = publicReference(
      definition,
      generated.functions.appId,
      referenceSchemaVersion,
    );
    const actual = deployedFunctions.get(reference.id);
    if (
      !actual
      || exactDeploymentFunction(actual) !== exactDeploymentFunction(reference)
      || (actual.authorityIndependent === true)
        !== (definition.authorityIndependent === true)
    ) {
      throw diagnosticError(
        'SNAPBACK_REACT_BINDING_MISMATCH',
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
    queryArtifactsById.set(reference.id, queryArtifactHash(definition));
    authorityIndependentById.set(
      reference.id,
      definition.authorityIndependent === true,
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
      throw diagnosticError(
        'SNAPBACK_REACT_BINDING_MISMATCH',
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
  if (generated.schema !== null) {
    if (
      generated.schema?.artifactKind !== 'schemaManifest'
      || generated.schema.appId !== generated.functions.appId
      || generated.schema.schemaHash !== inspection.schema?.schemaHash
      || !Array.isArray(generated.schema.ephemeralCollections)
    ) {
      throw diagnosticError(
        'SNAPBACK_REACT_BINDING_MISMATCH',
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
        throw diagnosticError(
          'SNAPBACK_REACT_BINDING_MISMATCH',
          `generated ephemeral collection ${definition.name} does not match the connected deployment`,
          { collection: definition.name },
        );
      }
      const reference = Object.freeze({
        artifactKind: 'ephemeralCollectionReference',
        schemaVersion: generated.schema.schemaVersion,
        appId: generated.schema.appId,
        id: `${generated.schema.appId}:ephemeral:${definition.name}`,
        name: definition.name,
        keyMode: definition.keyMode,
        scopeFields: Object.freeze([...definition.scopeFields]),
        routingFields: Object.freeze([...definition.routingFields]),
        defaultTtlMs: definition.defaultTtlMs,
        maxTtlMs: definition.maxTtlMs,
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
  let routeManifestHash = 'absent';
  if (generated.routes !== null) {
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
      throw diagnosticError(
        'SNAPBACK_REACT_BINDING_MISMATCH',
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
      if (routeEntry.registerGroupEligible !== true) continue;
      const occurrences = new Map();
      const usedNames = new Set();
      const queries = [];
      for (const query of routeEntry.queries) {
        const reference = references[query?.function];
        if (!reference || reference.kind !== 'LiveQuery') {
          throw diagnosticError(
            'SNAPBACK_REACT_MANIFEST_INVALID',
            'generated register-eligible query group names an unknown or non-live function',
            { route: routeEntry.route, function: query?.function ?? null },
          );
        }
        queries.push(Object.freeze({
          name: queryGroupEntryName(reference.name, occurrences, usedNames),
          ref: reference,
          args: deepFreeze(structuredClone(query.args ?? {})),
        }));
      }
      const definition = {
        route: routeEntry.route,
        queries: routeEntry.queries,
        ...(routeEntry.persist === false ? { persist: false } : {}),
      };
      const reference = Object.freeze({
        artifactKind: 'queryGroupReference',
        formatVersion: 1,
        schemaVersion: referenceSchemaVersion,
        appId: generated.functions.appId,
        id: `${generated.functions.appId}:query-group:${routeEntry.route}`,
        route: routeEntry.route,
        definitionHash: await sha256Text(
          `snapback:query-group-reference:v1\n${canonicalizeClientValueV1(definition)}`,
        ),
        queries: Object.freeze(queries),
        ...(routeEntry.persist === false ? { persist: false } : {}),
      });
      queryGroups[routeEntry.route] = reference;
      queryGroupsById.set(reference.id, reference);
    }
  }
  Object.freeze(references);
  Object.freeze(ephemeralReferences);
  Object.freeze(queryGroups);
  const functionCatalogDigest = await sha256Canonical(Object.values(references));
  const capabilityDigest = await sha256Canonical(inspection.capabilityManifest);
  const registeredBundleAvailable = Array.isArray(
    inspection.capabilityManifest?.supportedCapabilities,
  ) && inspection.capabilityManifest.supportedCapabilities.includes(
    REGISTERED_BUNDLE_CAPABILITY,
  );
  if (generated.capabilityManifest) {
    const declaredProfile = generated.capabilityManifest.targetProfileId;
    if (declaredProfile && declaredProfile !== inspection.targetProfileId) {
      throw diagnosticError(
        'SNAPBACK_REACT_BINDING_MISMATCH',
        'generated capability profile does not match the connected deployment',
        { expectedProfile: declaredProfile, actualProfile: inspection.targetProfileId ?? null },
      );
    }
  }
  const deploymentIdentity = Object.freeze({
    targetProfileId: inspection.targetProfileId,
    target: inspection.target,
    schemaHash: inspection.schema?.schemaHash ?? null,
    bundleHash: deployed.bundleHash,
    inputsHash: deployed.inputsHash ?? null,
  });
  const binding = {
    appId: generated.functions.appId,
    profile: inspection.targetProfileId,
    deploymentIdentity,
    authMode: session?.activeMode ?? null,
    routeManifestHash,
    registeredBundleAvailable,
    functionCatalogDigest,
    capabilityDigest,
    references,
    ephemeral: ephemeralReferences,
    groups: queryGroups,
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
  });
  return Object.freeze(binding);
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
// @ref LLP 0102#bundle-primed-generated-query-groups — bundle acquisition is
// pre-mount and group-scoped; hooks never arm registrations in an effect.
// @ref LLP 0107#preparation-and-admission — generated identity, exact route
// parameters, capability admission, and one-shot ownership are all settled
// before React can receive the group.
export async function prepareReactQueryGroupForBinding(
  binding,
  reference,
  params = {},
  { fallbackToLive = false, userId } = {},
) {
  const prepared = assertPreparedReactBinding(binding);
  const admitted = admittedReactQueryGroup(prepared, reference);
  const nonLive = admitted.queries.find((query) => query.ref.kind !== 'LiveQuery');
  if (nonLive) {
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
    registeredSubscription: null,
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
  if (!prepared.registeredBundleAvailable) {
    if (fallbackToLive) {
      return makePrepared({
        source: 'live-fallback',
        reason: 'registered_bundle_boot_v1-unavailable',
      });
    }
    throw diagnosticError(
      'SNAPBACK_REACT_GROUP_REGISTER_UNAVAILABLE',
      'target does not advertise registered_bundle_boot_v1',
      { capability: REGISTERED_BUNDLE_CAPABILITY },
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
        prepared.authorityIndependentById.get(entry.ref.id) === true
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
    ...(userId === undefined ? {} : { userId }),
  });
  const bundleKeys = Object.keys(bundle ?? {}).sort();
  const connectionKeys = Object.keys(bundle?.connection ?? {}).sort();
  const allowedBundleKeys = [
    'commitVersion',
    'connection',
    'entries',
    'generation',
    'versionStream',
  ];
  const allowedConnectionKeys = [
    'attachDeadline',
    'authorizationInvalidation',
    'connectionId',
    'grant',
  ];
  if (
    bundleKeys.length !== allowedBundleKeys.length
    || bundleKeys.some((key, index) => key !== allowedBundleKeys[index])
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
      const responseKeys = Object.keys(response ?? {}).sort();
      const allowedKeys = [
        'args',
        'authorization',
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
        || typeof response.subscriptionId !== 'string'
        || response.subscriptionId.length === 0
        || subscriptionIds.has(response.subscriptionId)
        || !Array.isArray(response.rows)
        || !Object.prototype.hasOwnProperty.call(response, 'resume')
        || responseKeys.some((key) => !allowedKeys.includes(key))
      ) {
        throw diagnosticError(
          'SNAPBACK_REACT_GROUP_BUNDLE_INVALID',
          'register-mode query-group bundle does not exactly match manifest order',
          { groupId: admitted.id, child: entry.name, index },
        );
      }
      subscriptionIds.add(response.subscriptionId);
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
            !== prepared.queryArtifactsById.get(entry.ref.id)
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
      const expectsAuthorization = prepared.authMode === 'sessions'
        && prepared.authorityIndependentById.get(entry.ref.id) !== true;
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
      const contract = prepared.resultContractsById.get(entry.ref.id);
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
      return Object.freeze({
        name: entry.name,
        ref: entry.ref,
        args: deepFreeze(structuredClone(response.args)),
        registeredSubscription: Object.freeze({
          subscriptionId: response.subscriptionId,
          rows: deepFreeze(structuredClone(verdict.value)),
          version: bundle.commitVersion,
          resume,
          authorization,
          authorizationNamespace: authorizationNamespaces[index] ?? null,
          attachDeadline: bundle.connection.attachDeadline,
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
  const admitted = prepared.referencesById.get(reference.id);
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
  return assertPreparedReactBinding(binding).resultContractsById.get(admitted.id) ?? null;
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
